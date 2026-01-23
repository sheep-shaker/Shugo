'use strict';

/**
 * Service CleTotemService - Protocole de Récupération Physique
 *
 * Gère la récupération d'urgence via une clé USB physique (Clé Totem).
 * Cette clé contient un token cryptographique unique permettant:
 * - L'accès administrateur d'urgence
 * - La désactivation des protocoles de sécurité
 * - La restauration après incident majeur
 *
 * La clé doit être physiquement insérée sur le serveur ou un poste autorisé.
 *
 * @see Document Technique V7.0 - Section 8.10
 */

const crypto = require('crypto');
const { Op } = require('sequelize');

/**
 * Types de clé totem
 */
const TOTEM_TYPES = {
  MASTER: 'master',       // Clé maître - accès total
  RECOVERY: 'recovery',   // Clé de récupération - restauration uniquement
  EMERGENCY: 'emergency'  // Clé d'urgence - désactivation protocoles
};

/**
 * Actions autorisées par type de clé
 */
const ALLOWED_ACTIONS = {
  [TOTEM_TYPES.MASTER]: ['unlock', 'restore', 'rotate_keys', 'deactivate_protocols', 'admin_access'],
  [TOTEM_TYPES.RECOVERY]: ['unlock', 'restore'],
  [TOTEM_TYPES.EMERGENCY]: ['unlock', 'deactivate_protocols']
};

class CleTotemService {
  constructor(models, sequelize, services = {}) {
    this.models = models;
    this.sequelize = sequelize;
    this.vaultService = services.vault;
    this.notificationService = services.notification;
    this.keyRotationService = services.keyRotation;

    // Registre des clés totem valides (en mémoire, chargé depuis le Vault)
    this._registeredTotems = new Map();
    this._activeSession = null;
  }

  /**
   * Initialise le service en chargeant les clés totem depuis le Vault
   * @returns {Promise<Object>}
   */
  async initialize() {
    console.log('[CleTotem] Initialisation du service...');

    try {
      // Charger les clés totem depuis le Vault
      if (this.vaultService) {
        const totemKeys = await this.vaultService.getItemsByType('totem_key');
        for (const key of totemKeys) {
          const keyData = await this.vaultService.decryptItem(key);
          this._registeredTotems.set(keyData.serial, {
            type: keyData.type,
            serial: keyData.serial,
            createdAt: keyData.createdAt,
            lastUsedAt: keyData.lastUsedAt,
            isActive: keyData.isActive
          });
        }
      }

      return {
        initialized: true,
        registeredTotems: this._registeredTotems.size
      };
    } catch (error) {
      console.error('[CleTotem] Erreur initialisation:', error.message);
      return { initialized: false, error: error.message };
    }
  }

  /**
   * Vérifie et authentifie une clé totem
   * @param {string} totemToken - Token de la clé USB
   * @param {string} ipAddress - IP de la requête
   * @returns {Promise<Object>}
   */
  async authenticateTotem(totemToken, ipAddress) {
    if (!totemToken) {
      throw new CleTotemError('INVALID_TOKEN', 'Token totem requis');
    }

    console.log(`[CleTotem] Tentative d'authentification depuis ${ipAddress}`);

    // Extraire le serial et le challenge du token
    const { serial, challenge } = this._parseToken(totemToken);

    // Vérifier si le serial est enregistré
    const totemInfo = this._registeredTotems.get(serial);
    if (!totemInfo) {
      await this._logFailedAttempt('unknown_serial', ipAddress, serial);
      throw new CleTotemError('UNKNOWN_TOTEM', 'Clé totem non reconnue');
    }

    if (!totemInfo.isActive) {
      await this._logFailedAttempt('inactive_totem', ipAddress, serial);
      throw new CleTotemError('INACTIVE_TOTEM', 'Clé totem désactivée');
    }

    // Valider le challenge cryptographique
    const isValid = await this._validateChallenge(serial, challenge);
    if (!isValid) {
      await this._logFailedAttempt('invalid_challenge', ipAddress, serial);
      throw new CleTotemError('INVALID_CHALLENGE', 'Challenge cryptographique invalide');
    }

    // Créer une session temporaire
    const session = await this._createTotemSession(serial, totemInfo.type, ipAddress);

    // Logger l'authentification réussie
    await this._logSecurityEvent('totem_authenticated', null, {
      serial,
      type: totemInfo.type,
      ipAddress,
      sessionId: session.id
    });

    // Notifier les admins
    await this._notifyAdmins('totem_auth', {
      serial,
      type: totemInfo.type,
      ipAddress
    });

    return {
      success: true,
      sessionId: session.id,
      totemType: totemInfo.type,
      allowedActions: ALLOWED_ACTIONS[totemInfo.type],
      expiresIn: session.expiresIn
    };
  }

