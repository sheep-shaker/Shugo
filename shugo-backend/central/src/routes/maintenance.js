// routes/maintenance.js
// Route: /api/v1/maintenance/*
// Description: Gestion de la maintenance nocturne et opérations système

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validateRequest } = require('../middleware/validateRequest');
const { rateLimiter } = require('../middleware/rateLimiter');
const { auditLog } = require('../middleware/audit');
const { require2FA } = require('../middleware/auth2FA');
const MaintenanceService = require('../services/MaintenanceService');
const Joi = require('joi');

// Validation schemas
const schemas = {
  scheduleMaintenance: Joi.object({
    maintenance_type: Joi.string().valid('routine', 'emergency', 'update', 'optimization').required(),
    scheduled_time: Joi.date().iso().required(),
    estimated_duration_minutes: Joi.number().integer().min(1).max(480).required(),
    operations: Joi.array().items(
      Joi.string().valid(
        'database_cleanup',
        'log_rotation',
        'cache_clear',
        'index_rebuild',
        'key_rotation',
        'session_cleanup',
        'backup_verify',
        'health_check',
        'metrics_aggregation',
        'orphan_cleanup',
        'temp_cleanup',
        'update_statistics'
      )
    ).min(1).required(),
    affected_services: Joi.array().items(Joi.string()),
    notification_settings: Joi.object({
      notify_users: Joi.boolean().default(true),
      advance_notice_hours: Joi.number().integer().min(0).max(72).default(24),
      channels: Joi.array().items(Joi.string().valid('email', 'sms', 'in_app'))
    }),
    rollback_enabled: Joi.boolean().default(true),
    dry_run: Joi.boolean().default(false),
    reason: Joi.string().required().max(500)
  }),

  updateMaintenance: Joi.object({
    scheduled_time: Joi.date().iso(),
    estimated_duration_minutes: Joi.number().integer().min(1).max(480),
    operations: Joi.array().items(Joi.string()),
    notification_settings: Joi.object(),
    reason: Joi.string().max(500)
  }).min(1),

  runNow: Joi.object({
    operations: Joi.array().items(Joi.string()).required().min(1),
    force: Joi.boolean().default(false),
    skip_checks: Joi.boolean().default(false),
    timeout_minutes: Joi.number().integer().min(1).max(60).default(30)
  })
};

