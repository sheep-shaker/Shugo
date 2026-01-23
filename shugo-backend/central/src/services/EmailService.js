'use strict';

/**
 * SHUGO v7.0 - Service de notifications email
 *
 * Gestion des emails via Mailjet :
 * - Envoi de notifications transactionnelles
 * - Templates email
 * - Envoi en masse (digest, rappels)
 * - Suivi des envois
 *
 * @see Document Technique V7.0 - Section 4.4
 */

const crypto = require('crypto');
const config = require('../config');

/**
 * Types d'emails
 */
const EMAIL_TYPES = {
  WELCOME: 'welcome',
  PASSWORD_RESET: 'password_reset',
  PASSWORD_CHANGED: 'password_changed',
  EMAIL_VERIFICATION: 'email_verification',
  TWO_FACTOR_SETUP: 'two_factor_setup',
  TWO_FACTOR_BACKUP: 'two_factor_backup',
  GUARD_REMINDER: 'guard_reminder',
  GUARD_ASSIGNED: 'guard_assigned',
  GUARD_CANCELLED: 'guard_cancelled',
  GUARD_SWAP_REQUEST: 'guard_swap_request',
  GUARD_SWAP_ACCEPTED: 'guard_swap_accepted',
  NOTIFICATION_DIGEST: 'notification_digest',
  MISSION_ASSIGNED: 'mission_assigned',
  MISSION_REVOKED: 'mission_revoked',
  SUPPORT_TICKET_CREATED: 'support_ticket_created',
  SUPPORT_TICKET_REPLY: 'support_ticket_reply',
  SUPPORT_TICKET_CLOSED: 'support_ticket_closed',
  ACCOUNT_LOCKED: 'account_locked',
  ACCOUNT_UNLOCKED: 'account_unlocked',
  SECURITY_ALERT: 'security_alert',
  EMERGENCY_CODE_USED: 'emergency_code_used',
  PROTOCOL_ACTIVATED: 'protocol_activated',
  MAINTENANCE_SCHEDULED: 'maintenance_scheduled',
  SYSTEM_ALERT: 'system_alert'
};

/**
 * Priorités d'envoi
 */
const EMAIL_PRIORITY = {
  CRITICAL: 1,   // Envoi immédiat
  HIGH: 2,       // Envoi dans les 5 minutes
  NORMAL: 3,     // Envoi dans les 15 minutes
  LOW: 4         // Envoi groupé (digest)
};

/**
 * Templates email par défaut
 */
const DEFAULT_TEMPLATES = {
  [EMAIL_TYPES.WELCOME]: {
    subject: 'Bienvenue sur SHUGO',
    templateId: process.env.MAILJET_TPL_WELCOME || null
  },
  [EMAIL_TYPES.PASSWORD_RESET]: {
    subject: 'Réinitialisation de votre mot de passe SHUGO',
    templateId: process.env.MAILJET_TPL_PASSWORD_RESET || null
  },
  [EMAIL_TYPES.EMAIL_VERIFICATION]: {
    subject: 'Vérifiez votre adresse email SHUGO',
    templateId: process.env.MAILJET_TPL_EMAIL_VERIFY || null
  },
  [EMAIL_TYPES.GUARD_REMINDER]: {
    subject: 'Rappel: Vous êtes de garde {{date}}',
    templateId: process.env.MAILJET_TPL_GUARD_REMINDER || null
  },
  [EMAIL_TYPES.GUARD_ASSIGNED]: {
    subject: 'Nouvelle garde assignée - {{date}}',
    templateId: process.env.MAILJET_TPL_GUARD_ASSIGNED || null
  },
  [EMAIL_TYPES.NOTIFICATION_DIGEST]: {
    subject: 'Votre résumé SHUGO du {{date}}',
    templateId: process.env.MAILJET_TPL_DIGEST || null
  },
  [EMAIL_TYPES.SECURITY_ALERT]: {
    subject: '⚠️ Alerte sécurité SHUGO',
    templateId: process.env.MAILJET_TPL_SECURITY || null
  },
  [EMAIL_TYPES.PROTOCOL_ACTIVATED]: {
    subject: '🔴 Protocole de sécurité activé',
    templateId: process.env.MAILJET_TPL_PROTOCOL || null
  },
  [EMAIL_TYPES.SUPPORT_TICKET_CREATED]: {
    subject: 'Ticket #{{ticketId}} créé - {{subject}}',
    templateId: process.env.MAILJET_TPL_SUPPORT || null
  }
};

