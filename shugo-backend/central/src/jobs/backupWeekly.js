'use strict';

/**
 * SHUGO v7.0 - Weekly Backup Job
 *
 * Sauvegarde hebdomadaire complète du système.
 * Exécuté le dimanche à 02h00 (heure locale).
 *
 * @see Document Technique V7.0 - Chapitre 9
 */

const { Op } = require('sequelize');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const { BackupJob, BackupFile, AuditLog, User } = require('../models');
const logger = require('../utils/logger');
const NotificationService = require('../services/NotificationService');

const gzip = promisify(zlib.gzip);

/**
 * Configuration de la sauvegarde hebdomadaire
 */
const BACKUP_CONFIG = {
  // Répertoire de sauvegarde
  backup_dir: process.env.BACKUP_DIR || './backups',
  // Sous-répertoire pour les sauvegardes hebdomadaires
  weekly_subdir: 'weekly',
  // Rétention des sauvegardes hebdomadaires (semaines)
  retention_weeks: 12,
  // Compression activée
  compress: true,
  // Chiffrement activé
  encrypt: true,
  // Algorithme de chiffrement
  encryption_algorithm: 'aes-256-gcm',
  // Tables à inclure dans la sauvegarde complète
  include_tables: [
    'users',
    'sessions',
    'registration_tokens',
    'locations',
    'local_instances',
    'groups',
    'group_memberships',
    'guards',
    'guard_assignments',
    'guard_scenarios',
    'guard_slots',
    'waiting_list',
    'notifications',
    'messages_center',
    'message_read_status',
    'support_requests',
    'user_missions',
    'user_skills',
    'user_availabilities',
    'aes_key_rotations',
    'shared_secrets',
    'emergency_codes',
    'vault_items',
    'security_protocol_logs',
    'audit_logs',
    'system_logs',
    'maintenance_runs',
    'health_checks',
    'system_metrics',
    'error_codes_registry',
    'error_occurrences',
    'backup_jobs',
    'backup_files',
    'restore_operations',
    'plugin_registry',
    'plugin_configurations'
  ],
  // Tables sensibles (chiffrées séparément)
  sensitive_tables: [
    'users',
    'sessions',
    'shared_secrets',
    'emergency_codes',
    'vault_items'
  ]
};

/**
 * Types de sauvegarde
 */
const BACKUP_TYPES = {
  WEEKLY_FULL: 'weekly_full',
  WEEKLY_INCREMENTAL: 'weekly_incremental'
};

/**
 * Classe principale du job de sauvegarde hebdomadaire
 */
class WeeklyBackupJob {
  constructor() {
    this.stats = {
      tables_backed_up: 0,
      total_rows: 0,
      files_created: 0,
      total_size_bytes: 0,
      compressed_size_bytes: 0,
      duration_ms: 0,
      errors: []
    };
    this.backupId = null;
    this.backupDir = null;
  }

  /**
   * Exécute la sauvegarde hebdomadaire
   */
  async execute() {
    const startTime = new Date();
    logger.info('[WeeklyBackup] Démarrage de la sauvegarde hebdomadaire');

    let backupJob;

    try {
      // 1. Créer l'enregistrement de backup
      backupJob = await BackupJob.create({
        type: BACKUP_TYPES.WEEKLY_FULL,
        status: 'running',
        started_at: startTime,
        details: { config: { ...BACKUP_CONFIG, encryption_key: '[REDACTED]' } }
      });
      this.backupId = backupJob.backup_id;

      // 2. Préparer le répertoire de backup
      await this.prepareBackupDirectory();

      // 3. Obtenir la clé de chiffrement
      const encryptionKey = await this.getEncryptionKey();

      // 4. Sauvegarder chaque table
      for (const tableName of BACKUP_CONFIG.include_tables) {
        await this.backupTable(tableName, encryptionKey);
      }

      // 5. Créer le manifest
      const manifest = await this.createManifest(startTime);

      // 6. Vérifier l'intégrité
      await this.verifyBackup(manifest);

      // 7. Nettoyer les anciennes sauvegardes
      await this.cleanOldBackups();

      // 8. Finaliser
      const endTime = new Date();
      this.stats.duration_ms = endTime - startTime;

      await backupJob.update({
        status: 'completed',
        completed_at: endTime,
        size_bytes: this.stats.total_size_bytes,
        compressed_size_bytes: this.stats.compressed_size_bytes,
        details: {
          config: { ...BACKUP_CONFIG, encryption_key: '[REDACTED]' },
          stats: this.stats,
          manifest_path: path.join(this.backupDir, 'manifest.json')
        }
      });

      // 9. Notifier les administrateurs
      await this.notifySuccess();

      logger.info('[WeeklyBackup] Sauvegarde terminée avec succès', this.stats);

      return {
        success: true,
        backup_id: this.backupId,
        duration_ms: this.stats.duration_ms,
        stats: this.stats
      };

    } catch (error) {
      logger.error('[WeeklyBackup] Erreur critique:', error);

      if (backupJob) {
        await backupJob.update({
          status: 'failed',
          completed_at: new Date(),
          error_message: error.message,
          details: {
            config: { ...BACKUP_CONFIG, encryption_key: '[REDACTED]' },
            stats: this.stats,
            error: error.stack
          }
        });
      }

      await this.notifyFailure(error);
      throw error;
    }
  }

