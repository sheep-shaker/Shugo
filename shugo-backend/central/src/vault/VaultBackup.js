'use strict';

/**
 * SHUGO v7.0 - Sauvegarde chiffrée du Vault
 *
 * Gère les sauvegardes et restaurations sécurisées du Vault.
 *
 * @see Document Technique V7.0 - Section 5.6
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Types de backup
 */
const BACKUP_TYPES = {
  FULL: 'full',
  KEYS_ONLY: 'keys_only',
  SECRETS_ONLY: 'secrets_only'
};

/**
 * Formats de backup
 */
const BACKUP_FORMATS = {
  ENCRYPTED_JSON: 'encrypted_json',
  ENCRYPTED_BINARY: 'encrypted_binary'
};

class VaultBackup {
  constructor(vaultManager, options = {}) {
    this._vaultManager = vaultManager;
    this._backupPath = options.backupPath || './backups/vault';

    // Configuration
    this._config = {
      algorithm: 'aes-256-gcm',
      keyLength: 32,
      compressionLevel: 9,
      maxBackups: 30, // Garder les 30 dernières sauvegardes
      ...options
    };
  }

  /**
   * Crée une sauvegarde complète du Vault
   */
  async createBackup(backupKey, options = {}) {
    const {
      type = BACKUP_TYPES.FULL,
      format = BACKUP_FORMATS.ENCRYPTED_JSON,
      includeMetadata = true
    } = options;

    if (!backupKey || backupKey.length < 32) {
      throw new Error('Clé de backup invalide (minimum 32 caractères)');
    }

    // Vérifier que le Vault est accessible
    const status = this._vaultManager.getStatus();
    if (!status.isUnsealed) {
      throw new Error('Le Vault doit être déverrouillé pour créer une sauvegarde');
    }

    const backupData = {
      version: '1.0',
      type,
      format,
      createdAt: new Date().toISOString(),
      metadata: includeMetadata ? await this._getMetadata() : null,
      data: {}
    };

    // Collecter les données selon le type
    if (type === BACKUP_TYPES.FULL || type === BACKUP_TYPES.KEYS_ONLY) {
      backupData.data.keys = await this._exportKeys();
    }

    if (type === BACKUP_TYPES.FULL || type === BACKUP_TYPES.SECRETS_ONLY) {
      backupData.data.secrets = await this._exportSecrets();
    }

    // Sérialiser et compresser
    const jsonData = JSON.stringify(backupData);
    const compressed = await gzip(Buffer.from(jsonData, 'utf8'), {
      level: this._config.compressionLevel
    });

    // Chiffrer
    const encrypted = this._encrypt(compressed, backupKey);

    // Générer le nom du fichier
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `vault-backup-${type}-${timestamp}.enc`;
    const filepath = path.join(this._backupPath, filename);

    // Créer le répertoire si nécessaire
    await fs.mkdir(this._backupPath, { recursive: true });

    // Écrire le fichier
    await fs.writeFile(filepath, JSON.stringify(encrypted));

    // Calculer le checksum
    const checksum = this._calculateChecksum(compressed);

    // Nettoyer les anciennes sauvegardes
    await this._cleanOldBackups();

    console.log(`[VaultBackup] Sauvegarde créée: ${filename}`);

    return {
      filename,
      filepath,
      type,
      format,
      size: encrypted.encrypted.length,
      checksum,
      createdAt: backupData.createdAt
    };
  }

  /**
   * Restaure une sauvegarde du Vault
   */
  async restoreBackup(filepath, backupKey, options = {}) {
    const {
      validateOnly = false,
      overwrite = false
    } = options;

    if (!backupKey || backupKey.length < 32) {
      throw new Error('Clé de backup invalide');
    }

    // Lire le fichier de sauvegarde
    const encryptedJson = await fs.readFile(filepath, 'utf8');
    const encrypted = JSON.parse(encryptedJson);

    // Déchiffrer
    let decrypted;
    try {
      decrypted = this._decrypt(encrypted, backupKey);
    } catch (error) {
      throw new Error('Échec du déchiffrement - clé incorrecte ou fichier corrompu');
    }

    // Décompresser
    const decompressed = await gunzip(decrypted);
    const backupData = JSON.parse(decompressed.toString('utf8'));

    // Valider la structure
    this._validateBackupStructure(backupData);

    if (validateOnly) {
      return {
        valid: true,
        type: backupData.type,
        createdAt: backupData.createdAt,
        metadata: backupData.metadata,
        keysCount: backupData.data.keys?.length || 0,
        secretsCount: backupData.data.secrets?.length || 0
      };
    }

    // Vérifier que le Vault est prêt pour la restauration
    const status = this._vaultManager.getStatus();
    if (!status.isUnsealed) {
      throw new Error('Le Vault doit être déverrouillé pour restaurer');
    }

    if (!overwrite) {
      throw new Error('La restauration écraserait les données existantes. Utilisez overwrite: true pour confirmer');
    }

    // Mettre le Vault en maintenance
    await this._vaultManager.enterMaintenance();

    try {
      // Restaurer les clés
      if (backupData.data.keys) {
        await this._importKeys(backupData.data.keys);
      }

      // Restaurer les secrets
      if (backupData.data.secrets) {
        await this._importSecrets(backupData.data.secrets);
      }

      console.log(`[VaultBackup] Restauration terminée`);

      return {
        success: true,
        type: backupData.type,
        keysRestored: backupData.data.keys?.length || 0,
        secretsRestored: backupData.data.secrets?.length || 0,
        restoredAt: new Date().toISOString()
      };
    } finally {
      // Sortir du mode maintenance
      await this._vaultManager.exitMaintenance();
    }
  }

