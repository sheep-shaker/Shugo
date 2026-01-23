'use strict';

/**
 * Service EmergencyCodeService - Gestion du tableau de secours
 *
 * Génération, activation et validation des 100 codes de secours.
 * Format 3 colonnes: A01-A33, B01-B33, C01-C34.
 *
 * @see Document Technique V7.0 - Section 5.9
 */

const { Op } = require('sequelize');
const crypto = require('../utils/crypto');

/**
 * Statuts des tableaux
 */
const TABLE_STATUS = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  USED: 'USED',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED'
};

/**
 * Types d'accès accordés
 */
const ACCESS_TYPES = {
  ADMIN_EMERGENCY: 'admin_emergency',
  VAULT_ACCESS: 'vault_access',
  RECOVERY: 'recovery',
  MASTER_OVERRIDE: 'master_override'
};

class EmergencyCodeService {
  constructor(models, sequelize, services = {}) {
    this.models = models;
    this.sequelize = sequelize;
    this.EmergencyCode = models.EmergencyCode;
    this.VaultItem = models.VaultItem;
    this.SecurityProtocolLog = models.SecurityProtocolLog;
    this.vaultService = services.vault;
    this.notificationService = services.notification;

    // Configuration
    this.TOTAL_CODES = 100;
    this.COLUMNS = ['A', 'B', 'C'];
    this.ROWS_PER_COLUMN = [33, 33, 34]; // A: 33, B: 33, C: 34 = 100
    this.ALERT_THRESHOLD = 85;
    this.CODE_LENGTH = 10;
    this.DEFAULT_ACCESS_DURATION = 120; // 2 heures en minutes
  }

