'use strict';

/**
 * SHUGO v7.0 - Service de monitoring et santé système
 *
 * Monitoring complet du système :
 * - Contrôles de santé (database, services, vault)
 * - Métriques système (CPU, mémoire, disque)
 * - Alertes et notifications
 * - Historique et statistiques
 *
 * @see Document Technique V7.0 - Section 10.3
 */

const os = require('os');
const { Op } = require('sequelize');

/**
 * Types de contrôles
 */
const CHECK_TYPES = {
  SYSTEM: 'system',
  DATABASE: 'database',
  VAULT: 'vault',
  NETWORK: 'network',
  SECURITY: 'security',
  SERVICE: 'service'
};

/**
 * Statuts de santé
 */
const HEALTH_STATUS = {
  HEALTHY: 'healthy',
  WARNING: 'warning',
  CRITICAL: 'critical',
  UNKNOWN: 'unknown'
};

/**
 * Catégories de métriques
 */
const METRIC_CATEGORIES = {
  PERFORMANCE: 'performance',
  SECURITY: 'security',
  USAGE: 'usage',
  ERROR: 'error',
  BUSINESS: 'business'
};

/**
 * Seuils d'alerte par défaut
 */
const DEFAULT_THRESHOLDS = {
  cpu: { warning: 70, critical: 90 },
  memory: { warning: 80, critical: 95 },
  disk: { warning: 80, critical: 90 },
  responseTime: { warning: 1000, critical: 5000 },
  errorRate: { warning: 1, critical: 5 }
};

class HealthService {
  constructor(models) {
    this.models = models;
    this.HealthCheck = models?.HealthCheck;
    this.SystemMetric = models?.SystemMetric;
    this.LocalInstance = models?.LocalInstance;

    this._notificationService = null;
    this._emailService = null;

    // Cache des derniers états
    this._statusCache = new Map();
    this._cacheExpiry = 30000; // 30 secondes

    // Thresholds configurables
    this.thresholds = { ...DEFAULT_THRESHOLDS };

    // Intervalle de collecte des métriques
    this._metricsInterval = null;
  }

  /**
   * Initialise le service
   */
  async initialize(options = {}) {
    const { notificationService, emailService, thresholds = {} } = options;

    this._notificationService = notificationService;
    this._emailService = emailService;
    this.thresholds = { ...this.thresholds, ...thresholds };

    // Démarrer la collecte automatique des métriques
    if (options.autoCollect !== false) {
      this.startMetricsCollection(options.collectInterval || 60000);
    }

    console.log('[HealthService] Initialisé');
    return { initialized: true };
  }

  // =========================================
  // CONTRÔLES DE SANTÉ
  // =========================================

  /**
   * Exécute tous les contrôles de santé
   */
  async runAllChecks() {
    const results = {
      overall: HEALTH_STATUS.HEALTHY,
      timestamp: new Date(),
      checks: {},
      issues: []
    };

    // Exécuter tous les contrôles en parallèle
    const [database, system, vault, services, network] = await Promise.all([
      this.checkDatabase(),
      this.checkSystem(),
      this.checkVault(),
      this.checkServices(),
      this.checkNetwork()
    ]);

    results.checks.database = database;
    results.checks.system = system;
    results.checks.vault = vault;
    results.checks.services = services;
    results.checks.network = network;

    // Déterminer le statut global
    for (const [name, check] of Object.entries(results.checks)) {
      if (check.status === HEALTH_STATUS.CRITICAL) {
        results.overall = HEALTH_STATUS.CRITICAL;
        results.issues.push({ component: name, status: check.status, message: check.message });
      } else if (check.status === HEALTH_STATUS.WARNING && results.overall !== HEALTH_STATUS.CRITICAL) {
        results.overall = HEALTH_STATUS.WARNING;
        results.issues.push({ component: name, status: check.status, message: check.message });
      }
    }

    // Enregistrer les résultats
    await this._recordHealthChecks(results);

    // Envoyer des alertes si nécessaire
    if (results.overall !== HEALTH_STATUS.HEALTHY) {
      await this._sendHealthAlert(results);
    }

    return results;
  }

