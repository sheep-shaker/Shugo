'use strict';

/**
 * SHUGO v7.0 - Job de vérification de santé système
 *
 * Exécution: Toutes les 5 minutes
 * - Vérifie la connexion base de données
 * - Vérifie les serveurs locaux
 * - Contrôle l'espace disque
 * - Vérifie les services critiques
 * - Déclenche les alertes si nécessaire
 *
 * @see Document Technique V7.0 - Section 11.1
 */

const cron = require('node-cron');
const os = require('os');

const DEFAULT_CONFIG = {
  schedule: '*/5 * * * *',      // Toutes les 5 minutes
  diskThreshold: 90,            // Alerte si > 90% utilisé
  memoryThreshold: 85,          // Alerte si > 85% utilisé
  cpuThreshold: 90,             // Alerte si > 90%
  dbTimeoutMs: 5000,            // Timeout connexion DB
  serverTimeoutMs: 10000,       // Timeout vérification serveurs
  enabled: true
};

class HealthCheckJob {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cronJob = null;
    this.isRunning = false;
    this.lastRun = null;
    this.lastHealth = null;
    this.stats = {
      runs: 0,
      healthy: 0,
      unhealthy: 0,
      alerts: 0
    };
  }

  async start() {
    if (this.cronJob) {
      console.log('[HealthCheckJob] Déjà démarré');
      return;
    }

    if (!this.config.enabled) {
      console.log('[HealthCheckJob] Désactivé par configuration');
      return;
    }

    this.cronJob = cron.schedule(this.config.schedule, async () => {
      await this.execute();
    }, { scheduled: true });

    console.log(`[HealthCheckJob] Démarré (${this.config.schedule})`);
  }

  async stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    console.log('[HealthCheckJob] Arrêté');
  }

  async execute() {
    if (this.isRunning) {
      console.log('[HealthCheckJob] Déjà en cours');
      return this.lastHealth;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      const health = {
        timestamp: new Date(),
        status: 'healthy',
        checks: {},
        issues: [],
        metrics: {}
      };

      // 1. Vérifier la base de données
      health.checks.database = await this._checkDatabase();
      if (!health.checks.database.healthy) {
        health.status = 'critical';
        health.issues.push('Database connection failed');
      }

      // 2. Vérifier les métriques système
      health.metrics.system = this._checkSystemMetrics();
      if (health.metrics.system.memory > this.config.memoryThreshold) {
        health.issues.push(`High memory usage: ${health.metrics.system.memory}%`);
        if (health.status === 'healthy') health.status = 'warning';
      }
      if (health.metrics.system.cpu > this.config.cpuThreshold) {
        health.issues.push(`High CPU usage: ${health.metrics.system.cpu}%`);
        if (health.status === 'healthy') health.status = 'warning';
      }

      // 3. Vérifier l'espace disque
      health.checks.disk = await this._checkDiskSpace();
      if (health.checks.disk.usagePercent > this.config.diskThreshold) {
        health.issues.push(`Low disk space: ${health.checks.disk.usagePercent}% used`);
        if (health.status === 'healthy') health.status = 'warning';
      }

      // 4. Vérifier les serveurs locaux
      health.checks.localServers = await this._checkLocalServers();
      if (health.checks.localServers.offline > 0) {
        health.issues.push(`${health.checks.localServers.offline} local server(s) offline`);
        if (health.status === 'healthy') health.status = 'warning';
      }

      // 5. Vérifier les services critiques
      health.checks.services = await this._checkCriticalServices();

      // Mettre à jour les stats
      this.stats.runs++;
      if (health.status === 'healthy') {
        this.stats.healthy++;
      } else {
        this.stats.unhealthy++;
      }

      // Déclencher des alertes si nécessaire
      if (health.issues.length > 0) {
        await this._handleIssues(health);
      }

      health.duration = Date.now() - startTime;
      this.lastHealth = health;
      this.lastRun = new Date();

      console.log(`[HealthCheckJob] Statut: ${health.status} (${health.duration}ms)`);

      return health;

    } catch (error) {
      console.error('[HealthCheckJob] Erreur:', error);
      this.stats.unhealthy++;
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  async _checkDatabase() {
    try {
      const { sequelize } = require('../models');
      await Promise.race([
        sequelize.authenticate(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), this.config.dbTimeoutMs)
        )
      ]);

      return { healthy: true, latency: 0 };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  _checkSystemMetrics() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cpus = os.cpus();

    // Calculer l'utilisation CPU moyenne
    let totalIdle = 0, totalTick = 0;
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    const cpuUsage = Math.round(100 - (100 * totalIdle / totalTick));

    return {
      memory: Math.round((usedMem / totalMem) * 100),
      memoryUsedMB: Math.round(usedMem / 1024 / 1024),
      memoryTotalMB: Math.round(totalMem / 1024 / 1024),
      cpu: cpuUsage,
      loadAvg: os.loadavg(),
      uptime: os.uptime()
    };
  }

  async _checkDiskSpace() {
    try {
      // Sur Windows, utiliser une approche différente
      const { execSync } = require('child_process');
      const platform = os.platform();

      if (platform === 'win32') {
        // Commande Windows pour l'espace disque
        const result = execSync('wmic logicaldisk get size,freespace,caption', { encoding: 'utf8' });
        const lines = result.trim().split('\n').slice(1);
        let totalSize = 0, totalFree = 0;

        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3) {
            const free = parseInt(parts[1]) || 0;
            const size = parseInt(parts[2]) || 0;
            totalSize += size;
            totalFree += free;
          }
        }

        const used = totalSize - totalFree;
        return {
          usagePercent: totalSize > 0 ? Math.round((used / totalSize) * 100) : 0,
          freeGB: Math.round(totalFree / 1024 / 1024 / 1024),
          totalGB: Math.round(totalSize / 1024 / 1024 / 1024)
        };
      } else {
        // Unix/Linux
        const result = execSync("df -k / | tail -1 | awk '{print $2,$3,$4}'", { encoding: 'utf8' });
        const [total, used, free] = result.trim().split(' ').map(Number);

        return {
          usagePercent: Math.round((used / total) * 100),
          freeGB: Math.round(free / 1024 / 1024),
          totalGB: Math.round(total / 1024 / 1024)
        };
      }
    } catch (error) {
      return { usagePercent: 0, error: error.message };
    }
  }

  async _checkLocalServers() {
    try {
      const { LocalInstance } = require('../models');
      if (!LocalInstance) {
        return { total: 0, online: 0, offline: 0 };
      }

      const servers = await LocalInstance.findAll({
        where: { status: 'active' }
      });

      let online = 0, offline = 0;
      const now = Date.now();

      for (const server of servers) {
        if (server.last_seen) {
          const timeSinceLastSeen = now - server.last_seen.getTime();
          if (timeSinceLastSeen < server.heartbeat_interval * 2 * 1000) {
            online++;
          } else {
            offline++;
          }
        } else {
          offline++;
        }
      }

      return { total: servers.length, online, offline };
    } catch (error) {
      return { total: 0, online: 0, offline: 0, error: error.message };
    }
  }

  async _checkCriticalServices() {
    const services = {
      jobs: { status: 'unknown' },
      sync: { status: 'unknown' },
      notifications: { status: 'unknown' }
    };

    try {
      // Vérifier le JobManager
      const jobManager = require('./index').manager;
      if (jobManager && jobManager.started) {
        services.jobs = { status: 'running' };
      }
    } catch (e) {
      services.jobs = { status: 'error', error: e.message };
    }

    return services;
  }

  async _handleIssues(health) {
    this.stats.alerts++;

    try {
      // Logger dans l'audit
      const { AuditLog } = require('../models');
      if (AuditLog) {
        await AuditLog.create({
          action_type: 'health.alert',
          entity_type: 'system',
          severity: health.status === 'critical' ? 'error' : 'warn',
          details: {
            status: health.status,
            issues: health.issues,
            checks: health.checks
          }
        });
      }

      // Notifier les admins si critique
      if (health.status === 'critical') {
        console.error('[HealthCheckJob] CRITIQUE:', health.issues);
        // TODO: Envoyer notification aux admins
      }
    } catch (error) {
      console.error('[HealthCheckJob] Erreur gestion alertes:', error);
    }
  }

  async runManual() {
    console.log('[HealthCheckJob] Exécution manuelle demandée');
    return await this.execute();
  }

  getStatus() {
    return {
      name: 'healthCheck',
      enabled: this.config.enabled,
      schedule: this.config.schedule,
      running: this.isRunning,
      lastRun: this.lastRun,
      lastHealth: this.lastHealth,
      stats: { ...this.stats }
    };
  }
}

module.exports = new HealthCheckJob();
module.exports.HealthCheckJob = HealthCheckJob;
