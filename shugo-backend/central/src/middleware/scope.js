// middleware/scope.js
// Middleware de gestion des scopes et permissions géographiques

const { User, Location, Group, UserMission } = require('../models');
const { Op } = require('sequelize');

/**
 * Types de scopes disponibles
 */
const SCOPE_TYPES = {
  GLOBAL: 'global',      // Accès total
  REGIONAL: 'regional',  // Accès régional (ex: FR, ES)
  LOCAL: 'local',        // Accès local (ex: FR-06, FR-83)
  GROUP: 'group',        // Accès limité à un groupe
  SELF: 'self'          // Accès limité à ses propres données
};

/**
 * Hiérarchie des scopes (du plus large au plus restrictif)
 */
const SCOPE_HIERARCHY = {
  'global': 5,
  'regional': 4,
  'local': 3,
  'group': 2,
  'self': 1
};

/**
 * Middleware pour vérifier le scope géographique
 * @param {Object} options - Options de configuration
 * @param {string} options.requiredScope - Scope minimum requis
 * @param {string} options.resourceGeoId - Fonction/valeur pour obtenir le geo_id de la ressource
 * @param {boolean} options.allowParent - Autoriser l'accès depuis un scope parent
 * @param {boolean} options.allowChildren - Autoriser l'accès aux scopes enfants
 * @param {boolean} options.checkMissions - Vérifier les missions temporaires
 */
function requireScope(options = {}) {
  const {
    requiredScope = SCOPE_TYPES.LOCAL,
    resourceGeoId = null,
    allowParent = true,
    allowChildren = false,
    checkMissions = true,
    errorMessage = 'Accès non autorisé pour ce scope géographique'
  } = options;

  return async (req, res, next) => {
    try {
      // Vérifier l'authentification
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'SHUGO-SCOPE-001',
            message: 'Authentication requise'
          }
        });
      }

      // Récupérer le geo_id de la ressource
      const targetGeoId = await resolveResourceGeoId(resourceGeoId, req);
      
      // Si pas de geo_id cible, vérifier le scope général de l'utilisateur
      if (!targetGeoId) {
        const hasScope = await checkUserScope(req.user.member_id, requiredScope);
        
        if (hasScope) {
          req.userScope = hasScope;
          return next();
        }
        
        return sendScopeError(res, errorMessage);
      }

      // Vérifier l'accès à la ressource spécifique
      const access = await checkResourceAccess({
        userId: req.user.member_id,
        userGeoId: req.user.geo_id,
        targetGeoId,
        requiredScope,
        allowParent,
        allowChildren,
        checkMissions
      });

      if (!access.granted) {
        return sendScopeError(res, access.message || errorMessage);
      }

      // Ajouter les infos de scope à la requête
      req.userScope = access.scope;
      req.scopePermissions = access.permissions;

      next();

    } catch (error) {
      console.error('Scope middleware error:', error);
      
      return res.status(500).json({
        success: false,
        error: {
          code: 'SHUGO-SCOPE-500',
          message: 'Erreur de vérification du scope'
        }
      });
    }
  };
}

/**
 * Middleware pour vérifier l'accès multi-scope
 */
function requireMultiScope(scopes = []) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'SHUGO-SCOPE-001',
            message: 'Authentication requise'
          }
        });
      }

      // Vérifier si l'utilisateur a au moins un des scopes requis
      for (const scope of scopes) {
        const hasScope = await checkUserScope(req.user.member_id, scope);
        
        if (hasScope) {
          req.userScope = hasScope;
          return next();
        }
      }

      return sendScopeError(res, `Un des scopes suivants est requis: ${scopes.join(', ')}`);

    } catch (error) {
      console.error('Multi-scope middleware error:', error);
      return res.status(500).json({
        success: false,
        error: {
          code: 'SHUGO-SCOPE-500',
          message: 'Erreur de vérification multi-scope'
        }
      });
    }
  };
}

/**
 * Middleware pour limiter l'accès à sa propre zone géographique
 */
function limitToOwnGeo(options = {}) {
  const {
    allowParent = false,
    allowChildren = true,
    strict = false
  } = options;

  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'SHUGO-SCOPE-001',
            message: 'Authentication requise'
          }
        });
      }

      // En mode strict, seul le geo_id exact est autorisé
      if (strict) {
        req.allowedGeoIds = [req.user.geo_id];
      } else {
        // Récupérer les geo_ids autorisés
        const allowedGeos = await getAllowedGeoIds({
          baseGeoId: req.user.geo_id,
          allowParent,
          allowChildren
        });
        
        req.allowedGeoIds = allowedGeos;
      }

      // Filtrer automatiquement les requêtes
      if (req.query.geo_id && !req.allowedGeoIds.includes(req.query.geo_id)) {
        return sendScopeError(res, 'Accès non autorisé à cette zone géographique');
      }

      next();

    } catch (error) {
      console.error('Limit to own geo error:', error);
      next();
    }
  };
}

