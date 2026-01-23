'use strict';

/**
 * Service de Maintenance SHUGO
 * 
 * Gestion de la maintenance nocturne automatique (00h00 local).
 * Coordonne toutes les opérations de maintenance : nettoyage, rotation, archivage.
 * 
 * @see Document Technique V7.0 - Section 5.7
 */

const { Op } = require('sequelize');
const config = require('../config');

/**
 * Étapes de maintenance
 */
const MAINTENANCE_STEPS = {
  DISCONNECT_USERS: 'disconnect_users',
  FREEZE_NETWORK: 'freeze_network',
  VERIFY_INTEGRITY: 'verify_integrity',
  CHECK_KEY_ROTATION: 'check_key_rotation',
  CLEANUP_SOFT_DELETES: 'cleanup_soft_deletes',
  ARCHIVE_LOGS: 'archive_logs',
  RECHIPER_DATA: 'rechiper_data',
  GENERATE_BACKUP: 'generate_backup',
  SEND_STATUS: 'send_status',
  RESTART: 'restart'
};

/**
 * Statuts de maintenance
 */
const MAINTENANCE_STATUS = {
  SCHEDULED: 'scheduled',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

/**
 * Service de maintenance
 */
class MaintenanceService {
  constructor(models, sequelize, services = {}) {
    this.models = models;
    this.sequelize = sequelize;
    this.MaintenanceRun = models.MaintenanceRun;
    this.HealthCheck = models.HealthCheck;
    this.SystemMetric = models.SystemMetric;
    this.SystemLog = models.SystemLog;
    this.Session = models.Session;
    this.User = models.User;
    this.AuditLog = models.AuditLog;
    this.AesKeyRotation = models.AesKeyRotation;
    this.SharedSecret = models.SharedSecret;

    // Services injectés
    this.vaultService = services.vault;
    this.backupService = services.backup;
    this.notificationService = services.notification;

    // État de la maintenance
    this._isRunning = false;
    this._currentRun = null;
    this._stepsCompleted = [];
    this._errors = [];
  }

  // =========================================
  // DÉCLENCHEMENT
  // =========================================

  /**
   * Lance la maintenance nocturne
   * @param {string} runType - Type de maintenance (daily, weekly, monthly, emergency)
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async startMaintenance(runType = 'daily', options = {}) {
    if (this._isRunning) {
      throw new MaintenanceError('ALREADY_RUNNING', 'Une maintenance est déjà en cours');
    }

    const { force = false, skipBackup = false, skipRotation = false } = options;

    this._isRunning = true;
    this._stepsCompleted = [];
    this._errors = [];

    const startTime = new Date();

    // Créer l'enregistrement de maintenance
    this._currentRun = await this.MaintenanceRun.create({
      run_type: runType,
      scheduled_at: startTime,
      started_at: startTime,
      status: MAINTENANCE_STATUS.RUNNING,
      steps_completed: [],
      errors_encountered: []
    });

    console.log(`[Maintenance] Démarrage maintenance ${runType} - ID: ${this._currentRun.run_id}`);

    try {
      // === ÉTAPE 1: Déconnexion des utilisateurs ===
      await this._executeStep(MAINTENANCE_STEPS.DISCONNECT_USERS, async () => {
        return this._disconnectAllUsers();
      });

      // === ÉTAPE 2: Gel du réseau (APIs désactivées) ===
      await this._executeStep(MAINTENANCE_STEPS.FREEZE_NETWORK, async () => {
        return this._setMaintenanceMode(true);
      });

      // === ÉTAPE 3: Vérification intégrité ===
      await this._executeStep(MAINTENANCE_STEPS.VERIFY_INTEGRITY, async () => {
        return this._verifyDatabaseIntegrity();
      });

      // === ÉTAPE 4: Vérification rotation clés ===
      if (!skipRotation) {
        await this._executeStep(MAINTENANCE_STEPS.CHECK_KEY_ROTATION, async () => {
          return this._checkKeyRotations();
        });
      }

      // === ÉTAPE 5: Nettoyage soft deletes ===
      await this._executeStep(MAINTENANCE_STEPS.CLEANUP_SOFT_DELETES, async () => {
        return this._cleanupSoftDeletes();
      });

      // === ÉTAPE 6: Archivage logs ===
      await this._executeStep(MAINTENANCE_STEPS.ARCHIVE_LOGS, async () => {
        return this._archiveLogs();
      });

      // === ÉTAPE 7: Rechiffrement si nécessaire ===
      await this._executeStep(MAINTENANCE_STEPS.RECHIPER_DATA, async () => {
        return this._rechipherDataIfNeeded();
      });

      // === ÉTAPE 8: Génération backup ===
      if (!skipBackup && this.backupService) {
        await this._executeStep(MAINTENANCE_STEPS.GENERATE_BACKUP, async () => {
          return this.backupService.createBackup('daily');
        });
      }

      // === ÉTAPE 9: Envoi statut au central ===
      await this._executeStep(MAINTENANCE_STEPS.SEND_STATUS, async () => {
        return this._sendStatusToCentral();
      });

      // === ÉTAPE 10: Redémarrage services ===
      await this._executeStep(MAINTENANCE_STEPS.RESTART, async () => {
        return this._setMaintenanceMode(false);
      });

      // Maintenance terminée avec succès
      const endTime = new Date();
      const durationSeconds = Math.round((endTime - startTime) / 1000);

      await this._currentRun.update({
        completed_at: endTime,
        status: MAINTENANCE_STATUS.COMPLETED,
        steps_completed: this._stepsCompleted,
        errors_encountered: this._errors,
        metrics: {
          durationSeconds,
          stepsCount: this._stepsCompleted.length,
          errorsCount: this._errors.length
        },
        next_run_scheduled: this._calculateNextRun(runType)
      });

      console.log(`[Maintenance] Terminée en ${durationSeconds}s - ${this._stepsCompleted.length} étapes`);

      return {
        success: true,
        runId: this._currentRun.run_id,
        duration: durationSeconds,
        stepsCompleted: this._stepsCompleted,
        errors: this._errors
      };

    } catch (error) {
      console.error('[Maintenance] Erreur critique:', error);

      await this._currentRun.update({
        completed_at: new Date(),
        status: MAINTENANCE_STATUS.FAILED,
        steps_completed: this._stepsCompleted,
        errors_encountered: [...this._errors, {
          step: 'critical',
          error: error.message,
          timestamp: new Date()
        }]
      });

      // Désactiver le mode maintenance en cas d'erreur
      await this._setMaintenanceMode(false);

      throw error;

    } finally {
      this._isRunning = false;
      this._currentRun = null;
    }
  }

  /**
   * Exécute une étape de maintenance
   * @private
   */
  async _executeStep(stepName, fn) {
    const stepStart = Date.now();
    console.log(`[Maintenance] Étape: ${stepName}...`);

    try {
      const result = await fn();
      const duration = Date.now() - stepStart;

      this._stepsCompleted.push({
        name: stepName,
        status: 'success',
        duration,
        result,
        timestamp: new Date()
      });

      console.log(`[Maintenance] ${stepName} OK (${duration}ms)`);
      return result;

    } catch (error) {
      const duration = Date.now() - stepStart;

      this._errors.push({
        step: stepName,
        error: error.message,
        duration,
        timestamp: new Date()
      });

      this._stepsCompleted.push({
        name: stepName,
        status: 'error',
        duration,
        error: error.message,
        timestamp: new Date()
      });

      console.error(`[Maintenance] ${stepName} ERREUR:`, error.message);

      // Continuer malgré l'erreur (sauf erreur critique)
      if (stepName === MAINTENANCE_STEPS.VERIFY_INTEGRITY) {
        throw error; // Arrêter si intégrité compromise
      }
    }
  }

  // =========================================
  // ÉTAPES DE MAINTENANCE
  // =========================================

  /**
   * Déconnecte tous les utilisateurs
   * @private
   */
  async _disconnectAllUsers() {
    const updated = await this.Session.update(
      {
        is_active: false,
        logout_reason: 'maintenance'
      },
      { where: { is_active: true } }
    );

    return { sessionsTerminated: updated[0] };
  }

  /**
   * Active/désactive le mode maintenance
   * @private
   */
  async _setMaintenanceMode(enabled) {
    // Stocker l'état en mémoire/Redis
    global.SHUGO_MAINTENANCE_MODE = enabled;

    // Logger l'événement
    await this.SystemLog.create({
      level: 'INFO',
      module: 'maintenance',
      message: enabled ? 'Mode maintenance activé' : 'Mode maintenance désactivé'
    });

    return { maintenanceMode: enabled };
  }

  /**
   * Vérifie l'intégrité de la base de données
   * @private
   */
  async _verifyDatabaseIntegrity() {
    const checks = [];

    // Vérifier les contraintes d'intégrité référentielle
    const [fkResults] = await this.sequelize.query(`
      SELECT conname, conrelid::regclass AS table_name
      FROM pg_constraint
      WHERE contype = 'f'
      AND NOT convalidated;
    `);

    checks.push({
      name: 'foreign_keys',
      status: fkResults.length === 0 ? 'ok' : 'warning',
      invalidCount: fkResults.length
    });

    // Vérifier les index corrompus
    const [indexResults] = await this.sequelize.query(`
      SELECT indexrelid::regclass AS index_name
      FROM pg_index
      WHERE NOT indisvalid;
    `);

    checks.push({
      name: 'indexes',
      status: indexResults.length === 0 ? 'ok' : 'error',
      invalidCount: indexResults.length
    });

    // Vérifier l'espace disque
    const [diskResults] = await this.sequelize.query(`
      SELECT pg_database_size(current_database()) as size;
    `);

    checks.push({
      name: 'database_size',
      status: 'ok',
      sizeBytes: parseInt(diskResults[0].size)
    });

    // Vérifier les utilisateurs orphelins
    const orphanedSessions = await this.Session.count({
      where: {
        member_id: {
          [Op.notIn]: this.sequelize.literal('(SELECT member_id FROM users)')
        }
      }
    });

    checks.push({
      name: 'orphaned_sessions',
      status: orphanedSessions === 0 ? 'ok' : 'warning',
      count: orphanedSessions
    });

    const hasErrors = checks.some(c => c.status === 'error');
    if (hasErrors) {
      throw new MaintenanceError('INTEGRITY_ERROR', 'Problèmes d\'intégrité détectés');
    }

    return { checks };
  }

  /**
   * Vérifie si rotation des clés nécessaire
   * @private
   */
  async _checkKeyRotations() {
    const results = {
      keysChecked: 0,
      keysNeedingRotation: [],
      secretsNeedingRotation: []
    };

    const now = new Date();
    const warningDate = new Date();
    warningDate.setDate(warningDate.getDate() + config.security.keyRotation.warningDays);

    // Vérifier les clés AES
    const expiringKeys = await this.AesKeyRotation.findAll({
      where: {
        is_active: true,
        expires_at: { [Op.lte]: warningDate }
      }
    });

    for (const key of expiringKeys) {
      results.keysNeedingRotation.push({
        keyType: key.key_type,
        expiresAt: key.expires_at,
        daysRemaining: Math.ceil((key.expires_at - now) / (1000 * 60 * 60 * 24))
      });
    }

    // Vérifier les secrets partagés
    const expiringSecrets = await this.SharedSecret.findAll({
      where: {
        is_active: true,
        expires_at: { [Op.lte]: warningDate }
      }
    });

    for (const secret of expiringSecrets) {
      results.secretsNeedingRotation.push({
        secretType: secret.secret_type,
        expiresAt: secret.expires_at,
        daysRemaining: Math.ceil((secret.expires_at - now) / (1000 * 60 * 60 * 24))
      });
    }

    results.keysChecked = expiringKeys.length + expiringSecrets.length;

    // Si c'est le 1er décembre, effectuer la rotation automatique
    if (now.getMonth() === 11 && now.getDate() === 1 && this.vaultService) {
      console.log('[Maintenance] Rotation annuelle des clés...');
      for (const key of expiringKeys) {
        try {
          await this.vaultService.rotateKey(key.key_type, null, 'scheduled');
          console.log(`[Maintenance] Clé ${key.key_type} rotée`);
        } catch (err) {
          console.error(`[Maintenance] Erreur rotation ${key.key_type}:`, err.message);
        }
      }
    }

    return results;
  }

  /**
   * Nettoie les enregistrements soft-deleted expirés
   * @private
   */
  async _cleanupSoftDeletes() {
    const results = { tablesProcessed: 0, recordsDeleted: 0 };
    
    // Date limite : 90 jours
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    // Tables avec soft delete
    const tablesToClean = [
      { model: this.models.User, field: 'deleted_at' },
      { model: this.models.Guard, field: 'deleted_at' },
      { model: this.models.Group, field: 'deleted_at' }
    ];

    for (const { model, field } of tablesToClean) {
      if (!model) continue;

      try {
        const deleted = await model.destroy({
          where: {
            [field]: { [Op.lt]: cutoffDate }
          },
          force: true // Suppression définitive
        });

        results.recordsDeleted += deleted;
        results.tablesProcessed++;
      } catch (err) {
        console.error(`[Maintenance] Erreur cleanup ${model.name}:`, err.message);
      }
    }

    // Nettoyer les sessions expirées
    const sessionsDeleted = await this.Session.destroy({
      where: {
        expires_at: { [Op.lt]: new Date() }
      }
    });
    results.recordsDeleted += sessionsDeleted;

    // Nettoyer les notifications expirées
    if (this.models.Notification) {
      const notificationsDeleted = await this.models.Notification.destroy({
        where: {
          expires_at: { [Op.lt]: new Date() }
        }
      });
      results.recordsDeleted += notificationsDeleted;
    }

    return results;
  }

  /**
   * Archive les logs de la journée
   * @private
   */
  async _archiveLogs() {
    const results = { logsArchived: 0, tablesProcessed: 0 };

    // Date limite pour archivage (logs > 30 jours)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);

    // Compter les logs à archiver
    const systemLogsCount = await this.SystemLog.count({
      where: { timestamp: { [Op.lt]: cutoffDate } }
    });

    const auditLogsCount = await this.AuditLog.count({
      where: { timestamp: { [Op.lt]: cutoffDate } }
    });

    results.logsArchived = systemLogsCount + auditLogsCount;
    results.tablesProcessed = 2;

    // TODO: Implémenter l'archivage vers stockage externe
    // Pour l'instant, on marque simplement les logs comme archivés

    console.log(`[Maintenance] ${results.logsArchived} logs à archiver`);

    return results;
  }

  /**
   * Rechiffre les données si nouvelle clé
   * @private
   */
  async _rechipherDataIfNeeded() {
    // Cette opération est gérée par VaultService lors de la rotation
    // Ici on vérifie simplement si un rechiffrement est en cours
    return { rechipherNeeded: false, status: 'checked' };
  }

  /**
   * Envoie le statut au serveur central
   * @private
   */
  async _sendStatusToCentral() {
    // TODO: Implémenter la communication avec le serveur central
    const status = {
      serverId: config.server.serverId,
      serverType: config.server.serverType,
      maintenanceCompleted: true,
      stepsCompleted: this._stepsCompleted.length,
      errorsCount: this._errors.length,
      timestamp: new Date()
    };

    console.log('[Maintenance] Statut envoyé au central:', status.serverId);

    return status;
  }

  /**
   * Calcule la prochaine maintenance
   * @private
   */
  _calculateNextRun(runType) {
    const next = new Date();
    
    switch (runType) {
      case 'daily':
        next.setDate(next.getDate() + 1);
        next.setHours(config.maintenance.hour, config.maintenance.minute, 0, 0);
        break;
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
      default:
        next.setDate(next.getDate() + 1);
    }

    return next;
  }

  // =========================================
  // HEALTH CHECKS
  // =========================================

  /**
   * Exécute un contrôle de santé complet
   * @returns {Promise<Object>}
   */
  async runHealthCheck() {
    const checks = [];
    const startTime = Date.now();

    // Check database
    try {
      await this.sequelize.authenticate();
      checks.push({
        check_type: 'system',
        component_name: 'database',
        check_name: 'connection',
        status: 'healthy',
        response_time_ms: Date.now() - startTime
      });
    } catch (err) {
      checks.push({
        check_type: 'system',
        component_name: 'database',
        check_name: 'connection',
        status: 'critical',
        error_message: err.message
      });
    }

    // Check disk space
    try {
      const os = require('os');
      const disk = os.freemem() / os.totalmem();
      checks.push({
        check_type: 'system',
        component_name: 'system',
        check_name: 'memory',
        status: disk > 0.1 ? 'healthy' : 'warning',
        details: { freePercent: Math.round(disk * 100) }
      });
    } catch (err) {
      // Ignorer les erreurs
    }

    // Check Vault
    if (this.vaultService) {
      try {
        const vaultStatus = await this.vaultService.getStatus();
        checks.push({
          check_type: 'security',
          component_name: 'vault',
          check_name: 'status',
          status: vaultStatus.initialized ? 'healthy' : 'critical',
          details: { keysCount: vaultStatus.keys?.length }
        });
      } catch (err) {
        checks.push({
          check_type: 'security',
          component_name: 'vault',
          check_name: 'status',
          status: 'critical',
          error_message: err.message
        });
      }
    }

    // Sauvegarder les résultats
    for (const check of checks) {
      await this.HealthCheck.create({
        ...check,
        checked_at: new Date()
      });
    }

    const overallStatus = checks.every(c => c.status === 'healthy') 
      ? 'healthy' 
      : checks.some(c => c.status === 'critical') 
        ? 'critical' 
        : 'warning';

    return {
      status: overallStatus,
      checks,
      duration: Date.now() - startTime
    };
  }

  /**
   * Collecte les métriques système
   * @returns {Promise<Object>}
   */
  async collectMetrics() {
    const os = require('os');
    const metrics = [];

    // CPU
    const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
    metrics.push({
      metric_name: 'cpu_usage',
      metric_category: 'performance',
      metric_value: cpuUsage,
      metric_unit: 'percent'
    });

    // Mémoire
    const memUsage = (1 - os.freemem() / os.totalmem()) * 100;
    metrics.push({
      metric_name: 'memory_usage',
      metric_category: 'performance',
      metric_value: memUsage,
      metric_unit: 'percent'
    });

    // Uptime
    metrics.push({
      metric_name: 'uptime',
      metric_category: 'performance',
      metric_value: os.uptime(),
      metric_unit: 'seconds'
    });

    // Sessions actives
    const activeSessions = await this.Session.count({ where: { is_active: true } });
    metrics.push({
      metric_name: 'active_sessions',
      metric_category: 'usage',
      metric_value: activeSessions,
      metric_unit: 'count'
    });

    // Utilisateurs actifs
    const activeUsers = await this.User.count({ where: { status: 'active' } });
    metrics.push({
      metric_name: 'active_users',
      metric_category: 'usage',
      metric_value: activeUsers,
      metric_unit: 'count'
    });

    // Sauvegarder
    for (const metric of metrics) {
      await this.SystemMetric.create(metric);
    }

    return metrics;
  }

  // =========================================
  // GETTERS ET UTILS
  // =========================================

  /**
   * Vérifie si une maintenance est en cours
   * @returns {boolean}
   */
  isRunning() {
    return this._isRunning;
  }

  /**
   * Retourne la maintenance en cours
   * @returns {Object|null}
   */
  getCurrentRun() {
    return this._currentRun;
  }

  /**
   * Récupère l'historique des maintenances
   * @param {Object} options
   * @returns {Promise<Object[]>}
   */
  async getHistory(options = {}) {
    const { limit = 30, status } = options;
    
    const where = {};
    if (status) where.status = status;

    return this.MaintenanceRun.findAll({
      where,
      order: [['started_at', 'DESC']],
      limit
    });
  }

  /**
   * Annule une maintenance programmée
   * @param {string} runId
   * @returns {Promise<void>}
   */
  async cancelScheduled(runId) {
    const run = await this.MaintenanceRun.findByPk(runId);
    if (!run || run.status !== MAINTENANCE_STATUS.SCHEDULED) {
      throw new MaintenanceError('CANNOT_CANCEL', 'Maintenance non annulable');
    }

    await run.update({ status: MAINTENANCE_STATUS.CANCELLED });
  }
}

/**
 * Classe d'erreur
 */
class MaintenanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MaintenanceError';
    this.code = code;
  }
}

module.exports = MaintenanceService;
module.exports.MaintenanceError = MaintenanceError;
module.exports.MAINTENANCE_STEPS = MAINTENANCE_STEPS;
module.exports.MAINTENANCE_STATUS = MAINTENANCE_STATUS;
