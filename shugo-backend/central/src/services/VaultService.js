'use strict';

/**
 * Service Vault SHUGO
 * 
 * Gestion sécurisée des clés de chiffrement, secrets partagés et éléments sensibles.
 * 
 * @see Document Technique V7.0 - Section 5.3, 5.8
 */

const { Op } = require('sequelize');
const crypto = require('../utils/crypto');
const config = require('../config');

/**
 * Types d'éléments du Vault
 */
const VAULT_ITEM_TYPES = {
  AES_KEY: 'aes_key',
  SECRET: 'secret',
  CERTIFICATE: 'certificate',
  BACKUP_KEY: 'backup_key',
  EMERGENCY_KEY: 'emergency_key'
};

/**
 * Types de clés AES
 */
const KEY_TYPES = {
  VAULT_LOCAL: 'vault_local',
  VAULT_CENTRAL: 'vault_central',
  BACKUP: 'backup',
  LOGS: 'logs'
};

/**
 * Service de gestion du Vault
 */
class VaultService {
  constructor(models, sequelize) {
    this.models = models;
    this.sequelize = sequelize;
    this.VaultItem = models.VaultItem;
    this.AesKeyRotation = models.AesKeyRotation;
    this.SharedSecret = models.SharedSecret;
    this.EmergencyCode = models.EmergencyCode;
    this.SecurityProtocolLog = models.SecurityProtocolLog;
    this.AuditLog = models.AuditLog;

    // Cache des clés actives (en mémoire chiffrée)
    this._keyCache = new Map();
    this._cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  // =========================================
  // INITIALISATION
  // =========================================

  /**
   * Initialise le Vault au démarrage
   * @returns {Promise<void>}
   */
  async initialize() {
    // Vérifier l'existence des clés principales
    const activeKey = await this._getActiveKey(KEY_TYPES.VAULT_CENTRAL);
    
    if (!activeKey) {
      // Première initialisation - générer les clés
      console.log('[Vault] Première initialisation - génération des clés...');
      await this._generateInitialKeys();
    }

    // Charger les clés actives en cache
    await this._loadActiveKeysToCache();

    // Vérifier les dates d'expiration
    await this._checkKeyExpirations();

    console.log('[Vault] Initialisé avec succès');
  }

  /**
   * Génère les clés initiales du Vault
   * @private
   */
  async _generateInitialKeys() {
    const keyTypes = Object.values(KEY_TYPES);
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1); // 1 an

    for (const keyType of keyTypes) {
      const newKey = crypto.generateAESKey();
      const iv = crypto.generateIV();
      
      // Chiffrer la clé avec la clé maître
      const masterKey = Buffer.from(config.security.vaultMasterKey, 'hex');
      const encryptedKey = crypto.encryptToBuffer(newKey, masterKey);

      await this.AesKeyRotation.create({
        key_type: keyType,
        key_version: 1,
        key_encrypted: encryptedKey,
        initialization_vector: iv,
        is_active: true,
        activated_at: new Date(),
        expires_at: expiresAt
      });
    }
  }

  // =========================================
  // GESTION DES CLÉS AES
  // =========================================

  /**
   * Récupère la clé AES active pour un type donné
   * @param {string} keyType - Type de clé (vault_local, vault_central, backup, logs)
   * @returns {Promise<Buffer>}
   */
  async getActiveKey(keyType) {
    // Vérifier le cache
    const cached = this._keyCache.get(keyType);
    if (cached && cached.expiry > Date.now()) {
      return cached.key;
    }

    const keyRecord = await this._getActiveKey(keyType);
    if (!keyRecord) {
      throw new VaultError('KEY_NOT_FOUND', `Aucune clé active pour le type: ${keyType}`);
    }

    // Déchiffrer la clé
    const masterKey = Buffer.from(config.security.vaultMasterKey, 'hex');
    const decryptedKey = crypto.decryptFromBuffer(keyRecord.key_encrypted, masterKey);

    // Mettre en cache
    this._keyCache.set(keyType, {
      key: decryptedKey,
      expiry: Date.now() + this._cacheExpiry,
      version: keyRecord.key_version
    });

    // Incrémenter le compteur d'accès
    await keyRecord.update({ 
      access_count: (keyRecord.access_count || 0) + 1,
      last_accessed_at: new Date()
    });

    return decryptedKey;
  }

