// routes/messages.js
// Route: /api/v1/messages/*
// Description: Centre de messages hiérarchisé avec émission manuelle et système

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validateRequest } = require('../middleware/validateRequest');
const { rateLimiter } = require('../middleware/rateLimiter');
const { auditLog } = require('../middleware/audit');
const MessageService = require('../services/MessageService');
const Joi = require('joi');

// Validation schemas
const schemas = {
  createMessage: Joi.object({
    message_type: Joi.string().valid('info', 'warning', 'alert', 'system', 'announcement').required(),
    priority: Joi.number().integer().min(1).max(10).default(5),
    target_type: Joi.string().valid('all', 'geo', 'group', 'individual', 'role').required(),
    target_geo_id: Joi.when('target_type', {
      is: 'geo',
      then: Joi.string().pattern(/^[A-Z]{2}-\d{2}-[A-Z0-9]+$/).required(),
      otherwise: Joi.optional()
    }),
    target_group_ids: Joi.when('target_type', {
      is: 'group',
      then: Joi.array().items(Joi.string().uuid()).required(),
      otherwise: Joi.optional()
    }),
    target_member_ids: Joi.when('target_type', {
      is: 'individual',
      then: Joi.array().items(Joi.number().integer()).required(),
      otherwise: Joi.optional()
    }),
    target_roles: Joi.when('target_type', {
      is: 'role',
      then: Joi.array().items(Joi.string()).required(),
      otherwise: Joi.optional()
    }),
    subject: Joi.string().required().max(200),
    content: Joi.string().required().max(5000),
    content_html: Joi.string().max(10000),
    attachments: Joi.array().items(
      Joi.object({
        filename: Joi.string().required(),
        type: Joi.string().required(),
        size: Joi.number().integer().required(),
        url: Joi.string().uri()
      })
    ),
    valid_from: Joi.date().iso().default(() => new Date()),
    valid_until: Joi.date().iso().greater(Joi.ref('valid_from')),
    require_acknowledgment: Joi.boolean().default(false),
    allow_reply: Joi.boolean().default(false),
    auto_translate: Joi.boolean().default(false),
    send_notification: Joi.boolean().default(true),
    notification_channels: Joi.array().items(
      Joi.string().valid('in_app', 'email', 'sms', 'push')
    ).default(['in_app'])
  }),

  updateMessage: Joi.object({
    subject: Joi.string().max(200),
    content: Joi.string().max(5000),
    content_html: Joi.string().max(10000),
    priority: Joi.number().integer().min(1).max(10),
    valid_until: Joi.date().iso(),
    is_active: Joi.boolean()
  }).min(1),

  markAsRead: Joi.object({
    message_ids: Joi.array().items(Joi.string().uuid()).required().min(1),
    acknowledged: Joi.boolean().default(false)
  }),

  replyToMessage: Joi.object({
    content: Joi.string().required().max(2000),
    attachments: Joi.array().items(Joi.object())
  })
};

