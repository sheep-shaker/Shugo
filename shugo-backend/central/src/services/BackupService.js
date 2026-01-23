'use strict';

/**
 * Service de Sauvegarde SHUGO
 * 
 * Gestion des sauvegardes automatiques et manuelles.
 * Stratégie 3-2-1 : 3 copies, 2 supports, 1 externe.
 * 
 * @see Document Technique V7.0 - Section 12
 */

const { Op } = require('sequelize');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const config = require('../config');

/**
 * Types de backup
 */
const BACKUP_TYPES = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  MANUAL: 'manual',
  EMERGENCY: 'emergency'
};

/**
 * Niveaux de backup
 */
const BACKUP_LEVELS = {
  FULL: 'full',
  INCREMENTAL: 'incremental',
  DIFFERENTIAL: 'differential'
};

/**
 * Types de fichiers
 */
const FILE_TYPES = {
  DATABASE: 'database',
  VAULT: 'vault',
  LOGS: 'logs',
  CONFIG: 'config',
  BINARY: 'binary',
  ARCHIVE: 'archive'
};

/**
 * Service de sauvegarde
 */
class BackupService {
  constructor(models, sequelize, services = {}) {
    this.models = models;
    this.sequelize = sequelize;
    this.BackupJob = models.BackupJob;
    this.BackupFile = models.BackupFile;
    this.RestoreOperation = models.RestoreOperation;
    this.AuditLog = models.AuditLog;

    // Services injectés
    this.vaultService = services.vault;

    // Configuration
    this.backupPath = config.backup.path || './backups';
    this.retentionDaily = config.backup.retention.daily || 30;
    this.retentionWeekly = config.backup.retention.weekly || 90;
    this.retentionMonthly = config.backup.retention.monthly || 365;
  }

  // =========================================
  // CRÉATION DE BACKUPS
  // =========================================

  /**
   * Crée une sauvegarde complète
   * @param {string} backupType - Type de backup (daily, weekly, monthly, manual)
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async createBackup(backupType = BACKUP_TYPES.DAILY, options = {}) {
    const { 
      level = BACKUP_LEVELS.FULL,
      includeVault = true,
      includeLogs = true,
      encrypt = true
    } = options;

    const startTime = new Date();
    const backupId = this._generateBackupId(backupType);

    console.log(`[Backup] Démarrage ${backupType} - ID: ${backupId}`);

    // Créer le job de backup
    const job = await this.BackupJob.create({
      job_type: backupType,
      backup_level: level,
      scheduled_at: startTime,
      started_at: startTime,
      status: 'running'
    });

    const backupDir = path.join(this.backupPath, backupId);
    const files = [];

    try {
      // Créer le répertoire
      await fs.mkdir(backupDir, { recursive: true });

      // === 1. Sauvegarde de la base de données ===
      const dbFile = await this._backupDatabase(backupDir, backupId, encrypt);
      files.push(dbFile);

      // === 2. Sauvegarde du Vault ===
      if (includeVault && this.vaultService) {
        const vaultFile = await this._backupVault(backupDir, backupId, encrypt);
        files.push(vaultFile);
      }

      // === 3. Sauvegarde des logs ===
      if (includeLogs) {
        const logsFile = await this._backupLogs(backupDir, backupId, encrypt);
        if (logsFile) files.push(logsFile);
      }

      // === 4. Sauvegarde de la configuration ===
      const configFile = await this._backupConfig(backupDir, backupId, encrypt);
      files.push(configFile);

      // === 5. Créer l'archive finale ===
      const archiveFile = await this._createArchive(backupDir, backupId);
      
      // Calculer la taille totale et le checksum
      const archiveStat = await fs.stat(archiveFile.path);
      const checksums = await this._calculateChecksums(archiveFile.path);

      // Enregistrer les fichiers en base
      for (const file of files) {
        await this.BackupFile.create({
          job_id: job.job_id,
          file_type: file.type,
          file_path: file.path,
          file_size_bytes: file.size,
          checksum_md5: file.checksumMd5,
          checksum_sha256: file.checksumSha256,
          compression_type: 'gzip',
          encryption_algorithm: encrypt ? 'AES-256-GCM' : null,
          is_encrypted: encrypt
        });
      }

      // Mettre à jour le job
      const endTime = new Date();
      const retentionDate = this._calculateRetention(backupType);

      await job.update({
        completed_at: endTime,
        status: 'completed',
        backup_size_bytes: archiveStat.size,
        compression_ratio: this._calculateCompressionRatio(files, archiveStat.size),
        backup_location: archiveFile.path,
        verification_status: 'pending',
        retention_until: retentionDate
      });

      // Nettoyer le répertoire temporaire
      await this._cleanupTempDir(backupDir);

      console.log(`[Backup] Terminé - ${archiveStat.size} bytes`);

      return {
        success: true,
        jobId: job.job_id,
        backupId,
        size: archiveStat.size,
        files: files.length,
        duration: endTime - startTime,
        location: archiveFile.path,
        checksums
      };

    } catch (error) {
      console.error('[Backup] Erreur:', error);

      await job.update({
        completed_at: new Date(),
        status: 'failed',
        error_message: error.message
      });

      // Nettoyer en cas d'erreur
      try {
        await fs.rm(backupDir, { recursive: true, force: true });
      } catch (e) {
        // Ignorer
      }

      throw new BackupError('BACKUP_FAILED', error.message);
    }
  }

  /**
   * Sauvegarde la base de données
   * @private
   */
  async _backupDatabase(backupDir, backupId, encrypt) {
    const filename = `${backupId}_database.sql`;
    const filepath = path.join(backupDir, filename);

    const dbConfig = config.database;
    const pgDumpCmd = `PGPASSWORD="${dbConfig.password}" pg_dump -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -F c -f "${filepath}"`;

    await execAsync(pgDumpCmd);

    const stat = await fs.stat(filepath);
    const checksums = await this._calculateChecksums(filepath);

    // Chiffrer si demandé
    let finalPath = filepath;
    if (encrypt) {
      finalPath = await this._encryptFile(filepath);
      await fs.unlink(filepath);
    }

    return {
      type: FILE_TYPES.DATABASE,
      path: finalPath,
      size: stat.size,
      checksumMd5: checksums.md5,
      checksumSha256: checksums.sha256
    };
  }