  /**
   * Récupère l'enregistrement de clé active
   * @private
   */
  async _getActiveKey(keyType) {
    return this.AesKeyRotation.findOne({
      where: { key_type: keyType, is_active: true }
    });
  }

  /**
   * Effectue la rotation d'une clé AES
   * @param {string} keyType - Type de clé
   * @param {number} rotatedBy - member_id de l'admin
   * @param {string} reason - Raison (scheduled, manual, compromise)
   * @returns {Promise<Object>}
   */
  async rotateKey(keyType, rotatedBy, reason = 'scheduled') {
    return this.sequelize.transaction(async (t) => {
      // 1. Récupérer la clé actuelle
      const currentKey = await this.AesKeyRotation.findOne({
        where: { key_type: keyType, is_active: true },
        transaction: t
      });

      const newVersion = currentKey ? currentKey.key_version + 1 : 1;
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);

      // 2. Générer la nouvelle clé
      const newKey = crypto.generateAESKey();
      const iv = crypto.generateIV();
      const masterKey = Buffer.from(config.security.vaultMasterKey, 'hex');
      const encryptedKey = crypto.encryptToBuffer(newKey, masterKey);

      // 3. Créer la nouvelle entrée
      const newKeyRecord = await this.AesKeyRotation.create({
        key_type: keyType,
        key_version: newVersion,
        key_encrypted: encryptedKey,
        initialization_vector: iv,
        is_active: false, // Pas encore active
        expires_at: expiresAt,
        previous_key_id: currentKey?.rotation_id
      }, { transaction: t });

      // 4. Rechiffrer les données concernées
      await this._rechipherDataWithNewKey(keyType, currentKey, newKey, t);

      // 5. Activer la nouvelle clé et désactiver l'ancienne
      if (currentKey) {
        await currentKey.update({ is_active: false }, { transaction: t });
      }
      
      await newKeyRecord.update({
        is_active: true,
        activated_at: new Date()
      }, { transaction: t });

      // 6. Invalider le cache
      this._keyCache.delete(keyType);

      // 7. Logger l'opération
      await this._logSecurityProtocol('key_rotation', rotatedBy, {
        keyType,
        oldVersion: currentKey?.key_version,
        newVersion,
        reason
      }, t);

      // 8. Conserver l'ancienne clé pour 15 jours (archives)
      if (currentKey) {
        // Marquer pour archivage après 15 jours
        const archiveDate = new Date();
        archiveDate.setDate(archiveDate.getDate() + 15);
        // TODO: Planifier l'archivage
      }

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
   * Rechiffre les données avec une nouvelle clé
   * @private
   */
  async _rechipherDataWithNewKey(keyType, oldKeyRecord, newKey, transaction) {
    // Selon le type de clé, différentes données doivent être rechiffrées
    switch (keyType) {
      case KEY_TYPES.VAULT_CENTRAL:
        await this._rechipherVaultItems(oldKeyRecord, newKey, transaction);
        break;
      case KEY_TYPES.LOGS:
        // Les logs sont archivés, pas rechiffrés
        break;
      case KEY_TYPES.BACKUP:
        // Les backups existants gardent leur ancienne clé
        break;
      default:
        // Pas de rechiffrement automatique
        break;
    }
  }

  /**
   * Rechiffre les éléments du Vault
   * @private
   */
  async _rechipherVaultItems(oldKeyRecord, newKey, transaction) {
    if (!oldKeyRecord) return;

    const items = await this.VaultItem.findAll({
      where: { vault_type: 'central', is_active: true },
      transaction
    });

    // Déchiffrer l'ancienne clé
    const masterKey = Buffer.from(config.security.vaultMasterKey, 'hex');
    const oldKey = crypto.decryptFromBuffer(oldKeyRecord.key_encrypted, masterKey);

    for (const item of items) {
      // Déchiffrer avec l'ancienne clé
      const decrypted = crypto.decryptFromBuffer(item.item_data_encrypted, oldKey);
      
      // Rechiffrer avec la nouvelle clé
      const reencrypted = crypto.encryptToBuffer(decrypted, newKey);
      
      await item.update({ item_data_encrypted: reencrypted }, { transaction });
    }
  }

  // =========================================
  // GESTION DES SECRETS PARTAGÉS
  // =========================================

  /**
   * Récupère le secret partagé actif
   * @param {string} secretType - Type de secret (local_central, emergency, backup)
   * @returns {Promise<Buffer>}
   */
  async getActiveSecret(secretType) {
    const secret = await this.SharedSecret.findOne({
      where: { secret_type: secretType, is_active: true }
    });

    if (!secret) {
      throw new VaultError('SECRET_NOT_FOUND', `Aucun secret actif pour le type: ${secretType}`);
    }

    // Déchiffrer le secret
    const masterKey = Buffer.from(config.security.vaultMasterKey, 'hex');
    return crypto.decryptFromBuffer(secret.secret_encrypted, masterKey);
  }

  /**
   * Crée un nouveau secret partagé
   * @param {string} secretType
   * @param {Buffer} secretValue
   * @param {number} createdBy
   * @returns {Promise<Object>}
   */
  async createSecret(secretType, secretValue, createdBy) {
    const masterKey = Buffer.from(config.security.vaultMasterKey, 'hex');
    const encryptedSecret = crypto.encryptToBuffer(secretValue, masterKey);
    const secretHash = crypto.sha256(secretValue);

    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const secret = await this.SharedSecret.create({
      secret_type: secretType,
      secret_encrypted: encryptedSecret,
      secret_hash: secretHash,
      expires_at: expiresAt,
      is_active: false,
      rotation_reason: 'initial'
    });

    await this._logSecurityProtocol('secret_created', createdBy, {
      secretType,
      secretId: secret.secret_id
    });

    return secret;
  }

  /**
   * Active un secret partagé
   * @param {string} secretId
   * @param {number} activatedBy
   * @returns {Promise<void>}
   */
  async activateSecret(secretId, activatedBy) {
    return this.sequelize.transaction(async (t) => {
      const secret = await this.SharedSecret.findByPk(secretId, { transaction: t });
      if (!secret) {
        throw new VaultError('SECRET_NOT_FOUND', 'Secret non trouvé');
      }

      // Désactiver l'ancien secret du même type
      await this.SharedSecret.update(
        { is_active: false },
        { where: { secret_type: secret.secret_type, is_active: true }, transaction: t }
      );

      // Activer le nouveau
      await secret.update({
        is_active: true,
        activated_at: new Date()
      }, { transaction: t });

      await this._logSecurityProtocol('secret_activated', activatedBy, {
        secretType: secret.secret_type,
        secretId
      }, t);
    });
  }

  /**
   * Effectue la rotation d'un secret partagé
   * @param {string} secretType
   * @param {Buffer} newSecretValue
   * @param {number} rotatedBy
   * @param {string} reason
   * @returns {Promise<Object>}
   */
  async rotateSecret(secretType, newSecretValue, rotatedBy, reason = 'scheduled') {
    return this.sequelize.transaction(async (t) => {
      // 1. Récupérer le secret actuel
      const currentSecret = await this.SharedSecret.findOne({
        where: { secret_type: secretType, is_active: true },
        transaction: t
      });

      // 2. Créer le nouveau secret
      const masterKey = Buffer.from(config.security.vaultMasterKey, 'hex');
      const encryptedSecret = crypto.encryptToBuffer(newSecretValue, masterKey);
      const secretHash = crypto.sha256(newSecretValue);

      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);

      const newSecret = await this.SharedSecret.create({
        secret_type: secretType,
        secret_encrypted: encryptedSecret,
        secret_hash: secretHash,
        expires_at: expiresAt,
        is_active: true,
        activated_at: new Date(),
        previous_secret_id: currentSecret?.secret_id,
        rotation_reason: reason
      }, { transaction: t });

      // 3. Désactiver l'ancien
      if (currentSecret) {
        await currentSecret.update({ is_active: false }, { transaction: t });
      }

      // 4. Logger
      await this._logSecurityProtocol('secret_rotation', rotatedBy, {
        secretType,
        oldSecretId: currentSecret?.secret_id,
        newSecretId: newSecret.secret_id,
        reason
      }, t);

      return newSecret;
    });
  }

  /**
   * Valide un secret partagé
   * @param {string} secretType
   * @param {Buffer} secretValue
   * @returns {Promise<boolean>}
   */
  async validateSecret(secretType, secretValue) {
    const secret = await this.SharedSecret.findOne({
      where: { secret_type: secretType, is_active: true }
    });

    if (!secret) return false;

    const hash = crypto.sha256(secretValue);
    return crypto.timingSafeEqual(hash, secret.secret_hash);
  }

  // =========================================
  // ÉLÉMENTS DU VAULT
  // =========================================

  /**
   * Stocke un élément dans le Vault
   * @param {string} itemType - Type d'élément
   * @param {string} itemName - Nom de l'élément
   * @param {Buffer|string} data - Données à stocker
   * @param {Object} metadata - Métadonnées
   * @returns {Promise<Object>}
   */
  async storeItem(itemType, itemName, data, metadata = {}) {
    const key = await this.getActiveKey(KEY_TYPES.VAULT_CENTRAL);
    const encrypted = crypto.encryptToBuffer(
      Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'),
      key
    );

    const item = await this.VaultItem.create({
      vault_type: 'central',
      item_type: itemType,
      item_name: itemName,
      item_data_encrypted: encrypted,
      metadata,
      is_active: true
    });

    return {
      itemId: item.item_id,
      itemType,
      itemName,
      createdAt: item.created_at
    };
  }

  /**
   * Récupère un élément du Vault
   * @param {string} itemId
   * @returns {Promise<Buffer>}
   */
  async retrieveItem(itemId) {
    const item = await this.VaultItem.findByPk(itemId);
    if (!item || !item.is_active) {
      throw new VaultError('ITEM_NOT_FOUND', 'Élément non trouvé');
    }

    const key = await this.getActiveKey(KEY_TYPES.VAULT_CENTRAL);
    const decrypted = crypto.decryptFromBuffer(item.item_data_encrypted, key);

    // Incrémenter le compteur d'accès
    await item.update({
      access_count: (item.access_count || 0) + 1,
      last_accessed_at: new Date()
    });

    return decrypted;
  }

  /**
   * Supprime un élément du Vault (soft delete)
   * @param {string} itemId
   * @param {number} deletedBy
   * @returns {Promise<void>}
   */
  async deleteItem(itemId, deletedBy) {
    const item = await this.VaultItem.findByPk(itemId);
    if (!item) {
      throw new VaultError('ITEM_NOT_FOUND', 'Élément non trouvé');
    }

    await item.update({ is_active: false });

    await this._logSecurityProtocol('vault_item_deleted', deletedBy, {
      itemId,
      itemType: item.item_type,
      itemName: item.item_name
    });
  }

  // =========================================
  // TABLEAU DE SECOURS D'URGENCE
  // =========================================

  /**
   * Génère un nouveau tableau de secours
   * @param {string} geoId
   * @param {number} generatedBy
   * @returns {Promise<Object>}
   */
  async generateEmergencyTable(geoId, generatedBy) {
    const now = new Date();
    const series = `SECOURS-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${geoId}`;

    // Générer 100 codes (3 colonnes x 33-34 lignes)
    const codes = [];
    const columns = ['A', 'B', 'C'];
    
    for (let col = 0; col < 3; col++) {
      const rowCount = col < 2 ? 33 : 34; // 33 + 33 + 34 = 100
      for (let row = 1; row <= rowCount; row++) {
        const position = `${columns[col]}${String(row).padStart(2, '0')}`;
        const code = crypto.generateToken(10).toUpperCase().slice(0, 10);
        const codeHash = crypto.sha256(code);

        codes.push({
          tableau_series: series,
          geo_id: geoId,
          code_position: position,
          code_hash: codeHash,
          is_used: false,
          status: 'PENDING' // En attente de validation
        });
      }
    }

    // Générer codes série et maître
    const seriesCode = crypto.generateToken(16).toUpperCase();
    const masterCode = crypto.generateToken(16).toUpperCase();

    // Sauvegarder en base
    await this.EmergencyCode.bulkCreate(codes);

    // Stocker les codes série/maître dans le Vault
    await this.storeItem(
      VAULT_ITEM_TYPES.EMERGENCY_KEY,
      `emergency_table_${series}`,
      JSON.stringify({ seriesCode, masterCode, geoId }),
      { series, geoId, generatedBy, codesCount: 100 }
    );

    await this._logSecurityProtocol('emergency_table_generated', generatedBy, {
      series,
      geoId,
      codesCount: 100
    });

    return {
      series,
      seriesCode,
      masterCode,
      geoId,
      codesCount: 100,
      // En production, ne pas retourner les codes en clair !
      // Ils doivent être imprimés et remis physiquement
      message: 'Tableau généré. Veuillez télécharger et imprimer le document sécurisé.'
    };
  }

  /**
   * Active un tableau de secours
   * @param {string} series
   * @param {number} activatedBy
   * @returns {Promise<void>}
   */
  async activateEmergencyTable(series, activatedBy) {
    // Révoquer les anciens tableaux du même geo_id
    const firstCode = await this.EmergencyCode.findOne({
      where: { tableau_series: series }
    });

    if (!firstCode) {
      throw new VaultError('TABLE_NOT_FOUND', 'Tableau de secours non trouvé');
    }

    await this.EmergencyCode.update(
      { status: 'REVOKED' },
      { 
        where: { 
          geo_id: firstCode.geo_id, 
          status: 'ACTIVE',
          tableau_series: { [Op.ne]: series }
        } 
      }
    );

    // Activer le nouveau tableau
    await this.EmergencyCode.update(
      { status: 'ACTIVE' },
      { where: { tableau_series: series } }
    );

    await this._logSecurityProtocol('emergency_table_activated', activatedBy, {
      series,
      geoId: firstCode.geo_id
    });
  }

  /**
   * Valide un code de secours
   * @param {string} series
   * @param {string} masterCode
   * @param {string} codePosition
   * @param {string} code
   * @param {string} ip
   * @returns {Promise<Object>}
   */
  async validateEmergencyCode(series, masterCode, codePosition, code, ip) {
    // Récupérer les infos du tableau depuis le Vault
    const items = await this.VaultItem.findAll({
      where: {
        item_name: `emergency_table_${series}`,
        is_active: true
      }
    });

    if (items.length === 0) {
      throw new VaultError('TABLE_NOT_FOUND', 'Tableau de secours non trouvé');
    }

    const key = await this.getActiveKey(KEY_TYPES.VAULT_CENTRAL);
    const tableData = JSON.parse(
      crypto.decryptFromBuffer(items[0].item_data_encrypted, key).toString('utf8')
    );

    // Vérifier le code maître
    if (tableData.masterCode !== masterCode) {
      await this._logSecurityProtocol('emergency_access_failed', null, {
        series,
        reason: 'invalid_master_code',
        ip
      });
      throw new VaultError('INVALID_CODE', 'Code maître invalide');
    }

    // Vérifier le code de position
    const codeRecord = await this.EmergencyCode.findOne({
      where: {
        tableau_series: series,
        code_position: codePosition,
        status: 'ACTIVE'
      }
    });

    if (!codeRecord) {
      throw new VaultError('CODE_NOT_FOUND', 'Code de position non trouvé ou inactif');
    }

    if (codeRecord.is_used) {
      throw new VaultError('CODE_USED', 'Ce code a déjà été utilisé');
    }

    // Vérifier le code
    const codeHash = crypto.sha256(code);
    if (codeRecord.code_hash !== codeHash) {
      await this._logSecurityProtocol('emergency_access_failed', null, {
        series,
        position: codePosition,
        reason: 'invalid_code',
        ip
      });
      throw new VaultError('INVALID_CODE', 'Code invalide');
    }

    // Marquer comme utilisé
    await codeRecord.update({
      is_used: true,
      used_at: new Date(),
      used_by_ip: ip
    });

    // Mettre à jour le compteur utilisé
    const usedCount = await this.EmergencyCode.count({
      where: { tableau_series: series, is_used: true }
    });

    // Vérifier si seuil d'alerte atteint (85 codes utilisés)
    if (usedCount >= 85) {
      await this._logSecurityProtocol('emergency_table_alert', null, {
        series,
        usedCount,
        message: 'Seuil d\'alerte atteint - Préparer nouveau tableau'
      });
    }

    await this._logSecurityProtocol('emergency_access_success', null, {
      series,
      position: codePosition,
      ip,
      remainingCodes: 100 - usedCount
    });

    return {
      success: true,
      geoId: tableData.geoId,
      remainingCodes: 100 - usedCount,
      accessType: 'emergency',
      expiresIn: 2 * 60 * 60 * 1000 // 2 heures
    };
  }

  // =========================================
  // VÉRIFICATIONS ET MAINTENANCE
  // =========================================

  /**
   * Vérifie les expirations de clés
   * @returns {Promise<Object[]>}
   */
  async _checkKeyExpirations() {
    const warningDate = new Date();
    warningDate.setDate(warningDate.getDate() + config.security.keyRotation.warningDays);

    const expiringKeys = await this.AesKeyRotation.findAll({
      where: {
        is_active: true,
        expires_at: { [Op.lte]: warningDate }
      }
    });

    const expiringSecrets = await this.SharedSecret.findAll({
      where: {
        is_active: true,
        expires_at: { [Op.lte]: warningDate }
      }
    });

    const warnings = [];

    for (const key of expiringKeys) {
      warnings.push({
        type: 'key',
        keyType: key.key_type,
        expiresAt: key.expires_at,
        daysRemaining: Math.ceil((key.expires_at - new Date()) / (1000 * 60 * 60 * 24))
      });
    }

    for (const secret of expiringSecrets) {
      warnings.push({
        type: 'secret',
        secretType: secret.secret_type,
        expiresAt: secret.expires_at,
        daysRemaining: Math.ceil((secret.expires_at - new Date()) / (1000 * 60 * 60 * 24))
      });
    }

    return warnings;
  }

  /**
   * Charge les clés actives en cache
   * @private
   */
  async _loadActiveKeysToCache() {
    const activeKeys = await this.AesKeyRotation.findAll({
      where: { is_active: true }
    });

    const masterKey = Buffer.from(config.security.vaultMasterKey, 'hex');

    for (const keyRecord of activeKeys) {
      const decryptedKey = crypto.decryptFromBuffer(keyRecord.key_encrypted, masterKey);
      this._keyCache.set(keyRecord.key_type, {
        key: decryptedKey,
        expiry: Date.now() + this._cacheExpiry,
        version: keyRecord.key_version
      });
    }
  }

  /**
   * Statut du Vault
   * @returns {Promise<Object>}
   */
  async getStatus() {
    const activeKeys = await this.AesKeyRotation.findAll({
      where: { is_active: true },
      attributes: ['key_type', 'key_version', 'expires_at', 'activated_at']
    });

    const activeSecrets = await this.SharedSecret.findAll({
      where: { is_active: true },
      attributes: ['secret_type', 'expires_at', 'activated_at']
    });

    const expirationWarnings = await this._checkKeyExpirations();

    const emergencyTableStats = await this.EmergencyCode.findAll({
      attributes: [
        'tableau_series',
        'geo_id',
        'status',
        [this.sequelize.fn('COUNT', this.sequelize.col('code_id')), 'total'],
        [this.sequelize.fn('SUM', this.sequelize.cast(
          this.sequelize.col('is_used'), 'INTEGER'
        )), 'used']
      ],
      group: ['tableau_series', 'geo_id', 'status'],
      where: { status: 'ACTIVE' }
    });

    return {
      initialized: true,
      keys: activeKeys.map(k => ({
        type: k.key_type,
        version: k.key_version,
        expiresAt: k.expires_at,
        activatedAt: k.activated_at
      })),
      secrets: activeSecrets.map(s => ({
        type: s.secret_type,
        expiresAt: s.expires_at,
        activatedAt: s.activated_at
      })),
      expirationWarnings,
      emergencyTables: emergencyTableStats.map(e => ({
        series: e.tableau_series,
        geoId: e.geo_id,
        total: parseInt(e.dataValues.total),
        used: parseInt(e.dataValues.used) || 0,
        remaining: parseInt(e.dataValues.total) - (parseInt(e.dataValues.used) || 0)
      }))
    };
  }

  // =========================================
  // LOGGING
  // =========================================

  /**
   * Log une opération de sécurité
   * @private
   */
  async _logSecurityProtocol(protocolName, memberId, details, transaction = null) {
    try {
      await this.SecurityProtocolLog.create({
        protocol_name: protocolName,
        triggered_by: memberId ? 'manual' : 'automatic',
        member_id: memberId,
        scope: 'central',
        reason: details.reason || JSON.stringify(details),
        actions_taken: details,
        result: 'success',
        started_at: new Date(),
        completed_at: new Date()
      }, { transaction });
    } catch (err) {
      console.error('Erreur log security protocol:', err);
    }
  }
}

/**
 * Classe d'erreur Vault
 */
class VaultError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
    this.statusCode = this._getStatusCode(code);
  }

  _getStatusCode(code) {
    const codes = {
      KEY_NOT_FOUND: 500,
      SECRET_NOT_FOUND: 500,
      ITEM_NOT_FOUND: 404,
      TABLE_NOT_FOUND: 404,
      CODE_NOT_FOUND: 404,
      INVALID_CODE: 401,
      CODE_USED: 400
    };
    return codes[code] || 500;
  }
}

module.exports = VaultService;
module.exports.VaultError = VaultError;
module.exports.VAULT_ITEM_TYPES = VAULT_ITEM_TYPES;
module.exports.KEY_TYPES = KEY_TYPES;
