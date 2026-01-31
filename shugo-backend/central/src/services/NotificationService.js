'use strict';

/**
 * Service de Notifications SHUGO
 * 
 * Gestion des notifications multi-canal : Email (Mailjet), Matrix/Element, Push
 * Relances automatiques, rappels de garde, alertes système.
 * 
 * @see Document Technique V7.0 - Section 4.1.9, 4.2
 */

const config = require('../config');

/**
 * Types de notifications
 */
const NOTIFICATION_TYPES = {
  // Gardes
  GUARD_CONFIRMATION: 'guard_confirmation',
  GUARD_REMINDER: 'guard_reminder',
  GUARD_CANCELLATION: 'guard_cancellation',
  GUARD_REPLACEMENT_REQUEST: 'guard_replacement_request',
  GUARD_REPLACEMENT_ACCEPTED: 'guard_replacement_accepted',
  GUARD_WAITING_LIST_ACTIVATED: 'guard_waiting_list_activated',
  GUARD_EMPTY_SLOT_ALERT: 'guard_empty_slot_alert',
  
  // Système
  SYSTEM_ALERT: 'system_alert',
  SYSTEM_MAINTENANCE: 'system_maintenance',
  SECURITY_ALERT: 'security_alert',
  
  // Compte
  ACCOUNT_WELCOME: 'account_welcome',
  ACCOUNT_EMAIL_VERIFICATION: 'account_email_verification',
  ACCOUNT_PASSWORD_RESET: 'account_password_reset',
  ACCOUNT_2FA_RESET: 'account_2fa_reset',
  ACCOUNT_BLOCKED: 'account_blocked',
  ACCOUNT_SUSPENDED: 'account_suspended',
  
  // Messages hiérarchiques
  HIERARCHICAL_MESSAGE: 'hierarchical_message',
  
  // Support
  SUPPORT_TICKET_CREATED: 'support_ticket_created',
  SUPPORT_TICKET_ASSIGNED: 'support_ticket_assigned',
  SUPPORT_TICKET_RESOLVED: 'support_ticket_resolved'
};

/**
 * Canaux de notification
 */
const CHANNELS = {
  EMAIL: 'email',
  MATRIX: 'matrix',
  PUSH: 'push',
  SMS: 'sms'
};

/**
 * Priorités
 */
const PRIORITIES = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent'
};

/**
 * Service de notifications
 */
class NotificationService {
  constructor(models) {
    this.models = models;
    this.Notification = models.Notification;
    this.User = models.User;
    this.AuditLog = models.AuditLog;
    
    // Clients externes (initialisés à la demande)
    this._mailjetClient = null;
    this._matrixClient = null;
    
    // File d'attente en mémoire pour batch
    this._queue = [];
    this._batchSize = 50;
    this._batchInterval = 5000; // 5 secondes
    
    // Templates de messages
    this._templates = this._initTemplates();
  }

  // =========================================
  // INITIALISATION
  // =========================================

  /**
   * Initialise les clients externes
   */
  async initialize() {
    // Initialiser Mailjet si activé
    if (config.notifications?.email?.enabled) {
      await this._initMailjet();
    }

    // Initialiser Matrix si activé
    if (config.notifications?.matrix?.enabled) {
      await this._initMatrix();
    }

    // Démarrer le traitement batch
    this._startBatchProcessor();

    console.log('[NotificationService] Initialisé');
  }

  /**
   * Initialise le client Mailjet
   * @private
   */
  async _initMailjet() {
    try {
      const Mailjet = require('node-mailjet');
      this._mailjetClient = Mailjet.apiConnect(
        config.notifications.email.apiKey,
        config.notifications.email.apiSecret
      );
      console.log('[NotificationService] Mailjet connecté');
    } catch (err) {
      console.error('[NotificationService] Erreur initialisation Mailjet:', err.message);
    }
  }

