'use strict';

/**
 * SHUGO Local Server - Backup Service
 * Gestion des sauvegardes locales avec chiffrement
 */

const fs = require('fs').promises;
const path = require('path');
const { createReadStream, createWriteStream } = require('fs');
const { pipeline } = require('stream/promises');
const { createGzip, createGunzip } = require('zlib');
const crypto = require('crypto');
const cron = require('node-cron');
const logger = require('../utils/logger');

class BackupService {
  constructor(config, vault) {
    this.config = config;
    this.vault = vault;
    this.backupPath = config.paths?.backups || path.join(__dirname, '../../backups');
    this.cronJob = null;
    this.isRunning = false;
  }

  /**
   * Initialize backup service
   */
  async initialize() {
    // Ensure backup directory exists
    await fs.mkdir(this.backupPath, { recursive: true });

    // Schedule automatic backups
    if (this.config.backup?.enabled && this.config.backup?.schedule) {
      this.scheduleBackups();
    }

    logger.info('BackupService initialized', {
      path: this.backupPath,
      schedule: this.config.backup?.schedule
    });
  }

  /**
   * Schedule automatic backups
   */
  scheduleBackups() {
    const schedule = this.config.backup.schedule;

    this.cronJob = cron.schedule(schedule, async () => {
      try {
        await this.createBackup('scheduled');
      } catch (error) {
        logger.error('Scheduled backup failed:', error);
      }
    });

    logger.info('Backup scheduled:', schedule);
  }

