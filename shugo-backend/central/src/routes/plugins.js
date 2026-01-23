// routes/plugins.js
// Route: /api/v1/plugins/*
// Description: Gestion des plugins et extensions

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validateRequest } = require('../middleware/validateRequest');
const { rateLimiter } = require('../middleware/rateLimiter');
const { auditLog } = require('../middleware/audit');
const { require2FA } = require('../middleware/auth2FA');
const PluginService = require('../services/PluginService');
const Joi = require('joi');
const multer = require('multer');
const upload = multer({ 
  dest: '/tmp/plugin-uploads/',
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

// Validation schemas
const schemas = {
  installPlugin: Joi.object({
    plugin_name: Joi.string().required().max(100),
    version: Joi.string().pattern(/^\d+\.\d+\.\d+$/).required(),
    source: Joi.string().valid('official', 'community', 'custom').default('community'),
    repository_url: Joi.string().uri().when('source', {
      is: 'community',
      then: Joi.required()
    }),
    auto_enable: Joi.boolean().default(false),
    configuration: Joi.object()
  }),

  configurePlugin: Joi.object({
    enabled: Joi.boolean(),
    configuration: Joi.object().required(),
    geo_scope: Joi.string().pattern(/^[A-Z]{2}-\d{2}-[A-Z0-9]+$/),
    allowed_roles: Joi.array().items(Joi.string()),
    rate_limits: Joi.object({
      requests_per_minute: Joi.number().integer().min(1),
      requests_per_hour: Joi.number().integer().min(1)
    })
  }),

  updatePlugin: Joi.object({
    target_version: Joi.string().pattern(/^\d+\.\d+\.\d+$/),
    backup_first: Joi.boolean().default(true),
    force: Joi.boolean().default(false)
  })
};

// GET /api/v1/plugins - Liste des plugins
router.get(
  '/',
  authenticate,
  authorize(['admin', 'operator']),
  rateLimiter('plugins:list'),
  async (req, res, next) => {
    try {
      const {
        status,
        category,
        source,
        include_available = 'false',
        page = 1,
        limit = 20
      } = req.query;

      const plugins = await PluginService.listPlugins({
        filters: { status, category, source },
        include_available: include_available === 'true',
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: plugins.data,
        meta: {
          total: plugins.total,
          installed: plugins.installed_count,
          enabled: plugins.enabled_count,
          page: plugins.page,
          pages: plugins.pages,
          limit: plugins.limit
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/plugins/:id - Détails d'un plugin
router.get(
  '/:id',
  authenticate,
  authorize(['admin', 'operator']),
  rateLimiter('plugins:read'),
  async (req, res, next) => {
    try {
      const plugin = await PluginService.getPlugin({
        plugin_id: req.params.id,
        include_config: true,
        include_metrics: req.query.include_metrics === 'true'
      });

      if (!plugin) {
        return res.status(404).json({
          success: false,
          error: { code: 'SHUGO-404', message: 'Plugin non trouvé' }
        });
      }

      res.json({
        success: true,
        data: plugin
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/plugins/install - Installe un plugin
router.post(
  '/install',
  authenticate,
  authorize(['admin']),
  require2FA,
  validateRequest(schemas.installPlugin),
  rateLimiter('plugins:install'),
  auditLog('plugin.install'),
  async (req, res, next) => {
    try {
      const plugin = await PluginService.installPlugin({
        ...req.body,
        installed_by: req.user.member_id
      });

      res.status(201).json({
        success: true,
        data: plugin,
        message: 'Plugin installé avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/plugins/upload - Upload et installe un plugin custom
router.post(
  '/upload',
  authenticate,
  authorize(['admin']),
  require2FA,
  upload.single('plugin'),
  rateLimiter('plugins:upload'),
  auditLog('plugin.upload'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: { code: 'SHUGO-400', message: 'Fichier plugin requis' }
        });
      }

      const plugin = await PluginService.uploadAndInstall({
        file_path: req.file.path,
        filename: req.file.originalname,
        ...req.body,
        uploaded_by: req.user.member_id
      });

      res.status(201).json({
        success: true,
        data: plugin,
        message: 'Plugin uploadé et installé avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/v1/plugins/:id/configure - Configure un plugin
router.patch(
  '/:id/configure',
  authenticate,
  authorize(['admin']),
  validateRequest(schemas.configurePlugin),
  rateLimiter('plugins:configure'),
  auditLog('plugin.configure'),
  async (req, res, next) => {
    try {
      const plugin = await PluginService.configurePlugin({
        plugin_id: req.params.id,
        configuration: req.body,
        configured_by: req.user.member_id
      });

      res.json({
        success: true,
        data: plugin,
        message: 'Plugin configuré avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/plugins/:id/enable - Active un plugin
router.post(
  '/:id/enable',
  authenticate,
  authorize(['admin']),
  rateLimiter('plugins:enable'),
  auditLog('plugin.enable'),
  async (req, res, next) => {
    try {
      const plugin = await PluginService.enablePlugin({
        plugin_id: req.params.id,
        enabled_by: req.user.member_id
      });

      res.json({
        success: true,
        data: plugin,
        message: 'Plugin activé'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/plugins/:id/disable - Désactive un plugin
router.post(
  '/:id/disable',
  authenticate,
  authorize(['admin']),
  rateLimiter('plugins:disable'),
  auditLog('plugin.disable'),
  async (req, res, next) => {
    try {
      const plugin = await PluginService.disablePlugin({
        plugin_id: req.params.id,
        reason: req.body.reason,
        disabled_by: req.user.member_id
      });

      res.json({
        success: true,
        data: plugin,
        message: 'Plugin désactivé'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/plugins/:id/update - Met à jour un plugin
router.post(
  '/:id/update',
  authenticate,
  authorize(['admin']),
  require2FA,
  validateRequest(schemas.updatePlugin),
  rateLimiter('plugins:update'),
  auditLog('plugin.update'),
  async (req, res, next) => {
    try {
      const plugin = await PluginService.updatePlugin({
        plugin_id: req.params.id,
        ...req.body,
        updated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: plugin,
        message: 'Plugin mis à jour avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/plugins/:id - Désinstalle un plugin
router.delete(
  '/:id',
  authenticate,
  authorize(['admin']),
  require2FA,
  rateLimiter('plugins:uninstall'),
  auditLog('plugin.uninstall'),
  async (req, res, next) => {
    try {
      await PluginService.uninstallPlugin({
        plugin_id: req.params.id,
        keep_data: req.query.keep_data === 'true',
        uninstalled_by: req.user.member_id
      });

      res.json({
        success: true,
        message: 'Plugin désinstallé'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/plugins/:id/logs - Logs du plugin
router.get(
  '/:id/logs',
  authenticate,
  authorize(['admin', 'operator']),
  rateLimiter('plugins:logs'),
  async (req, res, next) => {
    try {
      const {
        level,
        date_from,
        date_to,
        limit = 100
      } = req.query;

      const logs = await PluginService.getPluginLogs({
        plugin_id: req.params.id,
        filters: { level, date_from, date_to },
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

// GET /api/v1/plugins/:id/metrics - Métriques du plugin
router.get(
  '/:id/metrics',
  authenticate,
  authorize(['admin', 'operator']),
  rateLimiter('plugins:metrics'),
  async (req, res, next) => {
    try {
      const metrics = await PluginService.getPluginMetrics({
        plugin_id: req.params.id,
        period: req.query.period || 'day',
        date_from: req.query.date_from,
        date_to: req.query.date_to
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

// POST /api/v1/plugins/:id/execute - Exécute une action du plugin
router.post(
  '/:id/execute',
  authenticate,
  rateLimiter('plugins:execute'),
  auditLog('plugin.execute'),
  async (req, res, next) => {
    try {
      const { action, parameters } = req.body;

      const result = await PluginService.executePluginAction({
        plugin_id: req.params.id,
        action,
        parameters,
        executed_by: req.user.member_id,
        context: {
          user: req.user,
          ip: req.ip
        }
      });

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/plugins/marketplace - Marketplace de plugins
router.get(
  '/marketplace',
  authenticate,
  authorize(['admin']),
  rateLimiter('plugins:marketplace'),
  async (req, res, next) => {
    try {
      const {
        category,
        search,
        sort_by = 'popularity',
        page = 1,
        limit = 20
      } = req.query;

      const marketplace = await PluginService.getMarketplace({
        filters: { category, search },
        sort_by,
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: marketplace
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/plugins/check-updates - Vérifie les mises à jour
router.post(
  '/check-updates',
  authenticate,
  authorize(['admin']),
  rateLimiter('plugins:checkUpdates'),
  async (req, res, next) => {
    try {
      const updates = await PluginService.checkUpdates({
        plugin_ids: req.body.plugin_ids
      });

      res.json({
        success: true,
        data: updates,
        message: `${updates.available_updates} mise(s) à jour disponible(s)`
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
