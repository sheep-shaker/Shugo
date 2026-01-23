'use strict';

/**
 * SHUGO v7.0 - Guard Reminders Job
 *
 * Envoie des relances pour les créneaux de garde vides.
 * Exécuté les Lundi, Jeudi et Samedi.
 *
 * @see Document Technique V7.0 - Chapitre 4
 */

const { Op } = require('sequelize');
const {
  Guard,
  GuardAssignment,
  GuardSlot,
  User,
  Group,
  GroupMembership,
  WaitingList,
  AuditLog
} = require('../models');
const logger = require('../utils/logger');
const NotificationService = require('../services/NotificationService');
const EmailService = require('../services/EmailService');

/**
 * Configuration des relances
 */
const REMINDER_CONFIG = {
  // Jours d'exécution (0 = Dimanche)
  execution_days: [1, 4, 6], // Lundi, Jeudi, Samedi
  // Horizon de recherche des créneaux vides (jours)
  lookahead_days: 14,
  // Nombre minimum de créneaux vides pour déclencher une alerte
  alert_threshold: 3,
  // Délai minimum entre deux rappels au même utilisateur (heures)
  min_reminder_interval_hours: 48,
  // Priorité des notifications
  notification_priority: 'medium'
};

/**
 * Types de rappels
 */
const REMINDER_TYPES = {
  EMPTY_SLOT: 'empty_slot',
  LOW_COVERAGE: 'low_coverage',
  URGENT_NEED: 'urgent_need',
  WEEKLY_SUMMARY: 'weekly_summary'
};

/**
 * Classe principale du job de rappels de garde
 */
class GuardRemindersJob {
  constructor() {
    this.stats = {
      empty_slots_found: 0,
      reminders_sent: 0,
      emails_sent: 0,
      users_notified: 0,
      groups_with_gaps: 0,
      errors: []
    };
  }

  /**
   * Exécute le job de rappels
   */
  async execute() {
    const startTime = new Date();
    const today = new Date().getDay();

    // Vérifier si c'est un jour d'exécution
    if (!REMINDER_CONFIG.execution_days.includes(today)) {
      logger.info('[GuardReminders] Pas un jour d\'exécution, skip');
      return { success: true, skipped: true, reason: 'not_execution_day' };
    }

    logger.info('[GuardReminders] Démarrage des relances de garde');

    try {
      // 1. Identifier les créneaux vides
      const emptySlots = await this.findEmptySlots();
      this.stats.empty_slots_found = emptySlots.length;

      if (emptySlots.length === 0) {
        logger.info('[GuardReminders] Aucun créneau vide trouvé');
        return {
          success: true,
          duration_ms: Date.now() - startTime.getTime(),
          stats: this.stats
        };
      }

      // 2. Grouper par zone géographique
      const slotsByGeo = this.groupSlotsByGeo(emptySlots);

      // 3. Pour chaque zone, identifier les utilisateurs disponibles
      for (const [geoId, slots] of Object.entries(slotsByGeo)) {
        await this.processGeoZone(geoId, slots);
      }

      // 4. Envoyer le résumé aux administrateurs
      await this.sendAdminSummary(slotsByGeo);

      // 5. Logger l'exécution
      await this.logExecution(startTime);

      logger.info('[GuardReminders] Relances terminées', this.stats);

      return {
        success: true,
        duration_ms: Date.now() - startTime.getTime(),
        stats: this.stats
      };

    } catch (error) {
      logger.error('[GuardReminders] Erreur critique:', error);
      throw error;
    }
  }

  /**
   * Trouve les créneaux de garde vides dans l'horizon
   */
  async findEmptySlots() {
    const now = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + REMINDER_CONFIG.lookahead_days);

    // Récupérer les gardes actives avec leurs slots
    const guards = await Guard.findAll({
      where: {
        status: 'active',
        start_date: { [Op.lte]: endDate },
        [Op.or]: [
          { end_date: null },
          { end_date: { [Op.gte]: now } }
        ]
      },
      include: [{
        model: GuardSlot,
        as: 'slots',
        where: {
          date: { [Op.between]: [now, endDate] },
          status: { [Op.in]: ['empty', 'needs_coverage'] }
        },
        required: false
      }, {
        model: Group,
        as: 'group',
        attributes: ['group_id', 'name', 'geo_id']
      }]
    });

    const emptySlots = [];

