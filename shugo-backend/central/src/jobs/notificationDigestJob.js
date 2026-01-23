'use strict';

/**
 * SHUGO v7.0 - Job de digest des notifications
 *
 * Exécution: Tous les jours à 8h00
 * - Envoie un résumé quotidien des notifications non lues
 * - Regroupe les notifications par catégorie
 * - Respecte les préférences utilisateur
 *
 * @see Document Technique V7.0 - Section 4.2
 */

const cron = require('node-cron');
const { Op } = require('sequelize');

const DEFAULT_CONFIG = {
  schedule: '0 8 * * *',        // Tous les jours à 8h00
  minNotifications: 3,          // Minimum pour envoyer un digest
  maxNotifications: 50,         // Maximum de notifications par digest
  lookbackHours: 24,            // Regarder les 24 dernières heures
  batchSize: 100,               // Utilisateurs par batch
  enabled: true
};

class NotificationDigestJob {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cronJob = null;
    this.isRunning = false;
    this.lastRun = null;
    this.stats = {
      runs: 0,
      digestsSent: 0,
      notificationsIncluded: 0,
      failures: 0
    };
  }

  async start() {
    if (this.cronJob) {
      console.log('[NotificationDigestJob] Déjà démarré');
      return;
    }

    if (!this.config.enabled) {
      console.log('[NotificationDigestJob] Désactivé par configuration');
      return;
    }

    this.cronJob = cron.schedule(this.config.schedule, async () => {
      await this.execute();
    }, { scheduled: true });

    console.log(`[NotificationDigestJob] Démarré (${this.config.schedule})`);
  }

  async stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    console.log('[NotificationDigestJob] Arrêté');
  }

  async execute() {
    if (this.isRunning) {
      console.log('[NotificationDigestJob] Déjà en cours');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      console.log('[NotificationDigestJob] Début génération des digests...');

      const models = require('../models');
      const { User, Notification } = models;

      if (!User || !Notification) {
        console.log('[NotificationDigestJob] Modèles non disponibles');
        return { sent: 0, skipped: 0 };
      }

      const cutoffTime = new Date(Date.now() - this.config.lookbackHours * 60 * 60 * 1000);
      const results = { sent: 0, skipped: 0, errors: 0 };

      // Trouver les utilisateurs avec des notifications non lues
      const usersWithNotifications = await Notification.findAll({
        where: {
          read_at: null,
          created_at: { [Op.gte]: cutoffTime }
        },
        attributes: [
          'member_id',
          [models.sequelize.fn('COUNT', '*'), 'count']
        ],
        group: ['member_id'],
        having: models.sequelize.literal(`COUNT(*) >= ${this.config.minNotifications}`)
      });

      console.log(`[NotificationDigestJob] ${usersWithNotifications.length} utilisateurs avec digests à envoyer`);

      for (const userData of usersWithNotifications) {
        try {
          const memberId = userData.member_id;
          const count = parseInt(userData.get('count'));

          // Récupérer l'utilisateur
          const user = await User.findByPk(memberId);
          if (!user || user.status !== 'active') {
            results.skipped++;
            continue;
          }

          // Vérifier les préférences (digest activé?)
          if (user.notification_preferences?.digest === false) {
            results.skipped++;
            continue;
          }

          // Récupérer les notifications
          const notifications = await Notification.findAll({
            where: {
              member_id: memberId,
              read_at: null,
              created_at: { [Op.gte]: cutoffTime }
            },
            order: [['created_at', 'DESC']],
            limit: this.config.maxNotifications
          });

          // Grouper par catégorie
          const grouped = this._groupNotifications(notifications);

          // Générer et envoyer le digest
          await this._sendDigest(user, grouped, count);

          results.sent++;
          this.stats.digestsSent++;
          this.stats.notificationsIncluded += notifications.length;

        } catch (error) {
          console.error(`[NotificationDigestJob] Erreur pour user ${userData.member_id}:`, error);
          results.errors++;
        }
      }

      this.stats.runs++;
      this.lastRun = new Date();

      const duration = Date.now() - startTime;
      console.log(`[NotificationDigestJob] Terminé en ${duration}ms:`, results);

      await this._logExecution(results);

      return results;

    } catch (error) {
      this.stats.failures++;
      console.error('[NotificationDigestJob] Erreur:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  _groupNotifications(notifications) {
    const groups = {
      guard: [],
      system: [],
      account: [],
      support: [],
      other: []
    };

    for (const notif of notifications) {
      const category = notif.category || 'other';
      if (groups[category]) {
        groups[category].push(notif);
      } else {
        groups.other.push(notif);
      }
    }

    return groups;
  }

  async _sendDigest(user, groupedNotifications, totalCount) {
    try {
      const NotificationService = require('../services/NotificationService');

      // Construire le contenu du digest
      const digestContent = this._buildDigestContent(groupedNotifications, totalCount);

      // Envoyer via le service de notification
      // Note: Le service doit gérer l'envoi email avec template digest
      await NotificationService.send(
        user.member_id,
        'NOTIFICATION_DIGEST',
        {
          totalCount,
          ...digestContent,
          userName: user.first_name_encrypted // Sera déchiffré par le service
        },
        { immediate: true }
      );

    } catch (error) {
      // Si le service n'est pas disponible, logger silencieusement
      console.warn('[NotificationDigestJob] Service notification non disponible:', error.message);
    }
  }

  _buildDigestContent(groups, totalCount) {
    const sections = [];

    if (groups.guard.length > 0) {
      sections.push({
        title: 'Gardes',
        count: groups.guard.length,
        items: groups.guard.slice(0, 5).map(n => n.title)
      });
    }

    if (groups.system.length > 0) {
      sections.push({
        title: 'Système',
        count: groups.system.length,
        items: groups.system.slice(0, 3).map(n => n.title)
      });
    }

    if (groups.account.length > 0) {
      sections.push({
        title: 'Compte',
        count: groups.account.length,
        items: groups.account.slice(0, 3).map(n => n.title)
      });
    }

    if (groups.support.length > 0) {
      sections.push({
        title: 'Support',
        count: groups.support.length,
        items: groups.support.slice(0, 3).map(n => n.title)
      });
    }

    if (groups.other.length > 0) {
      sections.push({
        title: 'Autres',
        count: groups.other.length,
        items: groups.other.slice(0, 3).map(n => n.title)
      });
    }

    return {
      sections,
      summary: `Vous avez ${totalCount} notification(s) non lue(s)`
    };
  }

  async _logExecution(results) {
    try {
      const { AuditLog } = require('../models');
      if (AuditLog) {
        await AuditLog.create({
          action_type: 'notification.digest',
          entity_type: 'system',
          severity: 'info',
          details: results
        });
      }
    } catch (err) {
      console.error('[NotificationDigestJob] Erreur log:', err.message);
    }
  }

  async runManual() {
    console.log('[NotificationDigestJob] Exécution manuelle demandée');
    return await this.execute();
  }

  getStatus() {
    return {
      name: 'notificationDigest',
      enabled: this.config.enabled,
      schedule: this.config.schedule,
      running: this.isRunning,
      lastRun: this.lastRun,
      stats: { ...this.stats }
    };
  }
}

module.exports = new NotificationDigestJob();
module.exports.NotificationDigestJob = NotificationDigestJob;