class EmailService {
  constructor() {
    this.mailjet = null;
    this.isInitialized = false;
    this.stats = {
      sent: 0,
      failed: 0,
      queued: 0
    };

    // File d'attente pour les envois groupés
    this._queue = [];
    this._queueTimer = null;
    this._queueInterval = 60000; // 1 minute

    // Cache des templates
    this._templateCache = new Map();
  }

  /**
   * Initialise le service avec Mailjet
   */
  async initialize(options = {}) {
    if (this.isInitialized) return;

    const mailjetConfig = config.notifications.mailjet;

    if (!mailjetConfig.enabled) {
      console.log('[EmailService] Mailjet désactivé');
      this.isInitialized = true;
      return { initialized: true, enabled: false };
    }

    if (!mailjetConfig.apiKey || !mailjetConfig.apiSecret) {
      console.warn('[EmailService] Clés API Mailjet manquantes');
      this.isInitialized = true;
      return { initialized: true, enabled: false };
    }

    try {
      // Initialiser le client Mailjet
      const Mailjet = require('node-mailjet');
      this.mailjet = Mailjet.apiConnect(
        mailjetConfig.apiKey,
        mailjetConfig.apiSecret
      );

      // Charger les templates
      await this._loadTemplates();

      // Démarrer le processeur de queue
      this._startQueueProcessor();

      this.isInitialized = true;
      console.log('[EmailService] Initialisé avec Mailjet');

      return { initialized: true, enabled: true };
    } catch (error) {
      console.error('[EmailService] Erreur initialisation:', error.message);
      this.isInitialized = true;
      return { initialized: true, enabled: false, error: error.message };
    }
  }

  // =========================================
  // ENVOI D'EMAILS
  // =========================================

  /**
   * Envoie un email
   */
  async send(options) {
    const {
      to,
      type,
      subject,
      templateData = {},
      priority = EMAIL_PRIORITY.NORMAL,
      attachments = [],
      trackOpens = true,
      trackClicks = true
    } = options;

    if (!to) {
      throw new EmailError('MISSING_RECIPIENT', 'Destinataire requis');
    }

    // Préparer les données
    const emailData = {
      id: crypto.randomBytes(8).toString('hex'),
      to: this._normalizeRecipient(to),
      type,
      subject: this._processSubject(subject, type, templateData),
      templateData,
      priority,
      attachments,
      trackOpens,
      trackClicks,
      createdAt: new Date()
    };

    // Si priorité critique ou haute, envoi immédiat
    if (priority <= EMAIL_PRIORITY.HIGH) {
      return await this._sendImmediate(emailData);
    }

    // Sinon, mettre en queue
    return this._enqueue(emailData);
  }

  /**
   * Envoie un email de bienvenue
   */
  async sendWelcome(user, options = {}) {
    return this.send({
      to: user.email,
      type: EMAIL_TYPES.WELCOME,
      templateData: {
        firstName: user.firstName || user.first_name,
        lastName: user.lastName || user.last_name,
        memberId: user.memberId || user.member_id,
        loginUrl: `${config.server.baseUrl}/login`
      },
      priority: EMAIL_PRIORITY.HIGH,
      ...options
    });
  }

  /**
   * Envoie un email de réinitialisation de mot de passe
   */
  async sendPasswordReset(user, resetToken, options = {}) {
    const resetUrl = `${config.server.baseUrl}/reset-password?token=${resetToken}`;

    return this.send({
      to: user.email,
      type: EMAIL_TYPES.PASSWORD_RESET,
      templateData: {
        firstName: user.firstName || user.first_name,
        resetUrl,
        expiresIn: '2 heures'
      },
      priority: EMAIL_PRIORITY.CRITICAL,
      ...options
    });
  }

  /**
   * Envoie un email de vérification
   */
  async sendEmailVerification(user, verificationToken, options = {}) {
    const verifyUrl = `${config.server.baseUrl}/verify-email?token=${verificationToken}`;

    return this.send({
      to: user.email,
      type: EMAIL_TYPES.EMAIL_VERIFICATION,
      templateData: {
        firstName: user.firstName || user.first_name,
        verifyUrl
      },
      priority: EMAIL_PRIORITY.HIGH,
      ...options
    });
  }