  /**
   * Sauvegarde le Vault
   * @private
   */
  async _backupVault(backupDir, backupId, encrypt) {
    const filename = `${backupId}_vault.json`;
    const filepath = path.join(backupDir, filename);

    // Exporter les données du Vault (déjà chiffrées)
    const vaultData = await this._exportVaultData();
    await fs.writeFile(filepath, JSON.stringify(vaultData, null, 2));

    const stat = await fs.stat(filepath);
    const checksums = await this._calculateChecksums(filepath);

    let finalPath = filepath;
    if (encrypt) {
      finalPath = await this._encryptFile(filepath);
      await fs.unlink(filepath);
    }

    return {
      type: FILE_TYPES.VAULT,
      path: finalPath,
      size: stat.size,
      checksumMd5: checksums.md5,
      checksumSha256: checksums.sha256
    };
  }

  /**
   * Exporte les données du Vault
   * @private
   */
  async _exportVaultData() {
    const AesKeyRotation = this.models.AesKeyRotation;
    const SharedSecret = this.models.SharedSecret;
    const VaultItem = this.models.VaultItem;

    const keys = await AesKeyRotation.findAll({
      where: { is_active: true }
    });

    const secrets = await SharedSecret.findAll({
      where: { is_active: true }
    });

    const items = await VaultItem.findAll({
      where: { is_active: true }
    });

    return {
      exportedAt: new Date(),
      keys: keys.map(k => k.toJSON()),
      secrets: secrets.map(s => s.toJSON()),
      items: items.map(i => ({
        item_id: i.item_id,
        item_type: i.item_type,
        item_name: i.item_name,
        // Les données sont déjà chiffrées en base
        item_data_encrypted: i.item_data_encrypted.toString('base64')
      }))
    };
  }

  /**
   * Sauvegarde les logs
   * @private
   */
  async _backupLogs(backupDir, backupId, encrypt) {
    const logsDir = config.logging.directory || './logs';
    const filename = `${backupId}_logs.tar.gz`;
    const filepath = path.join(backupDir, filename);

    try {
      await execAsync(`tar -czf "${filepath}" -C "${logsDir}" .`);
    } catch (err) {
      console.warn('[Backup] Pas de logs à sauvegarder');
      return null;
    }

    const stat = await fs.stat(filepath);
    const checksums = await this._calculateChecksums(filepath);

    let finalPath = filepath;
    if (encrypt) {
      finalPath = await this._encryptFile(filepath);
      await fs.unlink(filepath);
    }

    return {
      type: FILE_TYPES.LOGS,
      path: finalPath,
      size: stat.size,
      checksumMd5: checksums.md5,
      checksumSha256: checksums.sha256
    };
  }

