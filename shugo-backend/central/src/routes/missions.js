// routes/missions.js
// Route: /api/v1/missions/*
// Description: CRUD des missions, attribution et révocation

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validateRequest } = require('../middleware/validateRequest');
const { rateLimiter } = require('../middleware/rateLimiter');
const { auditLog } = require('../middleware/audit');
const MissionService = require('../services/MissionService');
const Joi = require('joi');

// Validation schemas
const schemas = {
  createMission: Joi.object({
    mission_type: Joi.string().valid('temporary', 'permanent').required(),
    member_id: Joi.number().integer().min(1).max(9999999999).required(),
    scope_type: Joi.string().valid('global', 'regional', 'local', 'group').required(),
    scope_geo_id: Joi.string().pattern(/^[A-Z]{2}-\d{2}-[A-Z0-9]+$/).allow(null),
    scope_group_id: Joi.string().uuid().allow(null),
    privileges_granted: Joi.object({
      roles: Joi.array().items(
        Joi.string().valid('admin', 'coordinator', 'moderator', 'validator', 'auditor')
      ),
      permissions: Joi.array().items(Joi.string()),
      restrictions: Joi.array().items(Joi.string()),
      max_actions_per_day: Joi.number().integer().min(0),
      require_2fa: Joi.boolean().default(true)
    }).required(),
    valid_from: Joi.date().iso().required(),
    valid_until: Joi.date().iso().greater(Joi.ref('valid_from')).allow(null),
    justification: Joi.string().required().max(1000),
    requires_validation: Joi.boolean().default(true),
    auto_renew: Joi.boolean().default(false),
    notification_settings: Joi.object({
      notify_on_grant: Joi.boolean().default(true),
      notify_on_expire: Joi.boolean().default(true),
      notify_before_expire_days: Joi.number().integer().min(0).default(7)
    })
  }),

  updateMission: Joi.object({
    scope_geo_id: Joi.string().pattern(/^[A-Z]{2}-\d{2}-[A-Z0-9]+$/),
    scope_group_id: Joi.string().uuid(),
    privileges_granted: Joi.object(),
    valid_until: Joi.date().iso(),
    justification: Joi.string().max(1000),
    is_active: Joi.boolean(),
    auto_renew: Joi.boolean(),
    notification_settings: Joi.object()
  }).min(1),

  revokeMission: Joi.object({
    revocation_reason: Joi.string().required().max(1000),
    immediate: Joi.boolean().default(false),
    notify_user: Joi.boolean().default(true),
    block_reattribution: Joi.boolean().default(false),
    block_duration_days: Joi.number().integer().min(0).when('block_reattribution', {
      is: true,
      then: Joi.required()
    })
  }),

  validateMission: Joi.object({
    approved: Joi.boolean().required(),
    validation_notes: Joi.string().max(500),
    modifications: Joi.object({
      privileges_granted: Joi.object(),
      valid_until: Joi.date().iso()
    })
  })
};

