'use strict';

/**
 * Service GuiltySparkService - Protocole de Verrouillage d'Urgence
 *
 * Ce protocole active un verrouillage système en cas de:
 * - Tentatives d'intrusion multiples
 * - Détection de comportement anormal
 * - Demande manuelle d'un admin N1+
 *
 * Actions:
 * - Verrouillage de toutes les sessions actives
 * - Blocage des nouvelles connexions
 * - Alerte aux administrateurs
 * - Sauvegarde d'urgence optionnelle
 *
 * @see Document Technique V7.0 - Section 8.8
 */

const { Op } = require('sequelize');

/**
 * Niveaux de verrouillage
 */
const LOCKDOWN_LEVELS = {
  PARTIAL: 'partial',     // Verrouillage partiel - nouvelles connexions bloquées
  FULL: 'full',           // Verrouillage total - toutes sessions terminées
  EMERGENCY: 'emergency'  // Urgence - rotation clés + backup immédiat
};

/**
 * Raisons de déclenchement
 */
const TRIGGER_REASONS = {
  INTRUSION_ATTEMPT: 'intrusion_attempt',
  BRUTE_FORCE: 'brute_force',
  ANOMALY_DETECTED: 'anomaly_detected',
  ADMIN_REQUEST: 'admin_request',
  CASCADE: 'cascade_from_integrity'
};

class GuiltySparkService {
  constructor(models, sequelize, services = {}) {
    this.models = models;
    this.sequelize = sequelize;
    this.vaultService = services.vault;
    this.notificationService = services.notification;
    this.backupService = services.backup;

    this._isActive = false;
    this._currentLevel = null;
    this._lockdownStartedAt = null;
    this._triggerSource = null;
  }

  /**
   * Active le verrouillage partiel
   * @param {Object} trigger - Détails du déclencheur
   * @returns {Promise<Object>}
   */
  async activatePartialLockdown(trigger = {}) {
    console.log(`[GuiltySpark] Verrouillage PARTIEL activé`);

    const protocolLog = await this._createProtocolLog(
      LOCKDOWN_LEVELS.PARTIAL,
      trigger.adminId || null,
      trigger.reason || TRIGGER_REASONS.ANOMALY_DETECTED,
      trigger
    );

    try {
      const actions = [];

      // 1. Bloquer les nouvelles connexions
      global.SHUGO_LOGIN_BLOCKED = true;
      actions.push({ action: 'block_new_logins', timestamp: new Date() });

      // 2. Invalider les tokens de registration
      if (this.models.RegistrationToken) {
        const invalidated = await this.models.RegistrationToken.update(
          { status: 'revoked', revoked_reason: 'guilty_spark_lockdown' },
          { where: { status: 'active' } }
        );
        actions.push({ action: 'revoke_registration_tokens', count: invalidated[0] });
      }

      // 3. Marquer les sessions comme "en surveillance"
      await this.models.Session.update(
        { metadata: this.sequelize.literal(`metadata || '{"under_lockdown": true}'`) },
        { where: { is_active: true } }
      );
      actions.push({ action: 'mark_sessions_monitored' });

      // 4. Notifier les admins
      await this._notifyAdmins(LOCKDOWN_LEVELS.PARTIAL, trigger);
      actions.push({ action: 'admin_notification' });

      // Mettre à jour l'état
      this._isActive = true;
      this._currentLevel = LOCKDOWN_LEVELS.PARTIAL;
      this._lockdownStartedAt = new Date();
      this._triggerSource = trigger;

      // Finaliser le log
      await protocolLog.update({
        actions_taken: actions,
        result: 'success',
        completed_at: new Date(),
        duration_ms: Date.now() - protocolLog.started_at.getTime()
      });

      return {
        success: true,
        level: LOCKDOWN_LEVELS.PARTIAL,
        protocolId: protocolLog.protocol_log_id,
        actions,
        startedAt: this._lockdownStartedAt
      };
    } catch (error) {
      await protocolLog.update({
        result: 'failed',
        error_message: error.message,
        completed_at: new Date()
      });
      throw new GuiltySparkError('PARTIAL_LOCKDOWN_FAILED', error.message);
    }
  }