// GET /api/v1/messages - Liste les messages
router.get(
  '/',
  authenticate,
  rateLimiter('messages:list'),
  async (req, res, next) => {
    try {
      const {
        folder = 'inbox',
        unread_only = 'false',
        message_type,
        priority_min,
        page = 1,
        limit = 20
      } = req.query;

      const messages = await MessageService.getMessages({
        member_id: req.user.member_id,
        folder,
        filters: {
          unread_only: unread_only === 'true',
          message_type,
          priority_min: priority_min ? parseInt(priority_min) : undefined
        },
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: messages.data,
        meta: {
          total: messages.total,
          unread: messages.unread_count,
          page: messages.page,
          pages: messages.pages,
          limit: messages.limit
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/messages/unread-count - Nombre de messages non lus
router.get(
  '/unread-count',
  authenticate,
  rateLimiter('messages:unreadCount'),
  async (req, res, next) => {
    try {
      const counts = await MessageService.getUnreadCounts({
        member_id: req.user.member_id
      });

      res.json({
        success: true,
        data: counts
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/messages/:id - Récupère un message spécifique
router.get(
  '/:id',
  authenticate,
  rateLimiter('messages:read'),
  async (req, res, next) => {
    try {
      const message = await MessageService.getMessage({
        message_id: req.params.id,
        member_id: req.user.member_id,
        mark_as_read: req.query.mark_as_read !== 'false'
      });

      if (!message) {
        return res.status(404).json({
          success: false,
          error: { code: 'SHUGO-404', message: 'Message non trouvé' }
        });
      }

      res.json({
        success: true,
        data: message
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/messages - Crée un nouveau message
router.post(
  '/',
  authenticate,
  authorize(['admin', 'coordinator', 'moderator']),
  validateRequest(schemas.createMessage),
  rateLimiter('messages:create'),
  auditLog('message.create'),
  async (req, res, next) => {
    try {
      const message = await MessageService.createMessage({
        ...req.body,
        sender_member_id: req.user.member_id
      });

      res.status(201).json({
        success: true,
        data: message,
        message: `Message envoyé à ${message.recipients_count} destinataire(s)`
      });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/v1/messages/:id - Met à jour un message
router.patch(
  '/:id',
  authenticate,
  authorize(['admin', 'coordinator']),
  validateRequest(schemas.updateMessage),
  rateLimiter('messages:update'),
  auditLog('message.update'),
  async (req, res, next) => {
    try {
      const message = await MessageService.updateMessage({
        message_id: req.params.id,
        updates: req.body,
        user: req.user
      });

      res.json({
        success: true,
        data: message,
        message: 'Message mis à jour avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/messages/:id - Supprime un message
router.delete(
  '/:id',
  authenticate,
  rateLimiter('messages:delete'),
  auditLog('message.delete'),
  async (req, res, next) => {
    try {
      await MessageService.deleteMessage({
        message_id: req.params.id,
        member_id: req.user.member_id,
        is_admin: req.user.roles?.includes('admin')
      });

      res.json({
        success: true,
        message: 'Message supprimé avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/messages/mark-read - Marque des messages comme lus
router.post(
  '/mark-read',
  authenticate,
  validateRequest(schemas.markAsRead),
  rateLimiter('messages:markRead'),
  async (req, res, next) => {
    try {
      const result = await MessageService.markAsRead({
        ...req.body,
        member_id: req.user.member_id
      });

      res.json({
        success: true,
        data: result,
        message: `${result.marked_count} message(s) marqué(s) comme lu(s)`
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/messages/:id/acknowledge - Accuse réception d'un message
router.post(
  '/:id/acknowledge',
  authenticate,
  rateLimiter('messages:acknowledge'),
  async (req, res, next) => {
    try {
      const result = await MessageService.acknowledgeMessage({
        message_id: req.params.id,
        member_id: req.user.member_id,
        acknowledgment_text: req.body.text
      });

      res.json({
        success: true,
        data: result,
        message: 'Accusé de réception enregistré'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/messages/:id/reply - Répondre à un message
router.post(
  '/:id/reply',
  authenticate,
  validateRequest(schemas.replyToMessage),
  rateLimiter('messages:reply'),
  auditLog('message.reply'),
  async (req, res, next) => {
    try {
      const reply = await MessageService.replyToMessage({
        parent_message_id: req.params.id,
        ...req.body,
        sender_member_id: req.user.member_id
      });

      res.status(201).json({
        success: true,
        data: reply,
        message: 'Réponse envoyée avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/messages/:id/thread - Récupère un fil de discussion
router.get(
  '/:id/thread',
  authenticate,
  rateLimiter('messages:thread'),
  async (req, res, next) => {
    try {
      const thread = await MessageService.getMessageThread({
        message_id: req.params.id,
        member_id: req.user.member_id
      });

      res.json({
        success: true,
        data: thread
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/messages/:id/read-status - Statut de lecture d'un message
router.get(
  '/:id/read-status',
  authenticate,
  authorize(['admin', 'coordinator']),
  rateLimiter('messages:readStatus'),
  async (req, res, next) => {
    try {
      const status = await MessageService.getReadStatus({
        message_id: req.params.id,
        user: req.user
      });

      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/messages/broadcast - Diffusion de masse (admin)
router.post(
  '/broadcast',
  authenticate,
  authorize(['admin']),
  validateRequest(schemas.createMessage),
  rateLimiter('messages:broadcast'),
  auditLog('message.broadcast'),
  async (req, res, next) => {
    try {
      const result = await MessageService.broadcastMessage({
        ...req.body,
        sender_member_id: req.user.member_id,
        is_broadcast: true
      });

      res.status(201).json({
        success: true,
        data: result,
        message: `Message diffusé à ${result.recipients_count} destinataire(s)`
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/messages/templates - Templates de messages
router.get(
  '/templates',
  authenticate,
  authorize(['admin', 'coordinator', 'moderator']),
  rateLimiter('messages:templates'),
  async (req, res, next) => {
    try {
      const templates = await MessageService.getTemplates({
        category: req.query.category,
        language: req.query.language || 'fr'
      });

      res.json({
        success: true,
        data: templates
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
