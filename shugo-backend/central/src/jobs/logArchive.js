'use strict';

/**
 * SHUGO v7.0 - Log Archive Job
 *
 * Archivage quotidien des logs système et d'audit.
 * Compresse et stocke les logs anciens pour libérer l'espace base de données.
 *
 * @see Document Technique V7.0 - Chapitre 9
 */

const { Op } = require('sequelize');
const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { AuditLog, SystemLog } = require('../models');
const logger = require('../utils/logger');

const gzip = promisify(zlib.gzip);

/**
 * Configuration de l'archivage
 */
const ARCHIVE_CONFIG = {
  // Répertoire d'archivage
  archive_dir: process.env.LOG_ARCHIVE_DIR || './archives/logs',
  // Âge minimum pour archivage (jours)
  min_age_days: 7,
  // Taille de lot pour le traitement
  batch_size: 1000,
  // Conserver les logs critiques en base plus longtemps
  critical_retention_days: 90,
  // Format de date pour les fichiers
  date_format: 'YYYY-MM-DD',
  // Compression activée
  compress: true
};

/**
 * Types de logs à archiver
 */
const LOG_TYPES = {
  AUDIT: 'audit',
  SYSTEM: 'system'
};

/**
 * Classe principale du job d'archivage des logs
 */
class LogArchiveJob {
  constructor() {
    this.stats = {
      audit_logs_archived: 0,
      system_logs_archived: 0,
      files_created: 0,
      bytes_written: 0,
      errors: []
    };
  }