    for (const guard of guards) {
      // Si pas de slots définis, vérifier les assignations
      if (!guard.slots || guard.slots.length === 0) {
        const assignments = await GuardAssignment.findAll({
          where: {
            guard_id: guard.guard_id,
            status: 'active',
            date: { [Op.between]: [now, endDate] }
          }
        });

        // Identifier les jours sans assignation
        const assignedDates = new Set(
          assignments.map(a => a.date.toISOString().split('T')[0])
        );

        const currentDate = new Date(now);
        while (currentDate <= endDate) {
          const dateStr = currentDate.toISOString().split('T')[0];
          if (!assignedDates.has(dateStr)) {
            emptySlots.push({
              guard_id: guard.guard_id,
              guard_name: guard.name,
              group_id: guard.group?.group_id,
              group_name: guard.group?.name,
              geo_id: guard.group?.geo_id || guard.geo_id,
              date: new Date(currentDate),
              type: 'no_assignment'
            });
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }
      } else {
        // Utiliser les slots vides
        for (const slot of guard.slots) {
          emptySlots.push({
            guard_id: guard.guard_id,
            guard_name: guard.name,
            slot_id: slot.slot_id,
            group_id: guard.group?.group_id,
            group_name: guard.group?.name,
            geo_id: guard.group?.geo_id || guard.geo_id,
            date: slot.date,
            start_time: slot.start_time,
            end_time: slot.end_time,
            type: slot.status
          });
        }
      }
    }

    return emptySlots;
  }

  /**
   * Groupe les créneaux par zone géographique
   */
  groupSlotsByGeo(slots) {
    const grouped = {};

    for (const slot of slots) {
      const geoId = slot.geo_id || 'unknown';
      if (!grouped[geoId]) {
        grouped[geoId] = [];
      }
      grouped[geoId].push(slot);
    }

    return grouped;
  }

  /**
   * Traite une zone géographique
   */
  async processGeoZone(geoId, slots) {
    try {
      this.stats.groups_with_gaps++;

      // Trouver les utilisateurs disponibles dans cette zone
      const availableUsers = await this.findAvailableUsers(geoId, slots);

      if (availableUsers.length === 0) {
        logger.warn(`[GuardReminders] Aucun utilisateur disponible pour ${geoId}`);
        return;
      }

      // Déterminer le type de rappel
      const reminderType = this.determineReminderType(slots);

      // Envoyer les notifications
      for (const user of availableUsers) {
        await this.sendReminder(user, slots, reminderType, geoId);
      }

    } catch (error) {
      this.stats.errors.push({ geoId, error: error.message });
      logger.error(`[GuardReminders] Erreur traitement zone ${geoId}:`, error);
    }
  }

  /**
   * Trouve les utilisateurs disponibles pour une zone
   */
  async findAvailableUsers(geoId, slots) {
    // Récupérer les utilisateurs de la zone
    const users = await User.findAll({
      where: {
        geo_id: { [Op.like]: `${geoId.substring(0, 5)}%` },
        status: 'active',
        role: { [Op.in]: ['member', 'volunteer', 'guard'] }
      },
      include: [{
        model: GroupMembership,
        as: 'memberships',
        where: { status: 'active' },
        required: false
      }]
    });

    // Filtrer ceux qui n'ont pas reçu de rappel récemment
    const minReminderDate = new Date();
    minReminderDate.setHours(
      minReminderDate.getHours() - REMINDER_CONFIG.min_reminder_interval_hours
    );

    const availableUsers = [];

    for (const user of users) {
      // Vérifier le dernier rappel
      const lastReminder = await AuditLog.findOne({
        where: {
          action_type: 'guard.reminder_sent',
          member_id: user.member_id,
          created_at: { [Op.gte]: minReminderDate }
        }
      });

      if (!lastReminder) {
        // Vérifier la liste d'attente (ne pas rappeler quelqu'un déjà en attente)
        const inWaitingList = await WaitingList.findOne({
          where: {
            member_id: user.member_id,
            status: 'pending'
          }
        });

        if (!inWaitingList) {
          availableUsers.push(user);
        }
      }
    }

    return availableUsers;
  }

  /**
   * Détermine le type de rappel selon l'urgence
   */
  determineReminderType(slots) {
    const now = new Date();

    // Vérifier les créneaux dans les 3 prochains jours
    const urgentSlots = slots.filter(s => {
      const slotDate = new Date(s.date);
      const daysUntil = Math.ceil((slotDate - now) / (1000 * 60 * 60 * 24));
      return daysUntil <= 3;
    });

    if (urgentSlots.length > 0) {
      return REMINDER_TYPES.URGENT_NEED;
    }

    if (slots.length >= REMINDER_CONFIG.alert_threshold) {
      return REMINDER_TYPES.LOW_COVERAGE;
    }

    return REMINDER_TYPES.EMPTY_SLOT;
  }

