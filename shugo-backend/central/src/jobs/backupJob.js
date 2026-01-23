// jobs/backupJob.js
// Job CRON pour les sauvegardes automatiques du système

const cron = require('node-cron');
const BackupService = require('../services/BackupService');
const NotificationService = require('../services/NotificationService');
const { AuditLog, BackupSchedule } = require('../models');
const config = require('../config');

class BackupJob {
  constructor() {
    this.jobName = 'BackupJob';
    this.schedules = {
      daily: config.jobs?.backup?.daily || '0 2 * * *',      // 2h00 tous les jours
      weekly: config.jobs?.backup?.weekly || '0 3 * * 0',    // 3h00 dimanche
      monthly: config.jobs?.backup?.monthly || '0 4 1 * *'   // 4h00 le 1er du mois
    };
    this.enabled = config.jobs?.backup?.enabled !== false;
    this.tasks = {};
    this.isRunning = {};
    this.stats = {
      daily: { runs: 0, successes: 0, failures: 0 },
      weekly: { runs: 0, successes: 0, failures: 0 },
      monthly: { runs: 0, successes: 0, failures: 0 }
    };
  }

  /**
   * Démarrer tous les jobs de sauvegarde
   */
  async start() {
    if (!this.enabled) {
      console.log(`[${this.jobName}] Jobs de sauvegarde désactivés`);
      return;
    }

    // Démarrer les différents schedules
    await this.startDailyBackup();
    await this.startWeeklyBackup();
    await this.startMonthlyBackup();

    console.log(`[${this.jobName}] Jobs de sauvegarde démarrés`);
  }

  /**
   * Arrêter tous les jobs
   */
  async stop() {
    for (const [type, task] of Object.entries(this.tasks)) {
      if (task) {
        task.stop();
        console.log(`[${this.jobName}] Job ${type} arrêté`);
      }
    }
    this.tasks = {};
  }

  /**
   * Démarrer la sauvegarde quotidienne
   */
  async startDailyBackup() {
    if (!config.jobs?.backup?.daily?.enabled !== false) {
      return;
    }

    this.tasks.daily = cron.schedule(this.schedules.daily, async () => {
      await this.executeBackup('daily', {
        backup_type: 'incremental',
        components: ['database', 'vault', 'logs'],
        retention_days: 7,
        storage_locations: ['local'],
        compression_enabled: true,
        encryption_enabled: true
      });
    }, {
      scheduled: true,
      timezone: config.timezone || 'Europe/Paris'
    });

    console.log(`[${this.jobName}] Sauvegarde quotidienne programmée: ${this.schedules.daily}`);
  }

  /**
   * Démarrer la sauvegarde hebdomadaire
   */
  async startWeeklyBackup() {
    if (!config.jobs?.backup?.weekly?.enabled !== false) {
      return;
    }

    this.tasks.weekly = cron.schedule(this.schedules.weekly, async () => {
      await this.executeBackup('weekly', {
        backup_type: 'full',
        components: ['database', 'vault', 'files', 'logs', 'configs'],
        retention_days: 30,
        storage_locations: ['local', 's3'],
        compression_enabled: true,
        encryption_enabled: true
      });
    }, {
      scheduled: true,
      timezone: config.timezone || 'Europe/Paris'
    });

    console.log(`[${this.jobName}] Sauvegarde hebdomadaire programmée: ${this.schedules.weekly}`);
  }

  /**
   * Démarrer la sauvegarde mensuelle
   */
  async startMonthlyBackup() {
    if (!config.jobs?.backup?.monthly?.enabled !== false) {
      return;
    }

    this.tasks.monthly = cron.schedule(this.schedules.monthly, async () => {
      await this.executeBackup('monthly', {
        backup_type: 'full',
        components: ['database', 'vault', 'files', 'logs', 'configs'],
        retention_days: 365,
        storage_locations: ['local', 's3', 'offsite'],
        compression_enabled: true,
        encryption_enabled: true
      });
    }, {
      scheduled: true,
      timezone: config.timezone || 'Europe/Paris'
    });

    console.log(`[${this.jobName}] Sauvegarde mensuelle programmée: ${this.schedules.monthly}`);
  }