/**
 * Middleware pour vérifier les permissions de groupe
 */
function requireGroupScope(options = {}) {
  const {
    groupId = null,
    minRole = 'member',
    checkOwnership = false
  } = options;

  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'SHUGO-SCOPE-001',
            message: 'Authentication requise'
          }
        });
      }

      const targetGroupId = groupId || req.params.group_id || req.query.group_id;
      
      if (!targetGroupId) {
        return sendScopeError(res, 'ID de groupe requis');
      }

      // Vérifier l'appartenance au groupe
      const membership = await checkGroupMembership({
        userId: req.user.member_id,
        groupId: targetGroupId,
        minRole
      });

      if (!membership.isMember) {
        return sendScopeError(res, 'Vous n\'êtes pas membre de ce groupe');
      }

      if (checkOwnership && !membership.isOwner) {
        return sendScopeError(res, 'Seul le propriétaire du groupe peut effectuer cette action');
      }

      req.groupMembership = membership;
      next();

    } catch (error) {
      console.error('Group scope middleware error:', error);
      return res.status(500).json({
        success: false,
        error: {
          code: 'SHUGO-SCOPE-500',
          message: 'Erreur de vérification du groupe'
        }
      });
    }
  };
}

/**
 * Middleware pour élever temporairement les privilèges
 */
function elevateScope(options = {}) {
  const {
    duration = 300000, // 5 minutes par défaut
    require2FA = true,
    auditAction = 'scope.elevation'
  } = options;

  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'SHUGO-SCOPE-001',
            message: 'Authentication requise'
          }
        });
      }

      // Vérifier 2FA si requis
      if (require2FA && !req.twoFactorVerified) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'SHUGO-SCOPE-002',
            message: '2FA requis pour l\'élévation de privilèges'
          }
        });
      }

      // Créer une élévation temporaire
      const elevation = await createTemporaryElevation({
        userId: req.user.member_id,
        duration,
        reason: req.body.elevation_reason || 'Élévation temporaire',
        auditAction
      });

      req.elevatedScope = elevation;
      req.user.elevated = true;

      // Définir l'expiration
      setTimeout(() => {
        req.user.elevated = false;
      }, duration);

      next();

    } catch (error) {
      console.error('Elevate scope error:', error);
      return res.status(500).json({
        success: false,
        error: {
          code: 'SHUGO-SCOPE-500',
          message: 'Erreur lors de l\'élévation de privilèges'
        }
      });
    }
  };
}

// Fonctions utilitaires

async function resolveResourceGeoId(geoIdSource, req) {
  if (!geoIdSource) return null;
  
  if (typeof geoIdSource === 'function') {
    return await geoIdSource(req);
  }
  
  if (typeof geoIdSource === 'string') {
    // Chercher dans les params, query, ou body
    return req.params[geoIdSource] || 
           req.query[geoIdSource] || 
           req.body?.[geoIdSource];
  }
  
  return geoIdSource;
}

async function checkUserScope(userId, requiredScope) {
  try {
    const user = await User.findByPk(userId, {
      include: [{
        model: UserMission,
        as: 'missions',
        where: {
          is_active: true,
          [Op.or]: [
            { valid_until: null },
            { valid_until: { [Op.gt]: new Date() } }
          ]
        },
        required: false
      }]
    });

    if (!user) return null;

    // Vérifier le rôle global
    if (user.role === 'super_admin') {
      return {
        type: SCOPE_TYPES.GLOBAL,
        source: 'role',
        permissions: ['*']
      };
    }

    if (user.role === 'admin' && requiredScope !== SCOPE_TYPES.GLOBAL) {
      return {
        type: SCOPE_TYPES.REGIONAL,
        source: 'role',
        permissions: ['admin.*']
      };
    }

    // Vérifier les missions
    if (user.missions && user.missions.length > 0) {
      for (const mission of user.missions) {
        const missionScope = mission.scope_type;
        
        if (SCOPE_HIERARCHY[missionScope] >= SCOPE_HIERARCHY[requiredScope]) {
          return {
            type: missionScope,
            source: 'mission',
            mission_id: mission.mission_id,
            permissions: mission.privileges_granted?.permissions || []
          };
        }
      }
    }

    // Vérifier le scope par défaut de l'utilisateur
    const defaultScope = await getUserDefaultScope(user);
    
    if (SCOPE_HIERARCHY[defaultScope] >= SCOPE_HIERARCHY[requiredScope]) {
      return {
        type: defaultScope,
        source: 'default',
        permissions: []
      };
    }

    return null;

  } catch (error) {
    console.error('Check user scope error:', error);
    return null;
  }
}