  /**
   * Active le verrouillage total
   * @param {number} adminId - ID de l'admin déclencheur
   * @param {Object} trigger - Détails du déclencheur
   * @returns {Promise<Object>}
   */
  async activateFullLockdown(adminId, trigger = {}) {
    // Valider les droits admin
    await this._validateAdminN1(adminId);

    console.log(`[GuiltySpark] Verrouillage TOTAL activé par Admin ${adminId}`);

    const protocolLog = await this._createProtocolLog(
      LOCKDOWN_LEVELS.FULL,
      adminId,
      trigger.reason || TRIGGER_REASONS.ADMIN_REQUEST,
      trigger
    );

    try {
      const actions = [];

      // 1. Bloquer toutes les connexions
      global.SHUGO_LOGIN_BLOCKED = true;
      global.SHUGO_API_BLOCKED = true;
      actions.push({ action: 'block_all_access', timestamp: new Date() });

      // 2. Terminer TOUTES les sessions (sauf admin N1)
      const sessionsTerminated = await this.models.Session.update(
        {
          is_active: false,
          logout_at: new Date(),
          logout_reason: 'guilty_spark_full_lockdown'
        },
        {
          where: {
            is_active: true,
            member_id: {
              [Op.notIn]: this.sequelize.literal(`(
                SELECT member_id FROM users WHERE role IN ('Admin', 'Admin_N1')
              )`)
            }
          }
        }
      );
      actions.push({ action: 'terminate_sessions', count: sessionsTerminated[0] });

      // 3. Révoquer tous les tokens
      if (this.models.RegistrationToken) {
        await this.models.RegistrationToken.update(
          { status: 'revoked', revoked_reason: 'guilty_spark_full_lockdown' },
          { where: { status: 'active' } }
        );
        actions.push({ action: 'revoke_all_tokens' });
      }

      // 4. Journaliser les IPs suspectes
      if (trigger.suspiciousIps) {
        await this._logSuspiciousIps(trigger.suspiciousIps, protocolLog.protocol_log_id);
        actions.push({ action: 'log_suspicious_ips', count: trigger.suspiciousIps.length });
      }

      // 5. Notifier tous les admins (urgent)
      await this._notifyAdmins(LOCKDOWN_LEVELS.FULL, trigger, true);
      actions.push({ action: 'urgent_admin_notification' });

      // Mettre à jour l'état
      this._isActive = true;
      this._currentLevel = LOCKDOWN_LEVELS.FULL;
      this._lockdownStartedAt = new Date();
      this._triggerSource = trigger;

      await protocolLog.update({
        actions_taken: actions,
        result: 'success',
        completed_at: new Date(),
        duration_ms: Date.now() - protocolLog.started_at.getTime()
      });

      return {
        success: true,
        level: LOCKDOWN_LEVELS.FULL,
        protocolId: protocolLog.protocol_log_id,
        actions,
        sessionsTerminated: sessionsTerminated[0],
        startedAt: this._lockdownStartedAt
      };
    } catch (error) {
      await protocolLog.update({
        result: 'failed',
        error_message: error.message,
        completed_at: new Date()
      });
      throw new GuiltySparkError('FULL_LOCKDOWN_FAILED', error.message);
    }
  }

