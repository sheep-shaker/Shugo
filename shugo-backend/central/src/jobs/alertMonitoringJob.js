// jobs/alertMonitoringJob.js
// Job CRON pour surveiller les alertes système

const cron = require('node-cron');
const { Alert, AlertRule, AuditLog } = require('../models');
const NotificationService = require('../services/NotificationService');
const config = require('../config');

class AlertMonitoringJob {
  constructor() {
    this.jobName = 'AlertMonitoringJob';
    this.schedule = config.jobs?.alerting?.schedule || '* * * * *'; // Chaque minute
    this.enabled = config.jobs?.alerting?.enabled !== false;
    this.task = null;
    this.activeAlerts = new Map();
  }

  async start() {
    if (!this.enabled) return;
    
    // Charger les règles d'alerte
    await this.loadAlertRules();
    
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

  async loadAlertRules() {
    this.rules = await AlertRule.findAll({
      where: { is_active: true }
    });
    console.log(`[${this.jobName}] ${this.rules.length} règles d'alerte chargées`);
  }

  async execute() {
    for (const rule of this.rules) {
      try {
        const triggered = await this.evaluateRule(rule);
        
        if (triggered) {
          await this.handleAlert(rule);
        } else {
          await this.clearAlert(rule);
        }
      } catch (error) {
        console.error(`[${this.jobName}] Erreur règle ${rule.name}:`, error);
      }
    }
  }

  async evaluateRule(rule) {
    switch (rule.type) {
      case 'failed_logins':
        return await this.checkFailedLogins(rule.threshold);
      
      case 'error_rate':
        return await this.checkErrorRate(rule.threshold);
      
      case 'low_guards':
        return await this.checkLowGuards(rule.threshold);
      
      case 'system_resource':
        return await this.checkSystemResource(rule.resource, rule.threshold);
      
      case 'custom_query':
        return await this.evaluateCustomQuery(rule.query);
      
      default:
        return false;
    }
  }

  async checkFailedLogins(threshold) {
    const User = require('../models').User;
    const count = await User.count({
      where: {
        failed_login_attempts: { [Op.gte]: threshold },
        last_login_attempt: {
          [Op.gte]: new Date(Date.now() - 300000) // 5 dernières minutes
        }
      }
    });
    return count > 0;
  }

  async checkErrorRate(threshold) {
    const fiveMinAgo = new Date(Date.now() - 300000);
    const errors = await AuditLog.count({
      where: {
        severity: { [Op.in]: ['error', 'critical'] },
        timestamp: { [Op.gte]: fiveMinAgo }
      }
    });
    return errors > threshold;
  }

  async checkLowGuards(threshold) {
    const GuardSchedule = require('../models').GuardSchedule;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const lowStaffed = await GuardSchedule.count({
      where: {
        date: tomorrow,
        current_participants: { [Op.lt]: threshold }
      }
    });
    return lowStaffed > 0;
  }

  async checkSystemResource(resource, threshold) {
    const metrics = await SystemMetrics.findOne({
      order: [['timestamp', 'DESC']]
    });
    
    if (!metrics) return false;
    
    switch (resource) {
      case 'cpu':
        return metrics.cpu_usage > threshold;
      case 'memory':
        return metrics.memory_usage > threshold;
      case 'disk':
        return metrics.disk_usage > threshold;
      default:
        return false;
    }
  }

  async evaluateCustomQuery(query) {
    try {
      const sequelize = require('../models').sequelize;
      const [results] = await sequelize.query(query);
      return results.length > 0 && results[0].triggered === true;
    } catch {
      return false;
    }
  }

  async handleAlert(rule) {
    const alertKey = `${rule.rule_id}`;
    
    // Vérifier si l'alerte est déjà active
    if (this.activeAlerts.has(alertKey)) {
      const alert = this.activeAlerts.get(alertKey);
      
      // Escalader si nécessaire
      if (Date.now() - alert.triggered_at > rule.escalation_after * 60000) {
        await this.escalateAlert(rule, alert);
      }
      return;
    }

    // Créer une nouvelle alerte
    const alert = await Alert.create({
      rule_id: rule.rule_id,
      severity: rule.severity,
      status: 'active',
      triggered_at: new Date(),
      details: {
        rule_name: rule.name,
        condition: rule.condition
      }
    });

    this.activeAlerts.set(alertKey, alert);

    // Notifier
    await this.sendAlertNotification(rule, alert);
    
    // Log audit
    await AuditLog.create({
      action_type: 'alert.triggered',
      entity_type: 'alert',
      entity_id: alert.alert_id,
      severity: rule.severity,
      details: {
        rule: rule.name,
        condition: rule.condition
      }
    });
  }

  async clearAlert(rule) {
    const alertKey = `${rule.rule_id}`;
    
    if (this.activeAlerts.has(alertKey)) {
      const alert = this.activeAlerts.get(alertKey);
      
      await alert.update({
        status: 'resolved',
        resolved_at: new Date()
      });
      
      this.activeAlerts.delete(alertKey);
      
      // Notifier la résolution
      await NotificationService.broadcastToAdmins({
        type: 'alert.resolved',
        title: 'Alerte résolue',
        message: `L'alerte "${rule.name}" a été résolue`,
        priority: 'info',
        data: { rule_name: rule.name }
      });
    }
  }

  async escalateAlert(rule, alert) {
    await alert.update({
      escalated: true,
      escalated_at: new Date()
    });

    // Notifier l'escalade
    await NotificationService.broadcastToAdmins({
      type: 'alert.escalated',
      title: `🚨 ESCALADE: ${rule.name}`,
      message: `L'alerte n'a pas été résolue après ${rule.escalation_after} minutes`,
      priority: 'critical',
      data: {
        rule_name: rule.name,
        triggered_at: alert.triggered_at
      }
    });
  }

  async sendAlertNotification(rule, alert) {
    const priority = {
      low: 'normal',
      medium: 'warning',
      high: 'high',
      critical: 'critical'
    };

    await NotificationService.broadcastToAdmins({
      type: 'alert.new',
      title: `Alerte: ${rule.name}`,
      message: rule.message || `Condition d'alerte détectée: ${rule.condition}`,
      priority: priority[rule.severity] || 'warning',
      data: {
        alert_id: alert.alert_id,
        rule_name: rule.name,
        severity: rule.severity
      }
    });
  }

  getStatus() {
    return {
      name: this.jobName,
      enabled: this.enabled,
      schedule: this.schedule,
      activeAlerts: this.activeAlerts.size,
      rules: this.rules?.length || 0
    };
  }
}

module.exports = new AlertMonitoringJob();
