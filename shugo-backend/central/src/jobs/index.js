// jobs/index.js
// Gestionnaire principal des jobs CRON SHUGO v7

const config = require('../config');

// Import de tous les jobs
const waitingListJ3Job = require('./waitingListJ3Job');
const backupJob = require('./backupJob');
const maintenanceJob = require('./maintenanceJob');
const keyRotationJob = require('./keyRotationJob');
const sessionCleanupJob = require('./sessionCleanupJob');
const healthCheckJob = require('./healthCheckJob');
const notificationDigestJob = require('./notificationDigestJob');
const reportGenerationJob = require('./reportGenerationJob');
const syncLocalServersJob = require('./syncLocalServersJob');
const dataRetentionJob = require('./dataRetentionJob');
const metricsCollectionJob = require('./metricsCollectionJob');
const alertMonitoringJob = require('./alertMonitoringJob');
const auditArchiveJob = require('./auditArchiveJob');

/**
 * Gestionnaire principal des jobs CRON
 */
class JobManager {
  constructor() {
    this.jobs = {
      waitingListJ3: waitingListJ3Job,
      backup: backupJob,
      maintenance: maintenanceJob,
      keyRotation: keyRotationJob,
      sessionCleanup: sessionCleanupJob,
      healthCheck: healthCheckJob,
      notificationDigest: notificationDigestJob,
      reportGeneration: reportGenerationJob,
      syncLocalServers: syncLocalServersJob,
      dataRetention: dataRetentionJob,
      metricsCollection: metricsCollectionJob,
      alertMonitoring: alertMonitoringJob,
      auditArchive: auditArchiveJob
    };
    
    this.started = false;
    this.startTime = null;
  }

  /**
   * Démarrer tous les jobs
   */
  async startAll() {
    if (this.started) {
      console.log('[JobManager] Jobs déjà démarrés');
      return;
    }

    console.log('[JobManager] Démarrage de tous les jobs CRON...');
    this.startTime = new Date();

    // Démarrer chaque job
    const promises = Object.entries(this.jobs).map(async ([name, job]) => {
      try {
        if (job.start) {
          await job.start();
          console.log(`[JobManager] ✓ ${name} démarré`);
          return { name, status: 'started' };
        }
      } catch (error) {
        console.error(`[JobManager] ✗ Erreur démarrage ${name}:`, error);
        return { name, status: 'error', error: error.message };
      }
    });

    const results = await Promise.all(promises);
    
    // Compter les succès/échecs
    const started = results.filter(r => r.status === 'started').length;
    const failed = results.filter(r => r.status === 'error').length;

    console.log('[JobManager] ========================================');
    console.log(`[JobManager] Jobs démarrés: ${started}/${Object.keys(this.jobs).length}`);
    if (failed > 0) {
      console.log(`[JobManager] Jobs en erreur: ${failed}`);
    }
    console.log('[JobManager] ========================================');

    this.started = true;

    // Logger le démarrage
    await this.logStartup(results);

    return results;
  }

  /**
   * Arrêter tous les jobs
   */
  async stopAll() {
    if (!this.started) {
      console.log('[JobManager] Jobs non démarrés');
      return;
    }

    console.log('[JobManager] Arrêt de tous les jobs CRON...');

    const promises = Object.entries(this.jobs).map(async ([name, job]) => {
      try {
        if (job.stop) {
          await job.stop();
          console.log(`[JobManager] ✓ ${name} arrêté`);
          return { name, status: 'stopped' };
        }
      } catch (error) {
        console.error(`[JobManager] ✗ Erreur arrêt ${name}:`, error);
        return { name, status: 'error', error: error.message };
      }
    });

    const results = await Promise.all(promises);
    
    console.log('[JobManager] Tous les jobs arrêtés');
    this.started = false;

    // Logger l'arrêt
    await this.logShutdown(results);

    return results;
  }

  /**
   * Redémarrer tous les jobs
   */
  async restartAll() {
    await this.stopAll();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Attendre 2 secondes
    return await this.startAll();
  }

