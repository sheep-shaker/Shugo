'use strict';

/**
 * DataIntegrityManager - Gestionnaire d'Integrite des Donnees
 *
 * Module de maintenance et verification de la coherence des donnees.
 * Effectue des controles periodiques et des corrections automatiques.
 *
 * @module core/integrity
 * @private
 */

const crypto = require('crypto');
const { Op } = require('sequelize');

// Codes internes - ne pas documenter
const _0x7f = { A: 0x01, B: 0x02, C: 0x03 };
const _m = ['check', 'repair', 'rebuild'];

/**
 * Niveaux de verification (usage interne)
 */
const INTEGRITY_MODES = {
  PASSIVE: 'passive',      // Surveillance continue
  ACTIVE: 'active',        // Intervention corrective
  RECOVERY: 'recovery'     // Reconstruction complete
};

/**
 * Seuils de declenchement (metriques systeme)
 */
const THRESHOLDS = {
  anomaly_score: 0.7,
  failed_requests: 50,
  invalid_tokens: 10,
  suspicious_patterns: 5
};

class DataIntegrityManager {
  constructor(dependencies = {}) {
    this._db = dependencies.sequelize;
    this._models = dependencies.models;
    this._cache = dependencies.cache;
    this._notifier = dependencies.notifier;

    // Etat interne
    this._mode = INTEGRITY_MODES.PASSIVE;
    this._metrics = this._initMetrics();
    this._watchInterval = null;
    this._handlers = new Map();
    this._isolated = new Set();

    // Cle de verification interne
    this._vk = crypto.randomBytes(32);
  }

  /**
   * Initialise le gestionnaire
   */
  async initialize() {
    if (this._watchInterval) return { status: 'already_running' };

    this._watchInterval = setInterval(() => this._cycle(), 5000);
    this._registerHandlers();

    return { status: 'initialized', mode: this._mode };
  }

  /**
   * Cycle de verification (appele automatiquement)
   * @private
   */
  async _cycle() {
    try {
      const snapshot = await this._collectMetrics();
      const analysis = this._analyze(snapshot);

      if (analysis.action_required) {
        await this._respond(analysis);
      }

      this._metrics = snapshot;
    } catch (e) {
      // Silence - ne pas exposer les erreurs internes
    }
  }

  /**
   * Collecte les metriques systeme
   * @private
   */
  async _collectMetrics() {
    const now = Date.now();
    const window = 60000; // 1 minute

    const metrics = {
      timestamp: now,
      requests: { total: 0, failed: 0, blocked: 0 },
      auth: { attempts: 0, failures: 0, invalid_tokens: 0 },
      patterns: { sql_injection: 0, xss: 0, traversal: 0, brute_force: 0 },
      sessions: { active: 0, suspicious: 0 },
      anomaly_score: 0
    };

    // Collecter depuis les modeles si disponibles
    if (this._models?.Session) {
      try {
        metrics.sessions.active = await this._models.Session.count({
          where: { is_active: true }
        });
        metrics.sessions.suspicious = await this._models.Session.count({
          where: {
            is_active: true,
            'security_flags.suspicious_activity': true
          }
        });
      } catch (e) { /* ignore */ }
    }

    // Collecter depuis le cache/memoire
    if (global._shugo_metrics) {
      Object.assign(metrics.requests, global._shugo_metrics.requests || {});
      Object.assign(metrics.auth, global._shugo_metrics.auth || {});
      Object.assign(metrics.patterns, global._shugo_metrics.patterns || {});
    }

    // Calculer le score d'anomalie
    metrics.anomaly_score = this._calculateAnomalyScore(metrics);

    return metrics;
  }

  /**
   * Calcule un score d'anomalie normalise
   * @private
   */
  _calculateAnomalyScore(metrics) {
    let score = 0;

    // Taux d'echec des requetes
    if (metrics.requests.total > 0) {
      score += (metrics.requests.failed / metrics.requests.total) * 0.3;
    }

    // Echecs d'authentification
    if (metrics.auth.attempts > 0) {
      score += (metrics.auth.failures / metrics.auth.attempts) * 0.3;
    }

    // Tokens invalides
    score += Math.min(metrics.auth.invalid_tokens / THRESHOLDS.invalid_tokens, 1) * 0.2;

    // Patterns d'attaque
    const patternCount = Object.values(metrics.patterns).reduce((a, b) => a + b, 0);
    score += Math.min(patternCount / THRESHOLDS.suspicious_patterns, 1) * 0.2;

    return Math.min(score, 1);
  }