  /**
   * Prépare le répertoire de sauvegarde
   */
  async prepareBackupDirectory() {
    const dateStr = new Date().toISOString().split('T')[0];
    const weekNum = this.getWeekNumber(new Date());

    this.backupDir = path.join(
      BACKUP_CONFIG.backup_dir,
      BACKUP_CONFIG.weekly_subdir,
      `${dateStr}_week${weekNum}`
    );

    await fs.mkdir(this.backupDir, { recursive: true });
    await fs.mkdir(path.join(this.backupDir, 'data'), { recursive: true });
    await fs.mkdir(path.join(this.backupDir, 'sensitive'), { recursive: true });

    logger.info(`[WeeklyBackup] Répertoire créé: ${this.backupDir}`);
  }

  /**
   * Obtient le numéro de semaine
   */
  getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  /**
   * Obtient la clé de chiffrement
   */
  async getEncryptionKey() {
    // En production, récupérer depuis le vault
    const key = process.env.BACKUP_ENCRYPTION_KEY;
    if (!key && BACKUP_CONFIG.encrypt) {
      throw new Error('Clé de chiffrement non configurée');
    }
    return key ? Buffer.from(key, 'hex') : null;
  }

  /**
   * Sauvegarde une table
   */
  async backupTable(tableName, encryptionKey) {
    try {
      const { sequelize } = require('../models');

      // Récupérer toutes les données de la table
      const [rows] = await sequelize.query(`SELECT * FROM ${tableName}`);

      if (rows.length === 0) {
        logger.debug(`[WeeklyBackup] Table ${tableName}: vide, skip`);
        return;
      }

      // Sérialiser
      const jsonData = JSON.stringify(rows);
      const originalSize = Buffer.byteLength(jsonData);
      this.stats.total_rows += rows.length;

      // Compresser si activé
      let dataToWrite = Buffer.from(jsonData);
      if (BACKUP_CONFIG.compress) {
        dataToWrite = await gzip(dataToWrite);
      }

      // Chiffrer si table sensible et chiffrement activé
      const isSensitive = BACKUP_CONFIG.sensitive_tables.includes(tableName);
      let iv = null;
      let authTag = null;

      if (BACKUP_CONFIG.encrypt && encryptionKey && isSensitive) {
        const encrypted = this.encryptData(dataToWrite, encryptionKey);
        dataToWrite = encrypted.data;
        iv = encrypted.iv;
        authTag = encrypted.authTag;
      }

      // Déterminer le chemin du fichier
      const subDir = isSensitive ? 'sensitive' : 'data';
      const extension = BACKUP_CONFIG.compress ? '.json.gz' : '.json';
      const filename = `${tableName}${extension}${BACKUP_CONFIG.encrypt && isSensitive ? '.enc' : ''}`;
      const filepath = path.join(this.backupDir, subDir, filename);

      // Écrire le fichier
      await fs.writeFile(filepath, dataToWrite);

      // Calculer le checksum
      const checksum = crypto
        .createHash('sha256')
        .update(dataToWrite)
        .digest('hex');

      // Enregistrer le fichier de backup
      await BackupFile.create({
        backup_id: this.backupId,
        table_name: tableName,
        file_path: filepath,
        original_size: originalSize,
        compressed_size: dataToWrite.length,
        row_count: rows.length,
        checksum,
        encrypted: BACKUP_CONFIG.encrypt && isSensitive,
        iv: iv ? iv.toString('hex') : null,
        auth_tag: authTag ? authTag.toString('hex') : null
      });

      this.stats.tables_backed_up++;
      this.stats.total_size_bytes += originalSize;
      this.stats.compressed_size_bytes += dataToWrite.length;
      this.stats.files_created++;

      logger.debug(`[WeeklyBackup] Table ${tableName}: ${rows.length} lignes, ${dataToWrite.length} bytes`);

    } catch (error) {
      this.stats.errors.push({ table: tableName, error: error.message });
      logger.error(`[WeeklyBackup] Erreur sauvegarde table ${tableName}:`, error);
    }
  }

  /**
   * Chiffre les données
   */
  encryptData(data, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(BACKUP_CONFIG.encryption_algorithm, key, iv);

    const encrypted = Buffer.concat([
      cipher.update(data),
      cipher.final()
    ]);

    return {
      data: encrypted,
      iv,
      authTag: cipher.getAuthTag()
    };
  }