async function checkResourceAccess({
  userId,
  userGeoId,
  targetGeoId,
  requiredScope,
  allowParent,
  allowChildren,
  checkMissions
}) {
  try {
    // Vérifier d'abord le scope général
    const userScope = await checkUserScope(userId, requiredScope);
    
    if (userScope && userScope.type === SCOPE_TYPES.GLOBAL) {
      return {
        granted: true,
        scope: userScope,
        permissions: userScope.permissions
      };
    }

    // Vérifier la relation géographique
    const geoRelation = await checkGeoRelation({
      userGeoId,
      targetGeoId,
      allowParent,
      allowChildren
    });

    if (!geoRelation.related) {
      return {
        granted: false,
        message: 'Zone géographique non autorisée'
      };
    }

    // Vérifier les missions spécifiques si demandé
    if (checkMissions) {
      const missionAccess = await checkMissionAccess({
        userId,
        targetGeoId,
        requiredScope
      });

      if (missionAccess.granted) {
        return missionAccess;
      }
    }

    // Vérifier selon le type de relation
    if (geoRelation.type === 'same') {
      return {
        granted: true,
        scope: { type: SCOPE_TYPES.LOCAL, source: 'geo' },
        permissions: []
      };
    }

    if (geoRelation.type === 'parent' && allowParent) {
      return {
        granted: true,
        scope: { type: SCOPE_TYPES.REGIONAL, source: 'geo_parent' },
        permissions: []
      };
    }

    if (geoRelation.type === 'child' && allowChildren) {
      return {
        granted: true,
        scope: { type: SCOPE_TYPES.LOCAL, source: 'geo_child' },
        permissions: []
      };
    }

    return {
      granted: false,
      message: 'Permissions insuffisantes pour cette zone'
    };

  } catch (error) {
    console.error('Check resource access error:', error);
    return {
      granted: false,
      message: 'Erreur lors de la vérification des accès'
    };
  }
}

async function checkGeoRelation({ userGeoId, targetGeoId, allowParent, allowChildren }) {
  try {
    // Même zone
    if (userGeoId === targetGeoId) {
      return { related: true, type: 'same' };
    }

    // Vérifier si parent
    if (allowParent && targetGeoId.startsWith(userGeoId)) {
      return { related: true, type: 'parent' };
    }

    // Vérifier si enfant
    if (allowChildren && userGeoId.startsWith(targetGeoId)) {
      return { related: true, type: 'child' };
    }

    // Vérifier dans la base de données pour des relations plus complexes
    const userLocation = await Location.findOne({
      where: { geo_id: userGeoId }
    });

    const targetLocation = await Location.findOne({
      where: { geo_id: targetGeoId }
    });

    if (userLocation && targetLocation) {
      // Vérifier la hiérarchie
      if (targetLocation.parent_geo_id === userGeoId) {
        return { related: true, type: 'parent' };
      }

      if (userLocation.parent_geo_id === targetGeoId) {
        return { related: true, type: 'child' };
      }

      // Vérifier les zones sœurs (même parent)
      if (userLocation.parent_geo_id === targetLocation.parent_geo_id) {
        return { related: true, type: 'sibling' };
      }
    }

    return { related: false, type: 'none' };

  } catch (error) {
    console.error('Check geo relation error:', error);
    return { related: false, type: 'error' };
  }
}

async function getAllowedGeoIds({ baseGeoId, allowParent, allowChildren }) {
  const geoIds = [baseGeoId];

  try {
    const location = await Location.findOne({
      where: { geo_id: baseGeoId }
    });

    if (!location) return geoIds;

    // Ajouter le parent si autorisé
    if (allowParent && location.parent_geo_id) {
      geoIds.push(location.parent_geo_id);
    }

    // Ajouter les enfants si autorisé
    if (allowChildren) {
      const children = await Location.findAll({
        where: { parent_geo_id: baseGeoId },
        attributes: ['geo_id']
      });

      geoIds.push(...children.map(c => c.geo_id));
    }

  } catch (error) {
    console.error('Get allowed geo IDs error:', error);
  }

  return geoIds;
}