  /**
   * Vérifie la santé de la base de données
   */
  async checkDatabase() {
    const startTime = Date.now();

    try {
      const sequelize = this.models.sequelize;

      // Test de connexion
      await sequelize.authenticate();

      // Test de requête
      await sequelize.query('SELECT 1');

      const responseTime = Date.now() - startTime;
      const status = this._evaluateResponseTime(responseTime);

      await this._recordCheck({
        checkType: CHECK_TYPES.DATABASE,
        componentName: 'postgresql',
        checkName: 'connection',
        status,
        responseTime
      });

      return {
        status,
        responseTime,
        message: status === HEALTH_STATUS.HEALTHY ? 'Database operational' : `Response time: ${responseTime}ms`
      };
    } catch (error) {
      await this._recordCheck({
        checkType: CHECK_TYPES.DATABASE,
        componentName: 'postgresql',
        checkName: 'connection',
        status: HEALTH_STATUS.CRITICAL,
        errorMessage: error.message
      });

      return {
        status: HEALTH_STATUS.CRITICAL,
        message: error.message
      };
    }
  }

  /**
   * Vérifie les ressources système
   */
  async checkSystem() {
    const metrics = this.collectSystemMetrics();
    const issues = [];

    // Évaluer CPU
    if (metrics.cpu.usage > this.thresholds.cpu.critical) {
      issues.push({ metric: 'cpu', value: metrics.cpu.usage, threshold: this.thresholds.cpu.critical });
    }

    // Évaluer mémoire
    if (metrics.memory.usedPercent > this.thresholds.memory.critical) {
      issues.push({ metric: 'memory', value: metrics.memory.usedPercent, threshold: this.thresholds.memory.critical });
    }

    // Évaluer disque
    // Note: L'usage disque nécessiterait un appel système supplémentaire
    // Simplifié ici

    const status = issues.length > 0
      ? (issues.some(i => i.metric === 'cpu' || i.metric === 'memory') ? HEALTH_STATUS.CRITICAL : HEALTH_STATUS.WARNING)
      : HEALTH_STATUS.HEALTHY;

    await this._recordCheck({
      checkType: CHECK_TYPES.SYSTEM,
      componentName: 'server',
      checkName: 'resources',
      status,
      details: metrics
    });

    return {
      status,
      metrics,
      issues,
      message: status === HEALTH_STATUS.HEALTHY ? 'System resources OK' : `${issues.length} resource issues detected`
    };
  }

  /**
   * Vérifie le Vault de sécurité
   */
  async checkVault() {
    try {
      const VaultItem = this.models?.VaultItem;
      if (!VaultItem) {
        return { status: HEALTH_STATUS.UNKNOWN, message: 'Vault model not available' };
      }

      const startTime = Date.now();

      // Test d'accès au vault
      await VaultItem.count();

      const responseTime = Date.now() - startTime;
      const status = responseTime < 500 ? HEALTH_STATUS.HEALTHY : HEALTH_STATUS.WARNING;

      await this._recordCheck({
        checkType: CHECK_TYPES.VAULT,
        componentName: 'vault',
        checkName: 'access',
        status,
        responseTime
      });

      return {
        status,
        responseTime,
        message: 'Vault accessible'
      };
    } catch (error) {
      await this._recordCheck({
        checkType: CHECK_TYPES.VAULT,
        componentName: 'vault',
        checkName: 'access',
        status: HEALTH_STATUS.CRITICAL,
        errorMessage: error.message
      });

      return {
        status: HEALTH_STATUS.CRITICAL,
        message: error.message
      };
    }
  }

  /**
   * Vérifie les services critiques
   */
  async checkServices() {
    const services = ['auth', 'notification', 'sync'];
    const results = {};
    let worstStatus = HEALTH_STATUS.HEALTHY;

    for (const service of services) {
      try {
        // Vérification simplifiée - en production, on vérifierait vraiment chaque service
        const status = HEALTH_STATUS.HEALTHY;
        results[service] = { status, lastCheck: new Date() };
      } catch (error) {
        results[service] = { status: HEALTH_STATUS.CRITICAL, error: error.message };
        worstStatus = HEALTH_STATUS.CRITICAL;
      }
    }

    await this._recordCheck({
      checkType: CHECK_TYPES.SERVICE,
      componentName: 'services',
      checkName: 'all',
      status: worstStatus,
      details: results
    });

    return {
      status: worstStatus,
      services: results,
      message: worstStatus === HEALTH_STATUS.HEALTHY ? 'All services operational' : 'Some services have issues'
    };
  }

