'use strict';

/**
 * SHUGO v7.0 - Gestionnaire principal du Vault Central
 *
 * Le Vault est le coffre-fort cryptographique central qui gère:
 * - Les clés de chiffrement AES-256-GCM
 * - Les secrets partagés avec les serveurs locaux
 * - Les données sensibles chiffrées
 *
 * @see Document Technique V7.0 - Chapitre 5
 */

const crypto = require('crypto');
const EventEmitter = require('events');
const KeyStore = require('./KeyStore');
const SecretStore = require('./SecretStore');
const config = require('../config');

/**
 * États du Vault
 */
const VAULT_STATES = {
  SEALED: 'sealed',
  UNSEALED: 'unsealed',
  LOCKED: 'locked',
  MAINTENANCE: 'maintenance'
};

/**
 * Types d'éléments stockés
 */
const ITEM_TYPES = {
  KEY: 'key',
  SECRET: 'secret',
  CREDENTIAL: 'credential',
  CERTIFICATE: 'certificate',
  DATA: 'data'
};

class VaultManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this._masterKey = null;
    this._state = VAULT_STATES.SEALED;
    this._keyStore = null;
    this._secretStore = null;
    this._accessLog = [];
    this._lastAccess = null;

    // Configuration
    this._config = {
      masterKeyEnvVar: 'VAULT_MASTER_KEY',
      algorithm: 'aes-256-gcm',
      keyLength: 32,
      ivLength: 16,
      authTagLength: 16,
      accessTimeout: 300000, // 5 minutes
      maxConcurrentAccess: 10,
      ...options
    };

    // Compteur d'accès simultanés
    this._activeAccessCount = 0;
  }

  /**
   * Initialise le Vault
   */
  async initialize(masterKey = null) {
    if (this._state === VAULT_STATES.UNSEALED) {
      throw new VaultError('ALREADY_INITIALIZED', 'Le Vault est déjà initialisé');
    }

    // Récupérer la clé maître
    this._masterKey = masterKey || process.env[this._config.masterKeyEnvVar];

    if (!this._masterKey) {
      throw new VaultError('MISSING_MASTER_KEY', 'Clé maître du Vault non définie');
    }

    // Valider la clé maître
    if (this._masterKey.length < 32) {
      throw new VaultError('INVALID_MASTER_KEY', 'La clé maître doit faire au moins 32 caractères');
    }

    // Dériver la clé de chiffrement
    this._derivedKey = this._deriveKey(this._masterKey);

    // Initialiser les stores
    this._keyStore = new KeyStore(this._derivedKey);
    this._secretStore = new SecretStore(this._derivedKey);

    await this._keyStore.initialize();
    await this._secretStore.initialize();

    this._state = VAULT_STATES.UNSEALED;
    this._lastAccess = Date.now();

    this.emit('unsealed');
    console.log('[VaultManager] Vault initialisé et déverrouillé');

    return { state: this._state };
  }

  /**
   * Scelle le Vault (efface les clés de la mémoire)
   */
  async seal() {
    if (this._state === VAULT_STATES.SEALED) {
      return { state: this._state };
    }

    if (this._activeAccessCount > 0) {
      throw new VaultError('ACTIVE_ACCESS', 'Des accès sont encore en cours');
    }

    // Effacer les clés de la mémoire de manière sécurisée
    if (this._derivedKey) {
      crypto.randomFillSync(this._derivedKey);
      this._derivedKey = null;
    }

    this._masterKey = null;
    this._keyStore = null;
    this._secretStore = null;
    this._state = VAULT_STATES.SEALED;

    this.emit('sealed');
    console.log('[VaultManager] Vault scellé');

    return { state: this._state };
  }

  /**
   * Vérifie que le Vault est déverrouillé
   */
  _ensureUnsealed() {
    if (this._state !== VAULT_STATES.UNSEALED) {
      throw new VaultError('VAULT_SEALED', 'Le Vault est scellé');
    }
  }

  /**
   * Acquiert un accès au Vault
   */
  async _acquireAccess() {
    this._ensureUnsealed();

    if (this._activeAccessCount >= this._config.maxConcurrentAccess) {
      throw new VaultError('MAX_ACCESS_REACHED', 'Nombre maximal d\'accès simultanés atteint');
    }

    this._activeAccessCount++;
    this._lastAccess = Date.now();

    return () => {
      this._activeAccessCount--;
    };
  }

  /**
   * Dérive une clé à partir de la clé maître
   */
  _deriveKey(masterKey) {
    return crypto.pbkdf2Sync(
      masterKey,
      'shugo-vault-salt',
      100000,
      this._config.keyLength,
      'sha512'
    );
  }

  // =========================================
  // GESTION DES CLÉS
  // =========================================

  /**
   * Récupère la clé de chiffrement active
   */
  async getActiveKey() {
    const release = await this._acquireAccess();
    try {
      return await this._keyStore.getActiveKey();
    } finally {
      release();
    }
  }

  /**
   * Génère une nouvelle clé de chiffrement
   */
  async generateKey(options = {}) {
    const release = await this._acquireAccess();
    try {
      return await this._keyStore.generateKey(options);
    } finally {
      release();
    }
  }

  /**
   * Effectue une rotation des clés
   */
  async rotateKeys() {
    const release = await this._acquireAccess();
    try {
      const result = await this._keyStore.rotateKeys();
      this.emit('keyRotated', result);
      return result;
    } finally {
      release();
    }
  }

  /**
   * Récupère l'historique des clés
   */
  async getKeyHistory() {
    const release = await this._acquireAccess();
    try {
      return await this._keyStore.getHistory();
    } finally {
      release();
    }
  }

  // =========================================
  // GESTION DES SECRETS PARTAGÉS
  // =========================================

  /**
   * Génère un secret partagé pour un serveur local
   */
  async generateSharedSecret(localServerId) {
    const release = await this._acquireAccess();
    try {
      return await this._secretStore.generateSecret(localServerId);
    } finally {
      release();
    }
  }

  /**
   * Récupère un secret partagé
   */
  async getSharedSecret(localServerId) {
    const release = await this._acquireAccess();
    try {
      return await this._secretStore.getSecret(localServerId);
    } finally {
      release();
    }
  }

  /**
   * Effectue une rotation des secrets
   */
  async rotateSecret(localServerId) {
    const release = await this._acquireAccess();
    try {
      return await this._secretStore.rotateSecret(localServerId);
    } finally {
      release();
    }
  }

  /**
   * Révoque un secret partagé
   */
  async revokeSecret(localServerId) {
    const release = await this._acquireAccess();
    try {
      return await this._secretStore.revokeSecret(localServerId);
    } finally {
      release();
    }
  }

  // =========================================
  // CHIFFREMENT / DÉCHIFFREMENT
  // =========================================

  /**
   * Chiffre des données
   */
  async encrypt(data, keyVersion = null) {
    const release = await this._acquireAccess();
    try {
      const key = keyVersion
        ? await this._keyStore.getKey(keyVersion)
        : await this._keyStore.getActiveKey();

      if (!key) {
        throw new VaultError('KEY_NOT_FOUND', 'Clé de chiffrement non trouvée');
      }

      const iv = crypto.randomBytes(this._config.ivLength);
      const cipher = crypto.createCipheriv(
        this._config.algorithm,
        Buffer.from(key.key, 'hex'),
        iv
      );

      const dataBuffer = Buffer.from(JSON.stringify(data), 'utf8');
      const encrypted = Buffer.concat([
        cipher.update(dataBuffer),
        cipher.final()
      ]);

      const authTag = cipher.getAuthTag();

      return {
        encrypted: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        keyVersion: key.version
      };
    } finally {
      release();
    }
  }

  /**
   * Déchiffre des données
   */
  async decrypt(encryptedData) {
    const release = await this._acquireAccess();
    try {
      const { encrypted, iv, authTag, keyVersion } = encryptedData;

      const key = await this._keyStore.getKey(keyVersion);
      if (!key) {
        throw new VaultError('KEY_NOT_FOUND', `Clé version ${keyVersion} non trouvée`);
      }

      const decipher = crypto.createDecipheriv(
        this._config.algorithm,
        Buffer.from(key.key, 'hex'),
        Buffer.from(iv, 'base64')
      );

      decipher.setAuthTag(Buffer.from(authTag, 'base64'));

      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64')),
        decipher.final()
      ]);

      return JSON.parse(decrypted.toString('utf8'));
    } finally {
      release();
    }
  }

  /**
   * Rechiffre des données avec la clé active
   */
  async reencrypt(encryptedData) {
    const data = await this.decrypt(encryptedData);
    return await this.encrypt(data);
  }

  // =========================================
  // STOCKAGE SÉCURISÉ
  // =========================================

  /**
   * Stocke un élément dans le Vault
   */
  async store(itemId, data, type = ITEM_TYPES.DATA, metadata = {}) {
    const release = await this._acquireAccess();
    try {
      const encrypted = await this.encrypt(data);

      return {
        itemId,
        type,
        metadata,
        encrypted,
        storedAt: new Date().toISOString()
      };
    } finally {
      release();
    }
  }

  /**
   * Récupère un élément du Vault
   */
  async retrieve(storedItem) {
    const release = await this._acquireAccess();
    try {
      return await this.decrypt(storedItem.encrypted);
    } finally {
      release();
    }
  }

  // =========================================
  // STATUT ET ADMINISTRATION
  // =========================================

  /**
   * Récupère le statut du Vault
   */
  getStatus() {
    return {
      state: this._state,
      isUnsealed: this._state === VAULT_STATES.UNSEALED,
      activeAccessCount: this._activeAccessCount,
      lastAccess: this._lastAccess,
      keyStoreReady: !!this._keyStore,
      secretStoreReady: !!this._secretStore
    };
  }

  /**
   * Vérifie la santé du Vault
   */
  async healthCheck() {
    const status = this.getStatus();

    if (this._state !== VAULT_STATES.UNSEALED) {
      return {
        healthy: false,
        status,
        error: 'Vault is sealed'
      };
    }

    try {
      // Tester le chiffrement/déchiffrement
      const testData = { test: 'data', timestamp: Date.now() };
      const encrypted = await this.encrypt(testData);
      const decrypted = await this.decrypt(encrypted);

      if (JSON.stringify(testData) !== JSON.stringify(decrypted)) {
        return {
          healthy: false,
          status,
          error: 'Encryption/decryption test failed'
        };
      }

      return {
        healthy: true,
        status,
        keyStore: await this._keyStore.getStatus(),
        secretStore: await this._secretStore.getStatus()
      };
    } catch (error) {
      return {
        healthy: false,
        status,
        error: error.message
      };
    }
  }

  /**
   * Met le Vault en mode maintenance
   */
  async enterMaintenance() {
    if (this._activeAccessCount > 0) {
      throw new VaultError('ACTIVE_ACCESS', 'Des accès sont encore en cours');
    }

    this._state = VAULT_STATES.MAINTENANCE;
    this.emit('maintenance', true);

    return { state: this._state };
  }

  /**
   * Sort du mode maintenance
   */
  async exitMaintenance() {
    if (this._state !== VAULT_STATES.MAINTENANCE) {
      throw new VaultError('NOT_IN_MAINTENANCE', 'Le Vault n\'est pas en maintenance');
    }

    if (this._derivedKey) {
      this._state = VAULT_STATES.UNSEALED;
    } else {
      this._state = VAULT_STATES.SEALED;
    }

    this.emit('maintenance', false);

    return { state: this._state };
  }
}

/**
 * Classe d'erreur pour le Vault
 */
class VaultError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

module.exports = VaultManager;
module.exports.VaultError = VaultError;
module.exports.VAULT_STATES = VAULT_STATES;
module.exports.ITEM_TYPES = ITEM_TYPES;
