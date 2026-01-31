'use strict';

/**
 * SHUGO v7.0 - Job de génération des rapports
 *
 * Exécution: Tous les lundis à 6h00
 * - Génère les rapports hebdomadaires de gardes
 * - Génère les statistiques d'activité
 * - Crée les rapports de conformité
 * - Archive les rapports générés
 *
 * @see Document Technique V7.0 - Section 10.3
 */

const cron = require('node-cron');
const { Op } = require('sequelize');
const path = require('path');
const fs = require('fs').promises;

const DEFAULT_CONFIG = {
  schedule: '0 6 * * 1',        // Tous les lundis à 6h00
  reportsPath: './reports',
  retentionDays: 90,            // Garder les rapports 90 jours
  formats: ['json', 'csv'],
  enabled: true
};

class ReportGenerationJob {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cronJob = null;
    this.isRunning = false;
    this.lastRun = null;
    this.stats = {
      runs: 0,
      reportsGenerated: 0,
      failures: 0
    };
  }

  async start() {
    if (this.cronJob) {
      console.log('[ReportGenerationJob] Déjà démarré');
      return;
    }

    if (!this.config.enabled) {
      console.log('[ReportGenerationJob] Désactivé par configuration');
      return;
    }

    // Créer le dossier des rapports s'il n'existe pas
    await this._ensureReportsDirectory();

    this.cronJob = cron.schedule(this.config.schedule, async () => {
      await this.execute();
    }, { scheduled: true });

    console.log(`[ReportGenerationJob] Démarré (${this.config.schedule})`);
  }

  async stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    console.log('[ReportGenerationJob] Arrêté');
  }

  async execute() {
    if (this.isRunning) {
      console.log('[ReportGenerationJob] Déjà en cours');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      console.log('[ReportGenerationJob] Début génération des rapports...');

      const models = require('../models');
      const reports = [];
      const weekStart = this._getWeekStart();
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      // 1. Rapport des gardes hebdomadaire
      const guardReport = await this._generateGuardReport(models, weekStart, weekEnd);
      reports.push(guardReport);

      // 2. Rapport d'activité utilisateurs
      const activityReport = await this._generateActivityReport(models, weekStart, weekEnd);
      reports.push(activityReport);

      // 3. Rapport de conformité
      const complianceReport = await this._generateComplianceReport(models, weekStart, weekEnd);
      reports.push(complianceReport);

      // 4. Rapport de support
      const supportReport = await this._generateSupportReport(models, weekStart, weekEnd);
      reports.push(supportReport);

      // Sauvegarder les rapports
      for (const report of reports) {
        await this._saveReport(report);
        this.stats.reportsGenerated++;
      }

      // Nettoyer les anciens rapports
      await this._cleanupOldReports();

      this.stats.runs++;
      this.lastRun = new Date();

      const duration = Date.now() - startTime;
      console.log(`[ReportGenerationJob] ${reports.length} rapports générés en ${duration}ms`);

      await this._logExecution(reports);

      return reports.map(r => ({ name: r.name, file: r.filename }));

    } catch (error) {
      this.stats.failures++;
      console.error('[ReportGenerationJob] Erreur:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  async _generateGuardReport(models, startDate, endDate) {
    const { Guard, GuardAssignment } = models;

    const guards = await Guard.findAll({
      where: {
        guard_date: { [Op.between]: [startDate, endDate] }
      },
      include: GuardAssignment ? [{
        model: GuardAssignment,
        as: 'assignments'
      }] : []
    });

    const stats = {
      totalGuards: guards.length,
      totalSlots: 0,
      filledSlots: 0,
      emptyGuards: 0,
      cancelledGuards: 0,
      byDay: {}
    };

    for (const guard of guards) {
      stats.totalSlots += guard.max_participants || 0;
      stats.filledSlots += guard.current_participants || 0;

      if (guard.current_participants === 0) stats.emptyGuards++;
      if (guard.status === 'cancelled') stats.cancelledGuards++;

      // Stats par jour - Handle both Date objects and string dates
      const dayKey = typeof guard.guard_date === 'string'
        ? guard.guard_date.split('T')[0]
        : guard.guard_date.toISOString().split('T')[0];
      if (!stats.byDay[dayKey]) {
        stats.byDay[dayKey] = { guards: 0, participants: 0 };
      }
      stats.byDay[dayKey].guards++;
      stats.byDay[dayKey].participants += guard.current_participants || 0;
    }

    stats.fillRate = stats.totalSlots > 0
      ? Math.round((stats.filledSlots / stats.totalSlots) * 100)
      : 0;

    return {
      name: 'guard_weekly',
      type: 'guards',
      period: { start: startDate, end: endDate },
      generatedAt: new Date(),
      data: stats
    };
  }

  async _generateActivityReport(models, startDate, endDate) {
    const { User, AuditLog } = models;

    const stats = {
      activeUsers: 0,
      newUsers: 0,
      logins: 0,
      actions: {}
    };

    // Utilisateurs actifs (qui ont fait une action)
    if (AuditLog) {
      const activeUserIds = await AuditLog.findAll({
        where: {
          created_at: { [Op.between]: [startDate, endDate] },
          member_id: { [Op.ne]: null }
        },
        attributes: [[models.sequelize.fn('DISTINCT', models.sequelize.col('member_id')), 'member_id']],
        raw: true
      });
      stats.activeUsers = activeUserIds.length;

      // Actions par type
      const actionCounts = await AuditLog.findAll({
        where: {
          created_at: { [Op.between]: [startDate, endDate] }
        },
        attributes: [
          'action_type',
          [models.sequelize.fn('COUNT', '*'), 'count']
        ],
        group: ['action_type']
      });

      for (const ac of actionCounts) {
        stats.actions[ac.action_type] = parseInt(ac.get('count'));
      }

      // Logins
      stats.logins = stats.actions['auth.login'] || 0;
    }

    // Nouveaux utilisateurs
    if (User) {
      stats.newUsers = await User.count({
        where: {
          created_at: { [Op.between]: [startDate, endDate] }
        }
      });
    }

    return {
      name: 'activity_weekly',
      type: 'activity',
      period: { start: startDate, end: endDate },
      generatedAt: new Date(),
      data: stats
    };
  }

  async _generateComplianceReport(models, startDate, endDate) {
    const stats = {
      passwordChanges: 0,
      twoFactorEnabled: 0,
      securityIncidents: 0,
      dataAccess: 0
    };

    const { AuditLog, User } = models;

    if (AuditLog) {
      // Changements de mot de passe
      stats.passwordChanges = await AuditLog.count({
        where: {
          action_type: 'user.password_change',
          created_at: { [Op.between]: [startDate, endDate] }
        }
      });

      // Incidents de sécurité
      stats.securityIncidents = await AuditLog.count({
        where: {
          severity: 'error',
          action_type: { [Op.like]: 'security.%' },
          created_at: { [Op.between]: [startDate, endDate] }
        }
      });

      // Accès aux données sensibles
      stats.dataAccess = await AuditLog.count({
        where: {
          action_type: { [Op.like]: 'vault.%' },
          created_at: { [Op.between]: [startDate, endDate] }
        }
      });
    }

    // Utilisateurs avec 2FA
    if (User) {
      stats.twoFactorEnabled = await User.count({
        where: { two_factor_enabled: true }
      });
    }

    return {
      name: 'compliance_weekly',
      type: 'compliance',
      period: { start: startDate, end: endDate },
      generatedAt: new Date(),
      data: stats
    };
  }

  async _generateSupportReport(models, startDate, endDate) {
    const { SupportRequest } = models;

    const stats = {
      totalTickets: 0,
      resolved: 0,
      pending: 0,
      avgResolutionHours: 0,
      byCategory: {}
    };

    if (SupportRequest) {
      const tickets = await SupportRequest.findAll({
        where: {
          created_at: { [Op.between]: [startDate, endDate] }
        }
      });

      stats.totalTickets = tickets.length;

      let totalResolutionTime = 0;
      let resolvedCount = 0;

      for (const ticket of tickets) {
        // Par statut
        if (ticket.status === 'resolved' || ticket.status === 'closed') {
          stats.resolved++;
          if (ticket.resolved_at) {
            totalResolutionTime += ticket.resolved_at - ticket.created_at;
            resolvedCount++;
          }
        } else {
          stats.pending++;
        }

        // Par catégorie
        const cat = ticket.category || 'other';
        stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
      }

      if (resolvedCount > 0) {
        stats.avgResolutionHours = Math.round(totalResolutionTime / resolvedCount / (1000 * 60 * 60));
      }
    }

    return {
      name: 'support_weekly',
      type: 'support',
      period: { start: startDate, end: endDate },
      generatedAt: new Date(),
      data: stats
    };
  }

  async _saveReport(report) {
    const dateStr = report.period.start.toISOString().split('T')[0];
    const baseFilename = `${report.name}_${dateStr}`;

    // Sauvegarder en JSON
    if (this.config.formats.includes('json')) {
      const jsonPath = path.join(this.config.reportsPath, `${baseFilename}.json`);
      await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
      report.filename = `${baseFilename}.json`;
    }

    // Sauvegarder en CSV si applicable
    if (this.config.formats.includes('csv') && report.data) {
      const csvPath = path.join(this.config.reportsPath, `${baseFilename}.csv`);
      const csvContent = this._toCSV(report.data);
      await fs.writeFile(csvPath, csvContent);
    }
  }

  _toCSV(data) {
    const lines = ['key,value'];
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'object') {
        lines.push(`${key},"${JSON.stringify(value).replace(/"/g, '""')}"`);
      } else {
        lines.push(`${key},${value}`);
      }
    }
    return lines.join('\n');
  }

  async _ensureReportsDirectory() {
    try {
      await fs.mkdir(this.config.reportsPath, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  async _cleanupOldReports() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

      const files = await fs.readdir(this.config.reportsPath);
      let deleted = 0;

      for (const file of files) {
        const filePath = path.join(this.config.reportsPath, file);
        const stat = await fs.stat(filePath);

        if (stat.mtime < cutoffDate) {
          await fs.unlink(filePath);
          deleted++;
        }
      }

      if (deleted > 0) {
        console.log(`[ReportGenerationJob] ${deleted} anciens rapports supprimés`);
      }
    } catch (error) {
      console.error('[ReportGenerationJob] Erreur nettoyage:', error.message);
    }
  }

  _getWeekStart() {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1) - 7; // Lundi de la semaine dernière
    const weekStart = new Date(now.setDate(diff));
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
  }

  async _logExecution(reports) {
    try {
      const { AuditLog } = require('../models');
      if (AuditLog) {
        await AuditLog.create({
          action_type: 'report.generation',
          entity_type: 'system',
          severity: 'info',
          details: {
            reportsGenerated: reports.length,
            reports: reports.map(r => r.name)
          }
        });
      }
    } catch (err) {
      console.error('[ReportGenerationJob] Erreur log:', err.message);
    }
  }

  async runManual() {
    console.log('[ReportGenerationJob] Exécution manuelle demandée');
    return await this.execute();
  }

  getStatus() {
    return {
      name: 'reportGeneration',
      enabled: this.config.enabled,
      schedule: this.config.schedule,
      running: this.isRunning,
      lastRun: this.lastRun,
      stats: { ...this.stats }
    };
  }
}

module.exports = new ReportGenerationJob();
module.exports.ReportGenerationJob = ReportGenerationJob;
