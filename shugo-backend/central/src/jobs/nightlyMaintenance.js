'use strict';

/**
 * SHUGO v7.0 - Nightly Maintenance Job
 *
 * Tâche de maintenance nocturne exécutée à 00h00 (heure locale du serveur).
 * Effectue le nettoyage, l'optimisation et la vérification de l'intégrité.
 *
 * @see Document Technique V7.0 - Chapitre 9
 */

const { Op } = require('sequelize');
const {
  Session,
  AuditLog,
  SystemLog,
  Notification,
  HealthCheck,
  SystemMetric,
  MaintenanceRun
} = require('../models');
const logger = require('../utils/logger');

/**
 * Configuration de la maintenance
 */
const MAINTENANCE_CONFIG = {
  // Rétention des données (en jours)
  retention: {
    sessions_expired: 7,        // Sessions expirées
    audit_logs: 365,            // Logs d'audit (1 an)
    system_logs: 90,            // Logs système (3 mois)
    notifications_read: 30,     // Notifications lues
    health_checks: 30,          // Checks de santé
    system_metrics: 90          // Métriques système
  },
  // Seuils d'alerte
  thresholds: {
    disk_usage_warning: 80,     // % utilisation disque
    disk_usage_critical: 95,
    memory_usage_warning: 85,
    db_size_warning_gb: 10
  }
};

/**
 * Classe principale du job de maintenance nocturne
 */
class NightlyMaintenanceJob {
  constructor() {
    this.startTime = null;
    this.stats = {
      sessions_cleaned: 0,
      audit_logs_archived: 0,
      system_logs_cleaned: 0,
      notifications_cleaned: 0,
      health_checks_cleaned: 0,
      metrics_cleaned: 0,
      errors: []
    };
  }

  /**
   * Exécute la maintenance nocturne complète
   */
  async execute() {
    this.startTime = new Date();
    logger.info('[NightlyMaintenance] Démarrage de la maintenance nocturne');

    let maintenanceRun;

    try {
      // Créer l'enregistrement de maintenance
      maintenanceRun = await MaintenanceRun.create({
        type: 'nightly',
        status: 'running',
        started_at: this.startTime,
        details: { config: MAINTENANCE_CONFIG }
      });

      // 1. Nettoyage des sessions expirées
      await this.cleanExpiredSessions();

      // 2. Archivage des logs d'audit anciens
      await this.archiveAuditLogs();

      // 3. Nettoyage des logs système
      await this.cleanSystemLogs();

      // 4. Nettoyage des notifications lues
      await this.cleanReadNotifications();

      // 5. Nettoyage des health checks anciens
      await this.cleanHealthChecks();

      // 6. Nettoyage des métriques anciennes
      await this.cleanOldMetrics();

      // 7. Optimisation de la base de données
      await this.optimizeDatabase();

      // 8. Vérification de l'intégrité
      await this.checkIntegrity();

      // 9. Vérification de l'espace disque
      await this.checkDiskSpace();

      // Finaliser le run
      const endTime = new Date();
      await maintenanceRun.update({
        status: 'completed',
        completed_at: endTime,
        duration_seconds: Math.round((endTime - this.startTime) / 1000),
        details: {
          config: MAINTENANCE_CONFIG,
          stats: this.stats
        }
      });

      logger.info('[NightlyMaintenance] Maintenance terminée avec succès', this.stats);

      return {
        success: true,
        run_id: maintenanceRun.run_id,
        duration_seconds: Math.round((endTime - this.startTime) / 1000),
        stats: this.stats
      };

    } catch (error) {
      logger.error('[NightlyMaintenance] Erreur critique:', error);

      if (maintenanceRun) {
        await maintenanceRun.update({
          status: 'failed',
          completed_at: new Date(),
          error_message: error.message,
          details: {
            config: MAINTENANCE_CONFIG,
            stats: this.stats,
            error: error.stack
          }
        });
      }

      throw error;
    }
  }