  /**
   * Initialise le client Matrix
   * @private
   */
  async _initMatrix() {
    try {
      const sdk = require('matrix-js-sdk');
      this._matrixClient = sdk.createClient({
        baseUrl: config.notifications.matrix.homeserverUrl,
        accessToken: config.notifications.matrix.accessToken,
        userId: config.notifications.matrix.userId
      });
      await this._matrixClient.startClient({ initialSyncLimit: 0 });
      console.log('[NotificationService] Matrix connecté');
    } catch (err) {
      console.error('[NotificationService] Erreur initialisation Matrix:', err.message);
    }
  }

  // =========================================
  // ENVOI DE NOTIFICATIONS
  // =========================================

  /**
   * Envoie une notification à un utilisateur
   * @param {number} memberId
   * @param {string} type - Type de notification
   * @param {Object} data - Données pour le template
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async send(memberId, type, data = {}, options = {}) {
    const {
      channel = null, // null = utiliser préférence utilisateur
      priority = PRIORITIES.NORMAL,
      expiresAt = null,
      immediate = false
    } = options;

    // Récupérer l'utilisateur
    const user = await this.User.findByPk(memberId);
    if (!user) {
      throw new NotificationError('USER_NOT_FOUND', 'Utilisateur non trouvé');
    }

    // Déterminer le canal
    const targetChannel = channel || user.notification_channel || CHANNELS.EMAIL;

    // Générer le contenu
    const content = this._generateContent(type, data, user.preferred_language);

    // Créer l'enregistrement en base
    const notification = await this.Notification.create({
      member_id: memberId,
      type,
      category: this._getCategory(type),
      title: content.title,
      message: content.message,
      priority,
      channel: targetChannel,
      status: 'pending',
      expires_at: expiresAt,
      metadata: { data, templateType: type }
    });

    // Envoi immédiat ou mise en file
    if (immediate || priority === PRIORITIES.URGENT) {
      await this._sendImmediate(notification, user, content);
    } else {
      this._queue.push({ notification, user, content });
    }

    return notification;
  }

  /**
   * Envoie une notification à plusieurs utilisateurs
   * @param {number[]} memberIds
   * @param {string} type
   * @param {Object} data
   * @param {Object} options
   * @returns {Promise<Object[]>}
   */
  async sendBulk(memberIds, type, data = {}, options = {}) {
    const results = [];
    
    for (const memberId of memberIds) {
      try {
        const notification = await this.send(memberId, type, data, options);
        results.push({ memberId, success: true, notificationId: notification.notification_id });
      } catch (err) {
        results.push({ memberId, success: false, error: err.message });
      }
    }

    return results;
  }

  /**
   * Envoie une notification à un groupe
   * @param {string} groupId
   * @param {string} type
   * @param {Object} data
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async sendToGroup(groupId, type, data = {}, options = {}) {
    const GroupMembership = this.models.GroupMembership;
    
    const members = await GroupMembership.findAll({
      where: { group_id: groupId, is_active: true },
      attributes: ['member_id']
    });

    const memberIds = members.map(m => m.member_id);
    return this.sendBulk(memberIds, type, data, options);
  }

  /**
   * Envoie une notification à un geo_id
   * @param {string} geoId
   * @param {string} type
   * @param {Object} data
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async sendToGeoId(geoId, type, data = {}, options = {}) {
    const users = await this.User.findAll({
      where: { geo_id: geoId, status: 'active' },
      attributes: ['member_id']
    });

    const memberIds = users.map(u => u.member_id);
    return this.sendBulk(memberIds, type, data, options);
  }

  // =========================================
  // ENVOI PAR CANAL
  // =========================================

  /**
   * Envoi immédiat d'une notification
   * @private
   */
  async _sendImmediate(notification, user, content) {
    try {
      let result;
      
      switch (notification.channel) {
        case CHANNELS.EMAIL:
          result = await this._sendEmail(user, content);
          break;
        case CHANNELS.MATRIX:
          result = await this._sendMatrix(user, content);
          break;
        case CHANNELS.PUSH:
          result = await this._sendPush(user, content);
          break;
        default:
          result = await this._sendEmail(user, content);
      }

      await notification.update({
        status: 'sent',
        sent_at: new Date()
      });

      return result;
    } catch (err) {
      await this._handleSendError(notification, err);
      throw err;
    }
  }

