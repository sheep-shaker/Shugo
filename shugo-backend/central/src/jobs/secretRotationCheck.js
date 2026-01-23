'use strict';

/**
 * SHUGO v7.0 - Secret Rotation Check Job
 *
 * Vérifie l'état des secrets partagés et déclenche la rotation si nécessaire.
 * Les secrets ont une validité annuelle et doivent être renouvelés avant expiration.
 *
 * @see Document Technique V7.0 - Chapitre 6
 */

const { Op } = require('sequelize');
const { SharedSecret, LocalInstance, AuditLog, User } = require('../models');
const logger = require('../utils/logger');
const NotificationService = require('../services/NotificationService');
const SecretRotationService = require('../services/SecretRotationService');

/**
 * Configuration de la rotation des secrets
 */
const ROTATION_CONFIG = {
  // Nombre de jours avant expiration pour déclencher une alerte
  warning_days: 30,
  // Nombre de jours avant expiration pour rotation automatique
  auto_rotation_days: 14,
  // Nombre de jours avant expiration critique
  critical_days: 7,
  // Durée de validité d'un secret (en jours)
  validity_days: 365,
  // Nombre maximum de tentatives de rotation
  max_rotation_attempts: 3
};

/**
 * États des secrets
 */
const SECRET_STATUS = {
  ACTIVE: 'active',
  PENDING_ROTATION: 'pending_rotation',
  ROTATING: 'rotating',
  EXPIRED: 'expired',
  COMPROMISED: 'compromised'
};

/**
 * Classe principale du job de vérification des secrets
 */
class SecretRotationCheckJob {
  constructor() {
    this.stats = {
      total_secrets: 0,
      active: 0,
      expiring_soon: 0,
      critical: 0,
      expired: 0,
      rotations_initiated: 0,
      notifications_sent: 0,
      errors: []
    };
  }

  /**
   * Exécute la vérification des secrets
   */
  async execute() {
    const startTime = new Date();
    logger.info('[SecretRotationCheck] Démarrage de la vérification des secrets');

    try {
      // 1. Récupérer tous les secrets actifs
      const secrets = await this.getActiveSecrets();
      this.stats.total_secrets = secrets.length;

      // 2. Analyser chaque secret
      const analysis = await this.analyzeSecrets(secrets);

      // 3. Traiter les secrets expirés
      await this.handleExpiredSecrets(analysis.expired);

      // 4. Traiter les secrets critiques
      await this.handleCriticalSecrets(analysis.critical);

      // 5. Initier les rotations automatiques si nécessaire
      await this.initiateAutoRotations(analysis.autoRotate);

      // 6. Envoyer les alertes pour les secrets expirant bientôt
      await this.sendExpirationWarnings(analysis.warning);

      // 7. Vérifier les rotations en cours
      await this.checkPendingRotations();

      // 8. Générer le rapport
      const report = this.generateReport(analysis);

      // 9. Logger l'exécution
      await this.logExecution(startTime, report);

      logger.info('[SecretRotationCheck] Vérification terminée', this.stats);

      return {
        success: true,
        duration_ms: Date.now() - startTime.getTime(),
        stats: this.stats,
        report
      };

    } catch (error) {
      logger.error('[SecretRotationCheck] Erreur critique:', error);
      throw error;
    }
  }

  /**
   * Récupère tous les secrets actifs
   */
  async getActiveSecrets() {
    return await SharedSecret.findAll({
      where: {
        status: { [Op.in]: [SECRET_STATUS.ACTIVE, SECRET_STATUS.PENDING_ROTATION] }
      },
      include: [{
        model: LocalInstance,
        as: 'localServer',
        attributes: ['instance_id', 'name', 'geo_id', 'status', 'last_sync_at']
      }]
    });
  }

  /**
   * Analyse les secrets et les catégorise
   */
  async analyzeSecrets(secrets) {
    const now = new Date();
    const result = {
      healthy: [],
      warning: [],
      autoRotate: [],
      critical: [],
      expired: []
    };

    for (const secret of secrets) {
      const expiresAt = new Date(secret.expires_at);
      const daysUntilExpiry = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

      secret.daysUntilExpiry = daysUntilExpiry;

      if (daysUntilExpiry <= 0) {
        result.expired.push(secret);
        this.stats.expired++;
      } else if (daysUntilExpiry <= ROTATION_CONFIG.critical_days) {
        result.critical.push(secret);
        this.stats.critical++;
      } else if (daysUntilExpiry <= ROTATION_CONFIG.auto_rotation_days) {
        result.autoRotate.push(secret);
        this.stats.expiring_soon++;
      } else if (daysUntilExpiry <= ROTATION_CONFIG.warning_days) {
        result.warning.push(secret);
        this.stats.expiring_soon++;
      } else {
        result.healthy.push(secret);
        this.stats.active++;
      }
    }

    return result;
  }