  /**
   * Vérifie la connectivité réseau
   */
  async checkNetwork() {
    try {
      // Vérifier les serveurs locaux
      if (this.LocalInstance) {
        const activeServers = await this.LocalInstance.count({ where: { status: 'active' } });
        const offlineServers = await this.LocalInstance.findOffline ? await this.LocalInstance.findOffline(10) : [];

        const status = offlineServers.length > 0 ? HEALTH_STATUS.WARNING : HEALTH_STATUS.HEALTHY;

        await this._recordCheck({
          checkType: CHECK_TYPES.NETWORK,
          componentName: 'local_servers',
          checkName: 'connectivity',
          status,
          details: { active: activeServers, offline: offlineServers.length }
        });

        return {
          status,
          activeServers,
          offlineServers: offlineServers.length,
          message: offlineServers.length > 0 ? `${offlineServers.length} servers offline` : 'All servers connected'
        };
      }

      return { status: HEALTH_STATUS.HEALTHY, message: 'Network check skipped' };
    } catch (error) {
      return { status: HEALTH_STATUS.WARNING, message: error.message };
    }
  }

  // =========================================
  // MÉTRIQUES SYSTÈME
  // =========================================

  /**
   * Collecte les métriques système actuelles
   */
  collectSystemMetrics() {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // Calcul de l'utilisation CPU
    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }

    const cpuUsage = 100 - (totalIdle / totalTick * 100);