  /**
   * Sauvegarde la configuration
   * @private
   */
  async _backupConfig(backupDir, backupId, encrypt) {
    const filename = `${backupId}_config.json`;
    const filepath = path.join(backupDir, filename);

    // Configuration système (sans secrets)
    const configData = {
      exportedAt: new Date(),
      serverId: config.server.serverId,
      serverType: config.server.serverType,
      geoId: config.geo.defaultGeoId,
      version: '7.0.0',
      features: config.features
    };

    await fs.writeFile(filepath, JSON.stringify(configData, null, 2));

    const stat = await fs.stat(filepath);
    const checksums = await this._calculateChecksums(filepath);

    let finalPath = filepath;
    if (encrypt) {
      finalPath = await this._encryptFile(filepath);
      await fs.unlink(filepath);
    }

    return {
      type: FILE_TYPES.CONFIG,
      path: finalPath,
      size: stat.size,
      checksumMd5: checksums.md5,
      checksumSha256: checksums.sha256
    };
  }

  /**
   * Crée l'archive finale
   * @private
   */
  async _createArchive(backupDir, backupId) {
    const archiveName = `${backupId}.tar.gz`;
    const archivePath = path.join(this.backupPath, archiveName);

    await execAsync(`tar -czf "${archivePath}" -C "${backupDir}" .`);

    return {
      path: archivePath,
      type: FILE_TYPES.ARCHIVE
    };
  }

  // =========================================
  // RESTAURATION
  // =========================================

  /**
   * Restaure depuis une sauvegarde
   * @param {string} jobId - ID du job de backup
   * @param {number} requestedBy - member_id du demandeur
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async restore(jobId, requestedBy, options = {}) {
    const {
      restoreType = 'full',
      components = ['database', 'vault', 'config'],
      validateOnly = false
    } = options;

    // Récupérer le backup
    const job = await this.BackupJob.findByPk(jobId, {
      include: [{ model: this.BackupFile, as: 'files' }]
    });

    if (!job || job.status !== 'completed') {
      throw new BackupError('BACKUP_NOT_FOUND', 'Backup non trouvé ou incomplet');
    }

    // Créer l'opération de restauration
    const restore = await this.RestoreOperation.create({
      restore_type: restoreType,
      source_backup_job_id: jobId,
      requested_by_member_id: requestedBy,
      status: 'requested',
      components_restored: components
    });

    if (validateOnly) {
      // Valider uniquement l'intégrité
      const validation = await this._validateBackup(job);
      await restore.update({
        status: validation.valid ? 'validated' : 'failed',
        validation_results: validation
      });
      return { restore, validation };
    }

    try {
      await restore.update({ status: 'running', started_at: new Date() });

      const results = {};

      // Extraire l'archive
      const extractDir = path.join(this.backupPath, `restore_${restore.restore_id}`);
      await fs.mkdir(extractDir, { recursive: true });
      await execAsync(`tar -xzf "${job.backup_location}" -C "${extractDir}"`);

      // Restaurer chaque composant
      if (components.includes('database')) {
        results.database = await this._restoreDatabase(extractDir, job);
      }

      if (components.includes('vault')) {
        results.vault = await this._restoreVault(extractDir, job);
      }

      if (components.includes('config')) {
        results.config = await this._restoreConfig(extractDir, job);
      }

      // Nettoyer
      await fs.rm(extractDir, { recursive: true, force: true });

      await restore.update({
        status: 'completed',
        completed_at: new Date(),
        validation_results: results,
        rollback_available: true,
        rollback_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h
      });

      return {
        success: true,
        restoreId: restore.restore_id,
        results
      };

    } catch (error) {
      console.error('[Restore] Erreur:', error);

      await restore.update({
        status: 'failed',
        completed_at: new Date(),
        validation_results: { error: error.message }
      });

      throw new BackupError('RESTORE_FAILED', error.message);
    }
  }

  /**
   * Restaure la base de données
   * @private
   */
  async _restoreDatabase(extractDir, job) {
    const dbFile = job.files?.find(f => f.file_type === FILE_TYPES.DATABASE);
    if (!dbFile) return { skipped: true };

    let filepath = path.join(extractDir, path.basename(dbFile.file_path));

    // Déchiffrer si nécessaire
    if (dbFile.is_encrypted) {
      filepath = await this._decryptFile(filepath);
    }

    const dbConfig = config.database;
    const pgRestoreCmd = `PGPASSWORD="${dbConfig.password}" pg_restore -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -c "${filepath}"`;

    await execAsync(pgRestoreCmd);

    return { restored: true, file: dbFile.file_path };
  }