  /**
   * Gère les secrets expirés
   */
  async handleExpiredSecrets(expiredSecrets) {
    for (const secret of expiredSecrets) {
      try {
        // Marquer comme expiré
        await secret.update({ status: SECRET_STATUS.EXPIRED });

        // Notifier les administrateurs
        await this.notifyAdmins({
          type: 'secret_expired',
          title: 'Secret expiré',
          message: `Le secret partagé pour ${secret.localServer?.name || secret.local_instance_id} a expiré`,
          priority: 'critical',
          data: {
            secret_id: secret.secret_id,
            local_instance_id: secret.local_instance_id,
            expired_at: secret.expires_at
          }
        });

        // Audit
        await AuditLog.create({
          action_type: 'secret.expired',
          entity_type: 'shared_secret',
          entity_id: secret.secret_id,
          severity: 'critical',
          details: {
            local_instance_id: secret.local_instance_id,
            expired_at: secret.expires_at
          }
        });

        this.stats.notifications_sent++;

      } catch (error) {
        this.stats.errors.push({
          secret_id: secret.secret_id,
          action: 'handleExpired',
          error: error.message
        });
      }
    }
  }

  /**
   * Gère les secrets en état critique
   */
  async handleCriticalSecrets(criticalSecrets) {
    for (const secret of criticalSecrets) {
      try {
        // Notifier avec priorité critique
        await this.notifyAdmins({
          type: 'secret_critical',
          title: 'Secret en expiration critique',
          message: `Le secret pour ${secret.localServer?.name || secret.local_instance_id} expire dans ${secret.daysUntilExpiry} jours`,
          priority: 'critical',
          data: {
            secret_id: secret.secret_id,
            local_instance_id: secret.local_instance_id,
            days_until_expiry: secret.daysUntilExpiry
          }
        });

        // Tenter une rotation automatique d'urgence
        if (secret.status !== SECRET_STATUS.PENDING_ROTATION) {
          await this.initiateRotation(secret, 'critical_expiry');
        }

        this.stats.notifications_sent++;

      } catch (error) {
        this.stats.errors.push({
          secret_id: secret.secret_id,
          action: 'handleCritical',
          error: error.message
        });
      }
    }
  }

  /**
   * Initie les rotations automatiques
   */
  async initiateAutoRotations(secretsToRotate) {
    for (const secret of secretsToRotate) {
      try {
        if (secret.status === SECRET_STATUS.PENDING_ROTATION) {
          continue; // Rotation déjà en cours
        }

        await this.initiateRotation(secret, 'auto_rotation');

      } catch (error) {
        this.stats.errors.push({
          secret_id: secret.secret_id,
          action: 'initiateAutoRotation',
          error: error.message
        });
      }
    }
  }

  /**
   * Initie une rotation de secret
   */
  async initiateRotation(secret, reason) {
    try {
      // Marquer comme en cours de rotation
      await secret.update({ status: SECRET_STATUS.PENDING_ROTATION });

      // Appeler le service de rotation
      await SecretRotationService.initiateRotation({
        secret_id: secret.secret_id,
        local_instance_id: secret.local_instance_id,
        reason
      });

      // Audit
      await AuditLog.create({
        action_type: 'secret.rotation_initiated',
        entity_type: 'shared_secret',
        entity_id: secret.secret_id,
        severity: 'warning',
        details: {
          local_instance_id: secret.local_instance_id,
          reason,
          days_until_expiry: secret.daysUntilExpiry
        }
      });

      this.stats.rotations_initiated++;

      logger.info(`[SecretRotationCheck] Rotation initiée pour secret ${secret.secret_id}`, { reason });

    } catch (error) {
      logger.error(`[SecretRotationCheck] Erreur rotation secret ${secret.secret_id}:`, error);
      throw error;
    }
  }