async function checkGroupMembership({ userId, groupId, minRole }) {
  try {
    const GroupMembership = require('../models').GroupMembership;
    
    const membership = await GroupMembership.findOne({
      where: {
        member_id: userId,
        group_id: groupId,
        is_active: true
      }
    });

    if (!membership) {
      return { isMember: false };
    }

    const roleHierarchy = {
      'owner': 4,
      'admin': 3,
      'moderator': 2,
      'member': 1
    };

    const hasMinRole = roleHierarchy[membership.role] >= roleHierarchy[minRole];

    return {
      isMember: true,
      role: membership.role,
      isOwner: membership.role === 'owner',
      hasMinRole,
      joinedAt: membership.joined_at
    };

  } catch (error) {
    console.error('Check group membership error:', error);
    return { isMember: false };
  }
}

async function checkMissionAccess({ userId, targetGeoId, requiredScope }) {
  try {
    const missions = await UserMission.findAll({
      where: {
        member_id: userId,
        is_active: true,
        [Op.or]: [
          { valid_until: null },
          { valid_until: { [Op.gt]: new Date() } }
        ]
      }
    });

    for (const mission of missions) {
      // Mission globale
      if (mission.scope_type === SCOPE_TYPES.GLOBAL) {
        return {
          granted: true,
          scope: {
            type: SCOPE_TYPES.GLOBAL,
            source: 'mission',
            mission_id: mission.mission_id
          },
          permissions: mission.privileges_granted?.permissions || []
        };
      }

      // Mission pour la zone spécifique
      if (mission.scope_geo_id === targetGeoId) {
        return {
          granted: true,
          scope: {
            type: mission.scope_type,
            source: 'mission',
            mission_id: mission.mission_id
          },
          permissions: mission.privileges_granted?.permissions || []
        };
      }

      // Mission régionale couvrant la zone
      if (mission.scope_type === SCOPE_TYPES.REGIONAL && 
          targetGeoId.startsWith(mission.scope_geo_id)) {
        return {
          granted: true,
          scope: {
            type: SCOPE_TYPES.REGIONAL,
            source: 'mission',
            mission_id: mission.mission_id
          },
          permissions: mission.privileges_granted?.permissions || []
        };
      }
    }

    return { granted: false };

  } catch (error) {
    console.error('Check mission access error:', error);
    return { granted: false };
  }
}

async function getUserDefaultScope(user) {
  // Déterminer le scope par défaut selon le rôle
  const roleScopes = {
    'super_admin': SCOPE_TYPES.GLOBAL,
    'admin': SCOPE_TYPES.REGIONAL,
    'coordinator': SCOPE_TYPES.LOCAL,
    'guard': SCOPE_TYPES.LOCAL,
    'user': SCOPE_TYPES.SELF
  };

  return roleScopes[user.role] || SCOPE_TYPES.SELF;
}

async function createTemporaryElevation({ userId, duration, reason, auditAction }) {
  const AuditLog = require('../models').AuditLog;
  
  // Log l'élévation
  await AuditLog.create({
    action_type: auditAction,
    member_id: userId,
    entity_type: 'scope',
    severity: 'warning',
    details: {
      elevation_reason: reason,
      duration_ms: duration,
      expires_at: new Date(Date.now() + duration)
    }
  });

  return {
    elevated: true,
    expires_at: new Date(Date.now() + duration),
    reason
  };
}

function sendScopeError(res, message) {
  return res.status(403).json({
    success: false,
    error: {
      code: 'SHUGO-SCOPE-403',
      message
    }
  });
}

// Export
module.exports = {
  // Middleware principaux
  requireScope,
  requireMultiScope,
  limitToOwnGeo,
  requireGroupScope,
  elevateScope,
  
  // Alias
  scope: requireScope,
  
  // Configurations pré-définies
  globalScope: requireScope({ requiredScope: SCOPE_TYPES.GLOBAL }),
  regionalScope: requireScope({ requiredScope: SCOPE_TYPES.REGIONAL }),
  localScope: requireScope({ requiredScope: SCOPE_TYPES.LOCAL }),
  groupScope: requireGroupScope(),
  selfScope: requireScope({ requiredScope: SCOPE_TYPES.SELF }),
  
  // Constantes
  SCOPE_TYPES,
  SCOPE_HIERARCHY
};