  /**
   * Envoie un rappel de garde
   */
  async sendGuardReminder(user, guard, options = {}) {
    return this.send({
      to: user.email,
      type: EMAIL_TYPES.GUARD_REMINDER,
      templateData: {
        firstName: user.firstName || user.first_name,
        date: this._formatDate(guard.date),
        shift: this._translateShift(guard.shift),
        timeStart: guard.time_start,
        timeEnd: guard.time_end,
        location: guard.location_name || guard.geo_id
      },
      priority: EMAIL_PRIORITY.HIGH,
      ...options
    });
  }

  /**
   * Envoie une notification d'assignation de garde
   */
  async sendGuardAssigned(user, guard, options = {}) {
    return this.send({
      to: user.email,
      type: EMAIL_TYPES.GUARD_ASSIGNED,
      templateData: {
        firstName: user.firstName || user.first_name,
        date: this._formatDate(guard.date),
        shift: this._translateShift(guard.shift),
        timeStart: guard.time_start,
        timeEnd: guard.time_end,
        location: guard.location_name || guard.geo_id,
        points: guard.points || 1
      },
      priority: EMAIL_PRIORITY.NORMAL,
      ...options
    });
  }

  /**
   * Envoie un digest de notifications
   */
  async sendNotificationDigest(user, notifications, options = {}) {
    return this.send({
      to: user.email,
      type: EMAIL_TYPES.NOTIFICATION_DIGEST,
      templateData: {
        firstName: user.firstName || user.first_name,
        date: this._formatDate(new Date()),
        notifications: notifications.map(n => ({
          title: n.title,
          message: n.message,
          type: n.type,
          createdAt: this._formatDateTime(n.created_at)
        })),
        notificationCount: notifications.length,
        dashboardUrl: `${config.server.baseUrl}/dashboard`
      },
      priority: EMAIL_PRIORITY.LOW,
      ...options
    });
  }

  /**
   * Envoie une alerte de sécurité
   */
  async sendSecurityAlert(user, alert, options = {}) {
    return this.send({
      to: user.email,
      type: EMAIL_TYPES.SECURITY_ALERT,
      templateData: {
        firstName: user.firstName || user.first_name,
        alertType: alert.type,
        alertMessage: alert.message,
        ipAddress: alert.ipAddress,
        userAgent: alert.userAgent,
        timestamp: this._formatDateTime(new Date()),
        securityUrl: `${config.server.baseUrl}/security`
      },
      priority: EMAIL_PRIORITY.CRITICAL,
      ...options
    });
  }

  /**
   * Envoie une notification de protocole activé
   */
  async sendProtocolActivated(user, protocol, options = {}) {
    return this.send({
      to: user.email,
      type: EMAIL_TYPES.PROTOCOL_ACTIVATED,
      templateData: {
        firstName: user.firstName || user.first_name,
        protocolName: protocol.name,
        protocolLevel: protocol.level,
        activatedBy: protocol.activatedBy,
        timestamp: this._formatDateTime(new Date()),
        instructions: protocol.instructions
      },
      priority: EMAIL_PRIORITY.CRITICAL,
      ...options
    });
  }

  /**
   * Envoie une notification de ticket support
   */
  async sendSupportTicketNotification(user, ticket, action, options = {}) {
    let type;
    switch (action) {
      case 'created':
        type = EMAIL_TYPES.SUPPORT_TICKET_CREATED;
        break;
      case 'reply':
        type = EMAIL_TYPES.SUPPORT_TICKET_REPLY;
        break;
      case 'closed':
        type = EMAIL_TYPES.SUPPORT_TICKET_CLOSED;
        break;
      default:
        type = EMAIL_TYPES.SUPPORT_TICKET_CREATED;
    }

    return this.send({
      to: user.email,
      type,
      templateData: {
        firstName: user.firstName || user.first_name,
        ticketId: ticket.ticket_id || ticket.id,
        subject: ticket.subject,
        category: ticket.category,
        status: ticket.status,
        supportUrl: `${config.server.baseUrl}/support/tickets/${ticket.ticket_id || ticket.id}`
      },
      priority: EMAIL_PRIORITY.NORMAL,
      ...options
    });
  }

