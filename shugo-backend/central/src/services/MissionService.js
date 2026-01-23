// services/MissionService.js  
// Service de gestion des missions et privilèges

const { UserMission, User, Group, AuditLog } = require('../models');
const { Op } = require('sequelize');
const NotificationService = require('./NotificationService');
const EmailService = require('./EmailService');

class MissionService {
  async listMissions({ filters, page, limit, user }) {
    try {
      const where = {};
      
      if (filters.member_id) where.member_id = filters.member_id;
      if (filters.mission_type) where.mission_type = filters.mission_type;
      if (filters.scope_type) where.scope_type = filters.scope_type;
      if (filters.is_active !== undefined) where.is_active = filters.is_active;
      
      if (!filters.include_expired) {
        where[Op.or] = [
          { valid_until: null },
          { valid_until: { [Op.gt]: new Date() } }
        ];
      }

      const offset = (page - 1) * limit;

      const { count, rows } = await UserMission.findAndCountAll({
        where,
        limit,
        offset,
        order: [['created_at', 'DESC']],
        include: [{
          model: User,
          as: 'user',
          attributes: ['member_id', 'first_name', 'last_name', 'email']
        }]
      });

      const stats = {
        total_active: await UserMission.count({ where: { is_active: true } }),
        pending_validation: await UserMission.count({ 
          where: { validation_status: 'pending' } 
        }),
        expiring_soon: await UserMission.count({
          where: {
            is_active: true,
            valid_until: {
              [Op.between]: [new Date(), new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)]
            }
          }
        })
      };

      return {
        data: rows,
        total: count,
        page,
        pages: Math.ceil(count / limit),
        limit,
        stats
      };

    } catch (error) {
      console.error('List missions error:', error);
      throw error;
    }
  }

  async updateMission({ mission_id, updates, updated_by }) {
    const transaction = await UserMission.sequelize.transaction();

    try {
      const mission = await UserMission.findByPk(mission_id);
      if (!mission) throw new Error('Mission non trouvée');

      await mission.update(updates, { transaction });

      await AuditLog.create({
        action_type: 'mission.update',
        member_id: updated_by,
        entity_type: 'mission',
        entity_id: mission_id,
        details: { updates }
      }, { transaction });

      await transaction.commit();
      return mission;

    } catch (error) {
      await transaction.rollback();
      console.error('Update mission error:', error);
      throw error;
    }
  }

  async revokeMission({ mission_id, revocation_reason, immediate, notify_user, block_reattribution, block_duration_days, revoked_by_member_id }) {
    const transaction = await UserMission.sequelize.transaction();

    try {
      const mission = await UserMission.findByPk(mission_id, {
        include: [{ model: User, as: 'user' }]
      });

      if (!mission) throw new Error('Mission non trouvée');

      await mission.update({
        is_active: false,
        revoked_at: new Date(),
        revoked_by_member_id,
        revocation_reason
      }, { transaction });

      if (block_reattribution) {
        // Enregistrer le blocage pour éviter réattribution
        await AuditLog.create({
          action_type: 'mission.block_reattribution',
          member_id: revoked_by_member_id,
          entity_type: 'user',
          entity_id: mission.member_id,
          severity: 'warning',
          details: { 
            mission_id,
            block_until: new Date(Date.now() + block_duration_days * 24 * 60 * 60 * 1000) 
          }
        }, { transaction });
      }

      if (notify_user) {
        await NotificationService.send({
          user_id: mission.member_id,
          type: 'mission_revoked',
          title: 'Mission révoquée',
          message: `Votre mission ${mission.mission_type} a été révoquée`,
          priority: 'high'
        });
      }

      await AuditLog.create({
        action_type: 'mission.revoke',
        member_id: revoked_by_member_id,
        entity_type: 'mission',
        entity_id: mission_id,
        severity: 'critical',
        details: { reason: revocation_reason, immediate }
      }, { transaction });

      await transaction.commit();

      return { success: true, mission_id };

    } catch (error) {
      await transaction.rollback();
      console.error('Revoke mission error:', error);
      throw error;
    }
  }

  async checkPrivileges({ member_id, required_role, required_permissions, scope_geo_id, scope_group_id }) {
    try {
      const missions = await UserMission.findAll({
        where: {
          member_id,
          is_active: true,
          [Op.or]: [
            { valid_until: null },
            { valid_until: { [Op.gt]: new Date() } }
          ]
        }
      });

      for (const mission of missions) {
        const privileges = mission.privileges_granted;
        
        // Vérifier le rôle
        if (required_role && privileges.roles?.includes(required_role)) {
          // Vérifier le scope
          if (this.checkScope(mission, scope_geo_id, scope_group_id)) {
            return true;
          }
        }

        // Vérifier les permissions
        if (required_permissions?.length > 0) {
          const hasAllPerms = required_permissions.every(p => 
            privileges.permissions?.includes(p)
          );
          if (hasAllPerms && this.checkScope(mission, scope_geo_id, scope_group_id)) {
            return true;
          }
        }
      }

      return false;

    } catch (error) {
      console.error('Check privileges error:', error);
      return false;
    }
  }

  checkScope(mission, geo_id, group_id) {
    if (mission.scope_type === 'global') return true;
    if (mission.scope_type === 'regional' && geo_id?.startsWith(mission.scope_geo_id?.substring(0, 5))) return true;
    if (mission.scope_type === 'local' && mission.scope_geo_id === geo_id) return true;
    if (mission.scope_type === 'group' && mission.scope_group_id === group_id) return true;
    return false;
  }

  async checkMissionConflicts({ member_id, scope_type, scope_geo_id, privileges }) {
    const existing = await UserMission.findAll({
      where: {
        member_id,
        is_active: true,
        scope_type,
        scope_geo_id
      }
    });

    return existing.filter(m => {
      const existingRoles = m.privileges_granted.roles || [];
      const newRoles = privileges.roles || [];
      return existingRoles.some(r => newRoles.includes(r));
    });
  }

  async notifyValidators(mission) {
    // Notifier les validateurs de la zone
    const validators = await User.findAll({
      where: { role: 'validator', geo_id: mission.scope_geo_id }
    });

    for (const validator of validators) {
      await NotificationService.send({
        user_id: validator.member_id,
        type: 'mission_validation_required',
        title: 'Mission à valider',
        message: 'Une nouvelle mission requiert votre validation',
        data: { mission_id: mission.mission_id }
      });
    }
  }

  /**
   * Crée une nouvelle mission
   */
  async createMission({ member_id, mission_type, scope_type, scope_geo_id, scope_group_id, privileges_granted, valid_from, valid_until, requires_validation, granted_by_member_id, notes }) {
    const transaction = await UserMission.sequelize.transaction();

    try {
      // Vérifier les conflits
      const conflicts = await this.checkMissionConflicts({
        member_id,
        scope_type,
        scope_geo_id,
        privileges: privileges_granted
      });

      if (conflicts.length > 0) {
        throw new Error(`Conflit avec ${conflicts.length} mission(s) existante(s)`);
      }

      // Créer la mission
      const mission = await UserMission.create({
        member_id,
        mission_type,
        scope_type,
        scope_geo_id,
        scope_group_id,
        privileges_granted,
        valid_from: valid_from || new Date(),
        valid_until,
        is_active: !requires_validation,
        validation_status: requires_validation ? 'pending' : 'approved',
        granted_by_member_id,
        notes
      }, { transaction });

      // Audit
      await AuditLog.create({
        action_type: 'mission.create',
        member_id: granted_by_member_id,
        entity_type: 'mission',
        entity_id: mission.mission_id,
        severity: 'info',
        details: { mission_type, scope_type, privileges_granted }
      }, { transaction });

      // Notifier les validateurs si validation requise
      if (requires_validation) {
        await this.notifyValidators(mission);
      }

      // Notifier l'utilisateur
      await NotificationService.send({
        user_id: member_id,
        type: requires_validation ? 'mission_pending' : 'mission_granted',
        title: requires_validation ? 'Mission en attente de validation' : 'Nouvelle mission attribuée',
        message: `Mission ${mission_type} ${requires_validation ? 'en attente' : 'activée'}`,
        data: { mission_id: mission.mission_id }
      });

      await transaction.commit();
      return mission;

    } catch (error) {
      await transaction.rollback();
      console.error('Create mission error:', error);
      throw error;
    }
  }

  /**
   * Récupère une mission par ID
   */
  async getMission({ mission_id, include_user = true, include_audit = false }) {
    try {
      const include = [];

      if (include_user) {
        include.push({
          model: User,
          as: 'user',
          attributes: ['member_id', 'first_name', 'last_name', 'email', 'role', 'geo_id']
        });
      }

      const mission = await UserMission.findByPk(mission_id, { include });

      if (!mission) {
        throw new Error('Mission non trouvée');
      }

      const result = mission.toJSON();

      // Ajouter l'historique d'audit si demandé
      if (include_audit) {
        result.audit_history = await AuditLog.findAll({
          where: {
            entity_type: 'mission',
            entity_id: mission_id
          },
          order: [['created_at', 'DESC']],
          limit: 50
        });
      }

      return result;

    } catch (error) {
      console.error('Get mission error:', error);
      throw error;
    }
  }

  /**
   * Récupère les missions d'un utilisateur
   */
  async getUserMissions({ member_id, include_expired = false, include_revoked = false }) {
    try {
      const where = { member_id };

      if (!include_expired) {
        where[Op.or] = [
          { valid_until: null },
          { valid_until: { [Op.gt]: new Date() } }
        ];
      }

      if (!include_revoked) {
        where.revoked_at = null;
      }

      const missions = await UserMission.findAll({
        where,
        order: [['created_at', 'DESC']]
      });

      // Grouper par type
      const grouped = {
        active: [],
        pending: [],
        expired: [],
        revoked: []
      };

      for (const mission of missions) {
        if (mission.revoked_at) {
          grouped.revoked.push(mission);
        } else if (mission.validation_status === 'pending') {
          grouped.pending.push(mission);
        } else if (mission.valid_until && new Date(mission.valid_until) < new Date()) {
          grouped.expired.push(mission);
        } else if (mission.is_active) {
          grouped.active.push(mission);
        }
      }

      return {
        missions,
        grouped,
        summary: {
          total: missions.length,
          active: grouped.active.length,
          pending: grouped.pending.length,
          expired: grouped.expired.length,
          revoked: grouped.revoked.length
        }
      };

    } catch (error) {
      console.error('Get user missions error:', error);
      throw error;
    }
  }

  /**
   * Valide une mission en attente
   */
  async validateMission({ mission_id, approved, validated_by_member_id, rejection_reason, notes }) {
    const transaction = await UserMission.sequelize.transaction();

    try {
      const mission = await UserMission.findByPk(mission_id, {
        include: [{ model: User, as: 'user' }]
      });

      if (!mission) {
        throw new Error('Mission non trouvée');
      }

      if (mission.validation_status !== 'pending') {
        throw new Error('Cette mission n\'est pas en attente de validation');
      }

      await mission.update({
        validation_status: approved ? 'approved' : 'rejected',
        validated_by_member_id,
        validated_at: new Date(),
        is_active: approved,
        rejection_reason: approved ? null : rejection_reason,
        notes: notes ? `${mission.notes || ''}\n[Validation] ${notes}` : mission.notes
      }, { transaction });

      // Audit
      await AuditLog.create({
        action_type: approved ? 'mission.approve' : 'mission.reject',
        member_id: validated_by_member_id,
        entity_type: 'mission',
        entity_id: mission_id,
        severity: approved ? 'info' : 'warning',
        details: { approved, rejection_reason }
      }, { transaction });

      // Notifier l'utilisateur
      await NotificationService.send({
        user_id: mission.member_id,
        type: approved ? 'mission_approved' : 'mission_rejected',
        title: approved ? 'Mission approuvée' : 'Mission refusée',
        message: approved
          ? `Votre mission ${mission.mission_type} a été approuvée`
          : `Votre mission ${mission.mission_type} a été refusée: ${rejection_reason}`,
        priority: 'high',
        data: { mission_id }
      });

      await transaction.commit();

      return {
        success: true,
        mission_id,
        status: approved ? 'approved' : 'rejected'
      };

    } catch (error) {
      await transaction.rollback();
      console.error('Validate mission error:', error);
      throw error;
    }
  }

  /**
   * Renouvelle une mission existante
   */
  async renewMission({ mission_id, new_valid_until, renewed_by_member_id, notes }) {
    const transaction = await UserMission.sequelize.transaction();

    try {
      const mission = await UserMission.findByPk(mission_id);

      if (!mission) {
        throw new Error('Mission non trouvée');
      }

      if (mission.revoked_at) {
        throw new Error('Impossible de renouveler une mission révoquée');
      }

      const oldValidUntil = mission.valid_until;

      await mission.update({
        valid_until: new_valid_until,
        is_active: true,
        notes: notes ? `${mission.notes || ''}\n[Renouvellement] ${notes}` : mission.notes
      }, { transaction });

      // Audit
      await AuditLog.create({
        action_type: 'mission.renew',
        member_id: renewed_by_member_id,
        entity_type: 'mission',
        entity_id: mission_id,
        severity: 'info',
        details: {
          old_valid_until: oldValidUntil,
          new_valid_until
        }
      }, { transaction });

      // Notifier l'utilisateur
      await NotificationService.send({
        user_id: mission.member_id,
        type: 'mission_renewed',
        title: 'Mission renouvelée',
        message: `Votre mission ${mission.mission_type} a été renouvelée jusqu'au ${new Date(new_valid_until).toLocaleDateString('fr-FR')}`,
        data: { mission_id }
      });

      await transaction.commit();

      return {
        success: true,
        mission_id,
        new_valid_until
      };

    } catch (error) {
      await transaction.rollback();
      console.error('Renew mission error:', error);
      throw error;
    }
  }

  /**
   * Récupère les validations en attente
   */
  async getPendingValidations({ validator_member_id, geo_id, page = 1, limit = 20 }) {
    try {
      const where = {
        validation_status: 'pending'
      };

      // Filtrer par zone si spécifié
      if (geo_id) {
        where.scope_geo_id = {
          [Op.like]: `${geo_id.substring(0, 5)}%`
        };
      }

      const offset = (page - 1) * limit;

      const { count, rows } = await UserMission.findAndCountAll({
        where,
        limit,
        offset,
        order: [['created_at', 'ASC']], // Plus anciennes d'abord
        include: [{
          model: User,
          as: 'user',
          attributes: ['member_id', 'first_name', 'last_name', 'email', 'role', 'geo_id']
        }]
      });

      return {
        data: rows,
        total: count,
        page,
        pages: Math.ceil(count / limit),
        limit
      };

    } catch (error) {
      console.error('Get pending validations error:', error);
      throw error;
    }
  }

  /**
   * Récupère les missions expirant bientôt
   */
  async getExpiringMissions({ days_until_expiry = 30, geo_id, page = 1, limit = 50 }) {
    try {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + days_until_expiry);

      const where = {
        is_active: true,
        revoked_at: null,
        valid_until: {
          [Op.between]: [new Date(), expiryDate]
        }
      };

      if (geo_id) {
        where.scope_geo_id = {
          [Op.like]: `${geo_id.substring(0, 5)}%`
        };
      }

      const offset = (page - 1) * limit;

      const { count, rows } = await UserMission.findAndCountAll({
        where,
        limit,
        offset,
        order: [['valid_until', 'ASC']], // Plus proches d'expiration d'abord
        include: [{
          model: User,
          as: 'user',
          attributes: ['member_id', 'first_name', 'last_name', 'email']
        }]
      });

      // Grouper par urgence
      const now = new Date();
      const grouped = {
        critical: [], // < 7 jours
        warning: [],  // 7-14 jours
        info: []      // > 14 jours
      };

      for (const mission of rows) {
        const daysLeft = Math.ceil((new Date(mission.valid_until) - now) / (1000 * 60 * 60 * 24));
        if (daysLeft <= 7) {
          grouped.critical.push({ ...mission.toJSON(), days_left: daysLeft });
        } else if (daysLeft <= 14) {
          grouped.warning.push({ ...mission.toJSON(), days_left: daysLeft });
        } else {
          grouped.info.push({ ...mission.toJSON(), days_left: daysLeft });
        }
      }

      return {
        data: rows,
        grouped,
        total: count,
        page,
        pages: Math.ceil(count / limit),
        summary: {
          critical: grouped.critical.length,
          warning: grouped.warning.length,
          info: grouped.info.length
        }
      };

    } catch (error) {
      console.error('Get expiring missions error:', error);
      throw error;
    }
  }

  /**
   * Récupère l'historique d'audit des missions
   */
  async getAuditLog({ mission_id, member_id, action_types, date_from, date_to, page = 1, limit = 50 }) {
    try {
      const where = {
        entity_type: 'mission'
      };

      if (mission_id) {
        where.entity_id = mission_id;
      }

      if (member_id) {
        where.member_id = member_id;
      }

      if (action_types && action_types.length > 0) {
        where.action_type = { [Op.in]: action_types };
      }

      if (date_from || date_to) {
        where.created_at = {};
        if (date_from) where.created_at[Op.gte] = new Date(date_from);
        if (date_to) where.created_at[Op.lte] = new Date(date_to);
      }

      const offset = (page - 1) * limit;

      const { count, rows } = await AuditLog.findAndCountAll({
        where,
        limit,
        offset,
        order: [['created_at', 'DESC']],
        include: [{
          model: User,
          as: 'actor',
          attributes: ['member_id', 'first_name', 'last_name'],
          required: false
        }]
      });

      // Statistiques par type d'action
      const stats = {};
      for (const log of rows) {
        stats[log.action_type] = (stats[log.action_type] || 0) + 1;
      }

      return {
        data: rows,
        total: count,
        page,
        pages: Math.ceil(count / limit),
        stats
      };

    } catch (error) {
      console.error('Get audit log error:', error);
      throw error;
    }
  }
}

module.exports = new MissionService();
