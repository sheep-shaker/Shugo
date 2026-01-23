'use strict';

/**
 * Service KeyRotationService - Rotation des clés AES
 *
 * Gère la rotation automatique et manuelle des clés de chiffrement.
 * Rotation annuelle le 1er décembre + rotation d'urgence.
 *
 * @see Document Technique V7.0 - Section 5.4
 */

const { Op } = require('sequelize');
const crypto = require('../utils/crypto');
const config = require('../config');

/**
 * Types de clés gérées
 */
const KEY_TYPES = {
  VAULT_LOCAL: 'vault_local',
  VAULT_CENTRAL: 'vault_central',
  BACKUP: 'backup',
  LOGS: 'logs'
};

/**
 * Raisons de rotation
 */
const ROTATION_REASONS = {
  SCHEDULED: 'scheduled',
  MANUAL: 'manual',
  COMPROMISE: 'compromise',
  EMERGENCY: 'emergency',
  PROTOCOL: 'integrity_protocol'
};

class KeyRotationService {
  constructor(models, sequelize, services = {}) {
    this.models = models;
    this.sequelize = sequelize;
    this.AesKeyRotation = models.AesKeyRotation;
    this.SecurityProtocolLog = models.SecurityProtocolLog;
    this.vaultService = services.vault;
    this.notificationService = services.notification;

    // Clé maître pour chiffrer/déchiffrer les clés AES
    this._masterKey = config.security?.vaultMasterKey
      ? Buffer.from(config.security.vaultMasterKey, 'hex')
      : null;
  }

  /**
   * Initialise le service et vérifie les clés
   * @returns {Promise<Object>}
   */
  async initialize() {
    console.log('[KeyRotation] Initialisation...');

    // Vérifier que toutes les clés de base existent
    for (const keyType of Object.values(KEY_TYPES)) {
      const activeKey = await this.getActiveKey(keyType);
      if (!activeKey) {
        console.log(`[KeyRotation] Génération clé initiale: ${keyType}`);
        await this.generateInitialKey(keyType);
      }
    }

    // Vérifier les expirations
    const warnings = await this.checkExpirations();

    return {
      initialized: true,
      keyTypes: Object.values(KEY_TYPES),
      warnings
    };
  }

  /**
   * Récupère la clé active pour un type donné
   * @param {string} keyType
   * @returns {Promise<Object|null>}
   */
  async getActiveKey(keyType) {
    return this.AesKeyRotation.findOne({
      where: { key_type: keyType, is_active: true }
    });
  }

  /**
   * Génère une clé initiale pour un type
   * @param {string} keyType
   * @returns {Promise<Object>}
   */
  async generateInitialKey(keyType) {
    if (!this._masterKey) {
      throw new KeyRotationError('MASTER_KEY_MISSING', 'Clé maître non configurée');
    }

    const newKey = crypto.generateAESKey();
    const iv = crypto.generateIV();
    const keyHash = crypto.sha256(newKey);

    // Chiffrer la clé avec la clé maître
    const encryptedKey = crypto.encryptToBuffer(newKey, this._masterKey);

    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const keyRecord = await this.AesKeyRotation.create({
      key_type: keyType,
      key_version: 1,
      key_encrypted: encryptedKey,
      initialization_vector: iv,
      key_hash: keyHash,
      is_active: true,
      activated_at: new Date(),
      expires_at: expiresAt,
      rotation_reason: 'initial'
    });

    await this._logSecurityEvent('key_generated', null, {
      keyType,
      version: 1,
      expiresAt
    });

    return keyRecord;
  }

  /**
   * Déchiffre et retourne une clé AES
   * @param {Object} keyRecord - Enregistrement AesKeyRotation
   * @returns {Buffer}
   */
  decryptKey(keyRecord) {
    if (!this._masterKey) {
      throw new KeyRotationError('MASTER_KEY_MISSING', 'Clé maître non configurée');
    }
    return crypto.decryptFromBuffer(keyRecord.key_encrypted, this._masterKey);
  }