  /**
   * Démarrer un job spécifique
   */
  async startJob(jobName) {
    const job = this.jobs[jobName];
    
    if (!job) {
      throw new Error(`Job inconnu: ${jobName}`);
    }

    if (!job.start) {
      throw new Error(`Job ${jobName} n'a pas de méthode start`);
    }

    await job.start();
    console.log(`[JobManager] Job ${jobName} démarré`);
    
    return { name: jobName, status: 'started' };
  }

  /**
   * Arrêter un job spécifique
   */
  async stopJob(jobName) {
    const job = this.jobs[jobName];
    
    if (!job) {
      throw new Error(`Job inconnu: ${jobName}`);
    }

    if (!job.stop) {
      throw new Error(`Job ${jobName} n'a pas de méthode stop`);
    }

    await job.stop();
    console.log(`[JobManager] Job ${jobName} arrêté`);
    
    return { name: jobName, status: 'stopped' };
  }

  /**
   * Exécuter manuellement un job
   */
  async runJob(jobName) {
    const job = this.jobs[jobName];
    
    if (!job) {
      throw new Error(`Job inconnu: ${jobName}`);
    }

    if (!job.runManual && !job.execute) {
      throw new Error(`Job ${jobName} ne peut pas être exécuté manuellement`);
    }

    console.log(`[JobManager] Exécution manuelle de ${jobName}...`);
    
    if (job.runManual) {
      return await job.runManual();
    } else {
      return await job.execute();
    }
  }

  /**
   * Obtenir le statut de tous les jobs
   */
  getStatus() {
    const status = {
      running: this.started,
      startTime: this.startTime,
      uptime: this.started ? Date.now() - this.startTime : 0,
      jobs: {}
    };

    for (const [name, job] of Object.entries(this.jobs)) {
      if (job.getStatus) {
        status.jobs[name] = job.getStatus();
      } else {
        status.jobs[name] = { name, status: 'unknown' };
      }
    }

    return status;
  }

  /**
   * Obtenir le statut d'un job spécifique
   */
  getJobStatus(jobName) {
    const job = this.jobs[jobName];
    
    if (!job) {
      throw new Error(`Job inconnu: ${jobName}`);
    }

    if (!job.getStatus) {
      return { name: jobName, status: 'unknown' };
    }

    return job.getStatus();
  }

  /**
   * Obtenir la liste des jobs
   */
  listJobs() {
    return Object.keys(this.jobs).map(name => {
      const job = this.jobs[name];
      return {
        name,
        enabled: job.enabled !== false,
        schedule: job.schedule || 'N/A',
        running: job.isRunning || false
      };
    });
  }

  /**
   * Vérifier la santé des jobs
   */
  async healthCheck() {
    const health = {
      healthy: true,
      jobs: {},
      issues: []
    };

    for (const [name, job] of Object.entries(this.jobs)) {
      try {
        const status = job.getStatus ? job.getStatus() : { status: 'unknown' };
        
        health.jobs[name] = {
          enabled: status.enabled !== false,
          running: status.running || status.isRunning || false,
          lastRun: status.lastRun || null
        };

        // Vérifier les problèmes
        if (status.enabled && status.stats?.failures > 5) {
          health.healthy = false;
          health.issues.push(`${name}: Trop d'échecs (${status.stats.failures})`);
        }

      } catch (error) {
        health.jobs[name] = {
          status: 'error',
          error: error.message
        };
        health.healthy = false;
        health.issues.push(`${name}: ${error.message}`);
      }
    }

    return health;
  }

  /**
   * Logger le démarrage
   */
  async logStartup(results) {
    try {
      const AuditLog = require('../models').AuditLog;
      
      await AuditLog.create({
        action_type: 'jobs.startup',
        entity_type: 'system',
        severity: 'info',
        details: {
          started: results.filter(r => r.status === 'started').map(r => r.name),
          failed: results.filter(r => r.status === 'error').map(r => ({
            name: r.name,
            error: r.error
          }))
        }
      });
    } catch (error) {
      console.error('[JobManager] Erreur log startup:', error);
    }
  }

