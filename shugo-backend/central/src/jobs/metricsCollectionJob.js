// jobs/metricsCollectionJob.js
// Job CRON pour collecter les métriques système

const cron = require('node-cron');
const { SystemMetrics, AuditLog } = require('../models');
const config = require('../config');
const os = require('os');

class MetricsCollectionJob {
  constructor() {
    this.jobName = 'MetricsCollectionJob';
    this.schedule = config.jobs?.metrics?.schedule || '*/5 * * * *'; // Toutes les 5 minutes
    this.enabled = config.jobs?.metrics?.enabled !== false;
    this.task = null;
  }

  async start() {
    if (!this.enabled) return;
    
    this.task = cron.schedule(this.schedule, async () => {
      await this.execute();
    });
    
    console.log(`[${this.jobName}] Job démarré: ${this.schedule}`);
  }

  async stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  async execute() {
    const metrics = await this.collectMetrics();
    
    await SystemMetrics.create({
      timestamp: new Date(),
      cpu_usage: metrics.cpu,
      memory_usage: metrics.memory,
      disk_usage: metrics.disk,
      active_users: metrics.activeUsers,
      response_time: metrics.responseTime,
      error_rate: metrics.errorRate,
      custom_metrics: metrics.custom
    });

    // Vérifier les seuils d'alerte
    await this.checkThresholds(metrics);
  }

  async collectMetrics() {
    const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
    const memUsage = (1 - os.freemem() / os.totalmem()) * 100;
    
    // Requêtes DB pour métriques métier
    const Session = require('../models').Session;
    const activeUsers = await Session.count({
      where: { is_active: true }
    });

    return {
      cpu: cpuUsage,
      memory: memUsage,
      disk: await this.getDiskUsage(),
      activeUsers,
      responseTime: await this.getAvgResponseTime(),
      errorRate: await this.getErrorRate(),
      custom: {
        guards_today: await this.getGuardsToday(),
        pending_validations: await this.getPendingValidations()
      }
    };
  }

  async getDiskUsage() {
    const { exec } = require('child_process').promises;
    try {
      const { stdout } = await exec("df -h / | tail -1 | awk '{print $5}' | sed 's/%//'");
      return parseFloat(stdout.trim());
    } catch {
      return 0;
    }
  }

  async getAvgResponseTime() {
    // Calculer depuis les logs d'accès
    return Math.random() * 100 + 50; // Placeholder
  }

  async getErrorRate() {
    const oneHourAgo = new Date(Date.now() - 3600000);
    const errors = await AuditLog.count({
      where: {
        severity: 'error',
        timestamp: { [Op.gte]: oneHourAgo }
      }
    });
    const total = await AuditLog.count({
      where: {
        timestamp: { [Op.gte]: oneHourAgo }
      }
    });
    return total > 0 ? (errors / total) * 100 : 0;
  }

  async getGuardsToday() {
    const GuardSchedule = require('../models').GuardSchedule;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    return await GuardSchedule.count({
      where: {
        date: { [Op.gte]: today, [Op.lt]: tomorrow }
      }
    });
  }

  async getPendingValidations() {
    const UserMission = require('../models').UserMission;
    return await UserMission.count({
      where: {
        validation_status: 'pending'
      }
    });
  }

  async checkThresholds(metrics) {
    const thresholds = config.monitoring?.thresholds || {
      cpu: 80,
      memory: 90,
      disk: 85,
      errorRate: 5
    };

    const alerts = [];
    if (metrics.cpu > thresholds.cpu) {
      alerts.push(`CPU usage: ${metrics.cpu.toFixed(2)}%`);
    }
    if (metrics.memory > thresholds.memory) {
      alerts.push(`Memory usage: ${metrics.memory.toFixed(2)}%`);
    }
    if (metrics.disk > thresholds.disk) {
      alerts.push(`Disk usage: ${metrics.disk.toFixed(2)}%`);
    }
    if (metrics.errorRate > thresholds.errorRate) {
      alerts.push(`Error rate: ${metrics.errorRate.toFixed(2)}%`);
    }

    if (alerts.length > 0) {
      const NotificationService = require('../services/NotificationService');
      await NotificationService.broadcastToAdmins({
        type: 'system.metrics_alert',
        title: 'Seuils métriques dépassés',
        message: alerts.join(', '),
        priority: 'warning',
        data: metrics
      });
    }
  }

  getStatus() {
    return {
      name: this.jobName,
      enabled: this.enabled,
      schedule: this.schedule
    };
  }
}

module.exports = new MetricsCollectionJob();