  /**
   * Exécute une action avec la session totem
   * @param {string} sessionId - ID de la session totem
   * @param {string} action - Action à exécuter
   * @param {Object} params - Paramètres de l'action
   * @returns {Promise<Object>}
   */
  async executeAction(sessionId, action, params = {}) {
    // Valider la session
    const session = await this._validateSession(sessionId);
    if (!session) {
      throw new CleTotemError('INVALID_SESSION', 'Session totem invalide ou expirée');
    }

    // Vérifier que l'action est autorisée pour ce type de totem
    const allowedActions = ALLOWED_ACTIONS[session.totemType];
    if (!allowedActions.includes(action)) {
      throw new CleTotemError('UNAUTHORIZED_ACTION', `Action '${action}' non autorisée pour ce type de totem`);
    }

    console.log(`[CleTotem] Exécution action: ${action}`);

    const protocolLog = await this.models.SecurityProtocolLog.create({
      protocol_name: 'cle_totem',
      triggered_by: 'manual',
      scope: 'central',
      reason: `Action totem: ${action}`,
      trigger_details: { sessionId, action, params },
      actions_taken: [],
      result: 'pending',
      started_at: new Date(),
      severity: 'critical'
    });

    try {
      let result;

      switch (action) {
        case 'unlock':
          result = await this._executeUnlock(params);
          break;
        case 'restore':
          result = await this._executeRestore(params);
          break;
        case 'rotate_keys':
          result = await this._executeRotateKeys(params);
          break;
        case 'deactivate_protocols':
          result = await this._executeDeactivateProtocols(params);
          break;
        case 'admin_access':
          result = await this._executeAdminAccess(params);
          break;
        default:
          throw new CleTotemError('UNKNOWN_ACTION', `Action inconnue: ${action}`);
      }

      await protocolLog.update({
        actions_taken: [{ action, result }],
        result: 'success',
        completed_at: new Date(),
        duration_ms: Date.now() - protocolLog.started_at.getTime()
      });

      // Notifier les admins
      await this._notifyAdmins('totem_action', {
        action,
        result,
        sessionId
      });

      return {
        success: true,
        action,
        result,
        protocolLogId: protocolLog.protocol_log_id
      };
    } catch (error) {
      await protocolLog.update({
        result: 'failed',
        error_message: error.message,
        completed_at: new Date()
      });
      throw error;
    }
  }

  /**
   * Enregistre une nouvelle clé totem
   * @param {number} adminId - Admin N1 effectuant l'enregistrement
   * @param {Object} credentials - Credentials de l'admin
   * @param {Object} totemData - Données de la clé
   * @returns {Promise<Object>}
   */
  async registerTotem(adminId, credentials, totemData) {
    await this._validateAdminN1(adminId);

    if (!totemData.serial || !totemData.type) {
      throw new CleTotemError('INVALID_DATA', 'Serial et type requis');
    }

    if (!Object.values(TOTEM_TYPES).includes(totemData.type)) {
      throw new CleTotemError('INVALID_TYPE', `Type invalide: ${totemData.type}`);
    }

    console.log(`[CleTotem] Enregistrement nouvelle clé: ${totemData.serial}`);

    // Générer le secret de la clé
    const totemSecret = crypto.randomBytes(32).toString('hex');
    const totemHash = crypto.createHash('sha256').update(totemSecret).digest('hex');

    // Stocker dans le Vault
    if (this.vaultService) {
      await this.vaultService.storeItem({
        type: 'totem_key',
        name: `totem_${totemData.serial}`,
        data: {
          serial: totemData.serial,
          type: totemData.type,
          secretHash: totemHash,
          createdAt: new Date(),
          createdBy: adminId,
          isActive: true
        }
      });
    }

    // Ajouter au registre en mémoire
    this._registeredTotems.set(totemData.serial, {
      type: totemData.type,
      serial: totemData.serial,
      createdAt: new Date(),
      lastUsedAt: null,
      isActive: true
    });

    // Logger l'événement
    await this._logSecurityEvent('totem_registered', adminId, {
      serial: totemData.serial,
      type: totemData.type
    });

    return {
      success: true,
      serial: totemData.serial,
      type: totemData.type,
      secret: totemSecret // À transmettre UNIQUEMENT à la clé physique!
    };
  }