  /**
   * Crée le manifest de la sauvegarde
   */
  async createManifest(startTime) {
    const manifest = {
      version: '7.0',
      type: BACKUP_TYPES.WEEKLY_FULL,
      created_at: startTime.toISOString(),
      completed_at: new Date().toISOString(),
      backup_id: this.backupId,
      config: {
        compress: BACKUP_CONFIG.compress,
        encrypt: BACKUP_CONFIG.encrypt,
        encryption_algorithm: BACKUP_CONFIG.encryption_algorithm
      },
      stats: this.stats,
      files: await BackupFile.findAll({
        where: { backup_id: this.backupId },
        attributes: ['table_name', 'file_path', 'row_count', 'checksum', 'encrypted']
      }),
      checksums: {}
    };

    // Ajouter les checksums
    const files = await BackupFile.findAll({
      where: { backup_id: this.backupId }
    });

    for (const file of files) {
      manifest.checksums[file.table_name] = file.checksum;
    }

    // Écrire le manifest
    const manifestPath = path.join(this.backupDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    // Checksum du manifest
    const manifestChecksum = crypto
      .createHash('sha256')
      .update(JSON.stringify(manifest))
      .digest('hex');

    await fs.writeFile(
      path.join(this.backupDir, 'manifest.sha256'),
      manifestChecksum
    );

    return manifest;
  }

  /**
   * Vérifie l'intégrité de la sauvegarde
   */
  async verifyBackup(manifest) {
    logger.info('[WeeklyBackup] Vérification de l\'intégrité...');

    const files = await BackupFile.findAll({
      where: { backup_id: this.backupId }
    });

    for (const file of files) {
      const fileData = await fs.readFile(file.file_path);
      const checksum = crypto
        .createHash('sha256')
        .update(fileData)
        .digest('hex');

      if (checksum !== file.checksum) {
        throw new Error(`Checksum invalide pour ${file.table_name}`);
      }
    }

    logger.info('[WeeklyBackup] Intégrité vérifiée');
  }

  /**
   * Nettoie les anciennes sauvegardes
   */
  async cleanOldBackups() {
    try {
      const weeklyDir = path.join(BACKUP_CONFIG.backup_dir, BACKUP_CONFIG.weekly_subdir);
      const entries = await fs.readdir(weeklyDir, { withFileTypes: true });

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - (BACKUP_CONFIG.retention_weeks * 7));

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const match = entry.name.match(/^(\d{4}-\d{2}-\d{2})/);
          if (match) {
            const dirDate = new Date(match[1]);
            if (dirDate < cutoffDate) {
              const dirPath = path.join(weeklyDir, entry.name);
              await fs.rm(dirPath, { recursive: true, force: true });
              logger.info(`[WeeklyBackup] Ancienne sauvegarde supprimée: ${entry.name}`);
            }
          }
        }
      }

    } catch (error) {
      this.stats.errors.push({ action: 'cleanOldBackups', error: error.message });
      logger.error('[WeeklyBackup] Erreur nettoyage anciennes sauvegardes:', error);
    }
  }

  /**
   * Notifie le succès de la sauvegarde
   */
  async notifySuccess() {
    try {
      const admins = await User.findAll({
        where: { role: { [Op.in]: ['admin', 'root_admin'] } }
      });

      const compressionRatio = this.stats.total_size_bytes > 0
        ? ((1 - this.stats.compressed_size_bytes / this.stats.total_size_bytes) * 100).toFixed(1)
        : 0;

      for (const admin of admins) {
        await NotificationService.send({
          user_id: admin.member_id,
          type: 'backup_completed',
          title: 'Sauvegarde hebdomadaire terminée',
          message: `${this.stats.tables_backed_up} tables, ${(this.stats.compressed_size_bytes / (1024 * 1024)).toFixed(2)} MB (${compressionRatio}% compression)`,
          priority: 'low',
          data: {
            backup_id: this.backupId,
            stats: this.stats
          }
        });
      }

      // Audit log
      await AuditLog.create({
        action_type: 'backup.weekly_completed',
        entity_type: 'backup',
        entity_id: this.backupId,
        severity: 'info',
        details: this.stats
      });

    } catch (error) {
      logger.error('[WeeklyBackup] Erreur notification succès:', error);
    }
  }

  /**
   * Notifie l'échec de la sauvegarde
   */
  async notifyFailure(error) {
    try {
      const admins = await User.findAll({
        where: { role: { [Op.in]: ['admin', 'root_admin'] } }
      });

      for (const admin of admins) {
        await NotificationService.send({
          user_id: admin.member_id,
          type: 'backup_failed',
          title: 'ERREUR: Sauvegarde hebdomadaire échouée',
          message: error.message,
          priority: 'critical',
          data: {
            backup_id: this.backupId,
            error: error.message,
            stats: this.stats
          }
        });
      }

      // Audit log
      await AuditLog.create({
        action_type: 'backup.weekly_failed',
        entity_type: 'backup',
        entity_id: this.backupId,
        severity: 'critical',
        details: {
          error: error.message,
          stats: this.stats
        }
      });

    } catch (notifyError) {
      logger.error('[WeeklyBackup] Erreur notification échec:', notifyError);
    }
  }
}

/**
 * Fonction exportée pour le scheduler
 */
async function run() {
  const job = new WeeklyBackupJob();
  return await job.execute();
}

module.exports = { run, WeeklyBackupJob, BACKUP_CONFIG, BACKUP_TYPES };
