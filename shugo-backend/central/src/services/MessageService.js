'use strict';

/**
 * SHUGO v7.0 - Service de messagerie interne
 *
 * Gestion du centre de messages :
 * - Messages système automatiques
 * - Messages hiérarchiques manuels
 * - Diffusion ciblée (global, géo, groupe, individuel)
 * - Statuts de lecture et notifications
 *
 * @see Document Technique V7.0 - Section 4.2
 */

const { Op } = require('sequelize');

/**
 * Types de messages
 */
const MESSAGE_TYPES = {
  SYSTEM: 'system',
  HIERARCHICAL: 'hierarchical'
};

/**
 * Portées de diffusion
 */
const TARGET_SCOPES = {
  GLOBAL: 'global',
  GEO_ID: 'geo_id',
  GROUP: 'group',
  INDIVIDUAL: 'individual'
};

/**
 * Priorités des messages
 */
const MESSAGE_PRIORITY = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent'
};

/**
 * Catégories de messages système
 */
const SYSTEM_CATEGORIES = {
  MAINTENANCE: 'maintenance',
  SECURITY: 'security',
  UPDATE: 'update',
  REMINDER: 'reminder',
  ALERT: 'alert',
  INFO: 'info'
};

class MessageService {
  constructor(models) {
    this.models = models;
    this.MessagesCenter = models?.MessagesCenter;
    this.MessageReadStatus = models?.MessageReadStatus;
    this.User = models?.User;
    this.Group = models?.Group;
    this.AuditLog = models?.AuditLog;

    this._auditService = null;
    this._notificationService = null;
  }

  /**
   * Initialise le service
   */
  async initialize(options = {}) {
    const { auditService, notificationService } = options;
    this._auditService = auditService;
    this._notificationService = notificationService;

    console.log('[MessageService] Initialisé');
    return { initialized: true };
  }

  // =========================================
  // CRÉATION DE MESSAGES
  // =========================================

  /**
   * Crée un message hiérarchique
   */
  async createMessage(messageData, senderMemberId) {
    const {
      title,
      content,
      targetScope,
      targetIdentifier,
      priority = MESSAGE_PRIORITY.NORMAL,
      isPinned = false,
      expiresAt = null,
      notifyRecipients = true
    } = messageData;

    // Validation
    this._validateMessageData(messageData);

    // Vérifier l'autorisation de l'émetteur pour la portée
    await this._checkSenderAuthorization(senderMemberId, targetScope, targetIdentifier);

    const message = await this.MessagesCenter.create({
      type: MESSAGE_TYPES.HIERARCHICAL,
      sender_member_id: senderMemberId,
      target_scope: targetScope,
      target_identifier: targetIdentifier,
      title,
      content,
      priority,
      is_pinned: isPinned,
      expires_at: expiresAt
    });

    // Notifier les destinataires si demandé
    if (notifyRecipients && this._notificationService) {
      await this._notifyRecipients(message);
    }

    await this._logActivity('message.created', {
      messageId: message.message_id,
      type: MESSAGE_TYPES.HIERARCHICAL,
      targetScope,
      senderId: senderMemberId
    });

    return this._formatMessage(message);
  }

  /**
   * Crée un message système
   */
  async createSystemMessage(messageData) {
    const {
      title,
      content,
      targetScope = TARGET_SCOPES.GLOBAL,
      targetIdentifier = null,
      priority = MESSAGE_PRIORITY.NORMAL,
      category = SYSTEM_CATEGORIES.INFO,
      isPinned = false,
      expiresAt = null,
      expiresInHours = null
    } = messageData;

    let finalExpiresAt = expiresAt;
    if (!finalExpiresAt && expiresInHours) {
      finalExpiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    }

    const message = await this.MessagesCenter.create({
      type: MESSAGE_TYPES.SYSTEM,
      sender_member_id: null,
      target_scope: targetScope,
      target_identifier: targetIdentifier,
      title,
      content,
      priority,
      is_pinned: isPinned,
      expires_at: finalExpiresAt,
      metadata: { category }
    });

    await this._logActivity('message.system_created', {
      messageId: message.message_id,
      category,
      targetScope
    });

    return this._formatMessage(message);
  }

