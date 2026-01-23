// routes/scenarios.js
// Route: /api/v1/scenarios/*
// Description: CRUD des scénarios de garde et application aux semaines

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validateRequest } = require('../middleware/validateRequest');
const { rateLimiter } = require('../middleware/rateLimiter');
const { auditLog } = require('../middleware/audit');
const ScenarioService = require('../services/ScenarioService');
const Joi = require('joi');

// Validation schemas
const schemas = {
  createScenario: Joi.object({
    name: Joi.string().required().max(100),
    description: Joi.string().max(500),
    geo_id: Joi.string().required().pattern(/^[A-Z]{2}-\d{2}-[A-Z0-9]+$/),
    template_data: Joi.object({
      slots: Joi.array().items(
        Joi.object({
          day: Joi.string().valid('lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche').required(),
          shift: Joi.string().valid('matin', 'après-midi', 'soir', 'nuit').required(),
          time_start: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
          time_end: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
          role_required: Joi.string().allow(null),
          min_guards: Joi.number().integer().min(0).required(),
          max_guards: Joi.number().integer().min(0).required(),
          points: Joi.number().integer().min(0).default(1),
          require_certification: Joi.boolean().default(false)
        })
      ).required(),
      recurring: Joi.boolean().default(false),
      weeks_cycle: Joi.number().integer().min(1).max(52).default(1)
    }).required(),
    is_active: Joi.boolean().default(true)
  }),

  updateScenario: Joi.object({
    name: Joi.string().max(100),
    description: Joi.string().max(500),
    template_data: Joi.object(),
    is_active: Joi.boolean()
  }).min(1),

  applyScenario: Joi.object({
    scenario_id: Joi.string().uuid().required(),
    geo_id: Joi.string().required().pattern(/^[A-Z]{2}-\d{2}-[A-Z0-9]+$/),
    start_date: Joi.date().iso().required(),
    end_date: Joi.date().iso().greater(Joi.ref('start_date')).required(),
    override_existing: Joi.boolean().default(false),
    auto_assign_priorities: Joi.boolean().default(false)
  }),

  cloneScenario: Joi.object({
    new_name: Joi.string().required().max(100),
    target_geo_id: Joi.string().required().pattern(/^[A-Z]{2}-\d{2}-[A-Z0-9]+$/),
    include_inactive_slots: Joi.boolean().default(false)
  })
};

