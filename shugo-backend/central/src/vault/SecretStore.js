'use strict';

/**
 * SHUGO v7.0 - Stockage des secrets partagés
 *
 * Gère les secrets partagés entre le serveur central et les serveurs locaux.
 * Chaque serveur local a son propre secret pour la communication sécurisée.
 *
 * @see Document Technique V7.0 - Section 5.4
 */

const crypto = require('crypto');

/**
 * Statuts des secrets
 */
const SECRET_STATUS = {
  ACTIVE: 'active',
  PENDING: 'pending',
  ROTATING: 'rotating',
  REVOKED: 'revoked'
};

class SecretStore {
  constructor(derivedKey) {
    this._derivedKey = derivedKey;
    this._secrets = new Map();
    this._initialized = false;

    // Configuration
    this._config = {
      secretLength: 64, // 512 bits
      rotationPeriodDays: 365,
      algorithm: 'aes-256-gcm'
    };
  }

  /**
   * Initialise le SecretStore
   */
  async initialize() {
    if (this._initialized) return;

    // En production, charger les secrets depuis la base de données
    this._initialized = true;
    console.log('[SecretStore] Initialisé');
  }

  /**
   * Génère un secret pour un serveur local
   */
  async generateSecret(localServerId) {
    if (!localServerId) {
      throw new Error('ID du serveur local requis');
    }

    // Vérifier si un secret existe déjà
    const existing = this._secrets.get(localServerId);
    if (existing && existing.status === SECRET_STATUS.ACTIVE) {
      throw new Error(`Un secret actif existe déjà pour ${localServerId}`);
    }

    const secretBuffer = crypto.randomBytes(this._config.secretLength);
    const secretId = this._generateSecretId();

    const secretData = {
      secretId,
      localServerId,
      secret: secretBuffer.toString('hex'),
      status: SECRET_STATUS.ACTIVE,
      algorithm: this._config.algorithm,
      createdAt: new Date().toISOString(),
      expiresAt: this._calculateExpiry(),
      lastUsedAt: null,
      rotatedFrom: existing?.secretId || null
    };

    // Chiffrer le secret pour stockage
    const encryptedSecret = this._encryptSecret(secretData);

    this._secrets.set(localServerId, {
      ...secretData,
      encryptedSecret
    });

    console.log(`[SecretStore] Secret généré pour: ${localServerId}`);

    return {
      secretId,
      localServerId,
      status: secretData.status,
      expiresAt: secretData.expiresAt,
      // Le secret en clair est retourné UNE SEULE FOIS pour transmission sécurisée
      secret: secretData.secret
    };
  }

  /**
   * Récupère un secret pour un serveur local
   */
  async getSecret(localServerId) {
    const secretData = this._secrets.get(localServerId);

    if (!secretData) {
      return null;
    }

    if (secretData.status === SECRET_STATUS.REVOKED) {
      throw new Error(`Le secret pour ${localServerId} a été révoqué`);
    }

    // Mettre à jour la dernière utilisation
    secretData.lastUsedAt = new Date().toISOString();

    return {
      secretId: secretData.secretId,
      localServerId: secretData.localServerId,
      secret: secretData.secret,
      status: secretData.status,
      expiresAt: secretData.expiresAt
    };
  }

  /**
   * Effectue une rotation du secret
   */
  async rotateSecret(localServerId) {
    const currentSecret = this._secrets.get(localServerId);

    if (!currentSecret) {
      throw new Error(`Aucun secret trouvé pour ${localServerId}`);
    }

    // Marquer l'ancien secret comme en rotation
    currentSecret.status = SECRET_STATUS.ROTATING;

    // Générer le nouveau secret
    // Note: Pour permettre la transition, on garde temporairement l'ancien
    const oldSecret = { ...currentSecret };

    // Supprimer l'ancien pour permettre la génération
    this._secrets.delete(localServerId);

    const newSecret = await this.generateSecret(localServerId);

    // Stocker l'ancien secret temporairement pour la période de transition
    this._secrets.set(`${localServerId}_previous`, oldSecret);

    console.log(`[SecretStore] Rotation effectuée pour: ${localServerId}`);

    return {
      localServerId,
      previousSecretId: oldSecret.secretId,
      newSecretId: newSecret.secretId,
      rotatedAt: new Date().toISOString(),
      newSecret: newSecret.secret // Retourné pour transmission
    };
  }

