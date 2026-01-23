'use strict';

/**
 * SHUGO v7.0 - Stockage sécurisé des clés de chiffrement
 *
 * Gère les clés AES-256-GCM avec rotation annuelle.
 *
 * @see Document Technique V7.0 - Section 5.3
 */

const crypto = require('crypto');

/**
 * Statuts des clés
 */
const KEY_STATUS = {
  ACTIVE: 'active',
  PENDING: 'pending',
  DEPRECATED: 'deprecated',
  REVOKED: 'revoked'
};

class KeyStore {
  constructor(derivedKey) {
    this._derivedKey = derivedKey;
    this._keys = new Map();
    this._activeVersion = null;
    this._initialized = false;

    // Configuration
    this._config = {
      keyLength: 32, // 256 bits
      rotationPeriodDays: 365,
      gracePeriodDays: 30,
      algorithm: 'aes-256-gcm'
    };
  }

  /**
   * Initialise le KeyStore
   */
  async initialize() {
    if (this._initialized) return;

    // En production, charger les clés depuis la base de données
    // Ici, on génère une clé initiale si aucune n'existe
    if (this._keys.size === 0) {
      await this.generateKey({ setActive: true });
    }

    this._initialized = true;
    console.log('[KeyStore] Initialisé');
  }

  /**
   * Génère une nouvelle clé
   */
  async generateKey(options = {}) {
    const { setActive = false, expiresAt = null } = options;

    const keyBuffer = crypto.randomBytes(this._config.keyLength);
    const version = this._generateVersion();

    const keyData = {
      version,
      key: keyBuffer.toString('hex'),
      status: setActive ? KEY_STATUS.ACTIVE : KEY_STATUS.PENDING,
      algorithm: this._config.algorithm,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt || this._calculateExpiry(),
      rotatedFrom: null
    };

    // Chiffrer la clé pour stockage
    const encryptedKey = this._encryptKey(keyData);

    this._keys.set(version, {
      ...keyData,
      encryptedKey
    });

    if (setActive) {
      this._activeVersion = version;
    }

    console.log(`[KeyStore] Nouvelle clé générée: ${version}`);

    return {
      version,
      status: keyData.status,
      expiresAt: keyData.expiresAt
    };
  }

  /**
   * Récupère la clé active
   */
  async getActiveKey() {
    if (!this._activeVersion) {
      throw new Error('Aucune clé active');
    }

    return this.getKey(this._activeVersion);
  }

  /**
   * Récupère une clé par version
   */
  async getKey(version) {
    const keyData = this._keys.get(version);

    if (!keyData) {
      return null;
    }

    if (keyData.status === KEY_STATUS.REVOKED) {
      throw new Error(`La clé ${version} a été révoquée`);
    }

    return {
      version: keyData.version,
      key: keyData.key,
      algorithm: keyData.algorithm,
      status: keyData.status,
      expiresAt: keyData.expiresAt
    };
  }

  /**
   * Effectue une rotation des clés
   */
  async rotateKeys() {
    const currentKey = await this.getActiveKey();

    // Générer la nouvelle clé
    const newKey = await this.generateKey({ setActive: true });

    // Marquer l'ancienne comme dépréciée
    if (currentKey) {
      const oldKeyData = this._keys.get(currentKey.version);
      if (oldKeyData) {
        oldKeyData.status = KEY_STATUS.DEPRECATED;
        oldKeyData.deprecatedAt = new Date().toISOString();
      }

      // Lier les clés
      const newKeyData = this._keys.get(newKey.version);
      if (newKeyData) {
        newKeyData.rotatedFrom = currentKey.version;
      }
    }

    console.log(`[KeyStore] Rotation effectuée: ${currentKey?.version} -> ${newKey.version}`);

    return {
      previousVersion: currentKey?.version,
      newVersion: newKey.version,
      rotatedAt: new Date().toISOString()
    };
  }

  /**
   * Révoque une clé
   */
  async revokeKey(version) {
    const keyData = this._keys.get(version);

    if (!keyData) {
      throw new Error(`Clé ${version} non trouvée`);
    }

    if (version === this._activeVersion) {
      throw new Error('Impossible de révoquer la clé active');
    }

    keyData.status = KEY_STATUS.REVOKED;
    keyData.revokedAt = new Date().toISOString();

    // Effacer la clé de la mémoire
    keyData.key = null;

    console.log(`[KeyStore] Clé révoquée: ${version}`);

    return { version, revokedAt: keyData.revokedAt };
  }

  /**
   * Vérifie si une rotation est nécessaire
   */
  async checkRotationNeeded() {
    const activeKey = await this.getActiveKey();

    if (!activeKey || !activeKey.expiresAt) {
      return { needed: true, reason: 'no_active_key' };
    }

    const expiresAt = new Date(activeKey.expiresAt);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry <= this._config.gracePeriodDays) {
      return {
        needed: true,
        reason: 'expiring_soon',
        daysUntilExpiry
      };
    }

    return {
      needed: false,
      daysUntilExpiry
    };
  }

  /**
   * Récupère l'historique des clés
   */
  async getHistory() {
    const history = [];

    for (const [version, keyData] of this._keys) {
      history.push({
        version,
        status: keyData.status,
        algorithm: keyData.algorithm,
        createdAt: keyData.createdAt,
        expiresAt: keyData.expiresAt,
        deprecatedAt: keyData.deprecatedAt,
        revokedAt: keyData.revokedAt,
        rotatedFrom: keyData.rotatedFrom,
        isActive: version === this._activeVersion
      });
    }

    return history.sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    );
  }

  /**
   * Récupère le statut du KeyStore
   */
  async getStatus() {
    const activeKey = this._activeVersion ? this._keys.get(this._activeVersion) : null;

    return {
      initialized: this._initialized,
      totalKeys: this._keys.size,
      activeVersion: this._activeVersion,
      activeKeyStatus: activeKey?.status,
      activeKeyExpiresAt: activeKey?.expiresAt,
      keysByStatus: {
        active: [...this._keys.values()].filter(k => k.status === KEY_STATUS.ACTIVE).length,
        pending: [...this._keys.values()].filter(k => k.status === KEY_STATUS.PENDING).length,
        deprecated: [...this._keys.values()].filter(k => k.status === KEY_STATUS.DEPRECATED).length,
        revoked: [...this._keys.values()].filter(k => k.status === KEY_STATUS.REVOKED).length
      }
    };
  }

  /**
   * Génère un identifiant de version unique
   */
  _generateVersion() {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString('hex');
    return `KEY-${timestamp}-${random}`.toUpperCase();
  }

  /**
   * Calcule la date d'expiration
   */
  _calculateExpiry() {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + this._config.rotationPeriodDays);
    return expiry.toISOString();
  }

  /**
   * Chiffre une clé pour stockage sécurisé
   */
  _encryptKey(keyData) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this._derivedKey, iv);

    const dataStr = JSON.stringify({
      key: keyData.key,
      version: keyData.version
    });

    const encrypted = Buffer.concat([
      cipher.update(dataStr, 'utf8'),
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
   * Déchiffre une clé stockée
   */
  _decryptKey(encryptedData) {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this._derivedKey,
      Buffer.from(encryptedData.iv, 'base64')
    );

    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedData.encrypted, 'base64')),
      decipher.final()
    ]);

    return JSON.parse(decrypted.toString('utf8'));
  }
}

module.exports = KeyStore;
module.exports.KEY_STATUS = KEY_STATUS;