  /**
   * Nettoie les sessions expirées
   */
  async cleanExpiredSessions() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - MAINTENANCE_CONFIG.retention.sessions_expired);

      const result = await Session.destroy({
        where: {
          [Op.or]: [
            { expires_at: { [Op.lt]: cutoffDate } },
            { is_valid: false, updated_at: { [Op.lt]: cutoffDate } }
          ]
        }
      });

      this.stats.sessions_cleaned = result;
      logger.info(`[NightlyMaintenance] Sessions nettoyées: ${result}`);

    } catch (error) {
      this.stats.errors.push({ task: 'cleanExpiredSessions', error: error.message });
      logger.error('[NightlyMaintenance] Erreur nettoyage sessions:', error);
    }
  }

  /**
   * Archive les logs d'audit anciens
   */
  async archiveAuditLogs() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - MAINTENANCE_CONFIG.retention.audit_logs);

      // Compter les logs à archiver
      const count = await AuditLog.count({
        where: {
          created_at: { [Op.lt]: cutoffDate },
          archived: false
        }
      });

      if (count > 0) {
        // Marquer comme archivés (les logs critiques sont conservés)
        await AuditLog.update(
          { archived: true },
          {
            where: {
              created_at: { [Op.lt]: cutoffDate },
              archived: false,
              severity: { [Op.notIn]: ['critical', 'emergency'] }
            }
          }
        );
      }

      this.stats.audit_logs_archived = count;
      logger.info(`[NightlyMaintenance] Logs d'audit archivés: ${count}`);

    } catch (error) {
      this.stats.errors.push({ task: 'archiveAuditLogs', error: error.message });
      logger.error('[NightlyMaintenance] Erreur archivage audit logs:', error);
    }
  }

  /**
   * Nettoie les logs système anciens
   */
  async cleanSystemLogs() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - MAINTENANCE_CONFIG.retention.system_logs);

      const result = await SystemLog.destroy({
        where: {
          created_at: { [Op.lt]: cutoffDate },
          level: { [Op.notIn]: ['error', 'critical'] } // Garder les erreurs plus longtemps
        }
      });

      this.stats.system_logs_cleaned = result;
      logger.info(`[NightlyMaintenance] Logs système nettoyés: ${result}`);

    } catch (error) {
      this.stats.errors.push({ task: 'cleanSystemLogs', error: error.message });
      logger.error('[NightlyMaintenance] Erreur nettoyage system logs:', error);
    }
  }

  /**
   * Nettoie les notifications lues
   */
  async cleanReadNotifications() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - MAINTENANCE_CONFIG.retention.notifications_read);

      const result = await Notification.destroy({
        where: {
          read_at: { [Op.lt]: cutoffDate },
          priority: { [Op.ne]: 'critical' }
        }
      });

      this.stats.notifications_cleaned = result;
      logger.info(`[NightlyMaintenance] Notifications nettoyées: ${result}`);

    } catch (error) {
      this.stats.errors.push({ task: 'cleanReadNotifications', error: error.message });
      logger.error('[NightlyMaintenance] Erreur nettoyage notifications:', error);
    }
  }

  /**
   * Nettoie les health checks anciens
   */
  async cleanHealthChecks() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - MAINTENANCE_CONFIG.retention.health_checks);

      const result = await HealthCheck.destroy({
        where: {
          created_at: { [Op.lt]: cutoffDate },
          status: 'healthy' // Garder les checks en erreur plus longtemps
        }
      });

      this.stats.health_checks_cleaned = result;
      logger.info(`[NightlyMaintenance] Health checks nettoyés: ${result}`);

    } catch (error) {
      this.stats.errors.push({ task: 'cleanHealthChecks', error: error.message });
      logger.error('[NightlyMaintenance] Erreur nettoyage health checks:', error);
    }
  }

  /**
   * Nettoie les métriques anciennes
   */
  async cleanOldMetrics() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - MAINTENANCE_CONFIG.retention.system_metrics);

      const result = await SystemMetric.destroy({
        where: {
          recorded_at: { [Op.lt]: cutoffDate }
        }
      });

      this.stats.metrics_cleaned = result;
      logger.info(`[NightlyMaintenance] Métriques nettoyées: ${result}`);

    } catch (error) {
      this.stats.errors.push({ task: 'cleanOldMetrics', error: error.message });
      logger.error('[NightlyMaintenance] Erreur nettoyage métriques:', error);
    }
  }

  /**
   * Optimise la base de données
   */
  async optimizeDatabase() {
    try {
      const { sequelize } = require('../models');

      // VACUUM ANALYZE pour PostgreSQL
      if (sequelize.options.dialect === 'postgres') {
        await sequelize.query('VACUUM ANALYZE');
        logger.info('[NightlyMaintenance] VACUUM ANALYZE exécuté');
      }

      // OPTIMIZE pour MySQL
      if (sequelize.options.dialect === 'mysql') {
        const tables = await sequelize.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()",
          { type: sequelize.QueryTypes.SELECT }
        );

        for (const table of tables) {
          await sequelize.query(`OPTIMIZE TABLE ${table.table_name}`);
        }
        logger.info('[NightlyMaintenance] Tables MySQL optimisées');
      }

    } catch (error) {
      this.stats.errors.push({ task: 'optimizeDatabase', error: error.message });
      logger.error('[NightlyMaintenance] Erreur optimisation BDD:', error);
    }
  }

  /**
   * Vérifie l'intégrité des données
   */
  async checkIntegrity() {
    try {
      const issues = [];

      // Vérifier les sessions orphelines
      const { sequelize } = require('../models');
      const [orphanSessions] = await sequelize.query(`
        SELECT COUNT(*) as count FROM sessions s
        LEFT JOIN users u ON s.member_id = u.member_id
        WHERE u.member_id IS NULL
      `);

      if (orphanSessions[0]?.count > 0) {
        issues.push(`${orphanSessions[0].count} sessions orphelines détectées`);
      }

      // Vérifier les guards sans assignations valides
      const [orphanGuards] = await sequelize.query(`
        SELECT COUNT(*) as count FROM guards g
        WHERE g.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM guard_assignments ga
          WHERE ga.guard_id = g.guard_id AND ga.status = 'active'
        )
      `);

      if (orphanGuards[0]?.count > 0) {
        issues.push(`${orphanGuards[0].count} gardes actives sans assignation`);
      }

      if (issues.length > 0) {
        logger.warn('[NightlyMaintenance] Problèmes d\'intégrité détectés:', issues);
        this.stats.integrity_issues = issues;
      } else {
        logger.info('[NightlyMaintenance] Vérification d\'intégrité OK');
      }

    } catch (error) {
      this.stats.errors.push({ task: 'checkIntegrity', error: error.message });
      logger.error('[NightlyMaintenance] Erreur vérification intégrité:', error);
    }
  }

  /**
   * Vérifie l'espace disque
   */
  async checkDiskSpace() {
    try {
      const os = require('os');
      const { execSync } = require('child_process');

      let diskUsage = null;

      if (os.platform() === 'linux' || os.platform() === 'darwin') {
        const output = execSync("df -h / | tail -1 | awk '{print $5}'").toString().trim();
        diskUsage = parseInt(output.replace('%', ''));
      } else if (os.platform() === 'win32') {
        const output = execSync('wmic logicaldisk get size,freespace,caption').toString();
        // Parse Windows output
        const lines = output.trim().split('\n').slice(1);
        if (lines.length > 0) {
          const parts = lines[0].trim().split(/\s+/);
          if (parts.length >= 3) {
            const freeSpace = parseInt(parts[1]);
            const totalSize = parseInt(parts[2]);
            diskUsage = Math.round((1 - freeSpace / totalSize) * 100);
          }
        }
      }

      if (diskUsage !== null) {
        this.stats.disk_usage_percent = diskUsage;

        if (diskUsage >= MAINTENANCE_CONFIG.thresholds.disk_usage_critical) {
          logger.error(`[NightlyMaintenance] CRITIQUE: Espace disque à ${diskUsage}%`);
        } else if (diskUsage >= MAINTENANCE_CONFIG.thresholds.disk_usage_warning) {
          logger.warn(`[NightlyMaintenance] Attention: Espace disque à ${diskUsage}%`);
        } else {
          logger.info(`[NightlyMaintenance] Espace disque: ${diskUsage}%`);
        }
      }

    } catch (error) {
      this.stats.errors.push({ task: 'checkDiskSpace', error: error.message });
      logger.error('[NightlyMaintenance] Erreur vérification espace disque:', error);
    }
  }
}

/**
 * Fonction exportée pour le scheduler
 */
async function run() {
  const job = new NightlyMaintenanceJob();
  return await job.execute();
}

module.exports = { run, NightlyMaintenanceJob, MAINTENANCE_CONFIG };