  /**
   * Envoie un email via Mailjet
   * @private
   */
  async _sendEmail(user, content) {
    if (!this._mailjetClient) {
      throw new NotificationError('EMAIL_DISABLED', 'Service email non configuré');
    }

    // Déchiffrer l'email de l'utilisateur
    const crypto = require('../utils/crypto');
    let email;
    try {
      email = crypto.decryptFromBuffer(user.email_encrypted, 
        Buffer.from(config.security.encryptionKey, 'hex')).toString('utf8');
    } catch (err) {
      throw new NotificationError('DECRYPT_ERROR', 'Impossible de déchiffrer l\'email');
    }

    const request = this._mailjetClient.post('send', { version: 'v3.1' }).request({
      Messages: [{
        From: {
          Email: config.notifications.email.fromEmail,
          Name: config.notifications.email.fromName || 'SHUGO'
        },
        To: [{
          Email: email
        }],
        Subject: content.title,
        TextPart: content.message,
        HTMLPart: content.html || this._textToHtml(content.message)
      }]
    });

    const response = await request;
    return { 
      channel: 'email', 
      messageId: response.body?.Messages?.[0]?.To?.[0]?.MessageID 
    };
  }

  /**
   * Envoie un message Matrix
   * @private
   */
  async _sendMatrix(user, content) {
    if (!this._matrixClient) {
      throw new NotificationError('MATRIX_DISABLED', 'Service Matrix non configuré');
    }

    if (!user.matrix_id) {
      throw new NotificationError('NO_MATRIX_ID', 'Utilisateur sans ID Matrix');
    }

    // Créer ou récupérer la room directe
    const roomId = await this._getOrCreateDirectRoom(user.matrix_id);

    // Envoyer le message
    await this._matrixClient.sendMessage(roomId, {
      msgtype: 'm.text',
      body: `**${content.title}**\n\n${content.message}`,
      format: 'org.matrix.custom.html',
      formatted_body: `<strong>${content.title}</strong><br/><br/>${content.html || content.message}`
    });

    return { channel: 'matrix', roomId };
  }

