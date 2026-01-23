'use strict';

/**
 * Service UpsideModeService - Mode Dégradé / Upside Mode
 *
 * Gère le fonctionnement du système en mode dégradé lorsque:
 * - La connexion avec le serveur central est perdue
 * - Des services critiques sont indisponibles
 * - Le système doit fonctionner en autonomie temporaire
 *
 * Le mode Upside permet aux serveurs locaux de continuer à fonctionner
 * avec des capacités réduites jusqu'au rétablissement de la connexion.
 *
 * @see Document Technique V7.0 - Section 8.5
 */

const { Op } = require('sequelize');

/**
 * Niveaux de dégradation
 */
const DEGRADATION_LEVELS = {
  NONE: 'none',           // Fonctionnement normal
  LIGHT: 'light',         // Dégradation légère - certaines fonctionnalités désactivées
  MEDIUM: 'medium',       // Dégradation moyenne - mode lecture seule sauf urgences
  SEVERE: 'severe',       // Dégradation sévère - fonctions critiques uniquement
  AUTONOMOUS: 'autonomous' // Mode autonome - déconnecté du central
};

/**
 * Services pouvant être dégradés
 */
const DEGRADABLE_SERVICES = {
  SYNC: 'synchronization',
  NOTIFICATIONS: 'notifications',
  ANALYTICS: 'analytics',
  BACKUP: 'backup',
  AUDIT: 'audit_logging',
  EXTERNAL_AUTH: 'external_auth'
};

/**
 * Fonctionnalités par niveau de dégradation
 */
const LEVEL_CAPABILITIES = {
  [DEGRADATION_LEVELS.NONE]: {
    readWrite: true,
    sync: true,
    notifications: true,
    backup: true,
    audit: true,
    externalAuth: true
  },
  [DEGRADATION_LEVELS.LIGHT]: {
    readWrite: true,
    sync: true,
    notifications: false,
    backup: true,
    audit: true,
    externalAuth: true
  },
  [DEGRADATION_LEVELS.MEDIUM]: {
    readWrite: 'restricted',
    sync: 'queued',
    notifications: false,
    backup: 'emergency_only',
    audit: true,
    externalAuth: false
  },
  [DEGRADATION_LEVELS.SEVERE]: {
    readWrite: 'admin_only',
    sync: false,
    notifications: false,
    backup: false,
    audit: 'local_only',
    externalAuth: false
  },
  [DEGRADATION_LEVELS.AUTONOMOUS]: {
    readWrite: 'local',
    sync: false,
    notifications: 'local',
    backup: 'local',
    audit: 'local_only',
    externalAuth: false
  }
};

class UpsideModeService {
  constructor(models, sequelize, services = {}) {
    this.models = models;
    this.sequelize = sequelize;
    this.notificationService = services.notification;
    this.syncService = services.sync;

    this._currentLevel = DEGRADATION_LEVELS.NONE;
    this._activatedAt = null;
    this._reason = null;
    this._affectedServices = new Set();
    this._pendingOperations = [];
    this._healthCheckInterval = null;
  }

  /**
   * Initialise le service et démarre la surveillance
   */
  async initialize() {
    console.log('[UpsideMode] Initialisation...');

    const healthStatus = await this._performHealthCheck();

    if (healthStatus.issues.length > 0) {
      const recommendedLevel = this._determineLevel(healthStatus.issues);
      if (recommendedLevel !== DEGRADATION_LEVELS.NONE) {
        await this.activate(recommendedLevel, {
          reason: 'initial_health_check',
          issues: healthStatus.issues
        });
      }
    }

    this._startHealthMonitoring();

    return {
      initialized: true,
      currentLevel: this._currentLevel,
      healthStatus
    };
  }

