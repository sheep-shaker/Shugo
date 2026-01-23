// routes/waitingList.js
// Route: /api/v1/waiting-list/*
// Description: Gestion de la liste d'attente avec activation J-3

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validateRequest } = require('../middleware/validateRequest');
const { rateLimiter } = require('../middleware/rateLimiter');
const { auditLog } = require('../middleware/audit');
const WaitingListService = require('../services/WaitingListService');
const Joi = require('joi');

// Validation schemas
const schemas = {
  joinWaitingList: Joi.object({
    guard_id: Joi.string().uuid().required(),
    priority: Joi.number().integer().min(1).max(10).default(5),
    notification_preference: Joi.string().valid('email', 'sms', 'push', 'all').default('all'),
    max_distance_km: Joi.number().integer().min(0).max(100),
    availability_constraints: Joi.object({
      days_available: Joi.array().items(
        Joi.string().valid('lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche')
      ),
      shifts_available: Joi.array().items(
        Joi.string().valid('matin', 'après-midi', 'soir', 'nuit')
      ),
      exclude_dates: Joi.array().items(Joi.date().iso())
    })
  }),

  updatePosition: Joi.object({
    priority: Joi.number().integer().min(1).max(10),
    notification_preference: Joi.string().valid('email', 'sms', 'push', 'all'),
    max_distance_km: Joi.number().integer().min(0).max(100),
    availability_constraints: Joi.object(),
    is_active: Joi.boolean()
  }).min(1),

  batchActivation: Joi.object({
    guard_ids: Joi.array().items(Joi.string().uuid()).required().min(1),
    activation_date: Joi.date().iso(),
    send_notifications: Joi.boolean().default(true)
  })
};

// GET /api/v1/waiting-list - Liste les entrées de la liste d'attente
router.get(
  '/',
  authenticate,
  authorize(['admin', 'coordinator']),
  rateLimiter('waitingList:list'),
  async (req, res, next) => {
    try {
      const {
        geo_id,
        guard_id,
        status = 'active',
        page = 1,
        limit = 50
      } = req.query;

      const waitingList = await WaitingListService.getWaitingList({
        geo_id,
        guard_id,
        status,
        page: parseInt(page),
        limit: parseInt(limit),
        user: req.user
      });

      res.json({
        success: true,
        data: waitingList.data,
        meta: {
          total: waitingList.total,
          page: waitingList.page,
          pages: waitingList.pages,
          limit: waitingList.limit,
          next_activation: waitingList.next_activation_date
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/waiting-list/my-positions - Liste des positions de l'utilisateur
router.get(
  '/my-positions',
  authenticate,
  rateLimiter('waitingList:myPositions'),
  async (req, res, next) => {
    try {
      const positions = await WaitingListService.getUserPositions({
        member_id: req.user.member_id,
        include_inactive: req.query.include_inactive === 'true'
      });

      res.json({
        success: true,
        data: positions
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/waiting-list/guards/:guard_id - Liste d'attente pour un créneau spécifique
router.get(
  '/guards/:guard_id',
  authenticate,
  rateLimiter('waitingList:guardList'),
  async (req, res, next) => {
    try {
      const waitingList = await WaitingListService.getGuardWaitingList({
        guard_id: req.params.guard_id,
        user: req.user,
        include_stats: req.query.include_stats === 'true'
      });

      if (!waitingList) {
        return res.status(404).json({
          success: false,
          error: { code: 'SHUGO-404', message: 'Créneau non trouvé' }
        });
      }

      res.json({
        success: true,
        data: waitingList
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/waiting-list - S'inscrire sur la liste d'attente
router.post(
  '/',
  authenticate,
  validateRequest(schemas.joinWaitingList),
  rateLimiter('waitingList:join'),
  auditLog('waitingList.join'),
  async (req, res, next) => {
    try {
      const position = await WaitingListService.joinWaitingList({
        ...req.body,
        member_id: req.user.member_id
      });

      res.status(201).json({
        success: true,
        data: position,
        message: `Inscription sur la liste d'attente confirmée. Position: ${position.position}`
      });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/v1/waiting-list/:id - Modifier sa position
router.patch(
  '/:id',
  authenticate,
  validateRequest(schemas.updatePosition),
  rateLimiter('waitingList:update'),
  auditLog('waitingList.update'),
  async (req, res, next) => {
    try {
      const position = await WaitingListService.updatePosition({
        position_id: req.params.id,
        updates: req.body,
        member_id: req.user.member_id
      });

      res.json({
        success: true,
        data: position,
        message: 'Position mise à jour avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/waiting-list/:id - Quitter la liste d'attente
router.delete(
  '/:id',
  authenticate,
  rateLimiter('waitingList:leave'),
  auditLog('waitingList.leave'),
  async (req, res, next) => {
    try {
      await WaitingListService.leaveWaitingList({
        position_id: req.params.id,
        member_id: req.user.member_id,
        reason: req.query.reason
      });

      res.json({
        success: true,
        message: 'Désinscription de la liste d\'attente confirmée'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/waiting-list/activate - Activation manuelle (admin)
router.post(
  '/activate',
  authenticate,
  authorize(['admin']),
  validateRequest(schemas.batchActivation),
  rateLimiter('waitingList:activate'),
  auditLog('waitingList.activate'),
  async (req, res, next) => {
    try {
      const result = await WaitingListService.activatePositions({
        ...req.body,
        activated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: result,
        message: `${result.activated_count} positions activées avec succès`
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/waiting-list/pending-activations - Activations en attente
router.get(
  '/pending-activations',
  authenticate,
  authorize(['admin', 'coordinator']),
  rateLimiter('waitingList:pending'),
  async (req, res, next) => {
    try {
      const pending = await WaitingListService.getPendingActivations({
        days_ahead: parseInt(req.query.days_ahead || 3),
        geo_id: req.query.geo_id
      });

      res.json({
        success: true,
        data: pending
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/waiting-list/:id/activate-now - Activation immédiate d'une position
router.post(
  '/:id/activate-now',
  authenticate,
  authorize(['admin', 'coordinator']),
  rateLimiter('waitingList:activateNow'),
  auditLog('waitingList.activateNow'),
  async (req, res, next) => {
    try {
      const result = await WaitingListService.activateNow({
        position_id: req.params.id,
        notify: req.body.notify !== false,
        activated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: result,
        message: 'Position activée et utilisateur assigné au créneau'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/waiting-list/statistics - Statistiques de la liste d'attente
router.get(
  '/statistics',
  authenticate,
  authorize(['admin', 'coordinator']),
  rateLimiter('waitingList:stats'),
  async (req, res, next) => {
    try {
      const stats = await WaitingListService.getStatistics({
        geo_id: req.query.geo_id,
        date_from: req.query.date_from,
        date_to: req.query.date_to
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

// POST /api/v1/waiting-list/process-j3 - Traitement J-3 (appelé par CRON)
router.post(
  '/process-j3',
  authenticate,
  authorize(['system', 'admin']),
  rateLimiter('waitingList:processJ3'),
  auditLog('waitingList.processJ3'),
  async (req, res, next) => {
    try {
      const result = await WaitingListService.processJ3Activations({
        dry_run: req.query.dry_run === 'true'
      });

      res.json({
        success: true,
        data: result,
        message: `Traitement J-3 terminé. ${result.activated_count} positions activées.`
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
