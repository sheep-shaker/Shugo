// jobs/auditArchiveJob.js
// Job CRON pour archiver les anciens logs d'audit

const cron = require('node-cron');
const { Op } = require('sequelize');
const { AuditLog, AuditArchive } = require('../models');
const fs = require('fs').promises;
const path = require('path');
const config = require('../config');

class AuditArchiveJob {
  constructor() {
    this.jobName = 'AuditArchiveJob';
    this.schedule = config.jobs?.auditArchive?.schedule || '0 2 * * 0'; // 2h00 dimanche
    this.enabled = config.jobs?.auditArchive?.enabled !== false;
    this.task = null;
    this.archiveAge = config.audit?.archiveAge || 90; // 90 jours par défaut
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
    console.log(`[${this.jobName}] Début archivage des logs d'audit`);
    const startTime = Date.now();

    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - this.archiveAge);

      // Récupérer les logs à archiver
      const logsToArchive = await AuditLog.findAll({
        where: {
          timestamp: { [Op.lt]: cutoff }
        },
        order: [['timestamp', 'ASC']]
      });

      if (logsToArchive.length === 0) {
        console.log(`[${this.jobName}] Aucun log à archiver`);
        return;
      }

      console.log(`[${this.jobName}] ${logsToArchive.length} logs à archiver`);

      // Grouper par mois
      const logsByMonth = this.groupByMonth(logsToArchive);

      for (const [month, logs] of Object.entries(logsByMonth)) {
        await this.archiveMonth(month, logs);
      }

      // Supprimer les logs archivés
      const deleted = await AuditLog.destroy({
        where: {
          audit_id: { [Op.in]: logsToArchive.map(l => l.audit_id) }
        }
      });

      const duration = Date.now() - startTime;
      console.log(`[${this.jobName}] Archivage terminé`);
      console.log(`  - Logs archivés: ${logsToArchive.length}`);
      console.log(`  - Logs supprimés: ${deleted}`);
      console.log(`  - Durée: ${duration}ms`);

      // Log l'archivage lui-même
      await AuditLog.create({
        action_type: 'audit.archived',
        entity_type: 'system',
        severity: 'info',
        details: {
          archived_count: logsToArchive.length,
          deleted_count: deleted,
          duration_ms: duration
        }
      });

    } catch (error) {
      console.error(`[${this.jobName}] Erreur:`, error);
    }
  }

  groupByMonth(logs) {
    const grouped = {};
    
    for (const log of logs) {
      const month = log.timestamp.toISOString().substring(0, 7); // YYYY-MM
      if (!grouped[month]) {
        grouped[month] = [];
      }
      grouped[month].push(log);
    }
    
    return grouped;
  }

  async archiveMonth(month, logs) {
    const archivePath = path.join(
      config.audit?.archivePath || '/var/shugo/archives/audit',
      `${month}.json`
    );

    // Créer le répertoire si nécessaire
    await fs.mkdir(path.dirname(archivePath), { recursive: true });

    // Sauvegarder en JSON
    const archiveData = {
      month,
      count: logs.length,
      created_at: new Date(),
      logs: logs.map(l => l.toJSON())
    };

    await fs.writeFile(archivePath, JSON.stringify(archiveData, null, 2));

    // Créer une entrée d'archive en DB
    await AuditArchive.create({
      month,
      file_path: archivePath,
      logs_count: logs.length,
      size: Buffer.byteLength(JSON.stringify(archiveData)),
      checksum: this.calculateChecksum(archiveData)
    });

    console.log(`[${this.jobName}] Archivé ${logs.length} logs pour ${month}`);
  }

  calculateChecksum(data) {
    const crypto = require('crypto');
    return crypto.createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
  }

  getStatus() {
    return {
      name: this.jobName,
      enabled: this.enabled,
      schedule: this.schedule,
      archiveAge: this.archiveAge
    };
  }
}

module.exports = new AuditArchiveJob();