  /**
   * Génère un nouveau tableau de secours
   * @param {string} geoId - Scope géographique
   * @param {number} generatedBy - member_id du générateur
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async generateTable(geoId, generatedBy, options = {}) {
    const { accessType = ACCESS_TYPES.ADMIN_EMERGENCY, expiresInMonths = 12 } = options;

    console.log(`[EmergencyCode] Génération tableau pour ${geoId}`);

    const now = new Date();
    const series = `SECOURS-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${geoId}`;

    // Vérifier si un tableau actif existe déjà
    const existingActive = await this.EmergencyCode.findOne({
      where: { geo_id: geoId, status: TABLE_STATUS.ACTIVE }
    });

    if (existingActive) {
      console.log(`[EmergencyCode] Un tableau actif existe déjà pour ${geoId}`);
    }

    // Générer les 100 codes
    const codes = [];
    const plaintextCodes = []; // Pour le document à imprimer

    let codeIndex = 0;
    for (let colIdx = 0; colIdx < this.COLUMNS.length; colIdx++) {
      const column = this.COLUMNS[colIdx];
      const rowCount = this.ROWS_PER_COLUMN[colIdx];

      for (let row = 1; row <= rowCount; row++) {
        const position = `${column}${String(row).padStart(2, '0')}`;
        const code = this._generateSecureCode();
        const codeHash = crypto.sha256(code);

        codes.push({
          tableau_series: series,
          geo_id: geoId,
          code_position: position,
          code_hash: codeHash,
          is_used: false,
          status: TABLE_STATUS.PENDING,
          access_type: accessType,
          access_duration_minutes: this.DEFAULT_ACCESS_DURATION
        });

        plaintextCodes.push({
          position,
          code, // En clair pour impression uniquement
          column,
          row
        });

        codeIndex++;
      }
    }

    // Générer les codes de série et maître
    const seriesCode = crypto.generateToken(16).toUpperCase();
    const masterCode = crypto.generateToken(16).toUpperCase();

    // Date d'expiration
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + expiresInMonths);

    // Sauvegarder en base
    await this.sequelize.transaction(async (t) => {
      await this.EmergencyCode.bulkCreate(codes, { transaction: t });

      // Stocker les codes série/maître dans le Vault si disponible
      if (this.vaultService) {
        await this.vaultService.storeItem(
          'emergency_key',
          `emergency_table_${series}`,
          JSON.stringify({
            seriesCode,
            masterCode,
            geoId,
            generatedBy,
            generatedAt: now,
            expiresAt,
            codesCount: this.TOTAL_CODES
          }),
          { series, geoId, generatedBy, codesCount: this.TOTAL_CODES }
        );
      }

      // Logger l'événement
      await this._logSecurityEvent('emergency_table_generated', generatedBy, {
        series,
        geoId,
        codesCount: this.TOTAL_CODES,
        expiresAt
      }, t);
    });

    console.log(`[EmergencyCode] Tableau ${series} généré avec ${this.TOTAL_CODES} codes`);

    return {
      series,
      seriesCode,
      masterCode,
      geoId,
      codesCount: this.TOTAL_CODES,
      expiresAt,
      status: TABLE_STATUS.PENDING,
      // Document pour impression (à générer côté client)
      printableDocument: {
        header: {
          series,
          geoId,
          generatedAt: now,
          expiresAt,
          seriesCode,
          masterCode
        },
        codes: plaintextCodes,
        instructions: this._getInstructions()
      }
    };
  }

  /**
   * Active un tableau de secours
   * @param {string} series
   * @param {number} activatedBy
   * @returns {Promise<Object>}
   */
  async activateTable(series, activatedBy) {
    console.log(`[EmergencyCode] Activation tableau ${series}`);

    return this.sequelize.transaction(async (t) => {
      // Vérifier que le tableau existe
      const firstCode = await this.EmergencyCode.findOne({
        where: { tableau_series: series },
        transaction: t
      });

      if (!firstCode) {
        throw new EmergencyCodeError('TABLE_NOT_FOUND', 'Tableau de secours non trouvé');
      }

      // Révoquer les anciens tableaux actifs du même geo_id
      await this.EmergencyCode.update(
        { status: TABLE_STATUS.REVOKED, revoked_at: new Date() },
        {
          where: {
            geo_id: firstCode.geo_id,
            status: TABLE_STATUS.ACTIVE,
            tableau_series: { [Op.ne]: series }
          },
          transaction: t
        }
      );

      // Activer le nouveau tableau
      const now = new Date();
      await this.EmergencyCode.update(
        { status: TABLE_STATUS.ACTIVE, activated_at: now },
        { where: { tableau_series: series }, transaction: t }
      );

      // Logger
      await this._logSecurityEvent('emergency_table_activated', activatedBy, {
        series,
        geoId: firstCode.geo_id
      }, t);

      return {
        series,
        geoId: firstCode.geo_id,
        activatedAt: now,
        status: TABLE_STATUS.ACTIVE
      };
    });
  }

