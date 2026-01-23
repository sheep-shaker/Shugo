'use strict';

/**
 * Service SecretRotationService - Rotation des secrets partagés
 *
 * Gère les secrets cryptographiques partagés entre serveur central et locaux.
 * Rotation annuelle + rotation d'urgence.
 *
 * @see Document Technique V7.0 - Section 5.5
 */

const { Op } = require('sequelize');
const crypto = require('../utils/crypto');
const config = require('../config');

/**
 * Types de secrets
 */
const SECRET_TYPES = {
  LOCAL_CENTRAL: 'local_central',
  EMERGENCY: 'emergency',
  BACKUP: 'backup',
  SYNC: 'sync'
};

/**
 * Raisons de rotation
 */
const ROTATION_REASONS = {
  INITIAL: 'initial',
  SCHEDULED: 'scheduled',
  MANUAL: 'manual',
  COMPROMISE: 'compromise',
  SERVER_REGISTRATION: 'server_registration'
};

class SecretRotationService {
  constructor(models, sequelize, services = {}) {
    this.models = models;
    this.sequelize = sequelize;
    this.SharedSecret = models.SharedSecret;
    this.LocalInstance = models.LocalInstance;
    this.SecurityProtocolLog = models.SecurityProtocolLog;
    this.notificationService = services.notification;

    // Clé maître pour chiffrer les secrets
    this._masterKey = config.security?.vaultMasterKey
      ? Buffer.from(config.security.vaultMasterKey, 'hex')
      : null;
  }

  /**
   * Initialise le service
   * @returns {Promise<Object>}
   */
  async initialize() {
    console.log('[SecretRotation] Initialisation...');

    // Vérifier les secrets globaux
    for (const secretType of [SECRET_TYPES.EMERGENCY, SECRET_TYPES.BACKUP]) {
      const active = await this.getActiveSecret(secretType);
      if (!active) {
        console.log(`[SecretRotation] Génération secret initial: ${secretType}`);
        await this.generateSecret(secretType, null, ROTATION_REASONS.INITIAL);
      }
    }

    // Vérifier les expirations
    const warnings = await this.checkExpirations();

    return {
      initialized: true,
      secretTypes: Object.values(SECRET_TYPES),
      warnings
    };
  }

  /**
   * Génère un nouveau secret
   * @param {string} secretType - Type de secret
   * @param {string} localServerId - ID du serveur local (null pour global)
   * @param {string} reason - Raison de création
   * @returns {Promise<Object>}
   */
  async generateSecret(secretType, localServerId = null, reason = ROTATION_REASONS.MANUAL) {
    if (!this._masterKey) {
      throw new SecretRotationError('MASTER_KEY_MISSING', 'Clé maître non configurée');
    }

    console.log(`[SecretRotation] Génération ${secretType} pour ${localServerId || 'global'}`);

    // Générer le secret (32 bytes = 256 bits)
    const secretValue = crypto.randomBytes(32);
    const secretHash = crypto.sha256(secretValue);

    // Chiffrer avec la clé maître
    const encryptedSecret = crypto.encryptToBuffer(secretValue, this._masterKey);

    // Date d'expiration (1 an)
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const secret = await this.SharedSecret.create({
      secret_type: secretType,
      secret_encrypted: encryptedSecret,
      secret_hash: secretHash,
      is_active: false,
      expires_at: expiresAt,
      local_server_id: localServerId,
      rotation_reason: reason,
      validation_status: 'pending'
    });

    await this._logSecurityEvent('secret_generated', null, {
      secretType,
      localServerId,
      reason,
      secretId: secret.secret_id
    });

    return {
      secretId: secret.secret_id,
      secretType,
      localServerId,
      // Retourner le secret en clair pour transmission sécurisée
      secretValue: secretValue.toString('hex'),
      expiresAt,
      status: 'pending'
    };
  }

  /**
   * Active un secret
   * @param {string} secretId
   * @param {number} activatedBy
   * @returns {Promise<Object>}
   */
  async activateSecret(secretId, activatedBy) {
    console.log(`[SecretRotation] Activation secret ${secretId}`);

    return this.sequelize.transaction(async (t) => {
      const secret = await this.SharedSecret.findByPk(secretId, { transaction: t });
      if (!secret) {
        throw new SecretRotationError('SECRET_NOT_FOUND', 'Secret non trouvé');
      }

      // Désactiver les anciens secrets du même type/serveur
      await this.SharedSecret.update(
        { is_active: false },
        {
          where: {
            secret_type: secret.secret_type,
            local_server_id: secret.local_server_id,
            is_active: true
          },
          transaction: t
        }
      );

      // Activer le nouveau
      await secret.update({
        is_active: true,
        activated_at: new Date(),
        validation_status: 'validated'
      }, { transaction: t });

      await this._logSecurityEvent('secret_activated', activatedBy, {
        secretId,
        secretType: secret.secret_type,
        localServerId: secret.local_server_id
      }, t);

      return {
        secretId,
        secretType: secret.secret_type,
        activatedAt: secret.activated_at,
        status: 'active'
      };
    });
  }

