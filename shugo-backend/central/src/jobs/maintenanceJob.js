// jobs/maintenanceJob.js
// Job CRON pour les tâches de maintenance nocturne

const cron = require('node-cron');
const { Op } = require('sequelize');
const {
  Session,
  AuditLog,
  EmailQueue,
  Notification,
  TempFile,
  GuardSchedule,
  WaitingList,
  User
} = require('../models');
const NotificationService = require('../services/NotificationService');
const config = require('../config');

class MaintenanceJob {
  constructor() {
    this.jobName = 'MaintenanceJob';
    this.schedule = config.jobs?.maintenance?.schedule || '0 3 * * *'; // 3h00 tous les jours
    this.enabled = config.jobs?.maintenance?.enabled !== false;
    this.task = null;
    this.isRunning = false;
    this.tasks = [
      'cleanExpiredSessions',
      'cleanOldLogs',
      'cleanTempFiles',
      'cleanEmailQueue',
      'cleanNotifications',
      'updateGuardStatuses',
      'cleanInactiveWaitingList',
      'optimizeDatabase',
      'updateStatistics'
    ];
    this.stats = {
      totalRuns: 0,
      lastRun: null,
      tasksCompleted: {}
    };
  }

  /**
   * Démarrer le job
   */
  async start() {
    if (!this.enabled) {
      console.log(`[${this.jobName}] Job désactivé`);
      return;
    }

    if (this.task) {
      console.log(`[${this.jobName}] Job déjà démarré`);
      return;
    }

    this.task = cron.schedule(this.schedule, async () => {
      await this.execute();
    }, {
      scheduled: true,
      timezone: config.timezone || 'Europe/Paris'
    });

    console.log(`[${this.jobName}] Job démarré: ${this.schedule}`);
  }