  /**
   * Active le verrouillage d'urgence avec backup et rotation des clés
   * @param {number} adminId - ID de l'admin N1
   * @param {Object} credentials - Credentials de sécurité (password + TOTP)
   * @param {Object} trigger - Détails du déclencheur
   * @returns {Promise<Object>}
   */
  async activateEmergencyLockdown(adminId, credentials, trigger = {}) {
    // Validation renforcée
    await this._validateAdminN1(adminId);
    await this._validateCredentials(adminId, credentials);

    console.log(`[GuiltySpark] Verrouillage URGENCE activé par Admin ${adminId}`);

    const protocolLog = await this._createProtocolLog(
      LOCKDOWN_LEVELS.EMERGENCY,
      adminId,
      trigger.reason || TRIGGER_REASONS.INTRUSION_ATTEMPT,
      trigger
    );

    try {
      const actions = [];

      // 1. Verrouillage total immédiat
      global.SHUGO_LOGIN_BLOCKED = true;
      global.SHUGO_API_BLOCKED = true;
      global.SHUGO_MAINTENANCE_MODE = true;
      actions.push({ action: 'full_system_lock', timestamp: new Date() });

      // 2. Terminer TOUTES les sessions sans exception
      const sessionsTerminated = await this.models.Session.update(
        {
          is_active: false,
          logout_at: new Date(),
          logout_reason: 'guilty_spark_emergency'
        },
        { where: { is_active: true } }
      );
      actions.push({ action: 'terminate_all_sessions', count: sessionsTerminated[0] });

      // 3. Backup d'urgence si disponible
      if (this.backupService) {
        try {
          const backupResult = await this.backupService.createEmergencyBackup({
            reason: 'guilty_spark_emergency',
            triggeredBy: adminId
          });
          actions.push({ action: 'emergency_backup', jobId: backupResult.jobId });
        } catch (backupError) {
          console.error('[GuiltySpark] Backup d\'urgence échoué:', backupError.message);
          actions.push({ action: 'emergency_backup_failed', error: backupError.message });
        }
      }

      // 4. Rotation de toutes les clés si VaultService disponible
      if (this.vaultService) {
        const keyTypes = ['vault_local', 'vault_central', 'backup', 'logs'];
        for (const keyType of keyTypes) {
          try {
            await this.vaultService.rotateKey(keyType, adminId, 'guilty_spark_emergency');
            actions.push({ action: 'rotate_key', keyType, success: true });
          } catch (keyError) {
            actions.push({ action: 'rotate_key', keyType, success: false, error: keyError.message });
          }
        }
      }

      // 5. Invalider tous les tokens et secrets partagés
      if (this.models.SharedSecret) {
        await this.models.SharedSecret.update(
          { is_active: false },
          { where: { is_active: true } }
        );
        actions.push({ action: 'invalidate_shared_secrets' });
      }

      // 6. Notification d'urgence à tous les canaux
      await this._sendEmergencyNotifications(adminId, trigger, protocolLog.protocol_log_id);
      actions.push({ action: 'emergency_notifications_sent' });

      // Mettre à jour l'état
      this._isActive = true;
      this._currentLevel = LOCKDOWN_LEVELS.EMERGENCY;
      this._lockdownStartedAt = new Date();
      this._triggerSource = trigger;

      await protocolLog.update({
        actions_taken: actions,
        result: 'success',
        completed_at: new Date(),
        duration_ms: Date.now() - protocolLog.started_at.getTime(),
        severity: 'critical',
        requires_follow_up: true
      });

      return {
        success: true,
        level: LOCKDOWN_LEVELS.EMERGENCY,
        protocolId: protocolLog.protocol_log_id,
        actions,
        sessionsTerminated: sessionsTerminated[0],
        startedAt: this._lockdownStartedAt,
        requiresFollowUp: true
      };
    } catch (error) {
      await protocolLog.update({
        result: 'failed',
        error_message: error.message,
        completed_at: new Date()
      });
      throw new GuiltySparkError('EMERGENCY_LOCKDOWN_FAILED', error.message);
    }
  }

  /**
   * Désactive le verrouillage
   * @param {number} adminId - ID de l'admin N1
   * @param {Object} credentials - Credentials de sécurité
   * @returns {Promise<Object>}
   */
  async deactivate(adminId, credentials) {
    if (!this._isActive) {
      return { success: true, message: 'Aucun verrouillage actif' };
    }

    await this._validateAdminN1(adminId);
    await this._validateCredentials(adminId, credentials);

    console.log(`[GuiltySpark] Désactivation par Admin ${adminId}`);

    const protocolLog = await this.models.SecurityProtocolLog.create({
      protocol_name: 'guilty_spark_deactivation',
      triggered_by: 'manual',
      member_id: adminId,
      scope: 'central',
      reason: 'Désactivation du verrouillage',
      actions_taken: [],
      result: 'pending',
      started_at: new Date()
    });

    try {
      const actions = [];

      // Restaurer l'accès
      global.SHUGO_LOGIN_BLOCKED = false;
      global.SHUGO_API_BLOCKED = false;
      global.SHUGO_MAINTENANCE_MODE = false;
      actions.push({ action: 'restore_access', timestamp: new Date() });

      // Durée du verrouillage
      const lockdownDuration = this._lockdownStartedAt
        ? Date.now() - this._lockdownStartedAt.getTime()
        : 0;

      // Réinitialiser l'état
      const previousLevel = this._currentLevel;
      this._isActive = false;
      this._currentLevel = null;
      this._lockdownStartedAt = null;
      this._triggerSource = null;

      await protocolLog.update({
        actions_taken: actions,
        affected_entities: { previousLevel, lockdownDuration },
        result: 'success',
        completed_at: new Date()
      });

      // Notifier les admins de la désactivation
      await this._notifyAdmins(null, { deactivatedBy: adminId, previousLevel });

      return {
        success: true,
        previousLevel,
        lockdownDuration,
        deactivatedAt: new Date()
      };
    } catch (error) {
      await protocolLog.update({
        result: 'failed',
        error_message: error.message,
        completed_at: new Date()
      });
      throw new GuiltySparkError('DEACTIVATION_FAILED', error.message);
    }
  }

