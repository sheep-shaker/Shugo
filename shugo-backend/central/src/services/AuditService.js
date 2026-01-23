'use strict';

/**
 * Service AuditService - Supervision, Audit et Journalisation
 *
 * Implémente le système de supervision multi-niveaux selon le chapitre 10.
 * - Journalisation structurée (3 niveaux)
 * - Système d'audit automatique et manuel
 * - Alertes et notifications
 * - Dashboard de supervision
 *
 * @see Document Technique V7.0 - Chapitre 10
 */

const { Op } = require('sequelize');
const crypto = require('../utils/crypto');

/**
 * Niveaux de journalisation
 */
const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL'
};

/**
 * Catégories de logs
 */
const LOG_CATEGORIES = {
  SYSTEM: 'system',
  AUTH: 'auth',
  GUARD: 'guard',
  VAULT: 'vault',
  ADMIN: 'admin',
  SECURITY: 'security',
  PROTOCOL: 'protocol',
  SYNC: 'sync',
  BACKUP: 'backup'
};

/**
 * Niveaux de priorité pour les alertes
 */
const ALERT_PRIORITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent',
  CRITICAL: 'critical'
};

class AuditService {
  constructor(models, sequelize, services = {}) {
    this.models = models;
    this.sequelize = sequelize;
    this.AuditLog = models.AuditLog;
    this.notificationService = services.notification;
    this.cryptoService = crypto;

    // Configuration
    this._config = {
      retentionDays: {
        operational: 30,
        security: 365,
        audit: 2555 // 7 ans
      },
      alertThresholds: {
        authFailures: 5,
        suspiciousAccess: 3,
        errorRate: 10 // erreurs par minute
      },
      batchSize: 100
    };

    // Métriques en mémoire
    this._metrics = {
      authFailures: new Map(), // IP -> count
      errors: [],
      lastCleanup: null
    };
  }

  /**
   * Initialise le service
   */
  async initialize() {
    console.log('[AuditService] Initialisation...');

    // Démarrer le nettoyage périodique des métriques
    this._startMetricsCleanup();

    return {
      initialized: true,
      config: this._config
    };
  }

  /**
   * Journalise un événement système (Niveau 1)
   */
  async logSystem(action, details = {}) {
    return this._log({
      category: LOG_CATEGORIES.SYSTEM,
      level: details.level || LOG_LEVELS.INFO,
      action,
      details
    });
  }

  /**
   * Journalise un événement opérationnel (Niveau 2)
   */
  async logOperation(action, memberId, details = {}) {
    return this._log({
      category: details.category || LOG_CATEGORIES.GUARD,
      level: LOG_LEVELS.INFO,
      action,
      member_id: memberId,
      details
    });
  }

  /**
   * Journalise un événement de sécurité (Niveau 3)
   */
  async logSecurity(action, memberId = null, details = {}) {
    const entry = await this._log({
      category: LOG_CATEGORIES.SECURITY,
      level: details.level || LOG_LEVELS.WARN,
      action,
      member_id: memberId,
      details,
      is_sensitive: true
    });

    // Alerter si niveau critique
    if (details.level === LOG_LEVELS.CRITICAL) {
      await this._sendAlert({
        type: 'security_critical',
        action,
        details,
        logId: entry.log_id
      });
    }

    return entry;
  }

  /**
   * Journalise une tentative d'authentification
   */
  async logAuth(action, success, ipAddress, details = {}) {
    const level = success ? LOG_LEVELS.INFO : LOG_LEVELS.WARN;

    // Tracker les échecs par IP
    if (!success) {
      const count = (this._metrics.authFailures.get(ipAddress) || 0) + 1;
      this._metrics.authFailures.set(ipAddress, count);

      // Alerter si seuil atteint
      if (count >= this._config.alertThresholds.authFailures) {
        await this._sendAlert({
          type: 'auth_failures_threshold',
          ipAddress,
          count,
          action
        });
      }
    }

    return this._log({
      category: LOG_CATEGORIES.AUTH,
      level,
      action,
      member_id: details.memberId,
      ip_address: ipAddress,
      user_agent: details.userAgent,
      details: {
        success,
        ...details
      }
    });
  }