  /**
   * Révoque une clé totem
   * @param {number} adminId - Admin N1
   * @param {string} serial - Serial de la clé
   * @param {string} reason - Raison de la révocation
   * @returns {Promise<Object>}
   */
  async revokeTotem(adminId, serial, reason) {
    await this._validateAdminN1(adminId);

    const totemInfo = this._registeredTotems.get(serial);
    if (!totemInfo) {
      throw new CleTotemError('UNKNOWN_TOTEM', 'Clé totem non trouvée');
    }

    console.log(`[CleTotem] Révocation clé: ${serial}`);

    // Désactiver dans le registre
    totemInfo.isActive = false;
    this._registeredTotems.set(serial, totemInfo);

    // Mettre à jour dans le Vault
    if (this.vaultService) {
      await this.vaultService.updateItem(`totem_${serial}`, {
        isActive: false,
        revokedAt: new Date(),
        revokedBy: adminId,
        revokedReason: reason
      });
    }

    // Logger l'événement
    await this._logSecurityEvent('totem_revoked', adminId, {
      serial,
      reason
    });

    return {
      success: true,
      serial,
      revokedAt: new Date()
    };
  }

  /**
   * Obtient le statut du service
   * @returns {Object}
   */
  getStatus() {
    const totems = Array.from(this._registeredTotems.values());
    return {
      initialized: this._registeredTotems.size > 0,
      activeTotems: totems.filter(t => t.isActive).length,
      totalTotems: totems.length,
      activeSession: this._activeSession ? {
        id: this._activeSession.id,
        type: this._activeSession.totemType,
        expiresAt: this._activeSession.expiresAt
      } : null
    };
  }

  // ===== MÉTHODES D'EXÉCUTION =====

  async _executeUnlock(params) {
    global.SHUGO_LOGIN_BLOCKED = false;
    global.SHUGO_API_BLOCKED = false;
    global.SHUGO_MAINTENANCE_MODE = false;
    global.SHUGO_READ_ONLY = false;

    return { unlocked: true, timestamp: new Date() };
  }

  async _executeRestore(params) {
    if (!params.backupId) {
      throw new CleTotemError('BACKUP_REQUIRED', 'ID de backup requis');
    }

    // Déléguer au service de restauration si disponible
    if (this.models.RestoreOperation) {
      const restoreOp = await this.models.RestoreOperation.create({
        source_backup_job_id: params.backupId,
        restore_type: 'totem_recovery',
        status: 'pending',
        reason: 'Restauration via Clé Totem'
      });

      return {
        restoreOperationId: restoreOp.restore_id,
        status: 'initiated'
      };
    }

    return { status: 'restore_service_unavailable' };
  }

  async _executeRotateKeys(params) {
    if (!this.keyRotationService) {
      throw new CleTotemError('SERVICE_UNAVAILABLE', 'KeyRotationService non disponible');
    }

    const results = await this.keyRotationService.rotateAllKeys(null, 'totem_rotation');
    return { rotated: true, results };
  }

  async _executeDeactivateProtocols(params) {
    // Désactiver tous les protocoles actifs
    const deactivated = [];

    global.SHUGO_LOGIN_BLOCKED = false;
    global.SHUGO_API_BLOCKED = false;
    global.SHUGO_MAINTENANCE_MODE = false;
    global.SHUGO_READ_ONLY = false;

    deactivated.push('system_locks');

    return { deactivated, timestamp: new Date() };
  }