  /**
   * Create a full backup
   */
  async createBackup(trigger = 'manual') {
    if (this.isRunning) {
      throw new Error('Backup already in progress');
    }

    this.isRunning = true;
    const startTime = Date.now();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `shugo-local-${timestamp}`;

    logger.info('Starting backup', { trigger, backupName });

    try {
      // Create temp directory
      const tempDir = path.join(this.backupPath, `temp-${backupName}`);
      await fs.mkdir(tempDir, { recursive: true });

      // Backup database
      await this.backupDatabase(tempDir);

      // Backup vault
      await this.backupVault(tempDir);

      // Backup config
      await this.backupConfig(tempDir);

      // Create archive
      const archivePath = await this.createArchive(tempDir, backupName);

      // Encrypt if configured
      let finalPath = archivePath;
      if (this.config.backup?.encrypt) {
        finalPath = await this.encryptBackup(archivePath);
        await fs.unlink(archivePath);
      }

      // Cleanup temp directory
      await fs.rm(tempDir, { recursive: true });

      // Get backup info
      const stats = await fs.stat(finalPath);
      const duration = Date.now() - startTime;

      const backupInfo = {
        name: backupName,
        path: finalPath,
        size: stats.size,
        duration,
        trigger,
        encrypted: !!this.config.backup?.encrypt,
        timestamp: new Date().toISOString()
      };

      // Cleanup old backups
      await this.cleanupOldBackups();

      logger.info('Backup completed', backupInfo);

      return backupInfo;

    } catch (error) {
      logger.error('Backup failed:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Backup SQLite database
   */
  async backupDatabase(destDir) {
    const config = require('../config');
    const dbPath = config.database.storage;

    if (!dbPath) {
      logger.warn('No database path configured');
      return;
    }

    const destPath = path.join(destDir, 'database.sqlite');

    // Use SQLite backup API via raw copy (safe for SQLite with WAL)
    await fs.copyFile(dbPath, destPath);

    // Also copy WAL and SHM files if they exist
    try {
      await fs.copyFile(`${dbPath}-wal`, `${destPath}-wal`);
      await fs.copyFile(`${dbPath}-shm`, `${destPath}-shm`);
    } catch (e) {
      // WAL files may not exist
    }

    logger.debug('Database backed up');
  }

  /**
   * Backup vault data
   */
  async backupVault(destDir) {
    const vaultPath = path.join(__dirname, '../../data/vault');
    const destPath = path.join(destDir, 'vault');

    try {
      await fs.mkdir(destPath, { recursive: true });
      const files = await fs.readdir(vaultPath);

      for (const file of files) {
        await fs.copyFile(
          path.join(vaultPath, file),
          path.join(destPath, file)
        );
      }

      logger.debug('Vault backed up');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Backup configuration
   */
  async backupConfig(destDir) {
    const configBackup = {
      server_id: process.env.SERVER_ID,
      geo_id: process.env.GEO_ID,
      backup_date: new Date().toISOString(),
      version: require('../../package.json').version
    };

    await fs.writeFile(
      path.join(destDir, 'backup-info.json'),
      JSON.stringify(configBackup, null, 2)
    );

    logger.debug('Config backed up');
  }

  /**
   * Create compressed archive
   */
  async createArchive(sourceDir, name) {
    const archivePath = path.join(this.backupPath, `${name}.tar.gz`);
    const tar = require('tar');

    await tar.create(
      {
        gzip: true,
        file: archivePath,
        cwd: sourceDir
      },
      ['.']
    );

    return archivePath;
  }

  /**
   * Encrypt backup file
   */
  async encryptBackup(filePath) {
    const encryptedPath = `${filePath}.enc`;

    // Generate random IV
    const iv = crypto.randomBytes(16);

    // Get encryption key from vault
    const key = this.vault.backupKey || crypto.randomBytes(32);

    // Create cipher
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    // Read, encrypt, write
    const input = createReadStream(filePath);
    const output = createWriteStream(encryptedPath);

    // Write IV first
    output.write(iv);

    await pipeline(input, cipher, output);

    // Append auth tag
    const authTag = cipher.getAuthTag();
    await fs.appendFile(encryptedPath, authTag);

    return encryptedPath;
  }

  /**
   * Restore from backup
   */
  async restoreBackup(backupPath) {
    logger.info('Starting restore from', backupPath);

    // Decrypt if needed
    let archivePath = backupPath;
    if (backupPath.endsWith('.enc')) {
      archivePath = await this.decryptBackup(backupPath);
    }

    // Extract archive
    const tempDir = path.join(this.backupPath, `restore-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const tar = require('tar');
    await tar.extract({
      file: archivePath,
      cwd: tempDir
    });

    // Restore database
    await this.restoreDatabase(tempDir);

    // Restore vault
    await this.restoreVault(tempDir);

    // Cleanup
    await fs.rm(tempDir, { recursive: true });
    if (archivePath !== backupPath) {
      await fs.unlink(archivePath);
    }

    logger.info('Restore completed');
  }

  /**
   * Decrypt backup file
   */
  async decryptBackup(encryptedPath) {
    const decryptedPath = encryptedPath.replace('.enc', '');

    const encrypted = await fs.readFile(encryptedPath);

    // Extract IV (first 16 bytes)
    const iv = encrypted.slice(0, 16);

    // Extract auth tag (last 16 bytes)
    const authTag = encrypted.slice(-16);

    // Extract ciphertext
    const ciphertext = encrypted.slice(16, -16);

    // Get decryption key
    const key = this.vault.backupKey;
    if (!key) {
      throw new Error('Backup key not available');
    }

    // Decrypt
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);

    await fs.writeFile(decryptedPath, decrypted);

    return decryptedPath;
  }

  /**
   * Restore database from backup
   */
  async restoreDatabase(tempDir) {
    const config = require('../config');
    const dbPath = config.database.storage;
    const backupDbPath = path.join(tempDir, 'database.sqlite');

    try {
      await fs.access(backupDbPath);
      await fs.copyFile(backupDbPath, dbPath);
      logger.info('Database restored');
    } catch (error) {
      logger.warn('No database in backup');
    }
  }

  /**
   * Restore vault from backup
   */
  async restoreVault(tempDir) {
    const vaultPath = path.join(__dirname, '../../data/vault');
    const backupVaultPath = path.join(tempDir, 'vault');

    try {
      await fs.access(backupVaultPath);
      const files = await fs.readdir(backupVaultPath);

      for (const file of files) {
        await fs.copyFile(
          path.join(backupVaultPath, file),
          path.join(vaultPath, file)
        );
      }

      logger.info('Vault restored');
    } catch (error) {
      logger.warn('No vault in backup');
    }
  }

  /**
   * Cleanup old backups
   */
  async cleanupOldBackups() {
    const retention = this.config.backup?.retention || 7;
    const files = await fs.readdir(this.backupPath);

    const backups = files
      .filter(f => f.startsWith('shugo-local-') && (f.endsWith('.tar.gz') || f.endsWith('.enc')))
      .map(f => ({
        name: f,
        path: path.join(this.backupPath, f)
      }));

    // Sort by date (oldest first)
    backups.sort((a, b) => a.name.localeCompare(b.name));

    // Remove oldest if exceeding retention
    while (backups.length > retention) {
      const oldest = backups.shift();
      await fs.unlink(oldest.path);
      logger.info('Removed old backup:', oldest.name);
    }
  }

  /**
   * List available backups
   */
  async listBackups() {
    const files = await fs.readdir(this.backupPath);

    const backups = [];
    for (const file of files) {
      if (file.startsWith('shugo-local-') && (file.endsWith('.tar.gz') || file.endsWith('.enc'))) {
        const filePath = path.join(this.backupPath, file);
        const stats = await fs.stat(filePath);

        backups.push({
          name: file,
          path: filePath,
          size: stats.size,
          created: stats.mtime,
          encrypted: file.endsWith('.enc')
        });
      }
    }

    return backups.sort((a, b) => b.created - a.created);
  }

  /**
   * Stop backup service
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    logger.info('BackupService stopped');
  }
}

module.exports = BackupService;