// GET /api/v1/maintenance/runs - Historique des maintenances
router.get(
  '/runs',
  authenticate,
  authorize(['admin', 'operator']),
  rateLimiter('maintenance:list'),
  async (req, res, next) => {
    try {
      const {
        status,
        maintenance_type,
        date_from,
        date_to,
        page = 1,
        limit = 20
      } = req.query;

      const runs = await MaintenanceService.listMaintenanceRuns({
        filters: { status, maintenance_type, date_from, date_to },
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: runs.data,
        meta: {
          total: runs.total,
          page: runs.page,
          pages: runs.pages,
          limit: runs.limit,
          stats: runs.stats
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/maintenance/runs/:id - Détails d'une maintenance
router.get(
  '/runs/:id',
  authenticate,
  authorize(['admin', 'operator']),
  rateLimiter('maintenance:read'),
  async (req, res, next) => {
    try {
      const run = await MaintenanceService.getMaintenanceRun({
        run_id: req.params.id,
        include_logs: req.query.include_logs === 'true',
        include_operations: true
      });

      if (!run) {
        return res.status(404).json({
          success: false,
          error: { code: 'SHUGO-404', message: 'Maintenance non trouvée' }
        });
      }

      res.json({
        success: true,
        data: run
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/maintenance/status - État actuel de la maintenance
router.get(
  '/status',
  authenticate,
  rateLimiter('maintenance:status'),
  async (req, res, next) => {
    try {
      const status = await MaintenanceService.getCurrentStatus();

      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/maintenance/schedule - Programme une maintenance
router.post(
  '/schedule',
  authenticate,
  authorize(['admin']),
  validateRequest(schemas.scheduleMaintenance),
  rateLimiter('maintenance:schedule'),
  auditLog('maintenance.schedule'),
  async (req, res, next) => {
    try {
      const maintenance = await MaintenanceService.scheduleMaintenance({
        ...req.body,
        scheduled_by: req.user.member_id
      });

      res.json({
        success: true,
        data: maintenance,
        message: 'Maintenance programmée avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/v1/maintenance/:id - Met à jour une maintenance programmée
router.patch(
  '/:id',
  authenticate,
  authorize(['admin']),
  validateRequest(schemas.updateMaintenance),
  rateLimiter('maintenance:update'),
  auditLog('maintenance.update'),
  async (req, res, next) => {
    try {
      const maintenance = await MaintenanceService.updateMaintenance({
        maintenance_id: req.params.id,
        updates: req.body,
        updated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: maintenance,
        message: 'Maintenance mise à jour'
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/maintenance/:id - Annule une maintenance programmée
router.delete(
  '/:id',
  authenticate,
  authorize(['admin']),
  rateLimiter('maintenance:cancel'),
  auditLog('maintenance.cancel'),
  async (req, res, next) => {
    try {
      await MaintenanceService.cancelMaintenance({
        maintenance_id: req.params.id,
        cancelled_by: req.user.member_id,
        reason: req.body.reason
      });

      res.json({
        success: true,
        message: 'Maintenance annulée'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/maintenance/run-now - Lance une maintenance immédiatement
router.post(
  '/run-now',
  authenticate,
  authorize(['admin']),
  require2FA,
  validateRequest(schemas.runNow),
  rateLimiter('maintenance:runNow'),
  auditLog('maintenance.runNow'),
  async (req, res, next) => {
    try {
      const run = await MaintenanceService.runNow({
        ...req.body,
        initiated_by: req.user.member_id
      });

      res.status(202).json({
        success: true,
        data: run,
        message: 'Maintenance lancée. Consultez l\'état pour suivre la progression.'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/maintenance/nightly - Déclenche la maintenance nocturne (CRON/système)
router.post(
  '/nightly',
  authenticate,
  authorize(['system', 'admin']),
  rateLimiter('maintenance:nightly'),
  auditLog('maintenance.nightly'),
  async (req, res, next) => {
    try {
      const result = await MaintenanceService.runNightlyMaintenance({
        triggered_by: req.user.member_id || 'system',
        force: req.body.force === true
      });

      res.json({
        success: true,
        data: result,
        message: `Maintenance nocturne terminée. ${result.operations_completed}/${result.operations_total} opérations réussies.`
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/maintenance/operations - Liste les opérations disponibles
router.get(
  '/operations',
  authenticate,
  authorize(['admin', 'operator']),
  rateLimiter('maintenance:operations'),
  async (req, res, next) => {
    try {
      const operations = await MaintenanceService.getAvailableOperations();

      res.json({
        success: true,
        data: operations
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/maintenance/health - Rapport de santé système
router.get(
  '/health',
  authenticate,
  authorize(['admin', 'operator']),
  rateLimiter('maintenance:health'),
  async (req, res, next) => {
    try {
      const health = await MaintenanceService.getSystemHealth({
        detailed: req.query.detailed === 'true',
        include_history: req.query.include_history === 'true'
      });

      res.json({
        success: true,
        data: health
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/maintenance/metrics - Métriques système
router.get(
  '/metrics',
  authenticate,
  authorize(['admin', 'operator', 'monitor']),
  rateLimiter('maintenance:metrics'),
  async (req, res, next) => {
    try {
      const {
        metric_types = 'all',
        period = 'hour',
        date_from,
        date_to
      } = req.query;

      const metrics = await MaintenanceService.getSystemMetrics({
        metric_types: metric_types === 'all' ? null : metric_types.split(','),
        period,
        date_from,
        date_to
      });

      res.json({
        success: true,
        data: metrics
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/maintenance/optimize - Lance une optimisation
router.post(
  '/optimize',
  authenticate,
  authorize(['admin']),
  require2FA,
  rateLimiter('maintenance:optimize'),
  auditLog('maintenance.optimize'),
  async (req, res, next) => {
    try {
      const { 
        components = ['database', 'cache', 'indexes'],
        aggressive = false 
      } = req.body;

      const result = await MaintenanceService.optimizeSystem({
        components,
        aggressive,
        initiated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: result,
        message: 'Optimisation terminée avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/maintenance/schedule - Maintenances programmées
router.get(
  '/schedule',
  authenticate,
  rateLimiter('maintenance:getSchedule'),
  async (req, res, next) => {
    try {
      const schedule = await MaintenanceService.getMaintenanceSchedule({
        include_past: req.query.include_past === 'true',
        days_ahead: parseInt(req.query.days_ahead || 30)
      });

      res.json({
        success: true,
        data: schedule
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/maintenance/test - Test de maintenance (dry run)
router.post(
  '/test',
  authenticate,
  authorize(['admin']),
  rateLimiter('maintenance:test'),
  auditLog('maintenance.test'),
  async (req, res, next) => {
    try {
      const result = await MaintenanceService.testMaintenance({
        operations: req.body.operations || ['health_check'],
        verbose: req.body.verbose === true
      });

      res.json({
        success: true,
        data: result,
        message: 'Test de maintenance terminé'
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