  /**
   * Logger l'arrêt
   */
  async logShutdown(results) {
    try {
      const AuditLog = require('../models').AuditLog;
      
      await AuditLog.create({
        action_type: 'jobs.shutdown',
        entity_type: 'system',
        severity: 'info',
        details: {
          stopped: results.filter(r => r.status === 'stopped').map(r => r.name),
          uptime: Date.now() - this.startTime
        }
      });
    } catch (error) {
      console.error('[JobManager] Erreur log shutdown:', error);
    }
  }

  /**
   * Activer/désactiver un job
   */
  async toggleJob(jobName, enabled) {
    const job = this.jobs[jobName];
    
    if (!job) {
      throw new Error(`Job inconnu: ${jobName}`);
    }

    job.enabled = enabled;

    if (enabled && job.start) {
      await job.start();
    } else if (!enabled && job.stop) {
      await job.stop();
    }

    return {
      name: jobName,
      enabled,
      status: enabled ? 'started' : 'stopped'
    };
  }

  /**
   * Recharger la configuration d'un job
   */
  async reloadJobConfig(jobName) {
    const job = this.jobs[jobName];
    
    if (!job) {
      throw new Error(`Job inconnu: ${jobName}`);
    }

    // Arrêter et redémarrer le job avec la nouvelle config
    if (job.stop) await job.stop();
    
    // Recharger la configuration
    const newConfig = config.jobs?.[jobName];
    if (newConfig) {
      Object.assign(job, newConfig);
    }

    if (job.start && job.enabled) await job.start();

    return {
      name: jobName,
      reloaded: true
    };
  }
}

// Créer une instance singleton
const jobManager = new JobManager();

// Export
module.exports = {
  // Instance du manager
  manager: jobManager,
  
  // Jobs individuels
  jobs: {
    waitingListJ3: waitingListJ3Job,
    backup: backupJob,
    maintenance: maintenanceJob,
    keyRotation: keyRotationJob,
    sessionCleanup: sessionCleanupJob,
    healthCheck: healthCheckJob,
    notificationDigest: notificationDigestJob,
    reportGeneration: reportGenerationJob,
    syncLocalServers: syncLocalServersJob,
    dataRetention: dataRetentionJob,
    metricsCollection: metricsCollectionJob,
    alertMonitoring: alertMonitoringJob,
    auditArchive: auditArchiveJob
  },
  
  // Méthodes raccourcies
  startAll: () => jobManager.startAll(),
  stopAll: () => jobManager.stopAll(),
  restartAll: () => jobManager.restartAll(),
  getStatus: () => jobManager.getStatus(),
  healthCheck: () => jobManager.healthCheck(),
  runJob: (name) => jobManager.runJob(name),
  
  // Initialisation dans app.js
  async initialize(app) {
    console.log('[JobManager] Initialisation du système de jobs CRON');
    
    // Ajouter les routes d'administration si app fournie
    if (app) {
      app.get('/api/jobs/status', async (req, res) => {
        res.json(jobManager.getStatus());
      });

      app.post('/api/jobs/:name/run', async (req, res) => {
        try {
          const result = await jobManager.runJob(req.params.name);
          res.json({ success: true, result });
        } catch (error) {
          res.status(400).json({ success: false, error: error.message });
        }
      });

      app.post('/api/jobs/:name/toggle', async (req, res) => {
        try {
          const result = await jobManager.toggleJob(req.params.name, req.body.enabled);
          res.json({ success: true, result });
        } catch (error) {
          res.status(400).json({ success: false, error: error.message });
        }
      });
    }

    // Démarrer tous les jobs après un délai
    setTimeout(async () => {
      await jobManager.startAll();
    }, config.jobs?.startDelay || 10000); // 10 secondes par défaut

    return jobManager;
  }
};
