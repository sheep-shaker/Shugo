'use strict';

/**
 * SHUGO v7.0 - Job de nettoyage des sessions
 *
 * Exécution: Toutes les 15 minutes
 * - Supprime les sessions expirées
 * - Nettoie les tokens refresh expirés
 * - Purge les tentatives de connexion obsolètes
 * - Libère les verrous de compte expirés
 *
 * @see Document Technique V7.0 - Section 11.2
 */

const cron = require('node-cron');
const { Op } = require('sequelize');

const DEFAULT_CONFIG = {
  schedule: '*/15 * * * *',        // Toutes les 15 minutes
  sessionTTL: 24 * 60 * 60 * 1000, // 24 heures
  refreshTokenTTL: 7 * 24 * 60 * 60 * 1000, // 7 jours
  loginAttemptsTTL: 24 * 60 * 60 * 1000, // 24 heures
  lockDuration: 15 * 60 * 1000,    // 15 minutes
  batchSize: 500,
  enabled: true
};

class SessionCleanupJob {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cronJob = null;
    this.isRunning = false;
    this.lastRun = null;
    this.stats = {
      runs: 0,
      sessionsDeleted: 0,
      tokensDeleted: 0,
      attemptsDeleted: 0,
      locksReleased: 0,
      failures: 0
    };
  }

  async start() {
    if (this.cronJob) {
      console.log('[SessionCleanupJob] Déjà démarré');
      return;
    }

    if (!this.config.enabled) {
      console.log('[SessionCleanupJob] Désactivé par configuration');
      return;
    }

    this.cronJob = cron.schedule(this.config.schedule, async () => {
      await this.execute();
    }, { scheduled: true });

    console.log(`[SessionCleanupJob] Démarré (${this.config.schedule})`);
  }

  async stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    console.log('[SessionCleanupJob] Arrêté');
  }

  async execute() {
    if (this.isRunning) {
      console.log('[SessionCleanupJob] Déjà en cours d\'exécution');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      console.log('[SessionCleanupJob] Début du nettoyage des sessions...');

      const models = require('../models');
      const results = {
        sessions: 0,
        tokens: 0,
        attempts: 0,
        locks: 0
      };

      // 1. Nettoyer les sessions expirées
      if (models.Session) {
        const sessionCutoff = new Date(Date.now() - this.config.sessionTTL);
        results.sessions = await models.Session.destroy({
          where: {
            [Op.or]: [
              { expires_at: { [Op.lt]: new Date() } },
              { last_activity: { [Op.lt]: sessionCutoff } }
            ]
          }
        });
        this.stats.sessionsDeleted += results.sessions;
      }

      // 2. Nettoyer les refresh tokens expirés
      if (models.RefreshToken) {
        results.tokens = await models.RefreshToken.destroy({
          where: {
            expires_at: { [Op.lt]: new Date() }
          }
        });
        this.stats.tokensDeleted += results.tokens;
      }

      // 3. Nettoyer les tentatives de connexion obsolètes
      if (models.LoginAttempt) {
        const attemptsCutoff = new Date(Date.now() - this.config.loginAttemptsTTL);
        results.attempts = await models.LoginAttempt.destroy({
          where: {
            created_at: { [Op.lt]: attemptsCutoff }
          }
        });
        this.stats.attemptsDeleted += results.attempts;
      }

      // 4. Libérer les verrous de compte expirés
      if (models.User) {
        const lockCutoff = new Date(Date.now() - this.config.lockDuration);
        const [locksReleased] = await models.User.update(
          {
            account_locked: false,
            failed_login_attempts: 0,
            lock_reason: null
          },
          {
            where: {
              account_locked: true,
              locked_at: { [Op.lt]: lockCutoff },
              lock_reason: 'failed_attempts' // Ne pas libérer les verrous manuels
            }
          }
        );
        results.locks = locksReleased;
        this.stats.locksReleased += results.locks;
      }

      this.stats.runs++;
      this.lastRun = new Date();

      const duration = Date.now() - startTime;
      console.log(`[SessionCleanupJob] Terminé en ${duration}ms:`, results);

      // Logger si des éléments ont été nettoyés
      if (Object.values(results).some(v => v > 0)) {
        await this._logCleanup(results);
      }

      return results;

    } catch (error) {
      this.stats.failures++;
      console.error('[SessionCleanupJob] Erreur:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  async runManual() {
    console.log('[SessionCleanupJob] Exécution manuelle demandée');
    return await this.execute();
  }

  getStatus() {
    return {
      name: 'sessionCleanup',
      enabled: this.config.enabled,
      schedule: this.config.schedule,
      running: this.isRunning,
      lastRun: this.lastRun,
      stats: { ...this.stats }
    };
  }

  async _logCleanup(results) {
    try {
      const AuditLog = require('../models').AuditLog;
      if (AuditLog) {
        await AuditLog.create({
          action_type: 'session.cleanup',
          entity_type: 'system',
          severity: 'info',
          details: results
        });
      }
    } catch (err) {
      console.error('[SessionCleanupJob] Erreur log:', err.message);
    }
  }
}

module.exports = new SessionCleanupJob();
module.exports.SessionCleanupJob = SessionCleanupJob;