// GET /api/v1/scenarios - Liste tous les scénarios
router.get(
  '/',
  authenticate,
  authorize(['admin', 'coordinator']),
  rateLimiter('scenarios:list'),
  async (req, res, next) => {
    try {
      const { geo_id, active_only = 'true', page = 1, limit = 20 } = req.query;
      
      const scenarios = await ScenarioService.listScenarios({
        geo_id,
        active_only: active_only === 'true',
        page: parseInt(page),
        limit: parseInt(limit),
        user: req.user
      });

      res.json({
        success: true,
        data: scenarios.data,
        meta: {
          total: scenarios.total,
          page: scenarios.page,
          pages: scenarios.pages,
          limit: scenarios.limit
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/scenarios/:id - Récupère un scénario spécifique
router.get(
  '/:id',
  authenticate,
  authorize(['admin', 'coordinator', 'guard']),
  rateLimiter('scenarios:read'),
  async (req, res, next) => {
    try {
      const scenario = await ScenarioService.getScenario({
        scenario_id: req.params.id,
        user: req.user,
        include_stats: req.query.include_stats === 'true'
      });

      if (!scenario) {
        return res.status(404).json({
          success: false,
          error: { code: 'SHUGO-404', message: 'Scénario non trouvé' }
        });
      }

      res.json({
        success: true,
        data: scenario
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/scenarios - Crée un nouveau scénario
router.post(
  '/',
  authenticate,
  authorize(['admin', 'coordinator']),
  validateRequest(schemas.createScenario),
  rateLimiter('scenarios:create'),
  auditLog('scenario.create'),
  async (req, res, next) => {
    try {
      const scenario = await ScenarioService.createScenario({
        ...req.body,
        created_by: req.user.member_id
      });

      res.status(201).json({
        success: true,
        data: scenario,
        message: 'Scénario créé avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/v1/scenarios/:id - Met à jour un scénario
router.patch(
  '/:id',
  authenticate,
  authorize(['admin', 'coordinator']),
  validateRequest(schemas.updateScenario),
  rateLimiter('scenarios:update'),
  auditLog('scenario.update'),
  async (req, res, next) => {
    try {
      const scenario = await ScenarioService.updateScenario({
        scenario_id: req.params.id,
        updates: req.body,
        user: req.user
      });

      res.json({
        success: true,
        data: scenario,
        message: 'Scénario mis à jour avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/scenarios/:id - Supprime un scénario
router.delete(
  '/:id',
  authenticate,
  authorize(['admin']),
  rateLimiter('scenarios:delete'),
  auditLog('scenario.delete'),
  async (req, res, next) => {
    try {
      await ScenarioService.deleteScenario({
        scenario_id: req.params.id,
        user: req.user,
        force: req.query.force === 'true'
      });

      res.json({
        success: true,
        message: 'Scénario supprimé avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/scenarios/:id/apply - Applique un scénario à une période
router.post(
  '/:id/apply',
  authenticate,
  authorize(['admin', 'coordinator']),
  validateRequest(schemas.applyScenario),
  rateLimiter('scenarios:apply'),
  auditLog('scenario.apply'),
  async (req, res, next) => {
    try {
      const result = await ScenarioService.applyScenario({
        scenario_id: req.params.id,
        ...req.body,
        applied_by: req.user.member_id
      });

      res.json({
        success: true,
        data: result,
        message: `Scénario appliqué avec succès. ${result.guards_created} créneaux créés.`
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/scenarios/:id/clone - Clone un scénario
router.post(
  '/:id/clone',
  authenticate,
  authorize(['admin', 'coordinator']),
  validateRequest(schemas.cloneScenario),
  rateLimiter('scenarios:clone'),
  auditLog('scenario.clone'),
  async (req, res, next) => {
    try {
      const newScenario = await ScenarioService.cloneScenario({
        scenario_id: req.params.id,
        ...req.body,
        cloned_by: req.user.member_id
      });

      res.status(201).json({
        success: true,
        data: newScenario,
        message: 'Scénario cloné avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/scenarios/:id/preview - Prévisualise l'application d'un scénario
router.get(
  '/:id/preview',
  authenticate,
  authorize(['admin', 'coordinator']),
  rateLimiter('scenarios:preview'),
  async (req, res, next) => {
    try {
      const { start_date, end_date } = req.query;
      
      if (!start_date || !end_date) {
        return res.status(400).json({
          success: false,
          error: { code: 'SHUGO-400', message: 'start_date et end_date sont requis' }
        });
      }

      const preview = await ScenarioService.previewScenario({
        scenario_id: req.params.id,
        start_date,
        end_date,
        user: req.user
      });

      res.json({
        success: true,
        data: preview
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/scenarios/templates - Récupère les templates disponibles
router.get(
  '/templates',
  authenticate,
  authorize(['admin', 'coordinator']),
  rateLimiter('scenarios:templates'),
  async (req, res, next) => {
    try {
      const templates = await ScenarioService.getTemplates({
        category: req.query.category,
        geo_scope: req.query.geo_scope
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

// POST /api/v1/scenarios/:id/validate - Valide un scénario
router.post(
  '/:id/validate',
  authenticate,
  authorize(['admin', 'coordinator']),
  rateLimiter('scenarios:validate'),
  async (req, res, next) => {
    try {
      const validation = await ScenarioService.validateScenario({
        scenario_id: req.params.id,
        strict_mode: req.query.strict === 'true'
      });

      res.json({
        success: true,
        data: validation
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
