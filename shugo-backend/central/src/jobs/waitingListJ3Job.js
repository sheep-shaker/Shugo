// jobs/waitingListJ3Job.js
// Job CRON pour l'activation automatique J-3 de la liste d'attente

const cron = require('node-cron');
const { Op } = require('sequelize');
const { 
  WaitingList, 
  GuardSchedule, 
  GuardAssignment,
  User,
  AuditLog,
  Notification
} = require('../models');
const WaitingListService = require('../services/WaitingListService');
const NotificationService = require('../services/NotificationService');
const EmailService = require('../services/EmailService');
const config = require('../config');

class WaitingListJ3Job {
  constructor() {
    this.jobName = 'WaitingListJ3';
    this.schedule = config.jobs?.waitingListJ3?.schedule || '0 6 * * *'; // 6h00 tous les jours
    this.enabled = config.jobs?.waitingListJ3?.enabled !== false;
    this.isRunning = false;
    this.lastRun = null;
    this.task = null;
    this.stats = {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      totalActivations: 0,
      lastError: null
    };
  }

  /**
   * Initialiser et démarrer le job
   */
  async start() {
    if (!this.enabled) {
      console.log(`[${this.jobName}] Job désactivé dans la configuration`);
      return;
    }

    if (this.task) {
      console.log(`[${this.jobName}] Job déjà démarré`);
      return;
    }

    // Créer la tâche CRON
    this.task = cron.schedule(this.schedule, async () => {
      await this.execute();
    }, {
      scheduled: true,
      timezone: config.timezone || 'Europe/Paris'
    });

    console.log(`[${this.jobName}] Job démarré avec schedule: ${this.schedule}`);
    
    // Log audit
    await this.logAudit('job.started', 'info', {
      schedule: this.schedule,
      timezone: config.timezone
    });

    // Exécution initiale si configuré
    if (config.jobs?.waitingListJ3?.runOnStart) {
      console.log(`[${this.jobName}] Exécution initiale...`);
      setTimeout(() => this.execute(), 5000); // Délai de 5 secondes
    }
  }

  /**
   * Arrêter le job
   */
  async stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log(`[${this.jobName}] Job arrêté`);
      