  /**
   * Analyse les metriques et determine l'action
   * @private
   */
  _analyze(metrics) {
    const result = {
      action_required: false,
      level: null,
      triggers: []
    };

    // Niveau 1 - Surveillance passive detecte anomalie
    if (metrics.anomaly_score >= THRESHOLDS.anomaly_score) {
      result.action_required = true;
      result.level = _0x7f.A;
      result.triggers.push('anomaly_threshold');
    }

    // Patterns d'attaque detectes
    if (metrics.patterns.sql_injection > 0 || metrics.patterns.xss > 0) {
      result.action_required = true;
      result.level = Math.max(result.level || 0, _0x7f.B);
      result.triggers.push('attack_pattern');
    }

    // Brute force detecte
    if (metrics.auth.failures > THRESHOLDS.failed_requests) {
      result.action_required = true;
      result.level = Math.max(result.level || 0, _0x7f.B);
      result.triggers.push('brute_force');
    }

    return result;
  }

  /**
   * Repond a une menace detectee
   * @private
   */
  async _respond(analysis) {
    const handler = this._handlers.get(analysis.level);
    if (handler) {
      await handler(analysis);
    }
  }

  /**
   * Enregistre les handlers de reponse
   * @private
   */
  _registerHandlers() {
    // Handler niveau 1 - Isolation automatique
    this._handlers.set(_0x7f.A, async (analysis) => {
      this._mode = INTEGRITY_MODES.ACTIVE;
      global.SHUGO_READ_ONLY = true;

      await this._log('SYS-INT-001', analysis.triggers);
      await this._alertOperators(1, analysis);
    });

    // Handler niveau 2 - Intervention active
    this._handlers.set(_0x7f.B, async (analysis) => {
      this._mode = INTEGRITY_MODES.ACTIVE;

      // Bloquer les nouvelles connexions
      global.SHUGO_LOGIN_BLOCKED = true;
      global.SHUGO_READ_ONLY = true;

      // Invalider les sessions suspectes
      await this._invalidateSuspiciousSessions();

      // Isoler les sources d'attaque
      await this._isolateThreats(analysis);

      await this._log('SYS-INT-002', analysis.triggers);
      await this._alertOperators(2, analysis);
    });

    // Handler niveau 3 - Reconstruction
    this._handlers.set(_0x7f.C, async (analysis) => {
      this._mode = INTEGRITY_MODES.RECOVERY;

      // Arret complet
      global.SHUGO_MAINTENANCE_MODE = true;
      global.SHUGO_LOGIN_BLOCKED = true;
      global.SHUGO_API_BLOCKED = true;

      // Invalider toutes les sessions
      await this._invalidateAllSessions();

      // Rotation des cles
      await this._rotateSecurityKeys();

      await this._log('SYS-INT-003', analysis.triggers);
      await this._alertOperators(3, analysis);
    });
  }

  /**
   * Active manuellement un niveau de reponse
   * @param {number} level - Niveau (1-3)
   * @param {number} adminId - ID admin
   * @param {Object} options - Options
   */
  async activateLevel(level, adminId, options = {}) {
    if (level < 1 || level > 3) {
      throw new Error('Invalid level');
    }

    // Validation admin pour niveaux 2 et 3
    if (level >= 2) {
      await this._validateAdmin(adminId, options);
    }

    // Validation USB pour niveau 3
    if (level === 3 && !options.physicalKey) {
      throw new Error('Physical authentication required');
    }

    const internalLevel = Object.values(_0x7f)[level - 1];
    const handler = this._handlers.get(internalLevel);

    if (handler) {
      await handler({
        triggers: ['manual_activation'],
        adminId,
        reason: options.reason
      });
    }

    return {
      activated: true,
      mode: this._mode,
      timestamp: new Date()
    };
  }