  /**
   * Journalise un accès au Vault
   */
  async logVaultAccess(action, memberId, itemId, details = {}) {
    return this._log({
      category: LOG_CATEGORIES.VAULT,
      level: LOG_LEVELS.INFO,
      action,
      member_id: memberId,
      details: {
        item_id: itemId,
        ...details
      },
      is_sensitive: true
    });
  }

  /**
   * Journalise une action administrative
   */
  async logAdmin(action, adminId, targetId, details = {}) {
    return this._log({
      category: LOG_CATEGORIES.ADMIN,
      level: LOG_LEVELS.INFO,
      action,
      member_id: adminId,
      details: {
        target_id: targetId,
        ...details
      }
    });
  }

  /**
   * Journalise l'activation d'un protocole
   */
  async logProtocol(protocolName, level, adminId, details = {}) {
    return this._log({
      category: LOG_CATEGORIES.PROTOCOL,
      level: LOG_LEVELS.WARN,
      action: `protocol_${protocolName}`,
      member_id: adminId,
      details: {
        protocol_level: level,
        ...details
      },
      is_sensitive: true
    });
  }

  /**
   * Recherche dans les logs
   */
  async search(filters = {}, options = {}) {
    const where = {};
    const limit = options.limit || 100;
    const offset = options.offset || 0;

    // Filtres de base
    if (filters.category) {
      where.category = filters.category;
    }

    if (filters.level) {
      where.level = filters.level;
    }

    if (filters.memberId) {
      where.member_id = filters.memberId;
    }

    if (filters.action) {
      where.action = { [Op.like]: `%${filters.action}%` };
    }

    if (filters.ipAddress) {
      where.ip_address = filters.ipAddress;
    }

    // Filtres de date
    if (filters.startDate || filters.endDate) {
      where.created_at = {};
      if (filters.startDate) {
        where.created_at[Op.gte] = new Date(filters.startDate);
      }
      if (filters.endDate) {
        where.created_at[Op.lte] = new Date(filters.endDate);
      }
    }

    // Filtre sur les logs sensibles (seulement pour admins)
    if (!options.includeSecure) {
      where.is_sensitive = false;
    }

    const { count, rows } = await this.AuditLog.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset
    });

    return {
      total: count,
      logs: rows,
      page: Math.floor(offset / limit) + 1,
      pages: Math.ceil(count / limit)
    };
  }

  /**
   * Génère un rapport d'audit
   */
  async generateReport(type, period, options = {}) {
    const endDate = new Date();
    const startDate = new Date();

    switch (period) {
      case 'daily':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case 'weekly':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'monthly':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'yearly':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        if (options.startDate) startDate.setTime(new Date(options.startDate).getTime());
    }

    const report = {
      type,
      period,
      startDate,
      endDate,
      generatedAt: new Date(),
      generatedBy: options.adminId
    };

    switch (type) {
      case 'security':
        report.data = await this._generateSecurityReport(startDate, endDate);
        break;
      case 'performance':
        report.data = await this._generatePerformanceReport(startDate, endDate);
        break;
      case 'compliance':
        report.data = await this._generateComplianceReport(startDate, endDate);
        break;
      case 'activity':
        report.data = await this._generateActivityReport(startDate, endDate);
        break;
      default:
        report.data = await this._generateSummaryReport(startDate, endDate);
    }

    // Logger la génération du rapport
    await this.logAdmin('report_generated', options.adminId, null, {
      reportType: type,
      period,
      startDate,
      endDate
    });

    return report;
  }

  /**
   * Vérifie l'intégrité des logs
   */
  async verifyIntegrity(startDate, endDate) {
    const logs = await this.AuditLog.findAll({
      where: {
        created_at: {
          [Op.between]: [startDate, endDate]
        }
      },
      order: [['created_at', 'ASC']]
    });

    const issues = [];
    let previousHash = null;

    for (const log of logs) {
      // Vérifier le hash de l'entrée
      if (log.entry_hash) {
        const computedHash = this._computeEntryHash(log);
        if (computedHash !== log.entry_hash) {
          issues.push({
            logId: log.log_id,
            type: 'hash_mismatch',
            expected: log.entry_hash,
            computed: computedHash
          });
        }
      }

      // Vérifier la chaîne de hachage
      if (log.previous_hash && previousHash && log.previous_hash !== previousHash) {
        issues.push({
          logId: log.log_id,
          type: 'chain_broken',
          expected: previousHash,
          found: log.previous_hash
        });
      }

      previousHash = log.entry_hash;
    }

    return {
      verified: issues.length === 0,
      totalLogs: logs.length,
      issues,
      startDate,
      endDate
    };
  }

  /**
   * Archive les logs anciens
   */
  async archiveLogs(olderThan, options = {}) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThan);

    console.log(`[AuditService] Archivage des logs avant ${cutoffDate.toISOString()}`);

    const logsToArchive = await this.AuditLog.findAll({
      where: {
        created_at: { [Op.lt]: cutoffDate },
        is_archived: false
      },
      limit: this._config.batchSize
    });

    if (logsToArchive.length === 0) {
      return { archived: 0 };
    }

    // Marquer comme archivés
    const logIds = logsToArchive.map(l => l.log_id);
    await this.AuditLog.update(
      { is_archived: true, archived_at: new Date() },
      { where: { log_id: { [Op.in]: logIds } } }
    );

    // Si un service de backup est configuré, envoyer les logs
    if (options.backupService) {
      await options.backupService.archiveLogs(logsToArchive);
    }

    return {
      archived: logsToArchive.length,
      oldestDate: logsToArchive[0]?.created_at,
      newestDate: logsToArchive[logsToArchive.length - 1]?.created_at
    };
  }

  /**
   * Obtient les métriques de supervision
   */
  async getMetrics(period = 'hour') {
    const now = new Date();
    const startDate = new Date();

    switch (period) {
      case 'hour':
        startDate.setHours(startDate.getHours() - 1);
        break;
      case 'day':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
    }

    // Compter par catégorie
    const byCategoryResult = await this.AuditLog.findAll({
      attributes: [
        'category',
        [this.sequelize.fn('COUNT', this.sequelize.col('log_id')), 'count']
      ],
      where: {
        created_at: { [Op.gte]: startDate }
      },
      group: ['category']
    });

    // Compter par niveau
    const byLevelResult = await this.AuditLog.findAll({
      attributes: [
        'level',
        [this.sequelize.fn('COUNT', this.sequelize.col('log_id')), 'count']
      ],
      where: {
        created_at: { [Op.gte]: startDate }
      },
      group: ['level']
    });

    // Alertes actives
    const criticalCount = await this.AuditLog.count({
      where: {
        level: LOG_LEVELS.CRITICAL,
        created_at: { [Op.gte]: startDate }
      }
    });

    return {
      period,
      startDate,
      endDate: now,
      byCategory: byCategoryResult.reduce((acc, r) => {
        acc[r.category] = parseInt(r.dataValues.count);
        return acc;
      }, {}),
      byLevel: byLevelResult.reduce((acc, r) => {
        acc[r.level] = parseInt(r.dataValues.count);
        return acc;
      }, {}),
      criticalAlerts: criticalCount,
      authFailures: this._metrics.authFailures.size
    };
  }

  /**
   * Obtient le statut de santé du système d'audit
   */
  async getHealthStatus() {
    const now = new Date();
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

    const recentLogs = await this.AuditLog.count({
      where: { created_at: { [Op.gte]: lastHour } }
    });

    const criticalIssues = await this.AuditLog.count({
      where: {
        level: LOG_LEVELS.CRITICAL,
        created_at: { [Op.gte]: lastHour }
      }
    });

    const status = criticalIssues > 0 ? 'warning' : 'ok';

    return {
      status,
      timestamp: now,
      logsLastHour: recentLogs,
      criticalIssues,
      authFailureIps: this._metrics.authFailures.size,
      lastCleanup: this._metrics.lastCleanup
    };
  }

  // ===== MÉTHODES PRIVÉES =====

  async _log(entry) {
    const logEntry = {
      category: entry.category,
      level: entry.level,
      action: entry.action,
      member_id: entry.member_id || null,
      ip_address: entry.ip_address || null,
      user_agent: entry.user_agent || null,
      details: entry.details || {},
      is_sensitive: entry.is_sensitive || false,
      created_at: new Date()
    };

    // Calculer le hash de l'entrée pour l'intégrité
    logEntry.entry_hash = this._computeEntryHash(logEntry);

    return this.AuditLog.create(logEntry);
  }

  _computeEntryHash(entry) {
    const data = JSON.stringify({
      category: entry.category,
      level: entry.level,
      action: entry.action,
      member_id: entry.member_id,
      details: entry.details,
      created_at: entry.created_at
    });
    return this.cryptoService.sha256(data);
  }

  async _sendAlert(alertData) {
    if (!this.notificationService) return;

    try {
      // Récupérer les admins
      const admins = await this.models.User.findAll({
        where: { role: { [Op.in]: ['Admin', 'Admin_N1'] }, status: 'active' }
      });

      for (const admin of admins) {
        await this.notificationService.send(
          admin.member_id,
          'security_alert',
          alertData,
          { priority: ALERT_PRIORITY.URGENT, immediate: true }
        );
      }
    } catch (error) {
      console.error('[AuditService] Erreur envoi alerte:', error.message);
    }
  }

  _startMetricsCleanup() {
    // Nettoyer les métriques toutes les 5 minutes
    setInterval(() => {
      this._metrics.authFailures.clear();
      this._metrics.errors = this._metrics.errors.filter(
        e => Date.now() - e.timestamp < 60000
      );
      this._metrics.lastCleanup = new Date();
    }, 5 * 60 * 1000);
  }

  async _generateSecurityReport(startDate, endDate) {
    const securityLogs = await this.AuditLog.findAll({
      where: {
        category: LOG_CATEGORIES.SECURITY,
        created_at: { [Op.between]: [startDate, endDate] }
      }
    });

    const authLogs = await this.AuditLog.findAll({
      where: {
        category: LOG_CATEGORIES.AUTH,
        created_at: { [Op.between]: [startDate, endDate] }
      }
    });

    return {
      securityEvents: securityLogs.length,
      authEvents: authLogs.length,
      criticalEvents: securityLogs.filter(l => l.level === LOG_LEVELS.CRITICAL).length,
      failedLogins: authLogs.filter(l => l.details?.success === false).length,
      uniqueIps: [...new Set(authLogs.map(l => l.ip_address).filter(Boolean))].length
    };
  }

  async _generatePerformanceReport(startDate, endDate) {
    const systemLogs = await this.AuditLog.findAll({
      where: {
        category: LOG_CATEGORIES.SYSTEM,
        created_at: { [Op.between]: [startDate, endDate] }
      }
    });

    return {
      totalEvents: systemLogs.length,
      errors: systemLogs.filter(l => l.level === LOG_LEVELS.ERROR).length,
      warnings: systemLogs.filter(l => l.level === LOG_LEVELS.WARN).length
    };
  }

  async _generateComplianceReport(startDate, endDate) {
    const adminLogs = await this.AuditLog.findAll({
      where: {
        category: LOG_CATEGORIES.ADMIN,
        created_at: { [Op.between]: [startDate, endDate] }
      }
    });

    const vaultLogs = await this.AuditLog.findAll({
      where: {
        category: LOG_CATEGORIES.VAULT,
        created_at: { [Op.between]: [startDate, endDate] }
      }
    });

    return {
      adminActions: adminLogs.length,
      vaultAccesses: vaultLogs.length,
      dataExports: adminLogs.filter(l => l.action?.includes('export')).length
    };
  }

  async _generateActivityReport(startDate, endDate) {
    const allLogs = await this.AuditLog.count({
      where: { created_at: { [Op.between]: [startDate, endDate] } }
    });

    const uniqueUsers = await this.AuditLog.findAll({
      attributes: [[this.sequelize.fn('DISTINCT', this.sequelize.col('member_id')), 'member_id']],
      where: {
        member_id: { [Op.ne]: null },
        created_at: { [Op.between]: [startDate, endDate] }
      }
    });

    return {
      totalEvents: allLogs,
      uniqueUsers: uniqueUsers.length
    };
  }

  async _generateSummaryReport(startDate, endDate) {
    return {
      security: await this._generateSecurityReport(startDate, endDate),
      activity: await this._generateActivityReport(startDate, endDate)
    };
  }
}

/**
 * Classe d'erreur spécifique
 */
class AuditServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuditServiceError';
    this.code = code;
  }
}

module.exports = AuditService;
module.exports.AuditServiceError = AuditServiceError;
module.exports.LOG_LEVELS = LOG_LEVELS;
module.exports.LOG_CATEGORIES = LOG_CATEGORIES;
module.exports.ALERT_PRIORITY = ALERT_PRIORITY;