  /**
   * Envoie les alertes d'expiration proche
   */
  async sendExpirationWarnings(secretsExpiringSoon) {
    for (const secret of secretsExpiringSoon) {
      try {
        // Vérifier si une alerte n'a pas déjà été envoyée récemment
        const recentAlert = await AuditLog.findOne({
          where: {
            action_type: 'secret.expiration_warning',
            entity_id: secret.secret_id,
            created_at: { [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
          }
        });

        if (recentAlert) continue;

        await this.notifyAdmins({
          type: 'secret_expiring',
          title: 'Secret expirant bientôt',
          message: `Le secret pour ${secret.localServer?.name || secret.local_instance_id} expire dans ${secret.daysUntilExpiry} jours`,
          priority: 'high',
          data: {
            secret_id: secret.secret_id,
            local_instance_id: secret.local_instance_id,
            days_until_expiry: secret.daysUntilExpiry,
            expires_at: secret.expires_at
          }
        });

        // Logger l'alerte
        await AuditLog.create({
          action_type: 'secret.expiration_warning',
          entity_type: 'shared_secret',
          entity_id: secret.secret_id,
          severity: 'warning',
          details: {
            days_until_expiry: secret.daysUntilExpiry
          }
        });

        this.stats.notifications_sent++;

      } catch (error) {
        this.stats.errors.push({
          secret_id: secret.secret_id,
          action: 'sendWarning',
          error: error.message
        });
      }
    }
  }

  /**
   * Vérifie les rotations en cours
   */
  async checkPendingRotations() {
    try {
      const pendingSecrets = await SharedSecret.findAll({
        where: { status: SECRET_STATUS.PENDING_ROTATION }
      });

      for (const secret of pendingSecrets) {
        // Vérifier si la rotation est bloquée depuis trop longtemps
        const rotationStarted = secret.rotation_started_at || secret.updated_at;
        const hoursSinceStart = (Date.now() - new Date(rotationStarted).getTime()) / (1000 * 60 * 60);

        if (hoursSinceStart > 24) {
          // Rotation bloquée - alerter
          await this.notifyAdmins({
            type: 'rotation_stuck',
            title: 'Rotation de secret bloquée',
            message: `La rotation du secret pour ${secret.local_instance_id} est bloquée depuis ${Math.round(hoursSinceStart)} heures`,
            priority: 'critical',
            data: {
              secret_id: secret.secret_id,
              hours_stuck: hoursSinceStart
            }
          });

          this.stats.notifications_sent++;
        }
      }

    } catch (error) {
      this.stats.errors.push({
        action: 'checkPendingRotations',
        error: error.message
      });
    }
  }

  /**
   * Notifie les administrateurs
   */
  async notifyAdmins(notification) {
    try {
      const admins = await User.findAll({
        where: { role: { [Op.in]: ['admin', 'root_admin'] } }
      });

      for (const admin of admins) {
        await NotificationService.send({
          user_id: admin.member_id,
          ...notification
        });
      }

    } catch (error) {
      logger.error('[SecretRotationCheck] Erreur notification admins:', error);
    }
  }

  /**
   * Génère le rapport de vérification
   */
  generateReport(analysis) {
    return {
      timestamp: new Date(),
      summary: {
        total: this.stats.total_secrets,
        healthy: analysis.healthy.length,
        warning: analysis.warning.length,
        auto_rotate: analysis.autoRotate.length,
        critical: analysis.critical.length,
        expired: analysis.expired.length
      },
      secrets_by_status: {
        healthy: analysis.healthy.map(s => ({
          secret_id: s.secret_id,
          local_instance: s.localServer?.name,
          days_until_expiry: s.daysUntilExpiry
        })),
        warning: analysis.warning.map(s => ({
          secret_id: s.secret_id,
          local_instance: s.localServer?.name,
          days_until_expiry: s.daysUntilExpiry
        })),
        critical: analysis.critical.map(s => ({
          secret_id: s.secret_id,
          local_instance: s.localServer?.name,
          days_until_expiry: s.daysUntilExpiry
        })),
        expired: analysis.expired.map(s => ({
          secret_id: s.secret_id,
          local_instance: s.localServer?.name,
          expired_at: s.expires_at
        }))
      },
      actions_taken: {
        rotations_initiated: this.stats.rotations_initiated,
        notifications_sent: this.stats.notifications_sent
      },
      errors: this.stats.errors
    };
  }

  /**
   * Enregistre l'exécution du job
   */
  async logExecution(startTime, report) {
    await AuditLog.create({
      action_type: 'job.secret_rotation_check',
      entity_type: 'system',
      severity: this.stats.critical > 0 || this.stats.expired > 0 ? 'warning' : 'info',
      details: {
        duration_ms: Date.now() - startTime.getTime(),
        stats: this.stats,
        report_summary: report.summary
      }
    });
  }
}

/**
 * Fonction exportée pour le scheduler
 */
async function run() {
  const job = new SecretRotationCheckJob();
  return await job.execute();
}

module.exports = { run, SecretRotationCheckJob, ROTATION_CONFIG, SECRET_STATUS };