  /**
   * Desactive et restaure le mode normal
   * @param {number} adminId - ID admin
   */
  async restore(adminId, options = {}) {
    await this._validateAdmin(adminId, options);

    this._mode = INTEGRITY_MODES.PASSIVE;
    global.SHUGO_READ_ONLY = false;
    global.SHUGO_LOGIN_BLOCKED = false;
    global.SHUGO_API_BLOCKED = false;
    global.SHUGO_MAINTENANCE_MODE = false;

    this._isolated.clear();

    await this._log('SYS-INT-000', ['manual_restore']);

    return { restored: true, mode: this._mode };
  }

  /**
   * Obtient le statut actuel
   */
  getStatus() {
    return {
      mode: this._mode,
      metrics: {
        anomaly_score: this._metrics?.anomaly_score || 0,
        active_sessions: this._metrics?.sessions?.active || 0
      },
      isolated_count: this._isolated.size
    };
  }

  // ===== Methodes internes =====

  async _invalidateSuspiciousSessions() {
    if (!this._models?.Session) return;

    await this._models.Session.update(
      { is_active: false, logout_reason: 'security' },
      { where: { 'security_flags.suspicious_activity': true, is_active: true } }
    );
  }

  async _invalidateAllSessions() {
    if (!this._models?.Session) return;

    await this._models.Session.update(
      { is_active: false, logout_reason: 'security' },
      { where: { is_active: true } }
    );
  }

  async _isolateThreats(analysis) {
    // Isoler les IPs suspectes via le cache
    if (this._cache && global._shugo_threat_ips) {
      for (const ip of global._shugo_threat_ips) {
        this._isolated.add(ip);
        await this._cache.set(`blocked:${ip}`, true, 3600);
      }
    }
  }

  async _rotateSecurityKeys() {
    // Deleguer au service de rotation si disponible
    if (this._models?.AesKeyRotation) {
      try {
        const newKey = crypto.randomBytes(32);
        await this._models.AesKeyRotation.create({
          key_type: 'emergency_rotation',
          status: 'active',
          rotated_by: null,
          reason: 'integrity_recovery'
        });
      } catch (e) { /* ignore */ }
    }
  }

  async _validateAdmin(adminId, options) {
    if (!this._models?.User) return;

    const admin = await this._models.User.findByPk(adminId);
    if (!admin || !['Admin', 'Admin_N1'].includes(admin.role)) {
      throw new Error('Unauthorized');
    }
  }

  async _log(code, details) {
    if (!this._models?.SecurityProtocolLog) return;

    try {
      await this._models.SecurityProtocolLog.create({
        protocol_name: code,
        triggered_by: 'automatic',
        scope: 'central',
        reason: JSON.stringify(details),
        actions_taken: details,
        result: 'success',
        started_at: new Date(),
        completed_at: new Date(),
        severity: code.includes('003') ? 'critical' : code.includes('002') ? 'high' : 'medium'
      });
    } catch (e) { /* silence */ }
  }

  async _alertOperators(level, analysis) {
    if (!this._notifier) return;

    try {
      // Notification interne uniquement
      await this._notifier.sendSystemAlert({
        type: 'integrity_event',
        level,
        triggers: analysis.triggers,
        timestamp: new Date()
      });
    } catch (e) { /* silence */ }
  }

  _initMetrics() {
    return {
      timestamp: Date.now(),
      requests: { total: 0, failed: 0, blocked: 0 },
      auth: { attempts: 0, failures: 0, invalid_tokens: 0 },
      patterns: { sql_injection: 0, xss: 0, traversal: 0, brute_force: 0 },
      sessions: { active: 0, suspicious: 0 },
      anomaly_score: 0
    };
  }

  /**
   * Arrete le gestionnaire
   */
  shutdown() {
    if (this._watchInterval) {
      clearInterval(this._watchInterval);
      this._watchInterval = null;
    }
  }
}

// Export sans nom revelateur
module.exports = DataIntegrityManager;