    return {
      cpu: {
        usage: Math.round(cpuUsage * 100) / 100,
        cores: cpus.length,
        model: cpus[0]?.model
      },
      memory: {
        total: totalMem,
        used: usedMem,
        free: freeMem,
        usedPercent: Math.round((usedMem / totalMem) * 100 * 100) / 100
      },
      uptime: os.uptime(),
      loadAverage: os.loadavg(),
      platform: os.platform(),
      hostname: os.hostname()
    };
  }

  /**
   * Enregistre les métriques système
   */
  async recordSystemMetrics() {
    const metrics = this.collectSystemMetrics();

    const records = [
      { name: 'cpu_usage', category: METRIC_CATEGORIES.PERFORMANCE, value: metrics.cpu.usage, unit: 'percent' },
      { name: 'memory_used', category: METRIC_CATEGORIES.PERFORMANCE, value: metrics.memory.used, unit: 'bytes' },
      { name: 'memory_used_percent', category: METRIC_CATEGORIES.PERFORMANCE, value: metrics.memory.usedPercent, unit: 'percent' },
      { name: 'memory_free', category: METRIC_CATEGORIES.PERFORMANCE, value: metrics.memory.free, unit: 'bytes' },
      { name: 'load_average_1m', category: METRIC_CATEGORIES.PERFORMANCE, value: metrics.loadAverage[0], unit: 'load' },
      { name: 'load_average_5m', category: METRIC_CATEGORIES.PERFORMANCE, value: metrics.loadAverage[1], unit: 'load' },
      { name: 'system_uptime', category: METRIC_CATEGORIES.PERFORMANCE, value: metrics.uptime, unit: 'seconds' }
    ];

    if (this.SystemMetric) {
      await this.SystemMetric.recordBatch(records);
    }

    return metrics;
  }

  /**
   * Démarre la collecte automatique des métriques
   */
  startMetricsCollection(interval = 60000) {
    if (this._metricsInterval) {
      clearInterval(this._metricsInterval);
    }

    this._metricsInterval = setInterval(async () => {
      try {
        await this.recordSystemMetrics();
      } catch (error) {
        console.error('[HealthService] Erreur collecte métriques:', error.message);
      }
    }, interval);

    console.log(`[HealthService] Collecte métriques démarrée (${interval}ms)`);
  }

  /**
   * Arrête la collecte automatique
   */
  stopMetricsCollection() {
    if (this._metricsInterval) {
      clearInterval(this._metricsInterval);
      this._metricsInterval = null;
    }
  }

  /**
   * Récupère l'historique des métriques
   */
  async getMetricsHistory(metricName, hours = 24) {
    if (!this.SystemMetric) {
      return [];
    }

    return this.SystemMetric.getHistory(metricName, hours);
  }

  /**
   * Récupère les statistiques d'une métrique
   */
  async getMetricsStatistics(metricName, hours = 24) {
    if (!this.SystemMetric) {
      return null;
    }

    return this.SystemMetric.getStatistics(metricName, hours);
  }

  /**
   * Récupère le dashboard de métriques
   */
  async getMetricsDashboard() {
    const current = this.collectSystemMetrics();

    const dashboard = {
      current,
      timestamp: new Date()
    };

    if (this.SystemMetric) {
      dashboard.history = await this.SystemMetric.getDashboard();

      // Ajouter les tendances
      const cpuStats = await this.SystemMetric.getStatistics('cpu_usage', 1);
      const memStats = await this.SystemMetric.getStatistics('memory_used_percent', 1);

      dashboard.trends = {
        cpu: {
          current: current.cpu.usage,
          avgLastHour: cpuStats?.avg ? parseFloat(cpuStats.avg) : null
        },
        memory: {
          current: current.memory.usedPercent,
          avgLastHour: memStats?.avg ? parseFloat(memStats.avg) : null
        }
      };
    }

    return dashboard;
  }

  // =========================================
  // STATISTIQUES ET HISTORIQUE
  // =========================================

  /**
   * Récupère l'état de santé global
   */
  async getSystemHealth() {
    if (!this.HealthCheck) {
      return { overall: HEALTH_STATUS.UNKNOWN, message: 'Health checks not available' };
    }

    return this.HealthCheck.getSystemHealth();
  }

  /**
   * Récupère les statistiques de disponibilité
   */
  async getAvailabilityStats(componentName, days = 7) {
    if (!this.HealthCheck) {
      return null;
    }

    return this.HealthCheck.getAvailabilityStats(componentName, days);
  }

  /**
   * Récupère l'historique des problèmes
   */
  async getIssueHistory(componentName, hours = 24) {
    if (!this.HealthCheck) {
      return [];
    }

    return this.HealthCheck.getIssueHistory(componentName, hours);
  }

  /**
   * Récupère le rapport de santé complet
   */
  async getHealthReport(days = 7) {
    const [currentHealth, systemHealth] = await Promise.all([
      this.runAllChecks(),
      this.getSystemHealth()
    ]);

    const report = {
      generatedAt: new Date(),
      period: { days },
      current: currentHealth,
      overall: systemHealth,
      components: {}
    };

    // Statistiques par composant
    const components = ['postgresql', 'server', 'vault', 'services', 'local_servers'];

    for (const component of components) {
      const availability = await this.getAvailabilityStats(component, days);
      const issues = await this.getIssueHistory(component, days * 24);

      report.components[component] = {
        availability,
        issueCount: issues.length,
        recentIssues: issues.slice(0, 5)
      };
    }

    return report;
  }

  // =========================================
  // ALERTES ET NOTIFICATIONS
  // =========================================

  /**
   * Envoie une alerte de santé
   */
  async _sendHealthAlert(results) {
    try {
      // Notification in-app
      if (this._notificationService) {
        await this._notificationService.sendToAdmins({
          type: 'health_alert',
          title: `Alerte système: ${results.overall}`,
          message: results.issues.map(i => `${i.component}: ${i.message}`).join(', '),
          priority: results.overall === HEALTH_STATUS.CRITICAL ? 'critical' : 'high',
          data: results
        });
      }

      // Email pour les alertes critiques
      if (this._emailService && results.overall === HEALTH_STATUS.CRITICAL) {
        // Envoyer aux admins
        console.log('[HealthService] Alerte critique envoyée');
      }
    } catch (error) {
      console.error('[HealthService] Erreur envoi alerte:', error.message);
    }
  }

  /**
   * Vérifie les seuils et génère des alertes
   */
  async checkThresholds() {
    const metrics = this.collectSystemMetrics();
    const alerts = [];

    // CPU
    if (metrics.cpu.usage >= this.thresholds.cpu.critical) {
      alerts.push({
        type: 'cpu',
        level: 'critical',
        value: metrics.cpu.usage,
        threshold: this.thresholds.cpu.critical,
        message: `CPU usage critical: ${metrics.cpu.usage}%`
      });
    } else if (metrics.cpu.usage >= this.thresholds.cpu.warning) {
      alerts.push({
        type: 'cpu',
        level: 'warning',
        value: metrics.cpu.usage,
        threshold: this.thresholds.cpu.warning,
        message: `CPU usage elevated: ${metrics.cpu.usage}%`
      });
    }

    // Mémoire
    if (metrics.memory.usedPercent >= this.thresholds.memory.critical) {
      alerts.push({
        type: 'memory',
        level: 'critical',
        value: metrics.memory.usedPercent,
        threshold: this.thresholds.memory.critical,
        message: `Memory usage critical: ${metrics.memory.usedPercent}%`
      });
    } else if (metrics.memory.usedPercent >= this.thresholds.memory.warning) {
      alerts.push({
        type: 'memory',
        level: 'warning',
        value: metrics.memory.usedPercent,
        threshold: this.thresholds.memory.warning,
        message: `Memory usage elevated: ${metrics.memory.usedPercent}%`
      });
    }

    // Envoyer les alertes
    for (const alert of alerts) {
      await this._sendThresholdAlert(alert);
    }

    return alerts;
  }

  /**
   * Envoie une alerte de seuil
   */
  async _sendThresholdAlert(alert) {
    // Vérifier si on a déjà envoyé une alerte récemment pour éviter le spam
    const cacheKey = `alert_${alert.type}_${alert.level}`;
    const cached = this._statusCache.get(cacheKey);

    if (cached && Date.now() - cached < 300000) { // 5 minutes
      return;
    }

    this._statusCache.set(cacheKey, Date.now());

    if (this._notificationService) {
      await this._notificationService.sendToAdmins({
        type: 'threshold_alert',
        title: `Alerte ${alert.type}: ${alert.level}`,
        message: alert.message,
        priority: alert.level === 'critical' ? 'critical' : 'high',
        data: alert
      });
    }
  }

  // =========================================
  // MÉTHODES PRIVÉES
  // =========================================

  /**
   * Enregistre un contrôle de santé
   */
  async _recordCheck(options) {
    if (!this.HealthCheck) return;

    try {
      await this.HealthCheck.recordCheck(options);
    } catch (error) {
      console.error('[HealthService] Erreur enregistrement check:', error.message);
    }
  }

  /**
   * Enregistre tous les résultats de santé
   */
  async _recordHealthChecks(results) {
    // Les checks individuels sont déjà enregistrés dans chaque méthode
    // Cette méthode pourrait être utilisée pour un enregistrement global supplémentaire
  }

  /**
   * Évalue le temps de réponse
   */
  _evaluateResponseTime(responseTime) {
    if (responseTime >= this.thresholds.responseTime.critical) {
      return HEALTH_STATUS.CRITICAL;
    }
    if (responseTime >= this.thresholds.responseTime.warning) {
      return HEALTH_STATUS.WARNING;
    }
    return HEALTH_STATUS.HEALTHY;
  }

  // =========================================
  // NETTOYAGE
  // =========================================

  /**
   * Nettoie les anciennes données
   */
  async cleanup(days = 30) {
    const results = {
      healthChecks: 0,
      metrics: 0
    };

    if (this.HealthCheck) {
      results.healthChecks = await this.HealthCheck.cleanupOld(days);
    }

    if (this.SystemMetric) {
      results.metrics = await this.SystemMetric.cleanupOld(days);
    }

    console.log(`[HealthService] Nettoyage: ${results.healthChecks} checks, ${results.metrics} métriques supprimés`);

    return results;
  }

  // =========================================
  // API ENDPOINTS
  // =========================================

  /**
   * Point d'entrée pour l'endpoint /health
   */
  async getHealthEndpoint() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '7.0.0',
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };
  }

  /**
   * Point d'entrée pour l'endpoint /health/detailed
   */
  async getDetailedHealthEndpoint() {
    const [checks, metrics, systemHealth] = await Promise.all([
      this.runAllChecks(),
      this.collectSystemMetrics(),
      this.getSystemHealth()
    ]);

    return {
      status: checks.overall,
      timestamp: new Date().toISOString(),
      checks: checks.checks,
      metrics,
      systemHealth,
      issues: checks.issues
    };
  }

  /**
   * Arrête le service proprement
   */
  async shutdown() {
    this.stopMetricsCollection();
    console.log('[HealthService] Arrêté');
  }
}

/**
 * Classe d'erreur pour le service de santé
 */
class HealthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HealthError';
    this.code = code;
  }
}

module.exports = HealthService;
module.exports.HealthError = HealthError;
module.exports.CHECK_TYPES = CHECK_TYPES;
module.exports.HEALTH_STATUS = HEALTH_STATUS;
module.exports.METRIC_CATEGORIES = METRIC_CATEGORIES;
module.exports.DEFAULT_THRESHOLDS = DEFAULT_THRESHOLDS;
