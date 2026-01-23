'use strict';

/**
 * Service Papier Froissé - Réactivation de Compte
 * 
 * Réactive un compte utilisateur précédemment supprimé (soft delete uniquement).
 * Ne fonctionne pas pour les comptes effacés par Cendre Blanche.
 * 
 * @see Document Technique V7.0 - Section 8.3
 */

const { Op } = require('sequelize');

class PapierFroisseService {
  constructor(models, sequelize, services = {}) {
    this.models = models;
    this.sequelize = sequelize;
    this.User = models.User;
    this.AuditLog = models.AuditLog;
    this.SecurityProtocolLog = models.SecurityProtocolLog;

    this.notificationService = services.notification;
  }

  /**
   * Réactive un compte désactivé
   * @param {number} targetMemberId - Utilisateur à réactiver
   * @param {number} adminId - Admin exécutant
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async execute(targetMemberId, adminId, options = {}) {
    const { reason, restoreHistory = true } = options;

    console.log('[Papier Froisse] Reactivation de ' + targetMemberId);

    // Chercher l'utilisateur (y compris soft deleted)
    const targetUser = await this.User.findOne({
      where: { member_id: targetMemberId },
      paranoid: false // Inclure les soft deleted
    });

    if (!targetUser) {
      throw new PapierFroisseError('USER_NOT_FOUND', 'Utilisateur non trouve');
    }

    // Vérifier que le compte n'a pas été effacé par Cendre Blanche
    if (targetUser.status === 'deleted' && targetUser.email_hash && targetUser.email_hash.length === 64) {
      // Vérifier si c'est un hash aléatoire (signe de Cendre Blanche)
      const auditLog = await this.AuditLog.findOne({
        where: {
          action: 'cendre_blanche_executed',
          resource_id: String(targetMemberId)
        }
      });
      
      if (auditLog) {
        throw new PapierFroisseError('IRREVERSIBLE', 'Ce compte a ete supprime par Cendre Blanche et ne peut pas etre reactive');
      }
    }

    // Vérifier que le compte est bien désactivé
    if (targetUser.status === 'active' && !targetUser.deleted_at) {
      throw new PapierFroisseError('ALREADY_ACTIVE', 'Ce compte est deja actif');
    }

    // Valider l'autorisation
    await this._validateAuthorization(adminId, targetUser);

    const protocolLog = await this.SecurityProtocolLog.create({
      protocol_name: 'papier_froisse',
      triggered_by: 'manual',
      member_id: adminId,
      scope: 'local',
      reason: reason || 'Reactivation de compte',
      actions_taken: [],
      result: 'pending',
      started_at: new Date()
    });

    const actions = [];

    try {
      // Phase 1: Réactivation du compte
      await targetUser.update({
        status: 'active',
        deleted_at: null,
        updated_at: new Date()
      });
      actions.push({ phase: 1, action: 'reactivate_account' });

      // Phase 2: Restauration de l'historique si demandé
      if (restoreHistory) {
        const restored = await this._restoreHistory(targetMemberId);
        actions.push({ phase: 2, action: 'restore_history', ...restored });
      }

      // Phase 3: Notification
      if (this.notificationService) {
        try {
          await this.notificationService.send(targetMemberId, 'account_welcome', {
            type: 'reactivation',
            message: 'Votre compte a ete reactive'
          });
          actions.push({ phase: 3, action: 'notify_user' });
        } catch (e) {
          actions.push({ phase: 3, action: 'notify_user', error: e.message });
        }
      }

      await protocolLog.update({ actions_taken: actions, result: 'success', completed_at: new Date() });

      await this.AuditLog.create({
        member_id: adminId,
        action: 'papier_froisse_executed',
        resource_type: 'user',
        resource_id: String(targetMemberId),
        new_values: { status: 'active' },
        result: 'success',
        notes: reason
      });

      console.log('[Papier Froisse] Compte ' + targetMemberId + ' reactive');

      return {
        success: true,
        memberId: targetMemberId,
        protocolId: protocolLog.protocol_log_id,
        actions
      };

    } catch (error) {
      await protocolLog.update({ actions_taken: actions, result: 'failed', completed_at: new Date() });
      throw new PapierFroisseError('EXECUTION_FAILED', error.message);
    }
  }

  /**
   * Valide les autorisations
   * @private
   */
  async _validateAuthorization(adminId, targetUser) {
    const admin = await this.User.findByPk(adminId);
    if (!admin) throw new PapierFroisseError('ADMIN_NOT_FOUND', 'Admin non trouve');
    if (!['Platinum', 'Admin', 'Admin_N1'].includes(admin.role)) {
      throw new PapierFroisseError('UNAUTHORIZED', 'Droits insuffisants');
    }
    return true;
  }

  /**
   * Restaure l'historique de l'utilisateur
   * @private
   */
  async _restoreHistory(memberId) {
    const restored = { groups: 0, missions: 0 };

    // Restaurer les appartenances aux groupes (si soft deleted)
    if (this.models.GroupMembership) {
      const [groupsRestored] = await this.models.GroupMembership.update(
        { is_active: true, left_at: null },
        { where: { member_id: memberId, is_active: false } }
      );
      restored.groups = groupsRestored;
    }

    // Restaurer les missions (si expirées récemment)
    if (this.models.UserMission) {
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      const [missionsRestored] = await this.models.UserMission.update(
        { is_active: true, revoked_at: null },
        { 
          where: { 
            member_id: memberId, 
            is_active: false,
            revoked_at: { [Op.gte]: oneMonthAgo }
          } 
        }
      );
      restored.missions = missionsRestored;
    }

    return restored;
  }

  /**
   * Vérifie si un compte peut être réactivé
   * @param {number} memberId
   * @returns {Promise<Object>}
   */
  async canReactivate(memberId) {
    const user = await this.User.findOne({
      where: { member_id: memberId },
      paranoid: false
    });

    if (!user) {
      return { canReactivate: false, reason: 'Utilisateur non trouve' };
    }

    if (user.status === 'active' && !user.deleted_at) {
      return { canReactivate: false, reason: 'Compte deja actif' };
    }

    // Vérifier Cendre Blanche
    const cendreBlanched = await this.AuditLog.findOne({
      where: {
        action: 'cendre_blanche_executed',
        resource_id: String(memberId)
      }
    });

    if (cendreBlanched) {
      return { canReactivate: false, reason: 'Suppression irreversible (Cendre Blanche)' };
    }

    return { 
      canReactivate: true, 
      user: { 
        memberId: user.member_id, 
        role: user.role, 
        deletedAt: user.deleted_at 
      } 
    };
  }
}

class PapierFroisseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PapierFroisseError';
    this.code = code;
  }
}

module.exports = PapierFroisseService;
module.exports.PapierFroisseError = PapierFroisseError;
