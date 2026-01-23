'use strict';

/**
 * SHUGO v7.0 - Job de rétention des données
 *
 * Exécution: Tous les jours à 3h00
 * - Applique les politiques de rétention des données
 * - Anonymise les données obsolètes
 * - Supprime les logs anciens
 * - Archive les données historiques
 *
 * @see Document Technique V7.0 - Section 11.3 (RGPD)
 */

const cron = require('node-cron');
const { Op } = require('sequelize');

const DEFAULT_CONFIG = {
  schedule: '0 3 * * *',
  retentionPolicies: {
    auditLogs: 365,
    notifications: 90,
    sessions: 30,
    loginAttempts: 30,
    syncQueue: 30,
    supportRequests: 365 * 2,
    deletedUsers: 365 * 3
  },
  batchSize: 1000,
  dryRun: false,
  enabled: true
};

class DataRetentionJob {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cronJob = null;
    this.isRunning = false;
    this.lastRun = null;
    this.stats = {
      runs: 0,
      recordsDeleted: 0,
      recordsAnonymized: 0,
      failures: 0
    };
  }

  async start() {
    if (this.cronJob) return;
    if (!this.config.enabled) return;

    this.cronJob = cron.schedule(this.config.schedule, async () => {
      await this.execute();
    }, { scheduled: true });

    console.log(`[DataRetentionJob] Démarré (${this.config.schedule})`);
  }

  async stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    console.log('[DataRetentionJob] Arrêté');
  }

  async execute() {
    if (this.isRunning) return;

    this.isRunning = true;
    const startTime = Date.now();

    try {
      console.log('[DataRetentionJob] Début rétention...');

      const models = require('../models');
      const results = {
        auditLogs: 0,
        notifications: 0,
        sessions: 0,
        loginAttempts: 0,
        syncQueue: 0,
        anonymizedUsers: 0
      };

      // Nettoyer les tables selon les politiques
      results.auditLogs = await this._cleanupTable(
        models.AuditLog,
        this.config.retentionPolicies.auditLogs,
        'created_at'
      );

      results.notifications = await this._cleanupTable(
        models.Notification,
        this.config.retentionPolicies.notifications,
        'created_at',
        { status: { [Op.in]: ['read', 'expired'] } }
      );

      results.sessions = await this._cleanupTable(
        models.Session,
        this.config.retentionPolicies.sessions,
        'expires_at'
      );

      results.syncQueue = await this._cleanupTable(
        models.LocalSyncQueue,
        this.config.retentionPolicies.syncQueue,
        'created_at',
        { status: { [Op.in]: ['completed', 'failed'] } }
      );

      results.anonymizedUsers = await this._anonymizeDeletedUsers(models);

      this.stats.runs++;
      this.stats.recordsDeleted += Object.values(results).reduce((a, b) => a + b, 0);
      this.lastRun = new Date();

      console.log(`[DataRetentionJob] Terminé en ${Date.now() - startTime}ms:`, results);

      return results;
    } catch (error) {
      this.stats.failures++;
      console.error('[DataRetentionJob] Erreur:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  async _cleanupTable(Model, retentionDays, dateField, additionalWhere = {}) {
    if (!Model) return 0;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const where = {
      [dateField]: { [Op.lt]: cutoffDate },
      ...additionalWhere
    };

    if (this.config.dryRun) {
      return await Model.count({ where });
    }

    let totalDeleted = 0, deleted;
    do {
      deleted = await Model.destroy({ where, limit: this.config.batchSize });
      totalDeleted += deleted;
    } while (deleted === this.config.batchSize);

    return totalDeleted;
  }

  async _anonymizeDeletedUsers(models) {
    const { User } = models;
    if (!User) return 0;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionPolicies.deletedUsers);

    const users = await User.findAll({
      where: {
        status: 'deleted',
        deleted_at: { [Op.lt]: cutoffDate },
        email_encrypted: { [Op.ne]: '[ANONYMISÉ]' }
      },
      limit: this.config.batchSize
    });

    for (const user of users) {
      await user.update({
        email_encrypted: '[ANONYMISÉ]',
        email_hash: `anonymized_${user.member_id}`,
        first_name_encrypted: '[ANONYMISÉ]',
        last_name_encrypted: '[ANONYMISÉ]',
        password_hash: 'anonymized'
      });
      this.stats.recordsAnonymized++;
    }

    return users.length;
  }

  async runManual() {
    return await this.execute();
  }

  getStatus() {
    return {
      name: 'dataRetention',
      enabled: this.config.enabled,
      schedule: this.config.schedule,
      running: this.isRunning,
      lastRun: this.lastRun,
      stats: { ...this.stats }
    };
  }
}

module.exports = new DataRetentionJob();
module.exports.DataRetentionJob = DataRetentionJob;