  /**
   * Valide un secret (pour authentification serveur local)
   */
  async validateSecret(localServerId, providedSecret) {
    const secretData = this._secrets.get(localServerId);

    if (!secretData) {
      // Vérifier aussi l'ancien secret pendant la période de transition
      const previousSecret = this._secrets.get(`${localServerId}_previous`);
      if (previousSecret && previousSecret.secret === providedSecret) {
        return {
          valid: true,
          isPrevious: true,
          message: 'Utilise l\'ancien secret - mise à jour recommandée'
        };
      }
      return { valid: false, reason: 'secret_not_found' };
    }

    if (secretData.status === SECRET_STATUS.REVOKED) {
      return { valid: false, reason: 'secret_revoked' };
    }

    // Comparaison en temps constant pour éviter les timing attacks
    const providedBuffer = Buffer.from(providedSecret, 'hex');
    const storedBuffer = Buffer.from(secretData.secret, 'hex');

    if (providedBuffer.length !== storedBuffer.length) {
      return { valid: false, reason: 'invalid_secret' };
    }

    const isValid = crypto.timingSafeEqual(providedBuffer, storedBuffer);

    if (isValid) {
      secretData.lastUsedAt = new Date().toISOString();
    }

    return {
      valid: isValid,
      reason: isValid ? null : 'invalid_secret'
    };
  }

  /**
   * Révoque un secret
   */
  async revokeSecret(localServerId) {
    const secretData = this._secrets.get(localServerId);

    if (!secretData) {
      throw new Error(`Aucun secret trouvé pour ${localServerId}`);
    }

    secretData.status = SECRET_STATUS.REVOKED;
    secretData.revokedAt = new Date().toISOString();

    // Effacer le secret de la mémoire
    secretData.secret = null;

    // Supprimer aussi l'ancien secret s'il existe
    this._secrets.delete(`${localServerId}_previous`);

    console.log(`[SecretStore] Secret révoqué pour: ${localServerId}`);

    return {
      localServerId,
      secretId: secretData.secretId,
      revokedAt: secretData.revokedAt
    };
  }

  /**
   * Liste tous les secrets (sans les valeurs)
   */
  async listSecrets() {
    const secrets = [];

    for (const [localServerId, data] of this._secrets) {
      // Ignorer les secrets "previous" temporaires
      if (localServerId.endsWith('_previous')) continue;

      secrets.push({
        localServerId,
        secretId: data.secretId,
        status: data.status,
        createdAt: data.createdAt,
        expiresAt: data.expiresAt,
        lastUsedAt: data.lastUsedAt,
        revokedAt: data.revokedAt
      });
    }

    return secrets;
  }

  /**
   * Vérifie les secrets expirant bientôt
   */
  async checkExpirations(daysThreshold = 30) {
    const expiring = [];
    const now = new Date();
    const thresholdDate = new Date(now.getTime() + daysThreshold * 24 * 60 * 60 * 1000);

    for (const [localServerId, data] of this._secrets) {
      if (localServerId.endsWith('_previous')) continue;
      if (data.status !== SECRET_STATUS.ACTIVE) continue;

      const expiresAt = new Date(data.expiresAt);
      if (expiresAt <= thresholdDate) {
        expiring.push({
          localServerId,
          secretId: data.secretId,
          expiresAt: data.expiresAt,
          daysUntilExpiry: Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24))
        });
      }
    }

    return expiring;
  }

  /**
   * Récupère le statut du SecretStore
   */
  async getStatus() {
    const secrets = await this.listSecrets();

    return {
      initialized: this._initialized,
      totalSecrets: secrets.length,
      secretsByStatus: {
        active: secrets.filter(s => s.status === SECRET_STATUS.ACTIVE).length,
        pending: secrets.filter(s => s.status === SECRET_STATUS.PENDING).length,
        rotating: secrets.filter(s => s.status === SECRET_STATUS.ROTATING).length,
        revoked: secrets.filter(s => s.status === SECRET_STATUS.REVOKED).length
      }
    };
  }

  /**
   * Génère un identifiant de secret unique
   */
  _generateSecretId() {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString('hex');
    return `SEC-${timestamp}-${random}`.toUpperCase();
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
   * Chiffre un secret pour stockage sécurisé
   */
  _encryptSecret(secretData) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this._derivedKey, iv);

    const dataStr = JSON.stringify({
      secret: secretData.secret,
      secretId: secretData.secretId,
      localServerId: secretData.localServerId
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
   * Déchiffre un secret stocké
   */
  _decryptSecret(encryptedData) {
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

module.exports = SecretStore;
module.exports.SECRET_STATUS = SECRET_STATUS;