  /**
   * Valide un code de secours
   * @param {string} series
   * @param {string} masterCode
   * @param {string} position - Position du code (ex: A01)
   * @param {string} code - Code à valider
   * @param {string} ip - Adresse IP
   * @returns {Promise<Object>}
   */
  async validateCode(series, masterCode, position, code, ip) {
    console.log(`[EmergencyCode] Validation ${series} position ${position}`);

    // 1. Récupérer les infos du tableau depuis le Vault
    let tableData;
    if (this.vaultService) {
      try {
        const item = await this.models.VaultItem.findOne({
          where: { item_name: `emergency_table_${series}`, is_active: true }
        });

        if (item) {
          const data = await this.vaultService.retrieveItem(item.item_id);
          tableData = JSON.parse(data.toString('utf8'));
        }
      } catch (err) {
        console.error('[EmergencyCode] Erreur récupération Vault:', err.message);
      }
    }

    // 2. Vérifier le code maître
    if (tableData && tableData.masterCode !== masterCode) {
      await this._logSecurityEvent('emergency_access_failed', null, {
        series,
        position,
        reason: 'invalid_master_code',
        ip
      });
      throw new EmergencyCodeError('INVALID_MASTER_CODE', 'Code maître invalide');
    }

    // 3. Récupérer le code de la position
    const codeRecord = await this.EmergencyCode.findOne({
      where: {
        tableau_series: series,
        code_position: position.toUpperCase(),
        status: TABLE_STATUS.ACTIVE
      }
    });

    if (!codeRecord) {
      throw new EmergencyCodeError('CODE_NOT_FOUND', 'Code non trouvé ou tableau inactif');
    }

    // 4. Vérifier si déjà utilisé
    if (codeRecord.is_used) {
      await this._logSecurityEvent('emergency_access_failed', null, {
        series,
        position,
        reason: 'code_already_used',
        ip
      });
      throw new EmergencyCodeError('CODE_ALREADY_USED', 'Ce code a déjà été utilisé');
    }

    // 5. Valider le code
    const codeHash = crypto.sha256(code.toUpperCase());
    if (!crypto.timingSafeEqual(codeHash, codeRecord.code_hash)) {
      await this._logSecurityEvent('emergency_access_failed', null, {
        series,
        position,
        reason: 'invalid_code',
        ip
      });
      throw new EmergencyCodeError('INVALID_CODE', 'Code invalide');
    }

    // 6. Marquer comme utilisé
    await codeRecord.update({
      is_used: true,
      used_at: new Date(),
      used_by_ip: ip
    });

    // 7. Compter les codes utilisés
    const usedCount = await this.EmergencyCode.count({
      where: { tableau_series: series, is_used: true }
    });

    // 8. Vérifier le seuil d'alerte
    if (usedCount >= this.ALERT_THRESHOLD) {
      await this._notifyAdmins('emergency_table_alert', {
        series,
        geoId: tableData?.geoId || codeRecord.geo_id,
        usedCount,
        remainingCodes: this.TOTAL_CODES - usedCount,
        message: 'Seuil d\'alerte atteint - Préparer nouveau tableau'
      });
    }

    // 9. Logger le succès
    await this._logSecurityEvent('emergency_access_success', null, {
      series,
      position,
      ip,
      usedCount,
      remainingCodes: this.TOTAL_CODES - usedCount
    });

    console.log(`[EmergencyCode] Code ${position} validé - ${this.TOTAL_CODES - usedCount} codes restants`);

    return {
      success: true,
      geoId: tableData?.geoId || codeRecord.geo_id,
      accessType: codeRecord.access_type,
      accessDuration: codeRecord.access_duration_minutes,
      remainingCodes: this.TOTAL_CODES - usedCount,
      alertThresholdReached: usedCount >= this.ALERT_THRESHOLD,
      expiresIn: codeRecord.access_duration_minutes * 60 * 1000 // en ms
    };
  }

  /**
   * Révoque un tableau de secours
   * @param {string} series
   * @param {number} revokedBy
   * @param {string} reason
   * @returns {Promise<Object>}
   */
  async revokeTable(series, revokedBy, reason) {
    console.log(`[EmergencyCode] Révocation tableau ${series}`);

    await this.EmergencyCode.update(
      {
        status: TABLE_STATUS.REVOKED,
        revoked_at: new Date(),
        revoked_reason: reason
      },
      { where: { tableau_series: series } }
    );

    await this._logSecurityEvent('emergency_table_revoked', revokedBy, {
      series,
      reason
    });

    return { series, status: TABLE_STATUS.REVOKED, reason };
  }