      await this.logAudit('job.stopped', 'info', {
        stats: this.stats
      });
    }
  }

  /**
   * Exécuter le job
   */
  async execute() {
    if (this.isRunning) {
      console.log(`[${this.jobName}] Exécution déjà en cours, ignorée`);
      return;
    }

    const startTime = Date.now();
    this.isRunning = true;
    this.stats.totalRuns++;

    console.log(`[${this.jobName}] Début de l'exécution #${this.stats.totalRuns}`);

    try {
      // Calculer J+3 (3 jours dans le futur)
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 3);
      targetDate.setHours(0, 0, 0, 0);

      const results = {
        date: targetDate,
        guards: [],
        activations: [],
        notifications: [],
        errors: []
      };

      // 1. Récupérer les gardes à J+3 avec des postes vacants
      const vacantGuards = await this.findVacantGuards(targetDate);
      results.guards = vacantGuards;

      console.log(`[${this.jobName}] ${vacantGuards.length} gardes avec postes vacants trouvés pour le ${targetDate.toLocaleDateString('fr-FR')}`);

      // 2. Pour chaque garde vacant, activer depuis la liste d'attente
      for (const guard of vacantGuards) {
        try {
          const activationResult = await this.activateForGuard(guard, targetDate);
          
          if (activationResult.activated.length > 0) {
            results.activations.push(...activationResult.activated);
            results.notifications.push(...activationResult.notifications);
          }

        } catch (error) {
          console.error(`[${this.jobName}] Erreur activation garde ${guard.guard_id}:`, error);
          results.errors.push({
            guard_id: guard.guard_id,
            error: error.message
          });
        }
      }

      // 3. Envoyer un rapport récapitulatif
      await this.sendSummaryReport(results);

      // 4. Mettre à jour les statistiques
      this.stats.successfulRuns++;
      this.stats.totalActivations += results.activations.length;
      this.lastRun = {
        timestamp: new Date(),
        duration: Date.now() - startTime,
        results
      };

      console.log(`[${this.jobName}] Exécution terminée avec succès:`);
      console.log(`  - Gardes traités: ${results.guards.length}`);
      console.log(`  - Activations: ${results.activations.length}`);
      console.log(`  - Notifications envoyées: ${results.notifications.length}`);
      console.log(`  - Erreurs: ${results.errors.length}`);
      console.log(`  - Durée: ${this.lastRun.duration}ms`);

      // Log audit succès
      await this.logAudit('job.executed', 'info', {
        duration_ms: this.lastRun.duration,
        guards_processed: results.guards.length,
        activations: results.activations.length,
        notifications: results.notifications.length
      });

    } catch (error) {
      this.stats.failedRuns++;
      this.stats.lastError = {
        message: error.message,
        stack: error.stack,
        timestamp: new Date()
      };

      console.error(`[${this.jobName}] Erreur lors de l'exécution:`, error);

      // Log audit erreur
      await this.logAudit('job.failed', 'error', {
        error: error.message,
        stack: error.stack
      });

      // Notifier les admins
      await this.notifyError(error);

    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Trouver les gardes avec postes vacants à J+3
   */
  async findVacantGuards(targetDate) {
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const guards = await GuardSchedule.findAll({
      where: {
        date: {
          [Op.gte]: targetDate,
          [Op.lt]: nextDay
        },
        status: 'scheduled',
        [Op.or]: [
          { current_participants: { [Op.lt]: GuardSchedule.sequelize.col('min_participants') } },
          { '$assignments.member_id$': null }
        ]
      },
      include: [{
        model: GuardAssignment,
        as: 'assignments',
        required: false,
        where: {
          status: { [Op.in]: ['confirmed', 'present'] }
        }
      }],
      having: GuardSchedule.sequelize.literal(
        'COUNT(assignments.assignment_id) < guard_schedule.min_participants'
      ),
      group: ['guard_schedule.guard_id']
    });

    // Analyser chaque garde pour déterminer les besoins
    const vacantGuards = [];
    
    for (const guard of guards) {
      const currentCount = guard.assignments?.length || 0;
      const needed = guard.min_participants - currentCount;
      
      if (needed > 0) {
        vacantGuards.push({
          guard_id: guard.guard_id,
          date: guard.date,
          shift: guard.shift_type,
          geo_id: guard.geo_id,
          current_participants: currentCount,
          min_participants: guard.min_participants,
          max_participants: guard.max_participants,
          needed_participants: needed,
          can_accept: Math.min(needed, guard.max_participants - currentCount)
        });
      }
    }

    return vacantGuards;
  }

  /**
   * Activer les participants depuis la liste d'attente pour une garde
   */
  async activateForGuard(guard, targetDate) {
    const result = {
      guard_id: guard.guard_id,
      activated: [],
      notifications: [],
      errors: []
    };

    try {
      // Récupérer la liste d'attente pour cette garde avec scores de matching
      const waitingList = await WaitingList.findAll({
        where: {
          guard_id: guard.guard_id,
          status: 'waiting',
          is_active: true
        },
        order: [
          ['priority', 'DESC'],
          ['skill_match_score', 'DESC'],
          ['availability_match_score', 'DESC'],
          ['position', 'ASC'],
          ['joined_at', 'ASC']
        ],
        limit: guard.can_accept,
        include: [{
          model: User,
          as: 'member',
          where: {
            is_active: true,
            geo_id: {
              [Op.or]: [
                guard.geo_id,
                { [Op.like]: `${guard.geo_id}%` } // Inclure les sous-zones
              ]
            }
          }
        }]
      });

      console.log(`[${this.jobName}] ${waitingList.length} candidats trouvés pour garde ${guard.guard_id}`);

      // Activer chaque participant
      for (const entry of waitingList) {
        try {
          // Créer l'assignation
          const assignment = await GuardAssignment.create({
            guard_id: guard.guard_id,
            member_id: entry.member_id,
            assigned_by: 'SYSTEM_J3',
            assignment_type: 'automatic_j3',
            status: 'pending_confirmation',
            confirmation_deadline: this.calculateConfirmationDeadline(targetDate),
            notes: `Activation automatique J-3 depuis liste d'attente (position ${entry.position})`
          });

          // Mettre à jour l'entrée de liste d'attente
          await entry.update({
            status: 'activated',
            activated_at: new Date(),
            activation_type: 'j3_automatic'
          });

          // Notifier le participant
          const notificationResult = await this.notifyActivation({
            user: entry.member,
            guard,
            assignment,
            targetDate
          });

          result.activated.push({
            member_id: entry.member_id,
            assignment_id: assignment.assignment_id,
            position: entry.position
          });

          result.notifications.push(notificationResult);

          // Log audit individuel
          await this.logAudit('waiting_list.j3_activation', 'info', {
            member_id: entry.member_id,
            guard_id: guard.guard_id,
            position: entry.position,
            assignment_id: assignment.assignment_id
          });

        } catch (error) {
          console.error(`[${this.jobName}] Erreur activation membre ${entry.member_id}:`, error);
          result.errors.push({
            member_id: entry.member_id,
            error: error.message
          });
        }
      }

      // Mettre à jour le nombre de participants de la garde
      await GuardSchedule.update(
        { 
          current_participants: guard.current_participants + result.activated.length,
          last_updated: new Date()
        },
        { where: { guard_id: guard.guard_id } }
      );

    } catch (error) {
      console.error(`[${this.jobName}] Erreur traitement garde ${guard.guard_id}:`, error);
      result.errors.push({
        guard_id: guard.guard_id,
        error: error.message
      });
    }

    return result;
  }

  /**
   * Notifier un participant de son activation
   */
  async notifyActivation({ user, guard, assignment, targetDate }) {
    const result = {
      member_id: user.member_id,
      email: false,
      notification: false,
      sms: false
    };

    try {
      // Notification in-app
      await NotificationService.send({
        user_id: user.member_id,
        type: 'waiting_list.j3_activation',
        title: 'Activation pour une garde dans 3 jours',
        message: `Vous avez été activé(e) pour la garde du ${targetDate.toLocaleDateString('fr-FR')} (${guard.shift}). Veuillez confirmer votre participation.`,
        priority: 'high',
        data: {
          guard_id: guard.guard_id,
          assignment_id: assignment.assignment_id,
          confirmation_deadline: assignment.confirmation_deadline,
          action_url: `/guards/confirm/${assignment.assignment_id}`
        }
      });
      result.notification = true;

      // Email
      await EmailService.sendJ3Activation({
        email: user.email,
        name: user.first_name,
        guard_date: targetDate,
        guard_shift: guard.shift,
        confirmation_deadline: assignment.confirmation_deadline,
        confirmation_url: `${config.app.url}/guards/confirm/${assignment.assignment_id}`
      });
      result.email = true;

      // SMS si configuré
      if (user.phone && config.sms?.enabled) {
        // Implémenter l'envoi SMS
        result.sms = true;
      }

    } catch (error) {
      console.error(`[${this.jobName}] Erreur notification ${user.member_id}:`, error);
    }

    return result;
  }

  /**
   * Calculer la deadline de confirmation (J-1 à 18h)
   */
  calculateConfirmationDeadline(guardDate) {
    const deadline = new Date(guardDate);
    deadline.setDate(deadline.getDate() - 1); // J-1
    deadline.setHours(18, 0, 0, 0); // 18h00
    return deadline;
  }

  /**
   * Envoyer le rapport récapitulatif
   */
  async sendSummaryReport(results) {
    try {
      // Préparer le contenu du rapport
      const report = {
        date: results.date.toLocaleDateString('fr-FR'),
        statistics: {
          guards_processed: results.guards.length,
          total_activations: results.activations.length,
          notifications_sent: results.notifications.length,
          errors: results.errors.length
        },
        details: {
          guards: results.guards.map(g => ({
            guard_id: g.guard_id,
            shift: g.shift,
            needed: g.needed_participants,
            activated: results.activations.filter(a => 
              results.guards.find(guard => guard.guard_id === g.guard_id)
            ).length
          })),
          errors: results.errors
        }
      };

      // Envoyer aux coordinateurs
      const coordinators = await User.findAll({
        where: {
          role: { [Op.in]: ['coordinator', 'admin', 'super_admin'] },
          is_active: true
        }
      });

      for (const coordinator of coordinators) {
        await EmailService.sendTemplatedEmail({
          to: coordinator.email,
          template: 'j3_activation_report',
          data: {
            name: coordinator.first_name,
            report,
            dashboard_url: `${config.app.url}/admin/waiting-list`
          }
        });
      }

    } catch (error) {
      console.error(`[${this.jobName}] Erreur envoi rapport:`, error);
    }
  }

  /**
   * Notifier une erreur aux admins
   */
  async notifyError(error) {
    try {
      await NotificationService.broadcastToAdmins({
        type: 'job.error',
        title: `Erreur Job ${this.jobName}`,
        message: `Le job ${this.jobName} a rencontré une erreur: ${error.message}`,
        priority: 'high',
        data: {
          job_name: this.jobName,
          error: error.message,
          timestamp: new Date()
        }
      });
    } catch (notifyError) {
      console.error(`[${this.jobName}] Erreur notification:`, notifyError);
    }
  }

  /**
   * Logger dans l'audit trail
   */
  async logAudit(action, severity, details) {
    try {
      await AuditLog.create({
        action_type: action,
        entity_type: 'job',
        entity_id: this.jobName,
        severity,
        details: {
          job_name: this.jobName,
          ...details
        }
      });
    } catch (error) {
      console.error(`[${this.jobName}] Erreur audit log:`, error);
    }
  }

  /**
   * Obtenir le statut du job
   */
  getStatus() {
    return {
      name: this.jobName,
      enabled: this.enabled,
      running: this.isRunning,
      schedule: this.schedule,
      lastRun: this.lastRun,
      stats: this.stats,
      nextRun: this.task ? this.getNextRunTime() : null
    };
  }

  /**
   * Calculer la prochaine exécution
   */
  getNextRunTime() {
    if (!this.task) return null;
    
    // Parser le cron schedule pour calculer la prochaine exécution
    const cronParser = require('cron-parser');
    try {
      const interval = cronParser.parseExpression(this.schedule, {
        tz: config.timezone || 'Europe/Paris'
      });
      return interval.next().toDate();
    } catch (error) {
      return null;
    }
  }

  /**
   * Exécution manuelle forcée
   */
  async runManual() {
    console.log(`[${this.jobName}] Exécution manuelle déclenchée`);
    await this.execute();
  }
}

// Export singleton
module.exports = new WaitingListJ3Job();