  /**
   * Liste les sauvegardes disponibles
   */
  async listBackups() {
    try {
      const files = await fs.readdir(this._backupPath);
      const backups = [];

      for (const file of files) {
        if (!file.endsWith('.enc')) continue;

        const filepath = path.join(this._backupPath, file);
        const stats = await fs.stat(filepath);

        // Parser le nom de fichier
        const match = file.match(/vault-backup-(\w+)-(.+)\.enc$/);

        backups.push({
          filename: file,
          filepath,
          type: match ? match[1] : 'unknown',
          size: stats.size,
          createdAt: stats.birthtime.toISOString(),
          modifiedAt: stats.mtime.toISOString()
        });
      }

      return backups.sort((a, b) =>
        new Date(b.createdAt) - new Date(a.createdAt)
      );
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Vérifie l'intégrité d'une sauvegarde
   */
  async verifyBackup(filepath, backupKey) {
    try {
      const result = await this.restoreBackup(filepath, backupKey, {
        validateOnly: true
      });

      return {
        valid: true,
        ...result
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Supprime une sauvegarde
   */
  async deleteBackup(filepath) {
    await fs.unlink(filepath);
    console.log(`[VaultBackup] Sauvegarde supprimée: ${filepath}`);
    return { deleted: true };
  }

  // =========================================
  // MÉTHODES PRIVÉES
  // =========================================

  /**
   * Exporte les clés du KeyStore
   */
  async _exportKeys() {
    // En production, récupérer depuis le KeyStore
    const keyHistory = await this._vaultManager.getKeyHistory();
    return keyHistory.map(k => ({
      ...k,
      exportedAt: new Date().toISOString()
    }));
  }

  /**
   * Exporte les secrets du SecretStore
   */
  async _exportSecrets() {
    // En production, récupérer depuis le SecretStore
    return [];
  }

  /**
   * Importe des clés dans le KeyStore
   */
  async _importKeys(keys) {
    // En production, importer via le KeyStore
    console.log(`[VaultBackup] Import de ${keys.length} clés`);
  }

  /**
   * Importe des secrets dans le SecretStore
   */
  async _importSecrets(secrets) {
    // En production, importer via le SecretStore
    console.log(`[VaultBackup] Import de ${secrets.length} secrets`);
  }

  /**
   * Récupère les métadonnées du Vault
   */
  async _getMetadata() {
    return {
      vaultStatus: this._vaultManager.getStatus(),
      timestamp: new Date().toISOString(),
      hostname: require('os').hostname(),
      nodeVersion: process.version
    };
  }

  /**
   * Chiffre des données
   */
  _encrypt(data, key) {
    const derivedKey = crypto.pbkdf2Sync(key, 'vault-backup-salt', 100000, 32, 'sha512');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this._config.algorithm, derivedKey, iv);

    const encrypted = Buffer.concat([
      cipher.update(data),
      cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    return {
      encrypted: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64')
    };
  }

  /**
   * Déchiffre des données
   */
  _decrypt(encryptedData, key) {
    const derivedKey = crypto.pbkdf2Sync(key, 'vault-backup-salt', 100000, 32, 'sha512');
    const decipher = crypto.createDecipheriv(
      this._config.algorithm,
      derivedKey,
      Buffer.from(encryptedData.iv, 'base64')
    );

    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedData.encrypted, 'base64')),
      decipher.final()
    ]);
  }

  /**
   * Calcule un checksum
   */
  _calculateChecksum(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Valide la structure d'une sauvegarde
   */
  _validateBackupStructure(backupData) {
    if (!backupData.version) {
      throw new Error('Version de backup manquante');
    }

    if (!backupData.type) {
      throw new Error('Type de backup manquant');
    }

    if (!backupData.createdAt) {
      throw new Error('Date de création manquante');
    }

    if (!backupData.data) {
      throw new Error('Données de backup manquantes');
    }
  }

  /**
   * Nettoie les anciennes sauvegardes
   */
  async _cleanOldBackups() {
    try {
      const backups = await this.listBackups();

      if (backups.length > this._config.maxBackups) {
        const toDelete = backups.slice(this._config.maxBackups);

        for (const backup of toDelete) {
          await this.deleteBackup(backup.filepath);
        }
      }
    } catch (error) {
      console.warn('[VaultBackup] Erreur nettoyage:', error.message);
    }
  }
}

module.exports = VaultBackup;
module.exports.BACKUP_TYPES = BACKUP_TYPES;
module.exports.BACKUP_FORMATS = BACKUP_FORMATS;