  /**
   * Récupère le statut d'un tableau
   * @param {string} series
   * @returns {Promise<Object>}
   */
  async getTableStatus(series) {
    const codes = await this.EmergencyCode.findAll({
      where: { tableau_series: series },
      attributes: ['code_position', 'is_used', 'status', 'used_at', 'activated_at']
    });

    if (codes.length === 0) {
      throw new EmergencyCodeError('TABLE_NOT_FOUND', 'Tableau non trouvé');
    }

    const usedCount = codes.filter(c => c.is_used).length;
    const status = codes[0].status;

    return {
      series,
      status,
      totalCodes: codes.length,
      usedCodes: usedCount,
      remainingCodes: codes.length - usedCount,
      percentUsed: Math.round((usedCount / codes.length) * 100),
      alertThresholdReached: usedCount >= this.ALERT_THRESHOLD,
      activatedAt: codes[0].activated_at,
      usedPositions: codes.filter(c => c.is_used).map(c => c.code_position)
    };
  }

  /**
   * Liste les tableaux pour un geo_id
   * @param {string} geoId
   * @returns {Promise<Object[]>}
   */
  async listTables(geoId) {
    const tables = await this.EmergencyCode.findAll({
      where: { geo_id: geoId },
      attributes: [
        'tableau_series',
        'status',
        [this.sequelize.fn('COUNT', this.sequelize.col('code_id')), 'total'],
        [this.sequelize.fn('SUM', this.sequelize.cast(this.sequelize.col('is_used'), 'INTEGER')), 'used'],
        [this.sequelize.fn('MIN', this.sequelize.col('activated_at')), 'activated_at']
      ],
      group: ['tableau_series', 'status']
    });

    return tables.map(t => ({
      series: t.tableau_series,
      status: t.status,
      total: parseInt(t.dataValues.total),
      used: parseInt(t.dataValues.used) || 0,
      remaining: parseInt(t.dataValues.total) - (parseInt(t.dataValues.used) || 0),
      activatedAt: t.dataValues.activated_at
    }));
  }

  /**
   * Génère un code sécurisé
   * @private
   */
  _generateSecureCode() {
    // Format: 10 caractères alphanumériques (sans 0, O, I, L pour éviter confusion)
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    const bytes = crypto.randomBytes(this.CODE_LENGTH);

    for (let i = 0; i < this.CODE_LENGTH; i++) {
      code += chars[bytes[i] % chars.length];
    }

    return code;
  }

  /**
   * Instructions pour le document imprimé
   * @private
   */
  _getInstructions() {
    return {
      fr: [
        'Ce document est STRICTEMENT CONFIDENTIEL',
        'Conserver dans un coffre-fort sécurisé',
        'Chaque code ne peut être utilisé qu\'UNE SEULE fois',
        'En cas de perte ou vol, contacter immédiatement l\'administrateur',
        'Un nouveau tableau doit être généré lorsque 85 codes ont été utilisés'
      ],
      en: [
        'This document is STRICTLY CONFIDENTIAL',
        'Store in a secure safe',
        'Each code can only be used ONCE',
        'In case of loss or theft, contact administrator immediately',
        'A new table must be generated when 85 codes have been used'
      ]
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
        severity: eventName.includes('failed') ? 'high' : 'medium'
      }, { transaction });
    } catch (err) {
      console.error('[EmergencyCode] Erreur log:', err.message);
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
      console.error('[EmergencyCode] Erreur notification:', err.message);
    }
  }
}

/**
 * Classe d'erreur
 */
class EmergencyCodeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EmergencyCodeError';
    this.code = code;
    this.statusCode = this._getStatusCode(code);
  }

  _getStatusCode(code) {
    const codes = {
      TABLE_NOT_FOUND: 404,
      CODE_NOT_FOUND: 404,
      INVALID_MASTER_CODE: 401,
      INVALID_CODE: 401,
      CODE_ALREADY_USED: 400,
      TABLE_EXPIRED: 400
    };
    return codes[code] || 500;
  }
}

module.exports = EmergencyCodeService;
module.exports.EmergencyCodeError = EmergencyCodeError;
module.exports.TABLE_STATUS = TABLE_STATUS;
module.exports.ACCESS_TYPES = ACCESS_TYPES;