  /**
   * Active le mode dégradé
   */
  async activate(level, options = {}) {
    if (!Object.values(DEGRADATION_LEVELS).includes(level)) {
      throw new UpsideModeError('INVALID_LEVEL', `Niveau invalide: ${level}`);
    }

    if (level === DEGRADATION_LEVELS.NONE) {
      return this.deactivate(options.adminId);
    }

    console.log(`[UpsideMode] Activation niveau: ${level}`);

    const previousLevel = this._currentLevel;
    this._currentLevel = level;
    this._activatedAt = new Date();
    this._reason = options.reason || 'manual_activation';

    const protocolLog = await this.models.SecurityProtocolLog.create({
      protocol_name: 'upside_mode',
      protocol_level: level,
      triggered_by: options.adminId ? 'manual' : 'automatic',
      member_id: options.adminId || null,
      scope: options.scope || 'central',
      reason: this._reason,
      trigger_details: options,
      actions_taken: [],
      result: 'pending',
      started_at: new Date(),
      severity: this._getSeverity(level)
    });

    try {
      const actions = [];
      const capabilities = LEVEL_CAPABILITIES[level];

      if (capabilities.readWrite !== true) {
        global.SHUGO_UPSIDE_MODE = true;
        global.SHUGO_UPSIDE_LEVEL = level;

        if (capabilities.readWrite === 'restricted' || capabilities.readWrite === 'admin_only') {
          global.SHUGO_READ_ONLY = true;
        }
        actions.push({ action: 'set_read_mode', mode: capabilities.readWrite });
      }

      if (capabilities.sync !== true) {
        this._affectedServices.add(DEGRADABLE_SERVICES.SYNC);
        if (capabilities.sync === 'queued' && this.syncService) {
          await this.syncService.enableQueueMode?.();
          actions.push({ action: 'enable_sync_queue' });
        } else if (capabilities.sync === false) {
          actions.push({ action: 'disable_sync' });
        }
      }

      if (!capabilities.notifications) {
        this._affectedServices.add(DEGRADABLE_SERVICES.NOTIFICATIONS);
        actions.push({ action: 'disable_notifications' });
      }

      if (capabilities.audit === 'local_only') {
        this._affectedServices.add(DEGRADABLE_SERVICES.AUDIT);
        actions.push({ action: 'local_audit_only' });
      }

      if (this.notificationService && capabilities.notifications !== false) {
        await this._notifyAdmins({
          type: 'upside_mode_activated',
          level,
          previousLevel,
          reason: this._reason,
          capabilities
        });
        actions.push({ action: 'admin_notification' });
      }

      await protocolLog.update({
        actions_taken: actions,
        affected_entities: {
          affectedServices: Array.from(this._affectedServices),
          capabilities
        },
        result: 'success',
        completed_at: new Date()
      });

      return {
        success: true,
        level,
        previousLevel,
        activatedAt: this._activatedAt,
        capabilities,
        affectedServices: Array.from(this._affectedServices),
        protocolLogId: protocolLog.protocol_log_id
      };
    } catch (error) {
      await protocolLog.update({
        result: 'failed',
        error_message: error.message,
        completed_at: new Date()
      });
      throw new UpsideModeError('ACTIVATION_FAILED', error.message);
    }
  }

  /**
   * Désactive le mode dégradé
   */
  async deactivate(adminId = null) {
    if (this._currentLevel === DEGRADATION_LEVELS.NONE) {
      return { success: true, message: 'Mode dégradé non actif' };
    }

    console.log('[UpsideMode] Désactivation...');

    const protocolLog = await this.models.SecurityProtocolLog.create({
      protocol_name: 'upside_mode_deactivation',
      triggered_by: adminId ? 'manual' : 'automatic',
      member_id: adminId,
      scope: 'central',
      reason: 'Désactivation du mode dégradé',
      actions_taken: [],
      result: 'pending',
      started_at: new Date()
    });

    try {
      const actions = [];
      const previousLevel = this._currentLevel;
      const duration = this._activatedAt
        ? Date.now() - this._activatedAt.getTime()
        : 0;

      global.SHUGO_UPSIDE_MODE = false;
      global.SHUGO_UPSIDE_LEVEL = null;
      global.SHUGO_READ_ONLY = false;
      actions.push({ action: 'restore_normal_mode' });

      if (this._affectedServices.has(DEGRADABLE_SERVICES.SYNC)) {
        if (this.syncService) {
          await this.syncService.disableQueueMode?.();
          const pendingCount = await this._processPendingOperations();
          actions.push({ action: 'process_pending_sync', count: pendingCount });
        }
      }

      this._currentLevel = DEGRADATION_LEVELS.NONE;
      this._activatedAt = null;
      this._reason = null;
      this._affectedServices.clear();

      await this._notifyAdmins({
        type: 'upside_mode_deactivated',
        previousLevel,
        duration,
        deactivatedBy: adminId
      });
      actions.push({ action: 'admin_notification' });

      await protocolLog.update({
        actions_taken: actions,
        affected_entities: { previousLevel, duration },
        result: 'success',
        completed_at: new Date()
      });

      return {
        success: true,
        previousLevel,
        duration,
        deactivatedAt: new Date()
      };
    } catch (error) {
      await protocolLog.update({
        result: 'failed',
        error_message: error.message,
        completed_at: new Date()
      });
      throw new UpsideModeError('DEACTIVATION_FAILED', error.message);
    }
  }