  /**
   * Effectue la rotation d'un secret
   * @param {string} secretType
   * @param {string} localServerId
   * @param {number} rotatedBy
   * @param {string} reason
   * @returns {Promise<Object>}
   */
  async rotateSecret(secretType, localServerId = null, rotatedBy = null, reason = ROTATION_REASONS.MANUAL) {
    console.log(`[SecretRotation] Rotation ${secretType} pour ${localServerId || 'global'}`);

    return this.sequelize.transaction(async (t) => {
      // 1. Récupérer le secret actuel
      const currentSecret = await this.SharedSecret.findOne({
        where: {
          secret_type: secretType,
          local_server_id: localServerId,
          is_active: true
        },
        transaction: t
      });

      // 2. Générer le nouveau secret
      const secretValue = crypto.randomBytes(32);
      const secretHash = crypto.sha256(secretValue);
      const encryptedSecret = crypto.encryptToBuffer(secretValue, this._masterKey);

      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);

      // 3. Créer le nouveau secret
      const newSecret = await this.SharedSecret.create({
        secret_type: secretType,
        secret_encrypted: encryptedSecret,
        secret_hash: secretHash,
        is_active: true,
        activated_at: new Date(),
        expires_at: expiresAt,
        local_server_id: localServerId,
        previous_secret_id: currentSecret?.secret_id,
        rotation_reason: reason,
        rotated_by: rotatedBy,
        validation_status: 'validated'
      }, { transaction: t });

      // 4. Désactiver l'ancien
      if (currentSecret) {
        await currentSecret.update({ is_active: false }, { transaction: t });
      }

      // 5. Logger
      await this._logSecurityEvent('secret_rotation', rotatedBy, {
        secretType,
        localServerId,
        oldSecretId: currentSecret?.secret_id,
        newSecretId: newSecret.secret_id,
        reason
      }, t);

      // 6. Notifier si rotation d'urgence
      if (reason === ROTATION_REASONS.COMPROMISE) {
        await this._notifyAdmins('secret_rotation_emergency', {
          secretType,
          localServerId,
          reason
        });
      }

      return {
        secretId: newSecret.secret_id,
        secretType,
        localServerId,
        secretValue: secretValue.toString('hex'),
        previousSecretId: currentSecret?.secret_id,
        expiresAt,
        status: 'active'
      };
    });
  }

  /**
   * Récupère le secret actif
   * @param {string} secretType
   * @param {string} localServerId
   * @returns {Promise<Object|null>}
   */
  async getActiveSecret(secretType, localServerId = null) {
    return this.SharedSecret.findOne({
      where: {
        secret_type: secretType,
        local_server_id: localServerId,
        is_active: true
      }
    });
  }

  /**
   * Déchiffre un secret
   * @param {Object} secretRecord
   * @returns {Buffer}
   */
  decryptSecret(secretRecord) {
    if (!this._masterKey) {
      throw new SecretRotationError('MASTER_KEY_MISSING', 'Clé maître non configurée');
    }
    return crypto.decryptFromBuffer(secretRecord.secret_encrypted, this._masterKey);
  }

  /**
   * Valide un secret partagé (handshake central/local)
   * @param {string} secretType
   * @param {Buffer|string} secretValue
   * @param {string} localServerId
   * @returns {Promise<boolean>}
   */
  async validateSecret(secretType, secretValue, localServerId = null) {
    const secret = await this.getActiveSecret(secretType, localServerId);
    if (!secret) return false;

    const valueBuffer = Buffer.isBuffer(secretValue)
      ? secretValue
      : Buffer.from(secretValue, 'hex');

    const hash = crypto.sha256(valueBuffer);
    const isValid = crypto.timingSafeEqual(hash, secret.secret_hash);

    // Mettre à jour les stats
    if (isValid) {
      await secret.update({
        access_count: (secret.access_count || 0) + 1,
        last_used_at: new Date(),
        last_validated_at: new Date()
      });
    }

    return isValid;
  }

  /**
   * Enregistre un nouveau serveur local avec ses secrets
   * @param {string} localServerId
   * @param {string} geoId
   * @returns {Promise<Object>}
   */
  async registerLocalServer(localServerId, geoId) {
    console.log(`[SecretRotation] Enregistrement serveur local ${localServerId}`);

    const secrets = {};

    // Générer les secrets pour ce serveur
    for (const secretType of [SECRET_TYPES.LOCAL_CENTRAL, SECRET_TYPES.SYNC]) {
      const result = await this.generateSecret(
        secretType,
        localServerId,
        ROTATION_REASONS.SERVER_REGISTRATION
      );
      await this.activateSecret(result.secretId, null);
      secrets[secretType] = result.secretValue;
    }

    await this._logSecurityEvent('local_server_registered', null, {
      localServerId,
      geoId,
      secretTypes: Object.keys(secrets)
    });

    return {
      localServerId,
      geoId,
      secrets,
      message: 'Secrets générés. Transmettre de manière sécurisée au serveur local.'
    };
  }

  /**
   * Vérifie les secrets expirés ou bientôt expirés
   * @returns {Promise<Object[]>}
   */
  async checkExpirations() {
    const warnings = [];
    const now = new Date();
    const warningDays = config.security?.secretRotation?.warningDays || 30;
    const warningDate = new Date(now.getTime() + warningDays * 24 * 60 * 60 * 1000);

    const expiringSecrets = await this.SharedSecret.findAll({
      where: {
        is_active: true,
        expires_at: { [Op.lte]: warningDate }
      }
    });

    for (const secret of expiringSecrets) {
      const daysRemaining = Math.ceil((secret.expires_at - now) / (1000 * 60 * 60 * 24));

      warnings.push({
        secretId: secret.secret_id,
        secretType: secret.secret_type,
        localServerId: secret.local_server_id,
        expiresAt: secret.expires_at,
        daysRemaining,
        isExpired: daysRemaining <= 0,
        severity: daysRemaining <= 0 ? 'critical' : daysRemaining <= 7 ? 'high' : 'medium'
      });
    }

    return warnings;
  }

  /**
   * Rotation d'urgence de tous les secrets d'un serveur local
   * @param {string} localServerId
   * @param {number} rotatedBy
   * @returns {Promise<Object[]>}
   */
  async rotateAllServerSecrets(localServerId, rotatedBy) {
    console.log(`[SecretRotation] Rotation d'urgence pour serveur ${localServerId}`);

    const results = [];

    for (const secretType of [SECRET_TYPES.LOCAL_CENTRAL, SECRET_TYPES.SYNC]) {
      try {
        const result = await this.rotateSecret(
          secretType,
          localServerId,
          rotatedBy,
          ROTATION_REASONS.COMPROMISE
        );
        results.push({ ...result, success: true });
      } catch (error) {
        results.push({
          secretType,
          localServerId,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Statut complet du service
   * @returns {Promise<Object>}
   */
  async getStatus() {
    const secrets = await this.SharedSecret.findAll({
      where: { is_active: true },
      attributes: [
        'secret_id', 'secret_type', 'local_server_id',
        'activated_at', 'expires_at', 'access_count', 'last_used_at'
      ]
    });

    const warnings = await this.checkExpirations();

    return {
      initialized: true,
      activeSecrets: secrets.map(s => ({
        id: s.secret_id,
        type: s.secret_type,
        localServerId: s.local_server_id,
        activatedAt: s.activated_at,
        expiresAt: s.expires_at,
        accessCount: s.access_count,
        lastUsedAt: s.last_used_at,
        daysRemaining: Math.ceil((s.expires_at - new Date()) / (1000 * 60 * 60 * 24))
      })),
      warnings,
      totalActive: secrets.length
    };
  }

  /**
   * Log un événement de sécurité
   * @private
   */
  async _logSecurityEvent(eventName, memberId, details, transaction = null) {
    if (!this.SecurityProtocolLog) return;

    try {
      await this.SecurityProtocolLog.create({
        protocol_name: eventName,
        triggered_by: memberId ? 'manual' : 'automatic',
        member_id: memberId,
        scope: 'central',
        reason: JSON.stringify(details),
        actions_taken: [details],
        result: 'success',
        started_at: new Date(),
        completed_at: new Date(),
        severity: eventName.includes('emergency') || eventName.includes('compromise') ? 'critical' : 'medium'
      }, { transaction });
    } catch (err) {
      console.error('[SecretRotation] Erreur log:', err.message);
    }
  }

  /**
   * Notifie les admins
   * @private
   */
  async _notifyAdmins(type, data) {
    if (!this.notificationService || !this.models.User) return;

    try {
      const admins = await this.models.User.findAll({
        where: { role: { [Op.in]: ['Admin', 'Admin_N1'] }, status: 'active' }
      });

      for (const admin of admins) {
        await this.notificationService.send(admin.member_id, type, data, {
          priority: 'urgent',
          immediate: true
        });
      }
    } catch (err) {
      console.error('[SecretRotation] Erreur notification:', err.message);
    }
  }
}

/**
 * Classe d'erreur
 */
class SecretRotationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SecretRotationError';
    this.code = code;
  }
}

module.exports = SecretRotationService;
module.exports.SecretRotationError = SecretRotationError;
module.exports.SECRET_TYPES = SECRET_TYPES;
module.exports.ROTATION_REASONS = ROTATION_REASONS;