  /**
   * Exécute l'archivage des logs
   */
  async execute() {
    const startTime = new Date();
    logger.info('[LogArchive] Démarrage de l\'archivage des logs');

    try {
      // 1. S'assurer que le répertoire d'archive existe
      await this.ensureArchiveDirectory();

      // 2. Calculer la date limite
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - ARCHIVE_CONFIG.min_age_days);

      // 3. Archiver les logs d'audit
      await this.archiveAuditLogs(cutoffDate);

      // 4. Archiver les logs système
      await this.archiveSystemLogs(cutoffDate);

      // 5. Nettoyer les anciens fichiers d'archive (> 1 an)
      await this.cleanOldArchives();

      // 6. Générer le rapport
      const report = this.generateReport(startTime);

      logger.info('[LogArchive] Archivage terminé', this.stats);

      return {
        success: true,
        duration_ms: Date.now() - startTime.getTime(),
        stats: this.stats,
        report
      };

    } catch (error) {
      logger.error('[LogArchive] Erreur critique:', error);
      throw error;
    }
  }

  /**
   * S'assure que le répertoire d'archive existe
   */
  async ensureArchiveDirectory() {
    try {
      await fs.mkdir(ARCHIVE_CONFIG.archive_dir, { recursive: true });
      await fs.mkdir(path.join(ARCHIVE_CONFIG.archive_dir, 'audit'), { recursive: true });
      await fs.mkdir(path.join(ARCHIVE_CONFIG.archive_dir, 'system'), { recursive: true });
    } catch (error) {
      logger.error('[LogArchive] Erreur création répertoire:', error);
      throw error;
    }
  }

  /**
   * Archive les logs d'audit
   */
  async archiveAuditLogs(cutoffDate) {
    try {
      // Exclure les logs critiques récents
      const criticalCutoff = new Date();
      criticalCutoff.setDate(criticalCutoff.getDate() - ARCHIVE_CONFIG.critical_retention_days);

      const where = {
        created_at: { [Op.lt]: cutoffDate },
        archived: false,
        [Op.or]: [
          { severity: { [Op.notIn]: ['critical', 'emergency'] } },
          {
            severity: { [Op.in]: ['critical', 'emergency'] },
            created_at: { [Op.lt]: criticalCutoff }
          }
        ]
      };

      // Compter le total
      const totalCount = await AuditLog.count({ where });

      if (totalCount === 0) {
        logger.info('[LogArchive] Aucun log d\'audit à archiver');
        return;
      }

      logger.info(`[LogArchive] ${totalCount} logs d'audit à archiver`);

      // Traiter par lots
      let processed = 0;
      let offset = 0;

      while (processed < totalCount) {
        const batch = await AuditLog.findAll({
          where,
          limit: ARCHIVE_CONFIG.batch_size,
          offset,
          order: [['created_at', 'ASC']]
        });

        if (batch.length === 0) break;

        // Grouper par date
        const byDate = this.groupLogsByDate(batch);

        // Écrire chaque groupe dans un fichier
        for (const [dateStr, logs] of Object.entries(byDate)) {
          await this.writeArchiveFile(LOG_TYPES.AUDIT, dateStr, logs);
        }

        // Marquer comme archivés
        const ids = batch.map(l => l.log_id);
        await AuditLog.update(
          { archived: true, archived_at: new Date() },
          { where: { log_id: { [Op.in]: ids } } }
        );

        processed += batch.length;
        offset += ARCHIVE_CONFIG.batch_size;

        logger.info(`[LogArchive] Audit: ${processed}/${totalCount} traités`);
      }

      this.stats.audit_logs_archived = processed;

    } catch (error) {
      this.stats.errors.push({ type: 'audit', error: error.message });
      logger.error('[LogArchive] Erreur archivage audit logs:', error);
    }
  }

  /**
   * Archive les logs système
   */
  async archiveSystemLogs(cutoffDate) {
    try {
      const where = {
        created_at: { [Op.lt]: cutoffDate },
        // Ne pas archiver les erreurs récentes
        [Op.or]: [
          { level: { [Op.notIn]: ['error', 'critical'] } },
          {
            level: { [Op.in]: ['error', 'critical'] },
            created_at: {
              [Op.lt]: new Date(Date.now() - ARCHIVE_CONFIG.critical_retention_days * 24 * 60 * 60 * 1000)
            }
          }
        ]
      };

      const totalCount = await SystemLog.count({ where });

      if (totalCount === 0) {
        logger.info('[LogArchive] Aucun log système à archiver');
        return;
      }

      logger.info(`[LogArchive] ${totalCount} logs système à archiver`);

      let processed = 0;
      let offset = 0;

      while (processed < totalCount) {
        const batch = await SystemLog.findAll({
          where,
          limit: ARCHIVE_CONFIG.batch_size,
          offset,
          order: [['created_at', 'ASC']]
        });

        if (batch.length === 0) break;

        const byDate = this.groupLogsByDate(batch);

        for (const [dateStr, logs] of Object.entries(byDate)) {
          await this.writeArchiveFile(LOG_TYPES.SYSTEM, dateStr, logs);
        }

        // Supprimer les logs archivés (système logs peuvent être supprimés)
        const ids = batch.map(l => l.log_id);
        await SystemLog.destroy({
          where: { log_id: { [Op.in]: ids } }
        });

        processed += batch.length;
        offset = 0; // Reset offset car on supprime les lignes

        logger.info(`[LogArchive] System: ${processed}/${totalCount} traités`);
      }

      this.stats.system_logs_archived = processed;

    } catch (error) {
      this.stats.errors.push({ type: 'system', error: error.message });
      logger.error('[LogArchive] Erreur archivage system logs:', error);
    }
  }

  /**
   * Groupe les logs par date
   */
  groupLogsByDate(logs) {
    const grouped = {};

    for (const log of logs) {
      const dateStr = new Date(log.created_at).toISOString().split('T')[0];
      if (!grouped[dateStr]) {
        grouped[dateStr] = [];
      }
      grouped[dateStr].push(log.toJSON());
    }

    return grouped;
  }

  /**
   * Écrit un fichier d'archive
   */
  async writeArchiveFile(type, dateStr, logs) {
    try {
      const subDir = type === LOG_TYPES.AUDIT ? 'audit' : 'system';
      const filename = `${type}_${dateStr}.json${ARCHIVE_CONFIG.compress ? '.gz' : ''}`;
      const filepath = path.join(ARCHIVE_CONFIG.archive_dir, subDir, filename);

      // Vérifier si le fichier existe déjà
      let existingLogs = [];
      try {
        const existingData = await fs.readFile(filepath);
        const decompressed = ARCHIVE_CONFIG.compress
          ? zlib.gunzipSync(existingData).toString()
          : existingData.toString();
        existingLogs = JSON.parse(decompressed);
      } catch {
        // Fichier n'existe pas encore
      }

      // Fusionner les logs
      const allLogs = [...existingLogs, ...logs];

      // Sérialiser
      const jsonData = JSON.stringify(allLogs, null, 0);

      // Compresser si activé
      let dataToWrite;
      if (ARCHIVE_CONFIG.compress) {
        dataToWrite = await gzip(Buffer.from(jsonData));
      } else {
        dataToWrite = jsonData;
      }

      // Écrire
      await fs.writeFile(filepath, dataToWrite);

      this.stats.files_created++;
      this.stats.bytes_written += dataToWrite.length;

      logger.debug(`[LogArchive] Fichier créé: ${filename} (${logs.length} logs)`);

    } catch (error) {
      this.stats.errors.push({ type, date: dateStr, error: error.message });
      logger.error(`[LogArchive] Erreur écriture fichier ${type}_${dateStr}:`, error);
    }
  }

  /**
   * Nettoie les anciennes archives (> 1 an)
   */
  async cleanOldArchives() {
    try {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      for (const subDir of ['audit', 'system']) {
        const dirPath = path.join(ARCHIVE_CONFIG.archive_dir, subDir);

        try {
          const files = await fs.readdir(dirPath);

          for (const file of files) {
            // Extraire la date du nom de fichier
            const match = file.match(/(\d{4}-\d{2}-\d{2})/);
            if (match) {
              const fileDate = new Date(match[1]);
              if (fileDate < oneYearAgo) {
                await fs.unlink(path.join(dirPath, file));
                logger.info(`[LogArchive] Archive supprimée: ${file}`);
              }
            }
          }
        } catch (error) {
          // Répertoire peut ne pas exister
        }
      }

    } catch (error) {
      this.stats.errors.push({ action: 'cleanOldArchives', error: error.message });
      logger.error('[LogArchive] Erreur nettoyage anciennes archives:', error);
    }
  }

  /**
   * Génère le rapport d'archivage
   */
  generateReport(startTime) {
    return {
      timestamp: new Date(),
      duration_ms: Date.now() - startTime.getTime(),
      summary: {
        audit_logs_archived: this.stats.audit_logs_archived,
        system_logs_archived: this.stats.system_logs_archived,
        total_archived: this.stats.audit_logs_archived + this.stats.system_logs_archived,
        files_created: this.stats.files_created,
        bytes_written: this.stats.bytes_written,
        bytes_written_mb: (this.stats.bytes_written / (1024 * 1024)).toFixed(2)
      },
      config: {
        archive_dir: ARCHIVE_CONFIG.archive_dir,
        min_age_days: ARCHIVE_CONFIG.min_age_days,
        compression: ARCHIVE_CONFIG.compress
      },
      errors: this.stats.errors
    };
  }
}

/**
 * Fonction exportée pour le scheduler
 */
async function run() {
  const job = new LogArchiveJob();
  return await job.execute();
}

module.exports = { run, LogArchiveJob, ARCHIVE_CONFIG, LOG_TYPES };