  /**
   * Escalade vers un niveau supérieur
   */
  async escalate(trigger = {}) {
    const levels = Object.values(DEGRADATION_LEVELS);
    const currentIndex = levels.indexOf(this._currentLevel);

    if (currentIndex >= levels.length - 1) {
      return {
        success: false,
        message: 'Niveau maximum atteint',
        currentLevel: this._currentLevel
      };
    }

    const nextLevel = levels[currentIndex + 1];
    console.log(`[UpsideMode] Escalade: ${this._currentLevel} -> ${nextLevel}`);

    return this.activate(nextLevel, {
      reason: 'escalation',
      previousLevel: this._currentLevel,
      trigger
    });
  }

  /**
   * Désescalade vers un niveau inférieur
   */
  async deescalate(adminId) {
    const levels = Object.values(DEGRADATION_LEVELS);
    const currentIndex = levels.indexOf(this._currentLevel);

    if (currentIndex <= 0) {
      return this.deactivate(adminId);
    }

    const previousLevel = levels[currentIndex - 1];
    console.log(`[UpsideMode] Désescalade: ${this._currentLevel} -> ${previousLevel}`);

    return this.activate(previousLevel, {
      reason: 'deescalation',
      adminId
    });
  }

  /**
   * Vérifie si une action est autorisée dans le mode actuel
   */
  isActionAllowed(action, context = {}) {
    if (this._currentLevel === DEGRADATION_LEVELS.NONE) {
      return { allowed: true };
    }

    const capabilities = LEVEL_CAPABILITIES[this._currentLevel];

    if (action === 'write' || action === 'create' || action === 'update' || action === 'delete') {
      if (capabilities.readWrite === true) {
        return { allowed: true };
      }
      if (capabilities.readWrite === 'admin_only' && context.isAdmin) {
        return { allowed: true };
      }
      if (capabilities.readWrite === 'restricted' && (context.isAdmin || context.isEmergency)) {
        return { allowed: true };
      }
      if (capabilities.readWrite === 'local' && context.isLocal) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `Action '${action}' non autorisée en mode ${this._currentLevel}`,
        level: this._currentLevel
      };
    }

    if (action === 'sync') {
      if (capabilities.sync === true) {
        return { allowed: true };
      }
      if (capabilities.sync === 'queued') {
        return { allowed: true, queued: true };
      }
      return { allowed: false, reason: 'Synchronisation désactivée' };
    }

    if (action === 'notification') {
      if (capabilities.notifications === true || capabilities.notifications === 'local') {
        return { allowed: true, localOnly: capabilities.notifications === 'local' };
      }
      return { allowed: false, reason: 'Notifications désactivées' };
    }