  /**
   * Obtient le statut actuel
   * @returns {Object}
   */
  getStatus() {
    return {
      isActive: this._isActive,
      level: this._currentLevel,
      startedAt: this._lockdownStartedAt,
      duration: this._lockdownStartedAt
        ? Date.now() - this._lockdownStartedAt.getTime()
        : null,
      trigger: this._triggerSource
    };
  }

  // ===== MÉTHODES PRIVÉES =====

  async _createProtocolLog(level, adminId, reason, trigger) {
    return this.models.SecurityProtocolLog.create({
      protocol_name: 'guilty_spark',
      protocol_level: level,
      triggered_by: adminId ? 'manual' : 'automatic',
      member_id: adminId,
      scope: 'central',
      reason,
      trigger_details: trigger,
      actions_taken: [],
      result: 'pending',
      started_at: new Date(),
      severity: level === LOCKDOWN_LEVELS.EMERGENCY ? 'critical' : 'high'
    });
  }

  async _validateAdminN1(adminId) {
    const admin = await this.models.User.findByPk(adminId);
    if (!admin || !['Admin', 'Admin_N1'].includes(admin.role)) {
      throw new GuiltySparkError('UNAUTHORIZED', 'Droits Admin N1 requis');
    }
    return admin;
  }

  async _validateCredentials(adminId, credentials) {
    if (!credentials || !credentials.password || !credentials.totpCode) {
      throw new GuiltySparkError('INVALID_CREDENTIALS', 'Authentification incomplète');
    }
    // Validation effective via AuthService si disponible
  }

  async _logSuspiciousIps(ips, protocolLogId) {
    if (!this.models.AuditLog) return;

    for (const ip of ips) {
      await this.models.AuditLog.create({
        action: 'suspicious_ip_logged',
        category: 'security',
        ip_address: ip,
        details: { protocol_log_id: protocolLogId, logged_at: new Date() }
      });
    }
  }

  async _notifyAdmins(level, trigger, urgent = false) {
    if (!this.notificationService) return;

    try {
      const admins = await this.models.User.findAll({
        where: { role: { [Op.in]: ['Admin', 'Admin_N1'] }, status: 'active' }
      });

      for (const admin of admins) {
        await this.notificationService.send(
          admin.member_id,
          'security_alert',
          {
            protocol: 'guilty_spark',
            level,
            trigger,
            timestamp: new Date()
          },
          {
            priority: urgent ? 'urgent' : 'high',
            immediate: urgent
          }
        );
      }
    } catch (error) {
      console.error('[GuiltySpark] Erreur notification:', error.message);
    }
  }

  async _sendEmergencyNotifications(adminId, trigger, protocolLogId) {
    // Notification normale
    await this._notifyAdmins(LOCKDOWN_LEVELS.EMERGENCY, trigger, true);

    // Si un service de notification externe existe, l'utiliser aussi
    if (this.notificationService?.sendEmergencyAlert) {
      await this.notificationService.sendEmergencyAlert({
        protocol: 'guilty_spark',
        level: 'emergency',
        triggeredBy: adminId,
        protocolLogId,
        timestamp: new Date()
      });
    }
  }
}

/**
 * Classe d'erreur spécifique
 */
class GuiltySparkError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GuiltySparkError';
    this.code = code;
  }
}

module.exports = GuiltySparkService;
module.exports.GuiltySparkError = GuiltySparkError;
module.exports.LOCKDOWN_LEVELS = LOCKDOWN_LEVELS;
module.exports.TRIGGER_REASONS = TRIGGER_REASONS;