  /**
   * Exécuter une sauvegarde
   */
  async executeBackup(type, options) {
    if (this.isRunning[type]) {
      console.log(`[${this.jobName}] Sauvegarde ${type} déjà en cours`);
      return;
    }

    const startTime = Date.now();
    this.isRunning[type] = true;
    this.stats[type].runs++;

    console.log(`[${this.jobName}] Début sauvegarde ${type} #${this.stats[type].runs}`);

    try {
      // Créer la sauvegarde
      const result = await BackupService.createBackup({
        ...options,
        description: `Sauvegarde ${type} automatique`,
        initiated_by: 'SYSTEM_CRON'
      });

      // Attendre la fin de la sauvegarde
      const job = await this.waitForBackupCompletion(result.job_id);

      if (job.status === 'completed') {
        this.stats[type].successes++;
        
        // Nettoyer les anciennes sauvegardes
        await this.cleanupOldBackups(type);

        // Vérifier l'intégrité
        await BackupService.verifyBackup({ job_id: result.job_id });

        console.log(`[${this.jobName}] Sauvegarde ${type} terminée avec succès`);
        console.log(`  - Backup ID: ${result.backup_id}`);
        console.log(`  - Taille: ${this.formatBytes(job.file_size)}`);
        console.log(`  - Durée: ${Date.now() - startTime}ms`);

        // Log audit succès
        await this.logAudit(`backup.${type}.success`, 'info', {
          backup_id: result.backup_id,
          size: job.file_size,
          duration_ms: Date.now() - startTime
        });

      } else {
        throw new Error(`Backup failed with status: ${job.status}`);
      }

    } catch (error) {
      this.stats[type].failures++;
      
      console.error(`[${this.jobName}] Erreur sauvegarde ${type}:`, error);

      // Log audit erreur
      await this.logAudit(`backup.${type}.failed`, 'error', {
        error: error.message
      });

      // Notifier les admins
      await this.notifyBackupError(type, error);

    } finally {
      this.isRunning[type] = false;
    }
  }

  /**
   * Attendre la fin d'une sauvegarde
   */
  async waitForBackupCompletion(jobId, maxWaitTime = 3600000) { // 1 heure max
    const startTime = Date.now();
    const checkInterval = 10000; // Vérifier toutes les 10 secondes

    while (Date.now() - startTime < maxWaitTime) {
      const job = await BackupService.getBackupJob({ job_id: jobId });
      
      if (job.status === 'completed' || job.status === 'failed') {
        return job;
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    throw new Error('Backup timeout');
  }

  /**
   * Nettoyer les anciennes sauvegardes
   */
  async cleanupOldBackups(type) {
    try {
      const retentionDays = {
        daily: 7,
        weekly: 30,
        monthly: 365
      };

      const result = await BackupService.cleanupOldBackups({
        older_than_days: retentionDays[type],
        keep_minimum: 3,
        dry_run: false,
        initiated_by: 'SYSTEM_CRON'
      });

      if (result.deleted > 0) {
        console.log(`[${this.jobName}] ${result.deleted} anciennes sauvegardes ${type} supprimées`);
        console.log(`  - Espace libéré: ${this.formatBytes(result.space_freed)}`);
      }

    } catch (error) {
      console.error(`[${this.jobName}] Erreur nettoyage ${type}:`, error);
    }
  }

  /**
   * Notifier une erreur de sauvegarde
   */
  async notifyBackupError(type, error) {
    try {
      await NotificationService.broadcastToAdmins({
        type: 'backup.error',
        title: `Échec sauvegarde ${type}`,
        message: `La sauvegarde ${type} a échoué: ${error.message}`,
        priority: 'critical',
        data: {
          backup_type: type,
          error: error.message,
          timestamp: new Date()
        }
      });
    } catch (notifyError) {
      console.error(`[${this.jobName}] Erreur notification:`, notifyError);
    }
  }

  /**
   * Logger dans l'audit trail
   */
  async logAudit(action, severity, details) {
    try {
      await AuditLog.create({
        action_type: action,
        entity_type: 'job',
        entity_id: this.jobName,
        severity,
        details: {
          job_name: this.jobName,
          ...details
        }
      });
    } catch (error) {
      console.error(`[${this.jobName}] Erreur audit log:`, error);
    }
  }

  /**
   * Formater les bytes
   */
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  /**
   * Obtenir le statut
   */
  getStatus() {
    return {
      name: this.jobName,
      enabled: this.enabled,
      schedules: this.schedules,
      running: this.isRunning,
      stats: this.stats
    };
  }

  /**
   * Déclencher une sauvegarde manuelle
   */
  async runManual(type = 'daily') {
    console.log(`[${this.jobName}] Sauvegarde manuelle ${type} déclenchée`);
    
    const options = {
      daily: {
        backup_type: 'incremental',
        components: ['database', 'vault'],
        retention_days: 7
      },
      weekly: {
        backup_type: 'full',
        components: ['database', 'vault', 'files', 'logs', 'configs'],
        retention_days: 30
      },
      monthly: {
        backup_type: 'full',
        components: ['database', 'vault', 'files', 'logs', 'configs'],
        retention_days: 365
      },
      full: {
        backup_type: 'full',
        components: ['database', 'vault', 'files', 'logs', 'configs'],
        retention_days: 90
      }
    };

    await this.executeBackup(type, {
      ...options[type] || options.full,
      storage_locations: ['local'],
      compression_enabled: true,
      encryption_enabled: true
    });
  }
}

module.exports = new BackupJob();