  /**
   * Envoie une notification push via Firebase Cloud Messaging
   * @private
   */
  async _sendPush(user, content) {
    const fcmConfig = config.notifications?.fcm;

    // Si FCM n'est pas configuré, simuler l'envoi
    if (!fcmConfig?.enabled || !fcmConfig?.serverKey) {
      console.log(`[Push] [SIMULATION] ${user.member_id}: ${content.title}`);
      return { channel: 'push', status: 'simulated' };
    }

    // Récupérer le token FCM de l'utilisateur
    const pushToken = user.push_token || user.fcm_token;
    if (!pushToken) {
      console.log(`[Push] No token for user ${user.member_id}`);
      return { channel: 'push', status: 'no_token' };
    }

    try {
      const response = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `key=${fcmConfig.serverKey}`
        },
        body: JSON.stringify({
          to: pushToken,
          notification: {
            title: content.title,
            body: content.body || content.message,
            icon: fcmConfig.icon || '/icons/notification.png',
            click_action: content.click_action || fcmConfig.defaultClickAction
          },
          data: {
            type: content.type,
            notification_id: content.notification_id,
            ...content.data
          },
          priority: content.priority === 'urgent' ? 'high' : 'normal'
        })
      });

      const result = await response.json();

      if (result.success) {
        return { channel: 'push', status: 'sent', messageId: result.results?.[0]?.message_id };
      } else {
        console.error(`[Push] FCM error for ${user.member_id}:`, result.results?.[0]?.error);
        return { channel: 'push', status: 'failed', error: result.results?.[0]?.error };
      }
    } catch (error) {
      console.error(`[Push] Error sending to ${user.member_id}:`, error.message);
      return { channel: 'push', status: 'error', error: error.message };
    }
  }

  /**
   * Récupère ou crée une room Matrix directe
   * @private
   */
  async _getOrCreateDirectRoom(matrixUserId) {
    // Vérifier si une room existe déjà
    const rooms = this._matrixClient.getRooms();
    for (const room of rooms) {
      const members = room.getJoinedMembers();
      if (members.length === 2 && members.some(m => m.userId === matrixUserId)) {
        return room.roomId;
      }
    }

    // Créer une nouvelle room
    const response = await this._matrixClient.createRoom({
      preset: 'trusted_private_chat',
      invite: [matrixUserId],
      is_direct: true
    });

    return response.room_id;
  }

  // =========================================
  // RELANCES AUTOMATIQUES
  // =========================================

  /**
   * Envoie les relances pour créneaux vides
   * @param {string} geoId
   * @param {number} daysAhead
   * @returns {Promise<Object>}
   */
  async sendEmptySlotReminders(geoId, daysAhead = 14) {
    const Guard = this.models.Guard;
    const { Op } = require('sequelize');

    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    // Trouver les créneaux vides
    const emptyGuards = await Guard.findAll({
      where: {
        geo_id: geoId,
        guard_date: { [Op.between]: [today, futureDate] },
        current_participants: 0,
        status: 'open',
        deleted_at: null
      },
      order: [['guard_date', 'ASC'], ['start_time', 'ASC']]
    });

    if (emptyGuards.length === 0) {
      return { sent: 0, guards: [] };
    }

    // Formater les créneaux pour le message
    const slots = emptyGuards.map(g => ({
      date: g.guard_date,
      startTime: g.start_time,
      endTime: g.end_time,
      guardId: g.guard_id
    }));

    // Envoyer aux utilisateurs du geo_id
    const result = await this.sendToGeoId(geoId, NOTIFICATION_TYPES.GUARD_EMPTY_SLOT_ALERT, {
      slots,
      count: emptyGuards.length,
      daysAhead
    });

    return {
      sent: result.filter(r => r.success).length,
      guards: emptyGuards.map(g => g.guard_id)
    };
  }

  /**
   * Envoie les rappels de garde (J-2 et J)
   * @returns {Promise<Object>}
   */
  async sendGuardReminders() {
    const Guard = this.models.Guard;
    const GuardAssignment = this.models.GuardAssignment;
    const { Op } = require('sequelize');

    const results = { j2: 0, j0: 0 };

    // Rappels J-2 (12h)
    const j2Date = new Date();
    j2Date.setDate(j2Date.getDate() + 2);
    const j2DateStr = j2Date.toISOString().split('T')[0];

    const j2Guards = await Guard.findAll({
      where: {
        guard_date: j2DateStr,
        status: { [Op.in]: ['open', 'full'] },
        deleted_at: null
      },
      include: [{
        model: GuardAssignment,
        as: 'assignments',
        where: { status: 'confirmed' },
        required: true
      }]
    });

    for (const guard of j2Guards) {
      for (const assignment of guard.assignments) {
        try {
          await this.send(assignment.member_id, NOTIFICATION_TYPES.GUARD_REMINDER, {
            guardDate: guard.guard_date,
            startTime: guard.start_time,
            endTime: guard.end_time,
            daysUntil: 2
          });
          results.j2++;
        } catch (err) {
          console.error(`Erreur rappel J-2 pour ${assignment.member_id}:`, err.message);
        }
      }
    }

    // Rappels J (8h du matin)
    const today = new Date().toISOString().split('T')[0];
    
    const j0Guards = await Guard.findAll({
      where: {
        guard_date: today,
        status: { [Op.in]: ['open', 'full'] },
        deleted_at: null
      },
      include: [{
        model: GuardAssignment,
        as: 'assignments',
        where: { status: 'confirmed' },
        required: true
      }]
    });

    for (const guard of j0Guards) {
      for (const assignment of guard.assignments) {
        try {
          await this.send(assignment.member_id, NOTIFICATION_TYPES.GUARD_REMINDER, {
            guardDate: guard.guard_date,
            startTime: guard.start_time,
            endTime: guard.end_time,
            daysUntil: 0
          }, { priority: PRIORITIES.HIGH });
          results.j0++;
        } catch (err) {
          console.error(`Erreur rappel J pour ${assignment.member_id}:`, err.message);
        }
      }
    }

    return results;
  }

  // =========================================
  // TEMPLATES
  // =========================================

  /**
   * Initialise les templates de messages
   * @private
   */
  _initTemplates() {
    return {
      fr: {
        [NOTIFICATION_TYPES.GUARD_CONFIRMATION]: {
          title: 'Inscription confirmée',
          message: 'Votre inscription à la garde du {date} ({startTime} - {endTime}) est confirmée.'
        },
        [NOTIFICATION_TYPES.GUARD_REMINDER]: {
          title: 'Rappel de garde',
          message: 'Rappel : vous êtes inscrit(e) à la garde du {date} de {startTime} à {endTime}.'
        },
        [NOTIFICATION_TYPES.GUARD_CANCELLATION]: {
          title: 'Annulation de garde',
          message: 'Votre garde du {date} ({startTime} - {endTime}) a été annulée. Motif : {reason}'
        },
        [NOTIFICATION_TYPES.GUARD_REPLACEMENT_REQUEST]: {
          title: 'Demande de remplacement',
          message: '{requesterName} vous propose de le/la remplacer pour la garde du {date} ({startTime} - {endTime}). Répondez avant {deadline}.'
        },
        [NOTIFICATION_TYPES.GUARD_WAITING_LIST_ACTIVATED]: {
          title: 'Place disponible !',
          message: 'Bonne nouvelle ! Une place s\'est libérée et vous avez été automatiquement inscrit(e) à la garde du {date} ({startTime} - {endTime}).'
        },
        [NOTIFICATION_TYPES.GUARD_EMPTY_SLOT_ALERT]: {
          title: 'Créneaux à pourvoir',
          message: '{count} créneau(x) de garde sont encore disponibles dans les {daysAhead} prochains jours. Consultez le planning pour vous inscrire.'
        },
        [NOTIFICATION_TYPES.SYSTEM_MAINTENANCE]: {
          title: 'Maintenance programmée',
          message: 'Une maintenance est prévue le {date} à {time}. Le service sera indisponible pendant environ {duration} minutes.'
        },
        [NOTIFICATION_TYPES.SECURITY_ALERT]: {
          title: '⚠️ Alerte sécurité',
          message: 'Une activité inhabituelle a été détectée sur votre compte. {details}'
        },
        [NOTIFICATION_TYPES.ACCOUNT_WELCOME]: {
          title: 'Bienvenue sur SHUGO !',
          message: 'Votre compte a été créé avec succès. Vous pouvez maintenant vous connecter et consulter le planning des gardes.'
        },
        [NOTIFICATION_TYPES.ACCOUNT_EMAIL_VERIFICATION]: {
          title: 'Vérification de votre email - SHUGO',
          message: 'Bonjour {firstName},\n\nVotre code de vérification est : **{verificationCode}**\n\nCe code expire dans 30 minutes.\n\nSi vous n\'avez pas demandé ce code, ignorez cet email.'
        },
        [NOTIFICATION_TYPES.ACCOUNT_PASSWORD_RESET]: {
          title: 'Réinitialisation de mot de passe',
          message: 'Cliquez sur le lien suivant pour réinitialiser votre mot de passe : {resetLink}\nCe lien expire dans 1 heure.'
        },
        [NOTIFICATION_TYPES.HIERARCHICAL_MESSAGE]: {
          title: 'Message de {senderName}',
          message: '{content}'
        }
      },
      en: {
        [NOTIFICATION_TYPES.GUARD_CONFIRMATION]: {
          title: 'Registration confirmed',
          message: 'Your registration for the guard duty on {date} ({startTime} - {endTime}) is confirmed.'
        },
        [NOTIFICATION_TYPES.GUARD_REMINDER]: {
          title: 'Guard reminder',
          message: 'Reminder: you are registered for guard duty on {date} from {startTime} to {endTime}.'
        },
        // ... autres templates en anglais
      }
      // Ajouter it, es, pt selon besoin
    };
  }

  /**
   * Génère le contenu d'une notification
   * @private
   */
  _generateContent(type, data, language = 'fr') {
    const templates = this._templates[language] || this._templates.fr;
    const template = templates[type];

    if (!template) {
      return {
        title: 'Notification SHUGO',
        message: JSON.stringify(data)
      };
    }

    let title = template.title;
    let message = template.message;

    // Remplacer les placeholders
    for (const [key, value] of Object.entries(data)) {
      const placeholder = `{${key}}`;
      title = title.replace(new RegExp(placeholder, 'g'), value);
      message = message.replace(new RegExp(placeholder, 'g'), value);
    }

    return {
      title,
      message,
      html: this._textToHtml(message)
    };
  }

  /**
   * Convertit du texte en HTML basique
   * @private
   */
  _textToHtml(text) {
    return text
      .replace(/\n/g, '<br/>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
  }

  /**
   * Retourne la catégorie d'un type de notification
   * @private
   */
  _getCategory(type) {
    if (type.startsWith('guard_')) return 'guard';
    if (type.startsWith('system_') || type.startsWith('security_')) return 'system';
    if (type.startsWith('account_')) return 'account';
    if (type.startsWith('support_')) return 'support';
    return 'other';
  }

  // =========================================
  // GESTION DES ERREURS ET RETRY
  // =========================================

  /**
   * Gère les erreurs d'envoi
   * @private
   */
  async _handleSendError(notification, error) {
    const retryCount = notification.retry_count || 0;
    const maxRetries = notification.max_retries || 3;

    if (retryCount < maxRetries) {
      await notification.update({
        status: 'pending',
        retry_count: retryCount + 1,
        metadata: {
          ...notification.metadata,
          lastError: error.message,
          lastErrorAt: new Date()
        }
      });
    } else {
      await notification.update({
        status: 'failed',
        metadata: {
          ...notification.metadata,
          finalError: error.message,
          failedAt: new Date()
        }
      });
    }
  }

  /**
   * Démarre le processeur batch
   * @private
   */
  _startBatchProcessor() {
    setInterval(async () => {
      if (this._queue.length === 0) return;

      const batch = this._queue.splice(0, this._batchSize);
      
      for (const item of batch) {
        try {
          await this._sendImmediate(item.notification, item.user, item.content);
        } catch (err) {
          console.error(`Erreur batch send ${item.notification.notification_id}:`, err.message);
        }
      }
    }, this._batchInterval);
  }

  // =========================================
  // LECTURE ET GESTION
  // =========================================

  /**
   * Liste les notifications d'un utilisateur
   * @param {number} memberId
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async getForUser(memberId, options = {}) {
    const {
      status,
      type,
      unreadOnly = false,
      page = 1,
      limit = 20
    } = options;

    const { Op } = require('sequelize');
    const where = { member_id: memberId };

    if (status) {
      where.status = status;
    }

    if (type) {
      where.type = type;
    }

    if (unreadOnly) {
      where.read_at = null;
    }

    // Exclure les expirées
    where[Op.or] = [
      { expires_at: null },
      { expires_at: { [Op.gt]: new Date() } }
    ];

    const { count, rows } = await this.Notification.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: Math.min(limit, 100),
      offset: (page - 1) * limit
    });

    return {
      notifications: rows,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    };
  }

  /**
   * Marque une notification comme lue
   * @param {string} notificationId
   * @param {number} memberId
   * @returns {Promise<void>}
   */
  async markAsRead(notificationId, memberId) {
    const notification = await this.Notification.findOne({
      where: { notification_id: notificationId, member_id: memberId }
    });

    if (!notification) {
      throw new NotificationError('NOT_FOUND', 'Notification non trouvée');
    }

    await notification.update({ read_at: new Date() });
  }

  /**
   * Marque toutes les notifications comme lues
   * @param {number} memberId
   * @returns {Promise<number>}
   */
  async markAllAsRead(memberId) {
    const [updated] = await this.Notification.update(
      { read_at: new Date() },
      { where: { member_id: memberId, read_at: null } }
    );
    return updated;
  }

  /**
   * Compte les notifications non lues
   * @param {number} memberId
   * @returns {Promise<number>}
   */
  async countUnread(memberId) {
    return this.Notification.count({
      where: { member_id: memberId, read_at: null }
    });
  }
}

/**
 * Classe d'erreur
 */
class NotificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NotificationError';
    this.code = code;
  }
}

module.exports = NotificationService;
module.exports.NotificationError = NotificationError;
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
module.exports.CHANNELS = CHANNELS;
module.exports.PRIORITIES = PRIORITIES;