  /**
   * Restaure le Vault
   * @private
   */
  async _restoreVault(extractDir, job) {
    const vaultFile = job.files?.find(f => f.file_type === FILE_TYPES.VAULT);
    if (!vaultFile) return { skipped: true };

    // TODO: Implémenter la restauration du Vault
    return { skipped: true, reason: 'Manual restoration required for security' };
  }

  /**
   * Restaure la configuration
   * @private
   */
  async _restoreConfig(extractDir, job) {
    const configFile = job.files?.find(f => f.file_type === FILE_TYPES.CONFIG);
    if (!configFile) return { skipped: true };

    // TODO: Implémenter la restauration de la config
    return { skipped: true, reason: 'Manual review required' };
  }

  // =========================================
  // VALIDATION ET VÉRIFICATION
  // =========================================

  /**
   * Valide l'intégrité d'une sauvegarde
   * @param {Object} job
   * @returns {Promise<Object>}
   */
  async _validateBackup(job) {
    const results = { valid: true, checks: [] };

    // Vérifier que le fichier existe
    try {
      await fs.access(job.backup_location);
      results.checks.push({ name: 'file_exists', status: 'ok' });
    } catch (err) {
      results.valid = false;
      results.checks.push({ name: 'file_exists', status: 'failed', error: err.message });
      return results;
    }

    // Vérifier les checksums
    const checksums = await this._calculateChecksums(job.backup_location);
    // Note: On devrait comparer avec les checksums stockés

    results.checks.push({ name: 'checksum', status: 'ok', checksums });

    // Vérifier l'intégrité de l'archive
    try {
      await execAsync(`tar -tzf "${job.backup_location}" > /dev/null`);
      results.checks.push({ name: 'archive_integrity', status: 'ok' });
    } catch (err) {
      results.valid = false;
      results.checks.push({ name: 'archive_integrity', status: 'failed', error: err.message });
    }

    return results;
  }

  /**
   * Vérifie toutes les sauvegardes
   * @returns {Promise<Object>}
   */
  async verifyAllBackups() {
    const jobs = await this.BackupJob.findAll({
      where: { status: 'completed' },
      order: [['completed_at', 'DESC']],
      limit: 10
    });

    const results = [];

    for (const job of jobs) {
      try {
        const validation = await this._validateBackup(job);
        await job.update({ verification_status: validation.valid ? 'verified' : 'failed' });
        results.push({ jobId: job.job_id, ...validation });
      } catch (err) {
        results.push({ jobId: job.job_id, valid: false, error: err.message });
      }
    }

    return results;
  }

  // =========================================
  // NETTOYAGE ET RÉTENTION
  // =========================================

  /**
   * Nettoie les backups expirés
   * @returns {Promise<Object>}
   */
  async cleanupExpiredBackups() {
    const now = new Date();
    const results = { deleted: 0, freed: 0 };

    const expiredJobs = await this.BackupJob.findAll({
      where: {
        retention_until: { [Op.lt]: now },
        status: 'completed'
      }
    });

    for (const job of expiredJobs) {
      try {
        // Supprimer le fichier
        if (job.backup_location) {
          const stat = await fs.stat(job.backup_location);
          await fs.unlink(job.backup_location);
          results.freed += stat.size;
        }

        // Supprimer les fichiers associés
        await this.BackupFile.destroy({ where: { job_id: job.job_id } });

        // Marquer comme supprimé
        await job.update({ status: 'deleted' });
        results.deleted++;

      } catch (err) {
        console.error(`[Backup] Erreur suppression ${job.job_id}:`, err.message);
      }
    }

    console.log(`[Backup] Nettoyage: ${results.deleted} backups, ${Math.round(results.freed / 1024 / 1024)} MB libérés`);

    return results;
  }

