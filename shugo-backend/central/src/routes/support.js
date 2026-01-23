// routes/support.js
// Route: /api/v1/support/*
// Description: Système de tickets de support Assist'SHUGO

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validateRequest } = require('../middleware/validateRequest');
const { rateLimiter } = require('../middleware/rateLimiter');
const { auditLog } = require('../middleware/audit');
const SupportService = require('../services/SupportService');
const Joi = require('joi');

// Validation schemas
const schemas = {
  createTicket: Joi.object({
    category: Joi.string().valid(
      'technical', 'account', 'guard', 'mission', 'security', 'billing', 'feature', 'other'
    ).required(),
    priority: Joi.string().valid('low', 'medium', 'high', 'critical').default('medium'),
    subject: Joi.string().required().max(200),
    description: Joi.string().required().max(5000),
    attachments: Joi.array().items(
      Joi.object({
        filename: Joi.string().required(),
        type: Joi.string().required(),
        size: Joi.number().integer().required(),
        data: Joi.string() // Base64 encoded
      })
    ).max(5),
    related_entities: Joi.object({
      guard_id: Joi.string().uuid(),
      mission_id: Joi.string().uuid(),
      user_id: Joi.number().integer(),
      error_code: Joi.string().pattern(/^SHUGO-\d{3,4}$/)
    }),
    contact_preferences: Joi.object({
      email: Joi.boolean().default(true),
      sms: Joi.boolean().default(false),
      in_app: Joi.boolean().default(true)
    })
  }),

  updateTicket: Joi.object({
    status: Joi.string().valid('open', 'in_progress', 'pending', 'resolved', 'closed'),
    priority: Joi.string().valid('low', 'medium', 'high', 'critical'),
    category: Joi.string(),
    assigned_to_member_id: Joi.number().integer().allow(null),
    tags: Joi.array().items(Joi.string()),
    internal_notes: Joi.string().max(2000)
  }).min(1),

  addResponse: Joi.object({
    response_type: Joi.string().valid('public', 'internal').default('public'),
    content: Joi.string().required().max(5000),
    attachments: Joi.array().items(Joi.object()),
    close_ticket: Joi.boolean().default(false),
    solution_provided: Joi.boolean().default(false)
  }),

  rateSupport: Joi.object({
    rating: Joi.number().integer().min(1).max(5).required(),
    feedback: Joi.string().max(1000),
    resolved_issue: Joi.boolean().required()
  })
};