  async _executeAdminAccess(params) {
    // Créer une session admin temporaire (2h)
    const tempSession = {
      type: 'totem_admin',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      permissions: ['admin', 'security', 'vault']
    };

    if (this.models.Session) {
      await this.models.Session.create({
        session_type: 'totem_admin',
        is_active: true,
        created_at: tempSession.createdAt,
        expires_at: tempSession.expiresAt,
        metadata: { source: 'cle_totem' }
      });
    }

    return { adminAccess: true, expiresAt: tempSession.expiresAt };
  }

  // ===== MÉTHODES PRIVÉES =====

  _parseToken(token) {
    // Format: SERIAL-CHALLENGE (ex: TOTEM001-abc123def456...)
    const parts = token.split('-');
    if (parts.length < 2) {
      throw new CleTotemError('INVALID_TOKEN_FORMAT', 'Format de token invalide');
    }
    return {
      serial: parts[0],
      challenge: parts.slice(1).join('-')
    };
  }

  async _validateChallenge(serial, challenge) {
    // Récupérer le hash secret du totem depuis le Vault
    if (!this.vaultService) {
      // Mode dégradé: accepter si le challenge ressemble à un hash valide
      return challenge && challenge.length >= 32;
    }

    try {
      const totemData = await this.vaultService.getItem(`totem_${serial}`);
      if (!totemData) return false;

      const decrypted = await this.vaultService.decryptItem(totemData);
      const expectedHash = crypto.createHash('sha256').update(challenge).digest('hex');

      return expectedHash === decrypted.secretHash;
    } catch {
      return false;
    }
  }

  async _createTotemSession(serial, totemType, ipAddress) {
    const session = {
      id: crypto.randomUUID(),
      serial,
      totemType,
      ipAddress,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
      expiresIn: 30 * 60 * 1000
    };

    this._activeSession = session;
    return session;
  }

  async _validateSession(sessionId) {
    if (!this._activeSession || this._activeSession.id !== sessionId) {
      return null;
    }

    if (new Date() > this._activeSession.expiresAt) {
      this._activeSession = null;
      return null;
    }

    return this._activeSession;
  }

  async _validateAdminN1(adminId) {
    const admin = await this.models.User.findByPk(adminId);
    if (!admin || !['Admin', 'Admin_N1'].includes(admin.role)) {
      throw new CleTotemError('UNAUTHORIZED', 'Droits Admin N1 requis');
    }
    return admin;
  }

  async _logFailedAttempt(type, ipAddress, serial) {
    await this._logSecurityEvent('totem_auth_failed', null, {
      type,
      ipAddress,
      serial,
      timestamp: new Date()
    });
  }

  async _logSecurityEvent(eventName, memberId, details) {
    if (!this.models.SecurityProtocolLog) return;

    try {
      await this.models.SecurityProtocolLog.create({
        protocol_name: eventName,
        triggered_by: memberId ? 'manual' : 'automatic',
        member_id: memberId,
        scope: 'central',
        reason: JSON.stringify(details),
        actions_taken: [details],
        result: 'success',
        started_at: new Date(),
        completed_at: new Date(),
        severity: 'critical'
      });
    } catch (error) {
      console.error('[CleTotem] Erreur log:', error.message);
    }
  }

  async _notifyAdmins(type, data) {
    if (!this.notificationService || !this.models.User) return;

    try {
      const admins = await this.models.User.findAll({
        where: { role: { [Op.in]: ['Admin', 'Admin_N1'] }, status: 'active' }
      });

      for (const admin of admins) {
        await this.notificationService.send(
          admin.member_id,
          'security_alert',
          { type, ...data, timestamp: new Date() },
          { priority: 'urgent', immediate: true }
        );
      }
    } catch (error) {
      console.error('[CleTotem] Erreur notification:', error.message);
    }
  }
}

/**
 * Classe d'erreur spécifique
 */
class CleTotemError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CleTotemError';
    this.code = code;
  }
}

module.exports = CleTotemService;
module.exports.CleTotemError = CleTotemError;
module.exports.TOTEM_TYPES = TOTEM_TYPES;
module.exports.ALLOWED_ACTIONS = ALLOWED_ACTIONS;