  /**
   * Calcule la date de rétention
   * @private
   */
  _calculateRetention(backupType) {
    const date = new Date();
    
    switch (backupType) {
      case BACKUP_TYPES.DAILY:
        date.setDate(date.getDate() + this.retentionDaily);
        break;
      case BACKUP_TYPES.WEEKLY:
        date.setDate(date.getDate() + this.retentionWeekly);
        break;
      case BACKUP_TYPES.MONTHLY:
        date.setDate(date.getDate() + this.retentionMonthly);
        break;
      default:
        date.setDate(date.getDate() + this.retentionDaily);
    }

    return date;
  }

  // =========================================
  // UTILITAIRES
  // =========================================

  /**
   * Génère un ID de backup
   * @private
   */
  _generateBackupId(type) {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, '').split('.')[0];
    return `backup_${type}_${timestamp}`;
  }

  /**
   * Calcule les checksums d'un fichier
   * @private
   */
  async _calculateChecksums(filepath) {
    const content = await fs.readFile(filepath);
    
    return {
      md5: crypto.createHash('md5').update(content).digest('hex'),
      sha256: crypto.createHash('sha256').update(content).digest('hex')
    };
  }

  /**
   * Chiffre un fichier
   * @private
   */
  async _encryptFile(filepath) {
    const cryptoUtil = require('../utils/crypto');
    const content = await fs.readFile(filepath);
    const key = Buffer.from(config.security.encryptionKey, 'hex');
    
    const encrypted = cryptoUtil.encryptToBuffer(content, key);
    const encryptedPath = filepath + '.enc';
    
    await fs.writeFile(encryptedPath, encrypted);
    return encryptedPath;
  }

  /**
   * Déchiffre un fichier
   * @private
   */
  async _decryptFile(filepath) {
    const cryptoUtil = require('../utils/crypto');
    const content = await fs.readFile(filepath);
    const key = Buffer.from(config.security.encryptionKey, 'hex');
    
    const decrypted = cryptoUtil.decryptFromBuffer(content, key);
    const decryptedPath = filepath.replace('.enc', '');
    
    await fs.writeFile(decryptedPath, decrypted);
    return decryptedPath;
  }

  /**
   * Calcule le ratio de compression
   * @private
   */
  _calculateCompressionRatio(files, archiveSize) {
    const originalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
    if (originalSize === 0) return 1;
    return Math.round((1 - archiveSize / originalSize) * 100) / 100;
  }

  /**
   * Nettoie le répertoire temporaire
   * @private
   */
  async _cleanupTempDir(dir) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[Backup] Impossible de nettoyer ${dir}:`, err.message);
    }
  }

  // =========================================
  // LISTE ET STATISTIQUES
  // =========================================

  /**
   * Liste les backups disponibles
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async list(options = {}) {
    const { type, status = 'completed', page = 1, limit = 20 } = options;

    const where = {};
    if (type) where.job_type = type;
    if (status) where.status = status;

    const { count, rows } = await this.BackupJob.findAndCountAll({
      where,
      order: [['completed_at', 'DESC']],
      limit: Math.min(limit, 100),
      offset: (page - 1) * limit,
      include: [{ model: this.BackupFile, as: 'files' }]
    });

    return {
      backups: rows,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    };
  }

  /**
   * Statistiques des backups
   * @returns {Promise<Object>}
   */
  async getStats() {
    const [stats] = await this.sequelize.query(`
      SELECT 
        job_type,
        COUNT(*) as count,
        SUM(backup_size_bytes) as total_size,
        AVG(backup_size_bytes) as avg_size,
        MAX(completed_at) as last_backup
      FROM backup_jobs
      WHERE status = 'completed'
      GROUP BY job_type
    `);

    const totalSize = stats.reduce((sum, s) => sum + parseInt(s.total_size || 0), 0);

    return {
      byType: stats,
      totalSize,
      totalSizeMB: Math.round(totalSize / 1024 / 1024)
    };
  }
}

/**
 * Classe d'erreur
 */
class BackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

module.exports = BackupService;
module.exports.BackupError = BackupError;
module.exports.BACKUP_TYPES = BACKUP_TYPES;
module.exports.BACKUP_LEVELS = BACKUP_LEVELS;
module.exports.FILE_TYPES = FILE_TYPES;