  /**
   * Crée un message de maintenance planifiée
   */
  async createMaintenanceMessage(maintenanceData) {
    const { startTime, endTime, reason, affectedServices = [] } = maintenanceData;

    const title = 'Maintenance planifiée';
    const content = `Une maintenance est prévue du ${this._formatDateTime(startTime)} au ${this._formatDateTime(endTime)}.\n\n` +
      `Raison : ${reason}\n\n` +
      (affectedServices.length > 0 ? `Services concernés : ${affectedServices.join(', ')}` : '');

    return this.createSystemMessage({
      title,
      content,
      priority: MESSAGE_PRIORITY.HIGH,
      category: SYSTEM_CATEGORIES.MAINTENANCE,
      isPinned: true,
      expiresAt: endTime
    });
  }

  /**
   * Crée une alerte de sécurité
   */
  async createSecurityAlert(alertData) {
    const { title, content, severity = 'warning', targetScope = TARGET_SCOPES.GLOBAL, targetIdentifier = null } = alertData;

    const priority = severity === 'critical' ? MESSAGE_PRIORITY.URGENT : MESSAGE_PRIORITY.HIGH;

    return this.createSystemMessage({
      title: `🔒 ${title}`,
      content,
      targetScope,
      targetIdentifier,
      priority,
      category: SYSTEM_CATEGORIES.SECURITY,
      isPinned: severity === 'critical',
      expiresInHours: 24
    });
  }

  // =========================================
  // LECTURE ET RÉCUPÉRATION
  // =========================================

