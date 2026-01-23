'use strict';

/**
 * Service Cendre Blanche - Suppression Définitive
 * @see Document Technique V7.0 - Section 8.2, 8.9
 */

const { Op } = require('sequelize');
const crypto = require('crypto');

const ACTIVATION_CONDITIONS = {
  COMPROMISSION: 'compromission',
  VIOLATION: 'violation',
  USER_REQUEST: 'user_request',
  INACTIVITY: 'inactivity'
};

class CendreBlancheService {
  constructor(models, sequelize, services = {}) {
    this.models = models;
    this.sequelize = sequelize;
    this.notificationService = services.notification;
  }

  async execute(targetMemberId, adminId, options = {}) {
    const { reason, condition = ACTIVATION_CONDITIONS.USER_REQUEST, force = false } = options;
    console.log('[Cendre Blanche] Suppression de ' + targetMemberId);

    const targetUser = await this.models.User.findByPk(targetMemberId);
    if (!targetUser) throw new CendreBlancheError('USER_NOT_FOUND', 'Utilisateur non trouve');

    await this._validateAuthorization(adminId, targetUser, force);

    const protocolLog = await this.models.SecurityProtocolLog.create({
      protocol_name: 'cendre_blanche',
      triggered_by: 'manual',
      member_id: adminId,
      scope: 'local',
      reason: reason || 'Suppression definitive - ' + condition,
      actions_taken: [],
      result: 'pending',
      started_at: new Date()
    });

    const actions = [];
    const transaction = await this.sequelize.transaction();

    try {
      // Phase 1: Sauvegarde audit
      const auditBackup = await this._createAuditBackup(targetUser, transaction);
      actions.push({ phase: 1, action: 'audit_backup' });

      // Phase 2: Blocage
      await this.models.Session.update(
        { is_active: false, logout_reason: 'security' },
        { where: { member_id: targetMemberId }, transaction }
      );
      actions.push({ phase: 2, action: 'block_user' });

      // Phase 3: Suppression donnees liees
      if (this.models.Session) {
        await this.models.Session.destroy({ where: { member_id: targetMemberId }, transaction });
      }
      if (this.models.GuardAssignment) {
        await this.models.GuardAssignment.destroy({ where: { member_id: targetMemberId }, transaction });
      }
      if (this.models.GroupMembership) {
        await this.models.GroupMembership.destroy({ where: { member_id: targetMemberId }, transaction });
      }
      if (this.models.UserMission) {
        await this.models.UserMission.destroy({ where: { member_id: targetMemberId }, transaction });
      }
      if (this.models.Notification) {
        await this.models.Notification.destroy({ where: { member_id: targetMemberId }, transaction });
      }
      if (this.models.UserSkill) {
        await this.models.UserSkill.destroy({ where: { member_id: targetMemberId }, transaction });
      }
      if (this.models.UserAvailability) {
        await this.models.UserAvailability.destroy({ where: { member_id: targetMemberId }, transaction });
      }
      actions.push({ phase: 3, action: 'delete_related_data' });

      // Phase 4: Effacement cryptographique
      await this._cryptographicErase(targetUser, transaction);
      actions.push({ phase: 4, action: 'cryptographic_erase' });

      // Phase 5: Suppression definitive
      await targetUser.destroy({ transaction, force: true });
      actions.push({ phase: 5, action: 'delete_user', memberId: targetMemberId });

      await transaction.commit();

      await protocolLog.update({ actions_taken: actions, result: 'success', completed_at: new Date() });
      await this.models.AuditLog.create({
        member_id: adminId,
        action: 'cendre_blanche_executed',
        resource_type: 'user',
        resource_id: String(targetMemberId),
        result: 'success',
        notes: reason
      });

      console.log('[Cendre Blanche] Utilisateur ' + targetMemberId + ' supprime');
      return { success: true, memberId: targetMemberId, protocolId: protocolLog.protocol_log_id, actions };

    } catch (error) {
      await transaction.rollback();
      await protocolLog.update({ actions_taken: actions, result: 'failed', completed_at: new Date() });
      throw new CendreBlancheError('EXECUTION_FAILED', error.message);
    }
  }

  async _validateAuthorization(adminId, targetUser, force) {
    const admin = await this.models.User.findByPk(adminId);
    if (!admin) throw new CendreBlancheError('ADMIN_NOT_FOUND', 'Admin non trouve');
    
    const adminRole = admin.role;
    const targetRole = targetUser.role;

    if ((targetRole === 'Silver' || targetRole === 'Gold') && !['Platinum', 'Admin', 'Admin_N1'].includes(adminRole)) {
      throw new CendreBlancheError('UNAUTHORIZED', 'Droits insuffisants');
    }
    if (targetRole === 'Platinum' && adminRole !== 'Admin_N1') {
      throw new CendreBlancheError('UNAUTHORIZED', 'Admin N1 requis pour Platinum');
    }
    if (targetRole === 'Admin' && adminRole !== 'Admin_N1') {
      throw new CendreBlancheError('UNAUTHORIZED', 'Admin N1 requis pour Admin');
    }
    if (targetRole === 'Admin_N1' && !force) {
      throw new CendreBlancheError('COLLEGIAL_REQUIRED', 'Validation collegiale requise');
    }
    return true;
  }

  async _createAuditBackup(user, transaction) {
    const backup = {
      id: crypto.randomUUID(),
      memberId: user.member_id,
      role: user.role,
      geoId: user.geo_id,
      createdAt: user.created_at,
      deletedAt: new Date(),
      emailHash: user.email_hash
    };
    
    await this.models.AuditLog.create({
      action: 'cendre_blanche_backup',
      resource_type: 'user',
      resource_id: String(user.member_id),
      old_values: backup,
      result: 'success'
    }, { transaction });
    
    return backup;
  }

  async _cryptographicErase(user, transaction) {
    const randomData = crypto.randomBytes(256).toString('hex');
    const randomHash = crypto.createHash('sha256').update(randomData).digest('hex');

    // Use setDataValue to bypass encryption hooks
    user.setDataValue('email_encrypted', randomData);
    user.setDataValue('email_hash', randomHash);
    user.setDataValue('password_hash', randomHash);
    user.setDataValue('first_name_encrypted', randomData);
    user.setDataValue('last_name_encrypted', randomData);
    user.setDataValue('first_name_hash', null);
    user.setDataValue('last_name_hash', null);
    user.setDataValue('first_name_phonetic', null);
    user.setDataValue('last_name_phonetic', null);
    user.setDataValue('phone_encrypted', null);
    user.setDataValue('totp_secret_encrypted', null);
    user.setDataValue('matrix_id', null);
    user.setDataValue('status', 'deleted');

    await user.save({ transaction });

    return { erased: true };
  }

  async canRecover(memberId) {
    return { recoverable: false, reason: 'Cendre Blanche is irreversible' };
  }
}

class CendreBlancheError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CendreBlancheError';
    this.code = code;
  }
}

module.exports = CendreBlancheService;
module.exports.CendreBlancheError = CendreBlancheError;
module.exports.ACTIVATION_CONDITIONS = ACTIVATION_CONDITIONS;