    return { allowed: true };
  }

  /**
   * Ajoute une opération à la file d'attente
   */
  queueOperation(operation) {
    if (this._currentLevel === DEGRADATION_LEVELS.NONE) {
      return { queued: false, reason: 'Mode normal, pas de file d\'attente' };
    }

    this._pendingOperations.push({
      ...operation,
      queuedAt: new Date(),
      level: this._currentLevel
    });

    return {
      queued: true,
      position: this._pendingOperations.length,
      operationId: operation.id
    };
  }

  /**
   * Obtient le statut actuel
   */
  getStatus() {
    return {
      active: this._currentLevel !== DEGRADATION_LEVELS.NONE,
      level: this._currentLevel,
      activatedAt: this._activatedAt,
      duration: this._activatedAt
        ? Date.now() - this._activatedAt.getTime()
        : null,
      reason: this._reason,
      affectedServices: Array.from(this._affectedServices),
      capabilities: LEVEL_CAPABILITIES[this._currentLevel],
      pendingOperations: this._pendingOperations.length
    };
  }

  /**
   * Obtient les capacités pour un niveau donné
   */
  getLevelCapabilities(level) {
    return LEVEL_CAPABILITIES[level] || null;
  }

  // ===== MÉTHODES PRIVÉES =====

  _startHealthMonitoring() {
    this._healthCheckInterval = setInterval(async () => {
      try {
        const health = await this._performHealthCheck();

        if (health.issues.length > 0 && this._currentLevel === DEGRADATION_LEVELS.NONE) {
          const level = this._determineLevel(health.issues);
          if (level !== DEGRADATION_LEVELS.NONE) {
            await this.activate(level, {
              reason: 'health_check_failure',
              issues: health.issues
            });
          }
        } else if (health.issues.length === 0 && this._currentLevel !== DEGRADATION_LEVELS.NONE) {
          await this.deactivate();
        }
      } catch (error) {
        console.error('[UpsideMode] Erreur health check:', error.message);
      }
    }, 30000);
  }

  async _performHealthCheck() {
    const issues = [];
    const checks = {};

    try {
      await this.sequelize.authenticate();
      checks.database = 'ok';
    } catch {
      issues.push({ service: 'database', severity: 'critical' });
      checks.database = 'failed';
    }

    if (this.syncService) {
      try {
        const centralStatus = await this.syncService.checkCentralConnection?.();
        checks.central = centralStatus ? 'ok' : 'unreachable';
        if (!centralStatus) {
          issues.push({ service: 'central_connection', severity: 'high' });
        }
      } catch {
        issues.push({ service: 'central_connection', severity: 'high' });
        checks.central = 'failed';
      }
    }

    return {
      timestamp: new Date(),
      checks,
      issues,
      healthy: issues.length === 0
    };
  }

  _determineLevel(issues) {
    const hasCritical = issues.some(i => i.severity === 'critical');
    const hasHigh = issues.some(i => i.severity === 'high');
    const hasMedium = issues.some(i => i.severity === 'medium');

    if (hasCritical) return DEGRADATION_LEVELS.SEVERE;
    if (hasHigh) return DEGRADATION_LEVELS.MEDIUM;
    if (hasMedium) return DEGRADATION_LEVELS.LIGHT;
    return DEGRADATION_LEVELS.NONE;
  }

  _getSeverity(level) {
    switch (level) {
      case DEGRADATION_LEVELS.SEVERE:
      case DEGRADATION_LEVELS.AUTONOMOUS:
        return 'critical';
      case DEGRADATION_LEVELS.MEDIUM:
        return 'high';
      case DEGRADATION_LEVELS.LIGHT:
        return 'medium';
      default:
        return 'low';
    }
  }

  async _processPendingOperations() {
    const count = this._pendingOperations.length;

    for (const operation of this._pendingOperations) {
      try {
        if (this.syncService && operation.type === 'sync') {
          await this.syncService.replay?.(operation);
        }
      } catch (error) {
        console.error(`[UpsideMode] Erreur replay operation ${operation.id}:`, error.message);
      }
    }

    this._pendingOperations = [];
    return count;
  }

  async _notifyAdmins(data) {
    if (!this.notificationService || !this.models.User) return;

    try {
      const admins = await this.models.User.findAll({
        where: { role: { [Op.in]: ['Admin', 'Admin_N1'] }, status: 'active' }
      });

      for (const admin of admins) {
        await this.notificationService.send(
          admin.member_id,
          'system_alert',
          { protocol: 'upside_mode', ...data, timestamp: new Date() },
          { priority: 'high', immediate: true }
        );
      }
    } catch (error) {
      console.error('[UpsideMode] Erreur notification:', error.message);
    }
  }

  /**
   * Nettoyage à l'arrêt du service
   */
  shutdown() {
    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
      this._healthCheckInterval = null;
    }
  }
}

/**
 * Classe d'erreur spécifique
 */
class UpsideModeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'UpsideModeError';
    this.code = code;
  }
}

module.exports = UpsideModeService;
module.exports.UpsideModeError = UpsideModeError;
module.exports.DEGRADATION_LEVELS = DEGRADATION_LEVELS;
module.exports.DEGRADABLE_SERVICES = DEGRADABLE_SERVICES;
module.exports.LEVEL_CAPABILITIES = LEVEL_CAPABILITIES;