  /**
   * Récupère les messages pour un utilisateur
   */
  async getMessagesForUser(memberId, options = {}) {
    const {
      includeRead = false,
      includeIgnored = false,
      includeExpired = false,
      type = null,
      priority = null,
      page = 1,
      limit = 20
    } = options;

    // Récupérer l'utilisateur et ses groupes
    const user = await this.User.findByPk(memberId, {
      include: [{ model: this.Group, as: 'groups', attributes: ['group_id'] }]
    });

    if (!user) {
      throw new MessageError('USER_NOT_FOUND', 'Utilisateur non trouvé');
    }

    const groupIds = user.groups?.map(g => g.group_id.toString()) || [];

    // Construire la requête
    const where = {
      [Op.or]: [
        { target_scope: TARGET_SCOPES.GLOBAL },
        {
          target_scope: TARGET_SCOPES.GEO_ID,
          target_identifier: { [Op.like]: user.geo_id.substring(0, 8) + '%' }
        },
        ...(groupIds.length > 0 ? [{
          target_scope: TARGET_SCOPES.GROUP,
          target_identifier: { [Op.in]: groupIds }
        }] : []),
        {
          target_scope: TARGET_SCOPES.INDIVIDUAL,
          target_identifier: memberId.toString()
        }
      ]
    };

    if (!includeExpired) {
      where[Op.and] = [
        {
          [Op.or]: [
            { expires_at: null },
            { expires_at: { [Op.gt]: new Date() } }
          ]
        }
      ];
    }

    if (type) {
      where.type = type;
    }

    if (priority) {
      where.priority = priority;
    }

    // Récupérer les messages
    const { count, rows: messages } = await this.MessagesCenter.findAndCountAll({
      where,
      order: [
        ['is_pinned', 'DESC'],
        ['priority', 'DESC'],
        ['created_at', 'DESC']
      ],
      limit: Math.min(limit, 100),
      offset: (page - 1) * limit,
      include: [{
        model: this.User,
        as: 'sender',
        attributes: ['member_id', 'first_name_encrypted', 'last_name_encrypted']
      }]
    });

    // Récupérer les statuts de lecture
    const messageIds = messages.map(m => m.message_id);
    const readStatuses = await this.MessageReadStatus.findAll({
      where: {
        message_id: { [Op.in]: messageIds },
        member_id: memberId
      }
    });

    const readStatusMap = new Map(readStatuses.map(s => [s.message_id, s]));

    // Filtrer et formater
    let formattedMessages = messages.map(m => {
      const status = readStatusMap.get(m.message_id);
      return {
        ...this._formatMessage(m),
        isRead: !!status?.read_at,
        readAt: status?.read_at,
        isIgnored: !!status?.is_ignored
      };
    });

    if (!includeRead) {
      formattedMessages = formattedMessages.filter(m => !m.isRead);
    }

    if (!includeIgnored) {
      formattedMessages = formattedMessages.filter(m => !m.isIgnored);
    }

    return {
      messages: formattedMessages,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      },
      unreadCount: formattedMessages.filter(m => !m.isRead).length
    };
  }

  /**
   * Récupère un message par ID
   */
  async getMessage(messageId, memberId = null) {
    const message = await this.MessagesCenter.findByPk(messageId, {
      include: [{
        model: this.User,
        as: 'sender',
        attributes: ['member_id', 'first_name_encrypted', 'last_name_encrypted']
      }]
    });

    if (!message) {
      throw new MessageError('MESSAGE_NOT_FOUND', 'Message non trouvé');
    }

    const formatted = this._formatMessage(message);

    // Ajouter le statut de lecture si memberId fourni
    if (memberId) {
      const status = await this.MessageReadStatus.findOne({
        where: { message_id: messageId, member_id: memberId }
      });

      formatted.isRead = !!status?.read_at;
      formatted.readAt = status?.read_at;
      formatted.isIgnored = !!status?.is_ignored;
    }

    return formatted;
  }

  /**
   * Récupère le compteur de messages non lus
   */
  async getUnreadCount(memberId) {
    const { unreadCount } = await this.getMessagesForUser(memberId, {
      includeRead: true,
      includeIgnored: false,
      page: 1,
      limit: 1
    });

    return unreadCount;
  }

  // =========================================
  // ACTIONS SUR LES MESSAGES
  // =========================================

  /**
   * Marque un message comme lu
   */
  async markAsRead(messageId, memberId) {
    const message = await this.MessagesCenter.findByPk(messageId);
    if (!message) {
      throw new MessageError('MESSAGE_NOT_FOUND', 'Message non trouvé');
    }

    await this.MessageReadStatus.markAsRead(messageId, memberId);

    return { success: true, messageId, readAt: new Date() };
  }

  /**
   * Marque plusieurs messages comme lus
   */
  async markMultipleAsRead(messageIds, memberId) {
    const results = [];

    for (const messageId of messageIds) {
      try {
        await this.MessageReadStatus.markAsRead(messageId, memberId);
        results.push({ messageId, success: true });
      } catch (error) {
        results.push({ messageId, success: false, error: error.message });
      }
    }

    return results;
  }

  /**
   * Marque tous les messages comme lus
   */
  async markAllAsRead(memberId) {
    const { messages } = await this.getMessagesForUser(memberId, {
      includeRead: false,
      limit: 1000
    });

    const messageIds = messages.map(m => m.messageId);
    await this.markMultipleAsRead(messageIds, memberId);

    return { marked: messageIds.length };
  }

  /**
   * Ignore un message (le masque)
   */
  async ignoreMessage(messageId, memberId) {
    const message = await this.MessagesCenter.findByPk(messageId);
    if (!message) {
      throw new MessageError('MESSAGE_NOT_FOUND', 'Message non trouvé');
    }

    await this.MessageReadStatus.markAsIgnored(messageId, memberId);

    return { success: true, messageId };
  }

  /**
   * Met à jour un message
   */
  async updateMessage(messageId, updates, updatedByMemberId) {
    const message = await this.MessagesCenter.findByPk(messageId);
    if (!message) {
      throw new MessageError('MESSAGE_NOT_FOUND', 'Message non trouvé');
    }

    // Vérifier que l'utilisateur peut modifier le message
    if (message.sender_member_id !== updatedByMemberId) {
      throw new MessageError('UNAUTHORIZED', 'Non autorisé à modifier ce message');
    }

    const allowedFields = ['title', 'content', 'priority', 'is_pinned', 'expires_at'];
    const filteredUpdates = {};

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        filteredUpdates[field] = updates[field];
      }
    }

    await message.update(filteredUpdates);

    await this._logActivity('message.updated', {
      messageId,
      updatedBy: updatedByMemberId,
      fields: Object.keys(filteredUpdates)
    });

    return this._formatMessage(message);
  }

  /**
   * Supprime un message
   */
  async deleteMessage(messageId, deletedByMemberId) {
    const message = await this.MessagesCenter.findByPk(messageId);
    if (!message) {
      throw new MessageError('MESSAGE_NOT_FOUND', 'Message non trouvé');
    }

    // Vérifier l'autorisation
    if (message.sender_member_id !== deletedByMemberId && message.type !== MESSAGE_TYPES.SYSTEM) {
      throw new MessageError('UNAUTHORIZED', 'Non autorisé à supprimer ce message');
    }

    await message.destroy();

    await this._logActivity('message.deleted', {
      messageId,
      deletedBy: deletedByMemberId
    });

    return { success: true };
  }

  /**
   * Expire un message
   */
  async expireMessage(messageId, expiredByMemberId = null) {
    const message = await this.MessagesCenter.findByPk(messageId);
    if (!message) {
      throw new MessageError('MESSAGE_NOT_FOUND', 'Message non trouvé');
    }

    await message.expire();

    await this._logActivity('message.expired', {
      messageId,
      expiredBy: expiredByMemberId
    });

    return { success: true };
  }

  // =========================================
  // ÉPINGLAGE ET PRIORITÉ
  // =========================================

  /**
   * Épingle un message
   */
  async pinMessage(messageId, pinnedByMemberId) {
    const message = await this.MessagesCenter.findByPk(messageId);
    if (!message) {
      throw new MessageError('MESSAGE_NOT_FOUND', 'Message non trouvé');
    }

    await message.update({ is_pinned: true });

    await this._logActivity('message.pinned', {
      messageId,
      pinnedBy: pinnedByMemberId
    });

    return { success: true };
  }

  /**
   * Désépingle un message
   */
  async unpinMessage(messageId, unpinnedByMemberId) {
    const message = await this.MessagesCenter.findByPk(messageId);
    if (!message) {
      throw new MessageError('MESSAGE_NOT_FOUND', 'Message non trouvé');
    }

    await message.update({ is_pinned: false });

    await this._logActivity('message.unpinned', {
      messageId,
      unpinnedBy: unpinnedByMemberId
    });

    return { success: true };
  }

  /**
   * Change la priorité d'un message
   */
  async setPriority(messageId, priority, changedByMemberId) {
    if (!Object.values(MESSAGE_PRIORITY).includes(priority)) {
      throw new MessageError('INVALID_PRIORITY', 'Priorité invalide');
    }

    const message = await this.MessagesCenter.findByPk(messageId);
    if (!message) {
      throw new MessageError('MESSAGE_NOT_FOUND', 'Message non trouvé');
    }

    await message.update({ priority });

    await this._logActivity('message.priority_changed', {
      messageId,
      priority,
      changedBy: changedByMemberId
    });

    return { success: true, priority };
  }

  // =========================================
  // STATISTIQUES ET HISTORIQUE
  // =========================================

  /**
   * Récupère les statistiques des messages
   */
  async getStatistics(options = {}) {
    const { geoId = null, days = 30 } = options;

    const since = new Date();
    since.setDate(since.getDate() - days);

    const where = {
      created_at: { [Op.gte]: since }
    };

    if (geoId) {
      where.target_identifier = { [Op.like]: geoId.substring(0, 8) + '%' };
    }

    const [total, byType, byPriority, byScope] = await Promise.all([
      this.MessagesCenter.count({ where }),
      this.MessagesCenter.findAll({
        where,
        attributes: ['type', [this.MessagesCenter.sequelize.fn('COUNT', '*'), 'count']],
        group: ['type']
      }),
      this.MessagesCenter.findAll({
        where,
        attributes: ['priority', [this.MessagesCenter.sequelize.fn('COUNT', '*'), 'count']],
        group: ['priority']
      }),
      this.MessagesCenter.findAll({
        where,
        attributes: ['target_scope', [this.MessagesCenter.sequelize.fn('COUNT', '*'), 'count']],
        group: ['target_scope']
      })
    ]);

    return {
      period: { days, since },
      total,
      byType: byType.reduce((acc, r) => ({ ...acc, [r.type]: parseInt(r.get('count')) }), {}),
      byPriority: byPriority.reduce((acc, r) => ({ ...acc, [r.priority]: parseInt(r.get('count')) }), {}),
      byScope: byScope.reduce((acc, r) => ({ ...acc, [r.target_scope]: parseInt(r.get('count')) }), {})
    };
  }

  /**
   * Récupère l'historique de lecture d'un utilisateur
   */
  async getReadHistory(memberId, limit = 20) {
    const history = await this.MessageReadStatus.getRecentHistory(memberId, limit);

    return history.map(h => ({
      messageId: h.message_id,
      readAt: h.read_at,
      message: h.message ? {
        title: h.message.title,
        type: h.message.type,
        priority: h.message.priority,
        createdAt: h.message.created_at
      } : null
    }));
  }

  /**
   * Récupère les messages envoyés par un utilisateur
   */
  async getSentMessages(memberId, options = {}) {
    const { page = 1, limit = 20 } = options;

    const { count, rows } = await this.MessagesCenter.findAndCountAll({
      where: { sender_member_id: memberId },
      order: [['created_at', 'DESC']],
      limit: Math.min(limit, 100),
      offset: (page - 1) * limit
    });

    return {
      messages: rows.map(m => this._formatMessage(m)),
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    };
  }

  // =========================================
  // DIFFUSION ET DESTINATAIRES
  // =========================================

  /**
   * Récupère les destinataires potentiels d'un message
   */
  async getRecipients(message) {
    const where = {};

    switch (message.target_scope) {
      case TARGET_SCOPES.GLOBAL:
        // Tous les utilisateurs actifs
        where.status = 'active';
        break;

      case TARGET_SCOPES.GEO_ID:
        where.geo_id = { [Op.like]: message.target_identifier + '%' };
        where.status = 'active';
        break;

      case TARGET_SCOPES.GROUP:
        // Récupérer via les groupes
        const group = await this.Group.findByPk(message.target_identifier, {
          include: [{ model: this.User, as: 'members' }]
        });
        return group?.members || [];

      case TARGET_SCOPES.INDIVIDUAL:
        where.member_id = message.target_identifier;
        break;

      default:
        return [];
    }

    return this.User.findAll({
      where,
      attributes: ['member_id', 'email', 'first_name_encrypted', 'last_name_encrypted']
    });
  }

  /**
   * Compte les destinataires d'un message
   */
  async countRecipients(targetScope, targetIdentifier) {
    const where = { status: 'active' };

    switch (targetScope) {
      case TARGET_SCOPES.GLOBAL:
        break;

      case TARGET_SCOPES.GEO_ID:
        where.geo_id = { [Op.like]: targetIdentifier + '%' };
        break;

      case TARGET_SCOPES.GROUP:
        const group = await this.Group.findByPk(targetIdentifier, {
          include: [{ model: this.User, as: 'members' }]
        });
        return group?.members?.length || 0;

      case TARGET_SCOPES.INDIVIDUAL:
        return 1;

      default:
        return 0;
    }

    return this.User.count({ where });
  }

  // =========================================
  // NETTOYAGE
  // =========================================

  /**
   * Nettoie les messages expirés
   */
  async cleanupExpiredMessages(daysOld = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const deleted = await this.MessagesCenter.destroy({
      where: {
        expires_at: { [Op.lt]: cutoff }
      }
    });

    console.log(`[MessageService] ${deleted} messages expirés supprimés`);

    return { deleted };
  }

  /**
   * Nettoie les statuts de lecture orphelins
   */
  async cleanupOrphanedReadStatuses() {
    const [results] = await this.MessageReadStatus.sequelize.query(`
      DELETE FROM message_read_status
      WHERE message_id NOT IN (SELECT message_id FROM messages_center)
    `);

    return { cleaned: results?.affectedRows || 0 };
  }

  // =========================================
  // MÉTHODES PRIVÉES
  // =========================================

  /**
   * Valide les données du message
   */
  _validateMessageData(data) {
    if (!data.title || data.title.length < 3) {
      throw new MessageError('INVALID_TITLE', 'Le titre doit faire au moins 3 caractères');
    }

    if (!data.content || data.content.length < 1) {
      throw new MessageError('INVALID_CONTENT', 'Le contenu est requis');
    }

    if (!Object.values(TARGET_SCOPES).includes(data.targetScope)) {
      throw new MessageError('INVALID_SCOPE', 'Portée invalide');
    }

    if (data.targetScope !== TARGET_SCOPES.GLOBAL && !data.targetIdentifier) {
      throw new MessageError('MISSING_TARGET', 'Identifiant cible requis pour cette portée');
    }
  }

  /**
   * Vérifie l'autorisation de l'émetteur
   */
  async _checkSenderAuthorization(memberId, targetScope, targetIdentifier) {
    const user = await this.User.findByPk(memberId);
    if (!user) {
      throw new MessageError('SENDER_NOT_FOUND', 'Émetteur non trouvé');
    }

    // Vérifier les permissions selon le scope
    switch (targetScope) {
      case TARGET_SCOPES.GLOBAL:
        // Seuls les admins peuvent envoyer des messages globaux
        if (!['Admin', 'Super_Admin'].includes(user.role)) {
          throw new MessageError('UNAUTHORIZED', 'Non autorisé à envoyer des messages globaux');
        }
        break;

      case TARGET_SCOPES.GEO_ID:
        // Vérifier que l'utilisateur a autorité sur cette zone
        if (!user.geo_id.startsWith(targetIdentifier.substring(0, 5))) {
          if (!['Admin', 'Super_Admin', 'Platinum'].includes(user.role)) {
            throw new MessageError('UNAUTHORIZED', 'Non autorisé pour cette zone géographique');
          }
        }
        break;

      case TARGET_SCOPES.GROUP:
        // Vérifier l'appartenance ou l'autorité sur le groupe
        // Logique simplifiée - à adapter selon les besoins
        break;

      case TARGET_SCOPES.INDIVIDUAL:
        // Tout utilisateur peut envoyer un message individuel
        break;
    }
  }

  /**
   * Notifie les destinataires d'un nouveau message
   */
  async _notifyRecipients(message) {
    if (!this._notificationService) return;

    try {
      const recipients = await this.getRecipients(message);

      for (const recipient of recipients.slice(0, 100)) { // Limiter à 100 notifications directes
        await this._notificationService.send({
          userId: recipient.member_id,
          type: 'message',
          title: 'Nouveau message',
          message: message.title,
          data: { messageId: message.message_id },
          priority: message.priority
        });
      }
    } catch (error) {
      console.error('[MessageService] Erreur notification:', error.message);
    }
  }

  /**
   * Formate un message pour l'API
   */
  _formatMessage(message) {
    return {
      messageId: message.message_id,
      type: message.type,
      title: message.title,
      content: message.content,
      priority: message.priority,
      isPinned: message.is_pinned,
      targetScope: message.target_scope,
      targetIdentifier: message.target_identifier,
      expiresAt: message.expires_at,
      isExpired: message.expires_at ? new Date() > new Date(message.expires_at) : false,
      sender: message.sender ? {
        memberId: message.sender.member_id,
        firstName: message.sender.first_name_encrypted,
        lastName: message.sender.last_name_encrypted
      } : null,
      createdAt: message.created_at,
      updatedAt: message.updated_at
    };
  }

  /**
   * Formate une date/heure
   */
  _formatDateTime(date) {
    return new Date(date).toLocaleString('fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Log une activité
   */
  async _logActivity(action, data) {
    try {
      if (this._auditService) {
        await this._auditService.logOperation(action, {
          module: 'messages',
          ...data
        });
      }
    } catch (error) {
      console.error('[MessageService] Erreur audit:', error.message);
    }
  }
}

/**
 * Classe d'erreur pour le service de messages
 */
class MessageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MessageError';
    this.code = code;
  }
}

module.exports = MessageService;
module.exports.MessageError = MessageError;
module.exports.MESSAGE_TYPES = MESSAGE_TYPES;
module.exports.TARGET_SCOPES = TARGET_SCOPES;
module.exports.MESSAGE_PRIORITY = MESSAGE_PRIORITY;
module.exports.SYSTEM_CATEGORIES = SYSTEM_CATEGORIES;