// GET /api/v1/support/tickets - Liste les tickets
router.get(
  '/tickets',
  authenticate,
  rateLimiter('support:list'),
  async (req, res, next) => {
    try {
      const {
        status,
        priority,
        category,
        assigned_to,
        my_tickets_only = 'false',
        page = 1,
        limit = 20
      } = req.query;

      let filters = { status, priority, category };
      
      if (my_tickets_only === 'true') {
        filters.requester_member_id = req.user.member_id;
      } else if (!req.user.roles?.includes('admin') && !req.user.roles?.includes('support')) {
        // Les utilisateurs normaux ne voient que leurs propres tickets
        filters.requester_member_id = req.user.member_id;
      }

      if (assigned_to) {
        filters.assigned_to_member_id = assigned_to === 'me' 
          ? req.user.member_id 
          : parseInt(assigned_to);
      }

      const tickets = await SupportService.listTickets({
        filters,
        page: parseInt(page),
        limit: parseInt(limit),
        user: req.user
      });

      res.json({
        success: true,
        data: tickets.data,
        meta: {
          total: tickets.total,
          page: tickets.page,
          pages: tickets.pages,
          limit: tickets.limit,
          stats: tickets.stats
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/support/tickets/:id - Récupère un ticket spécifique
router.get(
  '/tickets/:id',
  authenticate,
  rateLimiter('support:read'),
  async (req, res, next) => {
    try {
      const ticket = await SupportService.getTicket({
        ticket_id: req.params.id,
        user: req.user,
        include_history: req.query.include_history === 'true'
      });

      if (!ticket) {
        return res.status(404).json({
          success: false,
          error: { code: 'SHUGO-404', message: 'Ticket non trouvé' }
        });
      }

      res.json({
        success: true,
        data: ticket
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/support/tickets - Crée un nouveau ticket
router.post(
  '/tickets',
  authenticate,
  validateRequest(schemas.createTicket),
  rateLimiter('support:create'),
  auditLog('support.create'),
  async (req, res, next) => {
    try {
      const ticket = await SupportService.createTicket({
        ...req.body,
        requester_member_id: req.user.member_id
      });

      res.status(201).json({
        success: true,
        data: ticket,
        message: `Ticket #${ticket.ticket_number} créé avec succès`
      });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/v1/support/tickets/:id - Met à jour un ticket
router.patch(
  '/tickets/:id',
  authenticate,
  authorize(['admin', 'support', 'coordinator']),
  validateRequest(schemas.updateTicket),
  rateLimiter('support:update'),
  auditLog('support.update'),
  async (req, res, next) => {
    try {
      const ticket = await SupportService.updateTicket({
        ticket_id: req.params.id,
        updates: req.body,
        updated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: ticket,
        message: 'Ticket mis à jour avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/support/tickets/:id/responses - Ajoute une réponse
router.post(
  '/tickets/:id/responses',
  authenticate,
  validateRequest(schemas.addResponse),
  rateLimiter('support:respond'),
  auditLog('support.respond'),
  async (req, res, next) => {
    try {
      const response = await SupportService.addResponse({
        ticket_id: req.params.id,
        ...req.body,
        responder_member_id: req.user.member_id
      });

      res.status(201).json({
        success: true,
        data: response,
        message: 'Réponse ajoutée avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/support/tickets/:id/assign - Assigne un ticket
router.post(
  '/tickets/:id/assign',
  authenticate,
  authorize(['admin', 'support', 'coordinator']),
  rateLimiter('support:assign'),
  auditLog('support.assign'),
  async (req, res, next) => {
    try {
      const { assigned_to_member_id, note } = req.body;

      const ticket = await SupportService.assignTicket({
        ticket_id: req.params.id,
        assigned_to_member_id,
        assigned_by: req.user.member_id,
        note
      });

      res.json({
        success: true,
        data: ticket,
        message: 'Ticket assigné avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/support/tickets/:id/escalate - Escalade un ticket
router.post(
  '/tickets/:id/escalate',
  authenticate,
  authorize(['support', 'coordinator']),
  rateLimiter('support:escalate'),
  auditLog('support.escalate'),
  async (req, res, next) => {
    try {
      const { reason, new_priority = 'high' } = req.body;

      const ticket = await SupportService.escalateTicket({
        ticket_id: req.params.id,
        reason,
        new_priority,
        escalated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: ticket,
        message: 'Ticket escaladé avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/support/tickets/:id/close - Ferme un ticket
router.post(
  '/tickets/:id/close',
  authenticate,
  rateLimiter('support:close'),
  auditLog('support.close'),
  async (req, res, next) => {
    try {
      const { resolution, close_reason } = req.body;

      const ticket = await SupportService.closeTicket({
        ticket_id: req.params.id,
        resolution,
        close_reason,
        closed_by: req.user.member_id
      });

      res.json({
        success: true,
        data: ticket,
        message: 'Ticket fermé avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/support/tickets/:id/reopen - Réouvre un ticket
router.post(
  '/tickets/:id/reopen',
  authenticate,
  rateLimiter('support:reopen'),
  auditLog('support.reopen'),
  async (req, res, next) => {
    try {
      const { reason } = req.body;

      const ticket = await SupportService.reopenTicket({
        ticket_id: req.params.id,
        reason,
        reopened_by: req.user.member_id
      });

      res.json({
        success: true,
        data: ticket,
        message: 'Ticket réouvert avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/support/tickets/:id/rate - Évalue le support
router.post(
  '/tickets/:id/rate',
  authenticate,
  validateRequest(schemas.rateSupport),
  rateLimiter('support:rate'),
  async (req, res, next) => {
    try {
      const rating = await SupportService.rateSupport({
        ticket_id: req.params.id,
        ...req.body,
        rated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: rating,
        message: 'Évaluation enregistrée, merci pour votre retour'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/support/categories - Liste les catégories
router.get(
  '/categories',
  authenticate,
  rateLimiter('support:categories'),
  async (req, res, next) => {
    try {
      const categories = await SupportService.getCategories({
        include_descriptions: req.query.include_descriptions === 'true'
      });

      res.json({
        success: true,
        data: categories
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/support/statistics - Statistiques du support
router.get(
  '/statistics',
  authenticate,
  authorize(['admin', 'support']),
  rateLimiter('support:stats'),
  async (req, res, next) => {
    try {
      const { date_from, date_to, group_by = 'day' } = req.query;

      const stats = await SupportService.getStatistics({
        date_from,
        date_to,
        group_by
      });

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/support/kb/search - Recherche dans la base de connaissances
router.get(
  '/kb/search',
  authenticate,
  rateLimiter('support:kbSearch'),
  async (req, res, next) => {
    try {
      const { q, category, limit = 10 } = req.query;

      if (!q) {
        return res.status(400).json({
          success: false,
          error: { code: 'SHUGO-400', message: 'Paramètre de recherche requis' }
        });
      }

      const results = await SupportService.searchKnowledgeBase({
        query: q,
        category,
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: results
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/support/kb/articles/:id - Article de la base de connaissances
router.get(
  '/kb/articles/:id',
  authenticate,
  rateLimiter('support:kbArticle'),
  async (req, res, next) => {
    try {
      const article = await SupportService.getKBArticle({
        article_id: req.params.id,
        increment_views: true
      });

      if (!article) {
        return res.status(404).json({
          success: false,
          error: { code: 'SHUGO-404', message: 'Article non trouvé' }
        });
      }

      res.json({
        success: true,
        data: article
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
