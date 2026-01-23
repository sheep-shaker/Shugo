// routes/admin.js
// Route: /api/v1/admin/*
// Description: Routes d'administration, statistiques et exports

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validateRequest } = require('../middleware/validateRequest');
const { rateLimiter } = require('../middleware/rateLimiter');
const { auditLog } = require('../middleware/audit');
const { require2FA } = require('../middleware/auth2FA');
const AdminService = require('../services/AdminService');
const Joi = require('joi');

// Validation schemas
const schemas = {
  exportData: Joi.object({
    export_type: Joi.string().valid(
      'users', 'guards', 'missions', 'audit_logs', 'statistics', 'full_backup'
    ).required(),
    format: Joi.string().valid('csv', 'json', 'xlsx', 'pdf').default('csv'),
    filters: Joi.object({
      date_from: Joi.date().iso(),
      date_to: Joi.date().iso(),
      geo_id: Joi.string().pattern(/^[A-Z]{2}-\d{2}-[A-Z0-9]+$/),
      status: Joi.string(),
      include_inactive: Joi.boolean().default(false)
    }),
    columns: Joi.array().items(Joi.string()),
    encryption: Joi.object({
      enabled: Joi.boolean().default(true),
      password: Joi.string().min(12).when('enabled', {
        is: true,
        then: Joi.required()
      })
    }),
    delivery: Joi.string().valid('download', 'email', 's3').default('download'),
    recipient_email: Joi.string().email().when('delivery', {
      is: 'email',
      then: Joi.required()
    })
  }),

  generateReport: Joi.object({
    report_type: Joi.string().valid(
      'activity', 'security', 'performance', 'compliance', 'financial', 'custom'
    ).required(),
    period: Joi.string().valid('daily', 'weekly', 'monthly', 'quarterly', 'yearly').required(),
    date_from: Joi.date().iso(),
    date_to: Joi.date().iso(),
    geo_scope: Joi.string().pattern(/^[A-Z]{2}-\d{2}-[A-Z0-9]+$/),
    include_charts: Joi.boolean().default(true),
    include_recommendations: Joi.boolean().default(true),
    format: Joi.string().valid('pdf', 'html', 'docx').default('pdf'),
    language: Joi.string().valid('fr', 'en', 'es', 'de').default('fr')
  }),

  systemConfig: Joi.object({
    category: Joi.string().valid(
      'security', 'performance', 'features', 'limits', 'notifications'
    ).required(),
    settings: Joi.object().required(),
    apply_to: Joi.string().valid('global', 'regional', 'local').default('global'),
    geo_id: Joi.string().pattern(/^[A-Z]{2}-\d{2}-[A-Z0-9]+$/).when('apply_to', {
      not: 'global',
      then: Joi.required()
    }),
    effective_date: Joi.date().iso()
  })
};