  // =========================================
  // ENVOI EN MASSE
  // =========================================

  /**
   * Envoie un email à plusieurs destinataires
   */
  async sendBulk(recipients, options) {
    const {
      type,
      subject,
      templateData = {},
      priority = EMAIL_PRIORITY.LOW,
      batchSize = 50
    } = options;

    const results = {
      total: recipients.length,
      sent: 0,
      failed: 0,
      errors: []
    };

    // Traiter par lots
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);

      try {
        await this._sendBatch(batch, {
          type,
          subject,
          templateData,
          priority
        });
        results.sent += batch.length;
      } catch (error) {
        results.failed += batch.length;
        results.errors.push({
          batch: i / batchSize + 1,
          error: error.message
        });
      }

      // Pause entre les lots pour éviter le rate limiting
      if (i + batchSize < recipients.length) {
        await this._delay(1000);
      }
    }

    return results;
  }

  /**
   * Envoie les digests quotidiens
   */
  async sendDailyDigests(usersWithNotifications) {
    const results = {
      total: usersWithNotifications.length,
      sent: 0,
      failed: 0
    };

    for (const { user, notifications } of usersWithNotifications) {
      try {
        await this.sendNotificationDigest(user, notifications);
        results.sent++;
      } catch (error) {
        results.failed++;
        console.error(`[EmailService] Erreur digest pour ${user.email}:`, error.message);
      }
    }

    return results;
  }

  // =========================================
  // GESTION DE LA QUEUE
  // =========================================

  /**
   * Ajoute un email à la queue
   */
  _enqueue(emailData) {
    this._queue.push(emailData);
    this.stats.queued++;

    return {
      queued: true,
      id: emailData.id,
      position: this._queue.length
    };
  }

  /**
   * Démarre le processeur de queue
   */
  _startQueueProcessor() {
    if (this._queueTimer) return;

    this._queueTimer = setInterval(async () => {
      await this._processQueue();
    }, this._queueInterval);

    console.log('[EmailService] Processeur de queue démarré');
  }

  /**
   * Arrête le processeur de queue
   */
  _stopQueueProcessor() {
    if (this._queueTimer) {
      clearInterval(this._queueTimer);
      this._queueTimer = null;
    }
  }

  /**
   * Traite la queue d'emails
   */
  async _processQueue() {
    if (this._queue.length === 0) return;

    const toProcess = [...this._queue];
    this._queue = [];

    console.log(`[EmailService] Traitement de ${toProcess.length} emails en queue`);

    for (const emailData of toProcess) {
      try {
        await this._sendImmediate(emailData);
      } catch (error) {
        console.error('[EmailService] Erreur envoi queue:', error.message);

        // Remettre en queue avec limite de retry
        if (!emailData.retryCount || emailData.retryCount < 3) {
          emailData.retryCount = (emailData.retryCount || 0) + 1;
          this._queue.push(emailData);
        }
      }
    }
  }

  // =========================================
  // ENVOI EFFECTIF
  // =========================================

  /**
   * Envoie un email immédiatement
   */
  async _sendImmediate(emailData) {
    if (!this.mailjet) {
      // Mode simulation si Mailjet non configuré
      console.log(`[EmailService] [SIMULATION] Email envoyé à ${emailData.to.Email}`);
      this.stats.sent++;
      return { sent: true, simulated: true, id: emailData.id };
    }

    try {
      const template = this._getTemplate(emailData.type);
      const mailjetConfig = config.notifications.mailjet;

      const message = {
        From: {
          Email: mailjetConfig.fromEmail,
          Name: mailjetConfig.fromName
        },
        To: [emailData.to],
        Subject: emailData.subject,
        TrackOpens: emailData.trackOpens ? 'enabled' : 'disabled',
        TrackClicks: emailData.trackClicks ? 'enabled' : 'disabled'
      };

      // Utiliser un template Mailjet si disponible
      if (template.templateId) {
        message.TemplateID = parseInt(template.templateId);
        message.TemplateLanguage = true;
        message.Variables = emailData.templateData;
      } else {
        // Sinon, générer le HTML
        message.HTMLPart = this._generateHTML(emailData.type, emailData.templateData);
        message.TextPart = this._generateText(emailData.type, emailData.templateData);
      }

      // Ajouter les pièces jointes
      if (emailData.attachments && emailData.attachments.length > 0) {
        message.Attachments = emailData.attachments.map(a => ({
          ContentType: a.contentType || 'application/octet-stream',
          Filename: a.filename,
          Base64Content: a.content
        }));
      }

      const response = await this.mailjet
        .post('send', { version: 'v3.1' })
        .request({ Messages: [message] });

      this.stats.sent++;

      return {
        sent: true,
        id: emailData.id,
        messageId: response.body?.Messages?.[0]?.To?.[0]?.MessageID
      };
    } catch (error) {
      this.stats.failed++;
      throw new EmailError('SEND_FAILED', error.message);
    }
  }

  /**
   * Envoie un lot d'emails
   */
  async _sendBatch(recipients, options) {
    if (!this.mailjet) {
      console.log(`[EmailService] [SIMULATION] Batch de ${recipients.length} emails`);
      this.stats.sent += recipients.length;
      return { sent: true, simulated: true };
    }

    const template = this._getTemplate(options.type);
    const mailjetConfig = config.notifications.mailjet;

    const messages = recipients.map(recipient => {
      const to = this._normalizeRecipient(recipient);
      const data = {
        ...options.templateData,
        firstName: recipient.firstName || recipient.first_name,
        email: recipient.email
      };

      const message = {
        From: {
          Email: mailjetConfig.fromEmail,
          Name: mailjetConfig.fromName
        },
        To: [to],
        Subject: this._processSubject(options.subject, options.type, data)
      };

      if (template.templateId) {
        message.TemplateID = parseInt(template.templateId);
        message.TemplateLanguage = true;
        message.Variables = data;
      } else {
        message.HTMLPart = this._generateHTML(options.type, data);
        message.TextPart = this._generateText(options.type, data);
      }

      return message;
    });

    const response = await this.mailjet
      .post('send', { version: 'v3.1' })
      .request({ Messages: messages });

    this.stats.sent += recipients.length;

    return {
      sent: true,
      count: recipients.length,
      response: response.body
    };
  }

  // =========================================
  // TEMPLATES
  // =========================================

  /**
   * Charge les templates depuis Mailjet
   */
  async _loadTemplates() {
    if (!this.mailjet) return;

    try {
      const response = await this.mailjet
        .get('template', { version: 'v3' })
        .request();

      const templates = response.body?.Data || [];

      for (const template of templates) {
        this._templateCache.set(template.Name, {
          id: template.ID,
          name: template.Name
        });
      }

      console.log(`[EmailService] ${templates.length} templates chargés`);
    } catch (error) {
      console.warn('[EmailService] Erreur chargement templates:', error.message);
    }
  }

  /**
   * Récupère un template
   */
  _getTemplate(type) {
    return DEFAULT_TEMPLATES[type] || { subject: 'Notification SHUGO' };
  }

  /**
   * Génère le HTML d'un email
   */
  _generateHTML(type, data) {
    const baseStyle = `
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
    `;

    const headerStyle = `
      background: linear-gradient(135deg, #1a237e 0%, #283593 100%);
      color: white;
      padding: 30px;
      text-align: center;
    `;

    const contentStyle = `
      padding: 30px;
      background: #ffffff;
    `;

    const footerStyle = `
      padding: 20px;
      text-align: center;
      font-size: 12px;
      color: #666;
      background: #f5f5f5;
    `;

    const buttonStyle = `
      display: inline-block;
      padding: 12px 30px;
      background: #1a237e;
      color: white;
      text-decoration: none;
      border-radius: 5px;
      margin: 20px 0;
    `;

    let content = '';

    switch (type) {
      case EMAIL_TYPES.WELCOME:
        content = `
          <h2>Bienvenue ${data.firstName} !</h2>
          <p>Votre compte SHUGO a été créé avec succès.</p>
          <p>Votre identifiant membre : <strong>${data.memberId}</strong></p>
          <a href="${data.loginUrl}" style="${buttonStyle}">Se connecter</a>
        `;
        break;

      case EMAIL_TYPES.PASSWORD_RESET:
        content = `
          <h2>Réinitialisation de mot de passe</h2>
          <p>Bonjour ${data.firstName},</p>
          <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
          <p>Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe :</p>
          <a href="${data.resetUrl}" style="${buttonStyle}">Réinitialiser mon mot de passe</a>
          <p><small>Ce lien expire dans ${data.expiresIn}.</small></p>
          <p><small>Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.</small></p>
        `;
        break;

      case EMAIL_TYPES.GUARD_REMINDER:
        content = `
          <h2>Rappel de garde</h2>
          <p>Bonjour ${data.firstName},</p>
          <p>Vous êtes de garde le <strong>${data.date}</strong>.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr><td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Créneau</strong></td><td style="padding: 10px; border-bottom: 1px solid #eee;">${data.shift}</td></tr>
            <tr><td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Horaires</strong></td><td style="padding: 10px; border-bottom: 1px solid #eee;">${data.timeStart} - ${data.timeEnd}</td></tr>
            <tr><td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Lieu</strong></td><td style="padding: 10px; border-bottom: 1px solid #eee;">${data.location}</td></tr>
          </table>
        `;
        break;

      case EMAIL_TYPES.SECURITY_ALERT:
        content = `
          <h2 style="color: #c62828;">⚠️ Alerte de sécurité</h2>
          <p>Bonjour ${data.firstName},</p>
          <p>Une activité suspecte a été détectée sur votre compte :</p>
          <div style="background: #ffebee; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p><strong>Type :</strong> ${data.alertType}</p>
            <p><strong>Description :</strong> ${data.alertMessage}</p>
            <p><strong>Adresse IP :</strong> ${data.ipAddress}</p>
            <p><strong>Date :</strong> ${data.timestamp}</p>
          </div>
          <p>Si ce n'était pas vous, veuillez sécuriser votre compte immédiatement.</p>
          <a href="${data.securityUrl}" style="${buttonStyle}">Vérifier mon compte</a>
        `;
        break;

      case EMAIL_TYPES.NOTIFICATION_DIGEST:
        const notifList = data.notifications.map(n =>
          `<li style="margin: 10px 0; padding: 10px; background: #f5f5f5; border-radius: 5px;">
            <strong>${n.title}</strong><br>
            <span style="font-size: 14px; color: #666;">${n.message}</span>
          </li>`
        ).join('');

        content = `
          <h2>Votre résumé du ${data.date}</h2>
          <p>Bonjour ${data.firstName},</p>
          <p>Vous avez ${data.notificationCount} notification(s) non lue(s) :</p>
          <ul style="list-style: none; padding: 0;">${notifList}</ul>
          <a href="${data.dashboardUrl}" style="${buttonStyle}">Voir mon tableau de bord</a>
        `;
        break;

      default:
        content = `
          <h2>Notification SHUGO</h2>
          <p>Bonjour ${data.firstName || ''},</p>
          <p>${data.message || 'Vous avez reçu une nouvelle notification.'}</p>
        `;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; ${baseStyle}">
        <div style="max-width: 600px; margin: 0 auto; background: #f5f5f5;">
          <div style="${headerStyle}">
            <h1 style="margin: 0; font-size: 28px;">SHUGO</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">Système de Gestion Opérationnelle</p>
          </div>
          <div style="${contentStyle}">
            ${content}
          </div>
          <div style="${footerStyle}">
            <p>Cet email a été envoyé automatiquement par SHUGO.</p>
            <p>© ${new Date().getFullYear()} SHUGO - Tous droits réservés</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Génère la version texte d'un email
   */
  _generateText(type, data) {
    let text = 'SHUGO - Notification\n\n';

    switch (type) {
      case EMAIL_TYPES.WELCOME:
        text += `Bienvenue ${data.firstName} !\n\n`;
        text += `Votre compte SHUGO a été créé avec succès.\n`;
        text += `Votre identifiant membre : ${data.memberId}\n\n`;
        text += `Connectez-vous : ${data.loginUrl}\n`;
        break;

      case EMAIL_TYPES.PASSWORD_RESET:
        text += `Bonjour ${data.firstName},\n\n`;
        text += `Vous avez demandé la réinitialisation de votre mot de passe.\n\n`;
        text += `Lien de réinitialisation : ${data.resetUrl}\n\n`;
        text += `Ce lien expire dans ${data.expiresIn}.\n`;
        break;

      case EMAIL_TYPES.GUARD_REMINDER:
        text += `Rappel de garde\n\n`;
        text += `Bonjour ${data.firstName},\n\n`;
        text += `Vous êtes de garde le ${data.date}\n`;
        text += `Créneau : ${data.shift}\n`;
        text += `Horaires : ${data.timeStart} - ${data.timeEnd}\n`;
        text += `Lieu : ${data.location}\n`;
        break;

      case EMAIL_TYPES.SECURITY_ALERT:
        text += `⚠️ ALERTE DE SÉCURITÉ\n\n`;
        text += `Bonjour ${data.firstName},\n\n`;
        text += `Une activité suspecte a été détectée :\n`;
        text += `Type : ${data.alertType}\n`;
        text += `Description : ${data.alertMessage}\n`;
        text += `IP : ${data.ipAddress}\n`;
        text += `Date : ${data.timestamp}\n\n`;
        text += `Vérifiez votre compte : ${data.securityUrl}\n`;
        break;

      default:
        text += `Bonjour ${data.firstName || ''},\n\n`;
        text += data.message || 'Vous avez reçu une nouvelle notification.\n';
    }

    text += '\n---\nCet email a été envoyé automatiquement par SHUGO.';

    return text;
  }

  // =========================================
  // UTILITAIRES
  // =========================================

  /**
   * Normalise un destinataire
   */
  _normalizeRecipient(recipient) {
    if (typeof recipient === 'string') {
      return { Email: recipient };
    }

    return {
      Email: recipient.email || recipient.Email,
      Name: recipient.name || recipient.Name ||
        `${recipient.firstName || recipient.first_name || ''} ${recipient.lastName || recipient.last_name || ''}`.trim()
    };
  }

  /**
   * Traite le sujet d'un email
   */
  _processSubject(subject, type, data) {
    let finalSubject = subject || this._getTemplate(type).subject || 'Notification SHUGO';

    // Remplacer les variables {{var}}
    finalSubject = finalSubject.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return data[key] || match;
    });

    return finalSubject;
  }

  /**
   * Formate une date
   */
  _formatDate(date) {
    const d = new Date(date);
    return d.toLocaleDateString('fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  /**
   * Formate une date et heure
   */
  _formatDateTime(date) {
    const d = new Date(date);
    return d.toLocaleString('fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Traduit un shift
   */
  _translateShift(shift) {
    const translations = {
      'morning': 'Matin',
      'matin': 'Matin',
      'afternoon': 'Après-midi',
      'après-midi': 'Après-midi',
      'evening': 'Soir',
      'soir': 'Soir',
      'night': 'Nuit',
      'nuit': 'Nuit'
    };
    return translations[shift?.toLowerCase()] || shift;
  }

  /**
   * Délai asynchrone
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // =========================================
  // ADMINISTRATION
  // =========================================

  /**
   * Récupère les statistiques
   */
  getStats() {
    return {
      ...this.stats,
      queueLength: this._queue.length,
      isInitialized: this.isInitialized,
      mailjetEnabled: !!this.mailjet
    };
  }

  /**
   * Vide la queue manuellement
   */
  async flushQueue() {
    console.log('[EmailService] Vidage manuel de la queue');
    await this._processQueue();
    return { processed: true, remaining: this._queue.length };
  }

  /**
   * Arrête le service proprement
   */
  async shutdown() {
    console.log('[EmailService] Arrêt en cours...');
    this._stopQueueProcessor();

    // Traiter les emails restants
    if (this._queue.length > 0) {
      console.log(`[EmailService] Envoi des ${this._queue.length} emails restants`);
      await this._processQueue();
    }

    console.log('[EmailService] Arrêté');
  }
}

/**
 * Classe d'erreur pour le service Email
 */
class EmailError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EmailError';
    this.code = code;
  }
}

// Export singleton
const emailService = new EmailService();

module.exports = emailService;
module.exports.EmailService = EmailService;
module.exports.EmailError = EmailError;
module.exports.EMAIL_TYPES = EMAIL_TYPES;
module.exports.EMAIL_PRIORITY = EMAIL_PRIORITY;