// GET /api/v1/missions - Liste toutes les missions
router.get(
  '/',
  authenticate,
  authorize(['admin', 'coordinator', 'auditor']),
  rateLimiter('missions:list'),
  async (req, res, next) => {
    try {
      const {
        member_id,
        mission_type,
        scope_type,
        is_active,
        include_expired = 'false',
        page = 1,
        limit = 20
      } = req.query;

      const missions = await MissionService.listMissions({
        filters: {
          member_id,
          mission_type,
          scope_type,
          is_active: is_active === 'true' ? true : is_active === 'false' ? false : undefined,
          include_expired: include_expired === 'true'
        },
        page: parseInt(page),
        limit: parseInt(limit),
        user: req.user
      });

      res.json({
        success: true,
        data: missions.data,
        meta: {
          total: missions.total,
          page: missions.page,
          pages: missions.pages,
          limit: missions.limit,
          stats: missions.stats
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/missions/my-missions - Missions de l'utilisateur connecté
router.get(
  '/my-missions',
  authenticate,
  rateLimiter('missions:myMissions'),
  async (req, res, next) => {
    try {
      const missions = await MissionService.getUserMissions({
        member_id: req.user.member_id,
        include_history: req.query.include_history === 'true'
      });

      res.json({
        success: true,
        data: missions
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/missions/:id - Récupère une mission spécifique
router.get(
  '/:id',
  authenticate,
  authorize(['admin', 'coordinator', 'auditor']),
  rateLimiter('missions:read'),
  async (req, res, next) => {
    try {
      const mission = await MissionService.getMission({
        mission_id: req.params.id,
        include_history: req.query.include_history === 'true',
        include_user: req.query.include_user === 'true'
      });

      if (!mission) {
        return res.status(404).json({
          success: false,
          error: { code: 'SHUGO-404', message: 'Mission non trouvée' }
        });
      }

      res.json({
        success: true,
        data: mission
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/missions - Crée une nouvelle mission
router.post(
  '/',
  authenticate,
  authorize(['admin', 'coordinator']),
  validateRequest(schemas.createMission),
  rateLimiter('missions:create'),
  auditLog('mission.create'),
  async (req, res, next) => {
    try {
      const mission = await MissionService.createMission({
        ...req.body,
        created_by_member_id: req.user.member_id
      });

      res.status(201).json({
        success: true,
        data: mission,
        message: 'Mission créée avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/v1/missions/:id - Met à jour une mission
router.patch(
  '/:id',
  authenticate,
  authorize(['admin', 'coordinator']),
  validateRequest(schemas.updateMission),
  rateLimiter('missions:update'),
  auditLog('mission.update'),
  async (req, res, next) => {
    try {
      const mission = await MissionService.updateMission({
        mission_id: req.params.id,
        updates: req.body,
        updated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: mission,
        message: 'Mission mise à jour avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/missions/:id/revoke - Révoque une mission
router.post(
  '/:id/revoke',
  authenticate,
  authorize(['admin']),
  validateRequest(schemas.revokeMission),
  rateLimiter('missions:revoke'),
  auditLog('mission.revoke'),
  async (req, res, next) => {
    try {
      const result = await MissionService.revokeMission({
        mission_id: req.params.id,
        ...req.body,
        revoked_by_member_id: req.user.member_id
      });

      res.json({
        success: true,
        data: result,
        message: 'Mission révoquée avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/missions/:id/validate - Valide une mission en attente
router.post(
  '/:id/validate',
  authenticate,
  authorize(['admin', 'validator']),
  validateRequest(schemas.validateMission),
  rateLimiter('missions:validate'),
  auditLog('mission.validate'),
  async (req, res, next) => {
    try {
      const mission = await MissionService.validateMission({
        mission_id: req.params.id,
        ...req.body,
        validated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: mission,
        message: req.body.approved ? 'Mission approuvée' : 'Mission rejetée'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/missions/:id/renew - Renouvelle une mission
router.post(
  '/:id/renew',
  authenticate,
  authorize(['admin', 'coordinator']),
  rateLimiter('missions:renew'),
  auditLog('mission.renew'),
  async (req, res, next) => {
    try {
      const mission = await MissionService.renewMission({
        mission_id: req.params.id,
        extension_days: req.body.extension_days || 30,
        justification: req.body.justification,
        renewed_by: req.user.member_id
      });

      res.json({
        success: true,
        data: mission,
        message: 'Mission renouvelée avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/missions/pending-validation - Missions en attente de validation
router.get(
  '/pending-validation',
  authenticate,
  authorize(['admin', 'validator']),
  rateLimiter('missions:pending'),
  async (req, res, next) => {
    try {
      const missions = await MissionService.getPendingValidations({
        geo_id: req.query.geo_id,
        user: req.user
      });

      res.json({
        success: true,
        data: missions,
        meta: {
          total: missions.length,
          urgent: missions.filter(m => m.urgent).length
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/missions/expiring - Missions bientôt expirées
router.get(
  '/expiring',
  authenticate,
  authorize(['admin', 'coordinator']),
  rateLimiter('missions:expiring'),
  async (req, res, next) => {
    try {
      const days_ahead = parseInt(req.query.days_ahead || 30);
      
      const missions = await MissionService.getExpiringMissions({
        days_ahead,
        auto_renewable_only: req.query.auto_renewable_only === 'true'
      });

      res.json({
        success: true,
        data: missions
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/missions/audit-log - Journal d'audit des missions
router.get(
  '/audit-log',
  authenticate,
  authorize(['admin', 'auditor']),
  rateLimiter('missions:audit'),
  async (req, res, next) => {
    try {
      const {
        member_id,
        date_from,
        date_to,
        action_type,
        page = 1,
        limit = 50
      } = req.query;

      const auditLog = await MissionService.getAuditLog({
        filters: { member_id, date_from, date_to, action_type },
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: auditLog
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/missions/check-privileges - Vérifie les privilèges d'un utilisateur
router.post(
  '/check-privileges',
  authenticate,
  rateLimiter('missions:checkPrivileges'),
  async (req, res, next) => {
    try {
      const {
        member_id = req.user.member_id,
        required_role,
        required_permissions = [],
        scope_geo_id,
        scope_group_id
      } = req.body;

      const hasPrivileges = await MissionService.checkPrivileges({
        member_id,
        required_role,
        required_permissions,
        scope_geo_id,
        scope_group_id
      });

      res.json({
        success: true,
        data: { has_privileges: hasPrivileges }
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