// GET /api/v1/admin/dashboard - Tableau de bord administrateur
router.get(
  '/dashboard',
  authenticate,
  authorize(['admin']),
  rateLimiter('admin:dashboard'),
  async (req, res, next) => {
    try {
      const { period = 'week', geo_id } = req.query;

      const dashboard = await AdminService.getDashboard({
        period,
        geo_id,
        user: req.user
      });

      res.json({
        success: true,
        data: dashboard
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/admin/statistics - Statistiques détaillées
router.get(
  '/statistics',
  authenticate,
  authorize(['admin', 'analyst']),
  rateLimiter('admin:statistics'),
  async (req, res, next) => {
    try {
      const {
        category = 'all',
        period = 'month',
        date_from,
        date_to,
        geo_id,
        group_by = 'day'
      } = req.query;

      const stats = await AdminService.getStatistics({
        category: category === 'all' ? null : category.split(','),
        period,
        date_from,
        date_to,
        geo_id,
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

// POST /api/v1/admin/export - Export de données
router.post(
  '/export',
  authenticate,
  authorize(['admin']),
  require2FA,
  validateRequest(schemas.exportData),
  rateLimiter('admin:export'),
  auditLog('admin.export'),
  async (req, res, next) => {
    try {
      const exportJob = await AdminService.exportData({
        ...req.body,
        requested_by: req.user.member_id
      });

      if (req.body.delivery === 'download') {
        res.download(exportJob.file_path, exportJob.filename, (err) => {
          if (err) next(err);
          // Nettoyer le fichier après téléchargement
          AdminService.cleanupExport(exportJob.id);
        });
      } else {
        res.status(202).json({
          success: true,
          data: exportJob,
          message: 'Export en cours. Vous serez notifié à la fin.'
        });
      }
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/admin/reports/generate - Génération de rapports
router.post(
  '/reports/generate',
  authenticate,
  authorize(['admin', 'analyst']),
  validateRequest(schemas.generateReport),
  rateLimiter('admin:generateReport'),
  auditLog('admin.generateReport'),
  async (req, res, next) => {
    try {
      const report = await AdminService.generateReport({
        ...req.body,
        generated_by: req.user.member_id
      });

      res.status(202).json({
        success: true,
        data: report,
        message: 'Génération du rapport en cours'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/admin/reports - Liste des rapports
router.get(
  '/reports',
  authenticate,
  authorize(['admin', 'analyst']),
  rateLimiter('admin:listReports'),
  async (req, res, next) => {
    try {
      const { type, status, page = 1, limit = 20 } = req.query;

      const reports = await AdminService.listReports({
        filters: { type, status },
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: reports
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/admin/reports/:id - Télécharge un rapport
router.get(
  '/reports/:id',
  authenticate,
  authorize(['admin', 'analyst']),
  rateLimiter('admin:downloadReport'),
  async (req, res, next) => {
    try {
      const report = await AdminService.getReport({
        report_id: req.params.id,
        user: req.user
      });

      if (!report) {
        return res.status(404).json({
          success: false,
          error: { code: 'SHUGO-404', message: 'Rapport non trouvé' }
        });
      }

      res.download(report.file_path, report.filename);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/admin/audit-logs - Logs d'audit complets
router.get(
  '/audit-logs',
  authenticate,
  authorize(['admin', 'auditor']),
  require2FA,
  rateLimiter('admin:auditLogs'),
  async (req, res, next) => {
    try {
      const {
        action_type,
        member_id,
        entity_type,
        date_from,
        date_to,
        severity,
        page = 1,
        limit = 50
      } = req.query;

      const logs = await AdminService.getAuditLogs({
        filters: {
          action_type,
          member_id: member_id ? parseInt(member_id) : undefined,
          entity_type,
          date_from,
          date_to,
          severity
        },
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: logs
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/admin/system-config - Configuration système
router.get(
  '/system-config',
  authenticate,
  authorize(['admin']),
  require2FA,
  rateLimiter('admin:getConfig'),
  async (req, res, next) => {
    try {
      const { category, geo_id } = req.query;

      const config = await AdminService.getSystemConfig({
        category,
        geo_id
      });

      res.json({
        success: true,
        data: config
      });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/v1/admin/system-config - Modifie la configuration
router.patch(
  '/system-config',
  authenticate,
  authorize(['admin']),
  require2FA,
  validateRequest(schemas.systemConfig),
  rateLimiter('admin:updateConfig'),
  auditLog('admin.updateConfig'),
  async (req, res, next) => {
    try {
      const config = await AdminService.updateSystemConfig({
        ...req.body,
        updated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: config,
        message: 'Configuration mise à jour'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/admin/users/activity - Activité des utilisateurs
router.get(
  '/users/activity',
  authenticate,
  authorize(['admin', 'coordinator']),
  rateLimiter('admin:userActivity'),
  async (req, res, next) => {
    try {
      const {
        member_id,
        geo_id,
        date_from,
        date_to,
        activity_type,
        page = 1,
        limit = 50
      } = req.query;

      const activity = await AdminService.getUserActivity({
        filters: {
          member_id: member_id ? parseInt(member_id) : undefined,
          geo_id,
          date_from,
          date_to,
          activity_type
        },
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: activity
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/admin/errors - Erreurs système
router.get(
  '/errors',
  authenticate,
  authorize(['admin', 'operator']),
  rateLimiter('admin:errors'),
  async (req, res, next) => {
    try {
      const {
        error_code,
        severity,
        component,
        date_from,
        date_to,
        resolved,
        page = 1,
        limit = 50
      } = req.query;

      const errors = await AdminService.getSystemErrors({
        filters: {
          error_code,
          severity,
          component,
          date_from,
          date_to,
          resolved: resolved === 'true' ? true : resolved === 'false' ? false : undefined
        },
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: errors
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/admin/broadcast - Message de diffusion admin
router.post(
  '/broadcast',
  authenticate,
  authorize(['admin']),
  require2FA,
  rateLimiter('admin:broadcast'),
  auditLog('admin.broadcast'),
  async (req, res, next) => {
    try {
      const {
        message_type,
        subject,
        content,
        target_geo_id,
        priority = 'normal',
        channels = ['in_app']
      } = req.body;

      const broadcast = await AdminService.broadcastMessage({
        message_type,
        subject,
        content,
        target_geo_id,
        priority,
        channels,
        sent_by: req.user.member_id
      });

      res.json({
        success: true,
        data: broadcast,
        message: `Message diffusé à ${broadcast.recipients_count} destinataire(s)`
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/admin/impersonate - Impersonnalisation (debug)
router.post(
  '/impersonate',
  authenticate,
  authorize(['admin']),
  require2FA,
  rateLimiter('admin:impersonate'),
  auditLog('admin.impersonate'),
  async (req, res, next) => {
    try {
      const { target_member_id, duration_minutes = 30, reason } = req.body;

      if (!reason || reason.length < 10) {
        return res.status(400).json({
          success: false,
          error: { code: 'SHUGO-400', message: 'Raison détaillée requise' }
        });
      }

      const session = await AdminService.createImpersonationSession({
        target_member_id: parseInt(target_member_id),
        duration_minutes,
        reason,
        initiated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: session,
        message: 'Session d\'impersonnalisation créée'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/admin/compliance - Rapport de conformité
router.get(
  '/compliance',
  authenticate,
  authorize(['admin', 'compliance']),
  rateLimiter('admin:compliance'),
  async (req, res, next) => {
    try {
      const compliance = await AdminService.getComplianceReport({
        geo_id: req.query.geo_id,
        include_details: req.query.detailed === 'true'
      });

      res.json({
        success: true,
        data: compliance
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