  /**
   * Arrêter le job
   */
  async stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log(`[${this.jobName}] Job arrêté`);
    }
  }

  /**
   * Exécuter la maintenance
   */
  async execute() {
    if (this.isRunning) {
      console.log(`[${this.jobName}] Maintenance déjà en cours`);
      return;
    }

    const startTime = Date.now();
    this.isRunning = true;
    this.stats.totalRuns++;

    console.log(`[${this.jobName}] Début maintenance #${this.stats.totalRuns}`);

    const results = {
      tasks: {},
      errors: [],
      duration: 0
    };

    // Exécuter chaque tâche
    for (const taskName of this.tasks) {
      try {
        console.log(`[${this.jobName}] Exécution: ${taskName}`);
        const taskResult = await this[taskName]();
        results.tasks[taskName] = {
          success: true,
          ...taskResult
        };
      } catch (error) {
        console.error(`[${this.jobName}] Erreur ${taskName}:`, error);
        results.tasks[taskName] = {
          success: false,
          error: error.message
        };
        results.errors.push({
          task: taskName,
          error: error.message
        });
      }
    }

    results.duration = Date.now() - startTime;
    this.stats.lastRun = {
      timestamp: new Date(),
      results
    };

    console.log(`[${this.jobName}] Maintenance terminée en ${results.duration}ms`);
    console.log(`  - Tâches réussies: ${Object.values(results.tasks).filter(t => t.success).length}/${this.tasks.length}`);
    console.log(`  - Erreurs: ${results.errors.length}`);

    // Log audit
    await this.logAudit('maintenance.completed', 'info', results);

    // Notifier si erreurs
    if (results.errors.length > 0) {
      await this.notifyErrors(results.errors);
    }

    this.isRunning = false;
  }

  /**
   * Nettoyer les sessions expirées
   */
  async cleanExpiredSessions() {
    const cutoff = new Date(Date.now() - config.session.maxAge || 86400000); // 24h par défaut
    
    const deleted = await Session.destroy({
      where: {
        [Op.or]: [
          { expires_at: { [Op.lt]: new Date() } },
          { last_activity: { [Op.lt]: cutoff } },
          { is_active: false }
        ]
      }
    });

    console.log(`[${this.jobName}] ${deleted} sessions expirées supprimées`);
    return { deleted };
  }

  /**
   * Nettoyer les anciens logs
   */
  async cleanOldLogs() {
    const retentionDays = config.maintenance?.logRetentionDays || 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    // Archiver les logs critiques
    const criticalLogs = await AuditLog.findAll({
      where: {
        severity: 'critical',
        timestamp: { [Op.lt]: cutoff }
      }
    });

    if (criticalLogs.length > 0) {
      // Archiver dans un fichier
      const fs = require('fs').promises;
      const path = require('path');
      const archivePath = path.join(
        config.logs.archivePath || '/var/log/shugo/archives',
        `critical_logs_${cutoff.toISOString().split('T')[0]}.json`
      );
      
      await fs.mkdir(path.dirname(archivePath), { recursive: true });
      await fs.writeFile(archivePath, JSON.stringify(criticalLogs, null, 2));
    }

    // Supprimer les logs non critiques
    const deleted = await AuditLog.destroy({
      where: {
        timestamp: { [Op.lt]: cutoff },
        severity: { [Op.ne]: 'critical' }
      }
    });

    console.log(`[${this.jobName}] ${deleted} anciens logs supprimés`);
    return { deleted, archived: criticalLogs.length };
  }

  /**
   * Nettoyer les fichiers temporaires
   */
  async cleanTempFiles() {
    const fs = require('fs').promises;
    const path = require('path');
    const tempDir = config.storage?.tempPath || '/tmp/shugo';
    
    let deleted = 0;
    let freedSpace = 0;

    try {
      // Nettoyer les entrées DB
      const dbDeleted = await TempFile.destroy({
        where: {
          created_at: {
            [Op.lt]: new Date(Date.now() - 3600000) // 1 heure
          }
        }
      });

      // Nettoyer le système de fichiers
      const files = await fs.readdir(tempDir);
      
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        const stats = await fs.stat(filePath);
        
        // Supprimer les fichiers de plus d'1 heure
        if (Date.now() - stats.mtimeMs > 3600000) {
          freedSpace += stats.size;
          await fs.unlink(filePath);
          deleted++;
        }
      }
    } catch (error) {
      console.warn(`[${this.jobName}] Erreur nettoyage temp:`, error);
    }

    console.log(`[${this.jobName}] ${deleted} fichiers temporaires supprimés (${this.formatBytes(freedSpace)})`);
    return { deleted, freedSpace };
  }

  /**
   * Nettoyer la queue d'emails
   */
  async cleanEmailQueue() {
    const EmailService = require('../services/EmailService');
    
    const deleted = await EmailService.cleanQueue(30); // 30 jours
    
    console.log(`[${this.jobName}] ${deleted} emails traités supprimés`);
    return { deleted };
  }

  /**
   * Nettoyer les anciennes notifications
   */
  async cleanNotifications() {
    const deleted = await NotificationService.cleanOldNotifications(90); // 90 jours
    
    console.log(`[${this.jobName}] ${deleted} notifications supprimées`);
    return { deleted };
  }

  /**
   * Mettre à jour les statuts des gardes
   */
  async updateGuardStatuses() {
    const now = new Date();
    let updated = 0;

    // Marquer les gardes passées comme terminées
    const completed = await GuardSchedule.update(
      { status: 'completed' },
      {
        where: {
          date: { [Op.lt]: now },
          status: { [Op.in]: ['scheduled', 'in_progress'] }
        }
      }
    );
    updated += completed[0];

    // Marquer les gardes en cours
    const inProgress = await GuardSchedule.update(
      { status: 'in_progress' },
      {
        where: {
          date: now,
          status: 'scheduled'
        }
      }
    );
    updated += inProgress[0];

    // Annuler les gardes sous-effectif à J-1
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const underStaffed = await GuardSchedule.findAll({
      where: {
        date: tomorrow,
        status: 'scheduled',
        current_participants: {
          [Op.lt]: GuardSchedule.sequelize.col('min_participants')
        }
      }
    });

    for (const guard of underStaffed) {
      await guard.update({ status: 'cancelled_understaffed' });
      
      // Notifier les participants
      await this.notifyGuardCancellation(guard);
      updated++;
    }

    console.log(`[${this.jobName}] ${updated} statuts de garde mis à jour`);
    return { updated };
  }

  /**
   * Nettoyer les entrées inactives de liste d'attente
   */
  async cleanInactiveWaitingList() {
    // Désactiver les entrées des utilisateurs inactifs
    const deactivated = await WaitingList.update(
      { is_active: false },
      {
        where: {
          is_active: true,
          '$member.is_active$': false
        },
        include: [{
          model: User,
          as: 'member',
          attributes: []
        }]
      }
    );

    // Supprimer les très anciennes entrées activées
    const deleted = await WaitingList.destroy({
      where: {
        status: 'activated',
        activated_at: {
          [Op.lt]: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) // 90 jours
        }
      }
    });

    console.log(`[${this.jobName}] Liste d'attente: ${deactivated[0]} désactivées, ${deleted} supprimées`);
    return { deactivated: deactivated[0], deleted };
  }

  /**
   * Optimiser la base de données
   */
  async optimizeDatabase() {
    const sequelize = require('../models').sequelize;
    const results = {};

    try {
      // PostgreSQL VACUUM ANALYZE
      if (config.database.dialect === 'postgres') {
        await sequelize.query('VACUUM ANALYZE');
        results.vacuum = true;
      }

      // MySQL OPTIMIZE TABLE
      if (config.database.dialect === 'mysql') {
        const tables = await sequelize.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()",
          { type: sequelize.QueryTypes.SELECT }
        );

        for (const table of tables) {
          await sequelize.query(`OPTIMIZE TABLE ${table.table_name}`);
        }
        results.optimized = tables.length;
      }

      // Reindexer si nécessaire
      if (config.maintenance?.reindex) {
        await sequelize.query('REINDEX DATABASE ' + config.database.database);
        results.reindexed = true;
      }

    } catch (error) {
      console.error(`[${this.jobName}] Erreur optimisation DB:`, error);
      results.error = error.message;
    }

    console.log(`[${this.jobName}] Base de données optimisée`);
    return results;
  }

  /**
   * Mettre à jour les statistiques
   */
  async updateStatistics() {
    const StatsService = require('../services/StatsService');
    
    try {
      // Calculer les stats du jour
      await StatsService.calculateDailyStats();
      
      // Mettre à jour les agrégats
      await StatsService.updateAggregates();
      
      console.log(`[${this.jobName}] Statistiques mises à jour`);
      return { success: true };
      
    } catch (error) {
      console.error(`[${this.jobName}] Erreur stats:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Notifier l'annulation d'une garde
   */
  async notifyGuardCancellation(guard) {
    try {
      const assignments = await guard.getAssignments({
        where: { status: { [Op.in]: ['confirmed', 'pending_confirmation'] } },
        include: ['member']
      });

      for (const assignment of assignments) {
        await NotificationService.send({
          user_id: assignment.member_id,
          type: 'guard.cancelled',
          title: 'Garde annulée',
          message: `La garde du ${guard.date.toLocaleDateString('fr-FR')} a été annulée (effectif insuffisant)`,
          priority: 'high',
          data: {
            guard_id: guard.guard_id,
            date: guard.date,
            reason: 'understaffed'
          }
        });
      }
    } catch (error) {
      console.error(`[${this.jobName}] Erreur notification annulation:`, error);
    }
  }

  /**
   * Notifier les erreurs
   */
  async notifyErrors(errors) {
    try {
      await NotificationService.broadcastToAdmins({
        type: 'maintenance.errors',
        title: 'Erreurs durant la maintenance',
        message: `${errors.length} erreurs durant la maintenance nocturne`,
        priority: 'warning',
        data: {
          errors,
          timestamp: new Date()
        }
      });
    } catch (error) {
      console.error(`[${this.jobName}] Erreur notification:`, error);
    }
  }

  /**
   * Logger dans l'audit
   */
  async logAudit(action, severity, details) {
    try {
      await AuditLog.create({
        action_type: action,
        entity_type: 'job',
        entity_id: this.jobName,
        severity,
        details
      });
    } catch (error) {
      console.error(`[${this.jobName}] Erreur audit:`, error);
    }
  }

  /**
   * Formater les bytes
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Obtenir le statut
   */
  getStatus() {
    return {
      name: this.jobName,
      enabled: this.enabled,
      schedule: this.schedule,
      running: this.isRunning,
      stats: this.stats
    };
  }

  /**
   * Exécution manuelle
   */
  async runManual() {
    console.log(`[${this.jobName}] Maintenance manuelle déclenchée`);
    await this.execute();
  }
}

module.exports = new MaintenanceJob();