  /**
   * Envoie un rappel à un utilisateur
   */
  async sendReminder(user, slots, reminderType, geoId) {
    try {
      // Construire le message
      const message = this.buildReminderMessage(slots, reminderType);

      // Notification in-app
      await NotificationService.send({
        user_id: user.member_id,
        type: `guard_reminder_${reminderType}`,
        title: this.getReminderTitle(reminderType),
        message: message.short,
        priority: reminderType === REMINDER_TYPES.URGENT_NEED ? 'high' : REMINDER_CONFIG.notification_priority,
        data: {
          slots_count: slots.length,
          geo_id: geoId,
          slots: slots.slice(0, 5).map(s => ({
            date: s.date,
            guard_name: s.guard_name
          }))
        }
      });

      this.stats.reminders_sent++;

      // Email si urgent ou si l'utilisateur a activé les emails
      if (reminderType === REMINDER_TYPES.URGENT_NEED || user.email_notifications_enabled) {
        await EmailService.send({
          to: user.email,
          subject: this.getReminderTitle(reminderType),
          template: 'guard_reminder',
          data: {
            user_name: user.first_name,
            slots,
            reminder_type: reminderType,
            action_url: `${process.env.APP_URL}/guards/available`
          }
        });

        this.stats.emails_sent++;
      }

      // Logger l'envoi
      await AuditLog.create({
        action_type: 'guard.reminder_sent',
        member_id: user.member_id,
        entity_type: 'guard_reminder',
        severity: 'info',
        details: {
          reminder_type: reminderType,
          geo_id: geoId,
          slots_count: slots.length
        }
      });

      this.stats.users_notified++;

    } catch (error) {
      this.stats.errors.push({
        user_id: user.member_id,
        action: 'sendReminder',
        error: error.message
      });
      logger.error(`[GuardReminders] Erreur envoi rappel à ${user.member_id}:`, error);
    }
  }

  /**
   * Construit le message de rappel
   */
  buildReminderMessage(slots, reminderType) {
    const slotDates = slots
      .slice(0, 3)
      .map(s => new Date(s.date).toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      }))
      .join(', ');

    const messages = {
      [REMINDER_TYPES.URGENT_NEED]: {
        short: `URGENT: ${slots.length} créneau(x) de garde non pourvu(s) dans les 3 prochains jours`,
        long: `Des créneaux de garde urgents nécessitent votre attention: ${slotDates}. Votre participation serait grandement appréciée.`
      },
      [REMINDER_TYPES.LOW_COVERAGE]: {
        short: `${slots.length} créneaux de garde disponibles dans votre zone`,
        long: `Plusieurs créneaux de garde sont disponibles: ${slotDates}. N'hésitez pas à vous inscrire pour aider votre communauté.`
      },
      [REMINDER_TYPES.EMPTY_SLOT]: {
        short: `Créneaux de garde disponibles: ${slotDates}`,
        long: `Des créneaux de garde sont disponibles dans votre zone. Consultez les disponibilités et inscrivez-vous si vous êtes disponible.`
      }
    };

    return messages[reminderType] || messages[REMINDER_TYPES.EMPTY_SLOT];
  }

  /**
   * Retourne le titre du rappel
   */
  getReminderTitle(reminderType) {
    const titles = {
      [REMINDER_TYPES.URGENT_NEED]: 'Gardes urgentes à pourvoir',
      [REMINDER_TYPES.LOW_COVERAGE]: 'Créneaux de garde disponibles',
      [REMINDER_TYPES.EMPTY_SLOT]: 'Opportunité de garde',
      [REMINDER_TYPES.WEEKLY_SUMMARY]: 'Résumé hebdomadaire des gardes'
    };
    return titles[reminderType] || 'Rappel de garde';
  }

  /**
   * Envoie le résumé aux administrateurs
   */
  async sendAdminSummary(slotsByGeo) {
    try {
      const admins = await User.findAll({
        where: { role: { [Op.in]: ['admin', 'coordinator'] } }
      });

      const summary = Object.entries(slotsByGeo).map(([geoId, slots]) => ({
        geo_id: geoId,
        empty_slots: slots.length,
        urgent: slots.filter(s => {
          const daysUntil = Math.ceil((new Date(s.date) - new Date()) / (1000 * 60 * 60 * 24));
          return daysUntil <= 3;
        }).length
      }));

      for (const admin of admins) {
        await NotificationService.send({
          user_id: admin.member_id,
          type: 'guard_reminder_summary',
          title: 'Résumé des créneaux non pourvus',
          message: `${this.stats.empty_slots_found} créneaux vides, ${this.stats.reminders_sent} rappels envoyés`,
          priority: 'low',
          data: { summary }
        });
      }

    } catch (error) {
      logger.error('[GuardReminders] Erreur envoi résumé admin:', error);
    }
  }

  /**
   * Enregistre l'exécution du job
   */
  async logExecution(startTime) {
    await AuditLog.create({
      action_type: 'job.guard_reminders',
      entity_type: 'system',
      severity: 'info',
      details: {
        duration_ms: Date.now() - startTime.getTime(),
        stats: this.stats
      }
    });
  }
}

/**
 * Fonction exportée pour le scheduler
 */
async function run() {
  const job = new GuardRemindersJob();
  return await job.execute();
}

module.exports = { run, GuardRemindersJob, REMINDER_CONFIG, REMINDER_TYPES };