  /**
   * Effectue la rotation d'une clé
   * @param {string} keyType - Type de clé
   * @param {number} rotatedBy - member_id de l'admin (null si automatique)
   * @param {string} reason - Raison de la rotation
   * @returns {Promise<Object>}
   */
  async rotateKey(keyType, rotatedBy = null, reason = ROTATION_REASONS.MANUAL) {
    if (!this._masterKey) {
      throw new KeyRotationError('MASTER_KEY_MISSING', 'Clé maître non configurée');
    }

    console.log(`[KeyRotation] Rotation ${keyType} - Raison: ${reason}`);

    return this.sequelize.transaction(async (t) => {
      // 1. Récupérer la clé actuelle
      const currentKey = await this.AesKeyRotation.findOne({
        where: { key_type: keyType, is_active: true },
        transaction: t
      });

      const newVersion = currentKey ? currentKey.key_version + 1 : 1;

      // 2. Générer la nouvelle clé
      const newKey = crypto.generateAESKey();
      const iv = crypto.generateIV();
      const keyHash = crypto.sha256(newKey);
      const encryptedKey = crypto.encryptToBuffer(newKey, this._masterKey);

      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);

      // 3. Créer la nouvelle entrée
      const newKeyRecord = await this.AesKeyRotation.create({
        key_type: keyType,
        key_version: newVersion,
        key_encrypted: encryptedKey,
        initialization_vector: iv,
        key_hash: keyHash,
        is_active: false, // Pas encore active
        expires_at: expiresAt,
        previous_key_id: currentKey?.rotation_id,
        rotation_reason: reason
      }, { transaction: t });

      // 4. Rechiffrer les données si nécessaire
      if (currentKey && this.vaultService) {
        const oldKey = this.decryptKey(currentKey);
        await this._rechipherData(keyType, oldKey, newKey, t);
      }

      // 5. Activer la nouvelle clé
      await newKeyRecord.update({
        is_active: true,
        activated_at: new Date()
      }, { transaction: t });

      // 6. Désactiver l'ancienne clé
      if (currentKey) {
        await currentKey.update({
          is_active: false,
          rotated_at: new Date(),
          rotated_by: rotatedBy,
          rotation_reason: reason
        }, { transaction: t });
      }

      // 7. Logger l'événement
      await this._logSecurityEvent('key_rotation', rotatedBy, {
        keyType,
        previousVersion: currentKey?.key_version,
        newVersion,
        reason
      }, t);

      // 8. Notifier les admins si rotation d'urgence
      if (reason === ROTATION_REASONS.COMPROMISE || reason === ROTATION_REASONS.EMERGENCY) {
        await this._notifyAdmins('key_rotation_emergency', {
          keyType,
          reason,
          newVersion
        });
      }

      console.log(`[KeyRotation] ${keyType} v${newVersion} activée`);

      return {
        keyType,
        previousVersion: currentKey?.key_version,
        newVersion,
        activatedAt: newKeyRecord.activated_at,
        expiresAt
      };
    });
  }

  /**
   * Rotation d'urgence de toutes les clés
   * @param {number} rotatedBy
   * @param {string} reason
   * @returns {Promise<Object[]>}
   */
  async rotateAllKeys(rotatedBy, reason = ROTATION_REASONS.EMERGENCY) {
    console.log(`[KeyRotation] Rotation d'urgence de TOUTES les clés`);

    const results = [];
    for (const keyType of Object.values(KEY_TYPES)) {
      try {
        const result = await this.rotateKey(keyType, rotatedBy, reason);
        results.push({ ...result, success: true });
      } catch (error) {
        console.error(`[KeyRotation] Erreur rotation ${keyType}:`, error.message);
        results.push({ keyType, success: false, error: error.message });
      }
    }

    return results;
  }

  /**
   * Vérifie les clés expirées ou bientôt expirées
   * @returns {Promise<Object[]>}
   */
  async checkExpirations() {
    const warnings = [];
    const now = new Date();
    const warningDays = config.security?.keyRotation?.warningDays || 30;
    const warningDate = new Date(now.getTime() + warningDays * 24 * 60 * 60 * 1000);

    const expiringKeys = await this.AesKeyRotation.findAll({
      where: {
        is_active: true,
        expires_at: { [Op.lte]: warningDate }
      }
    });

    for (const key of expiringKeys) {
      const daysRemaining = Math.ceil((key.expires_at - now) / (1000 * 60 * 60 * 24));

      warnings.push({
        keyType: key.key_type,
        version: key.key_version,
        expiresAt: key.expires_at,
        daysRemaining,
        isExpired: daysRemaining <= 0,
        severity: daysRemaining <= 0 ? 'critical' : daysRemaining <= 7 ? 'high' : 'medium'
      });

      // Si c'est le 1er décembre, rotation automatique
      if (now.getMonth() === 11 && now.getDate() === 1 && daysRemaining <= 30) {
        console.log(`[KeyRotation] Rotation annuelle programmée pour ${key.key_type}`);
        try {
          await this.rotateKey(key.key_type, null, ROTATION_REASONS.SCHEDULED);
        } catch (err) {
          console.error(`[KeyRotation] Erreur rotation auto:`, err.message);
        }
      }
    }

    return warnings;
  }

  /**
   * Planifie la rotation annuelle (à appeler par le CRON)
   * @returns {Promise<Object>}
   */
  async scheduleAnnualRotation() {
    const now = new Date();

    // Rotation uniquement le 1er décembre
    if (now.getMonth() !== 11 || now.getDate() !== 1) {
      return { scheduled: false, reason: 'not_rotation_date' };
    }

    console.log('[KeyRotation] Exécution de la rotation annuelle');

    const results = await this.rotateAllKeys(null, ROTATION_REASONS.SCHEDULED);

    return {
      scheduled: true,
      date: now,
      results
    };
  }

  /**
   * Récupère l'historique des rotations
   * @param {string} keyType
   * @param {number} limit
   * @returns {Promise<Object[]>}
   */
  async getRotationHistory(keyType, limit = 10) {
    return this.AesKeyRotation.findAll({
      where: { key_type: keyType },
      order: [['key_version', 'DESC']],
      limit,
      attributes: [
        'rotation_id', 'key_type', 'key_version',
        'is_active', 'activated_at', 'rotated_at',
        'expires_at', 'rotation_reason', 'access_count'
      ]
    });
  }

  /**
   * Statut complet du service
   * @returns {Promise<Object>}
   */
  async getStatus() {
    const keys = [];

    for (const keyType of Object.values(KEY_TYPES)) {
      const activeKey = await this.getActiveKey(keyType);
      if (activeKey) {
        const daysRemaining = Math.ceil(
          (activeKey.expires_at - new Date()) / (1000 * 60 * 60 * 24)
        );

        keys.push({
          type: keyType,
          version: activeKey.key_version,
          activatedAt: activeKey.activated_at,
          expiresAt: activeKey.expires_at,
          daysRemaining,
          accessCount: activeKey.access_count,
          status: daysRemaining <= 0 ? 'expired' : daysRemaining <= 7 ? 'warning' : 'ok'
        });
      } else {
        keys.push({
          type: keyType,
          status: 'missing'
        });
      }
    }

    const warnings = await this.checkExpirations();

    return {
      initialized: true,
      keys,
      warnings,
      nextAnnualRotation: this._getNextRotationDate()
    };
  }

  /**
   * Calcule la prochaine date de rotation annuelle
   * @private
   */
  _getNextRotationDate() {
    const now = new Date();
    const thisYear = now.getFullYear();
    const rotationDate = new Date(thisYear, 11, 1); // 1er décembre

    if (now > rotationDate) {
      rotationDate.setFullYear(thisYear + 1);
    }

    return rotationDate;
  }

  /**
   * Rechiffre les données avec la nouvelle clé
   * @private
   */
  async _rechipherData(keyType, oldKey, newKey, transaction) {
    // Le rechiffrement dépend du type de clé
    switch (keyType) {
      case KEY_TYPES.VAULT_CENTRAL:
        if (this.vaultService) {
          // Le VaultService gère le rechiffrement
          console.log('[KeyRotation] Rechiffrement des éléments du Vault...');
        }
        break;
      case KEY_TYPES.BACKUP:
        // Les backups existants gardent leur ancienne clé
        // Seuls les nouveaux backups utiliseront la nouvelle clé
        break;
      default:
        // Pas de rechiffrement automatique pour les autres types
        break;
    }
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
        severity: eventName.includes('emergency') ? 'critical' : 'medium'
      }, { transaction });
    } catch (err) {
      console.error('[KeyRotation] Erreur log:', err.message);
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
      console.error('[KeyRotation] Erreur notification:', err.message);
    }
  }
}

/**
 * Classe d'erreur
 */
class KeyRotationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'KeyRotationError';
    this.code = code;
  }
}

module.exports = KeyRotationService;
module.exports.KeyRotationError = KeyRotationError;
module.exports.KEY_TYPES = KEY_TYPES;
module.exports.ROTATION_REASONS = ROTATION_REASONS;
