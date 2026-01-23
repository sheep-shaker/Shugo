// routes/protocols/guiltySpark.js
// Route: /api/v1/protocols/guilty-spark/*
// Description: Protocole 343 Guilty Spark - Création et gestion des serveurs locaux

const express = require('express');
const router = express.Router();
const { authorize } = require('../../middleware/authorize');
const { validateRequest } = require('../../middleware/validateRequest');
const { rateLimiter } = require('../../middleware/rateLimiter');
const { auditLog } = require('../../middleware/audit');
const { require2FA } = require('../../middleware/auth2FA');
const GuiltySparkService = require('../../services/protocols/GuiltySparkService');
const Joi = require('joi');

// Validation schemas
const schemas = {
  initialize: Joi.object({
    server_name: Joi.string().required().max(100),
    geo_id: Joi.string().required().pattern(/^[A-Z]{2}-\d{2}-[A-Z0-9]+$/),
    server_type: Joi.string().valid('primary', 'secondary', 'backup').default('secondary'),
    hardware_specs: Joi.object({
      cpu_cores: Joi.number().integer().min(4).required(),
      ram_gb: Joi.number().min(8).required(),
      storage_gb: Joi.number().min(100).required(),
      network_speed_mbps: Joi.number().min(100).required()
    }).required(),
    network_config: Joi.object({
      ip_address: Joi.string().ip(),
      subnet_mask: Joi.string().ip(),
      gateway: Joi.string().ip(),
      dns_servers: Joi.array().items(Joi.string().ip()),
      port: Joi.number().integer().min(1).max(65535).default(8443)
    }).required(),
    security_config: Joi.object({
      firewall_enabled: Joi.boolean().default(true),
      encryption_level: Joi.string().valid('standard', 'high', 'maximum').default('high'),
      allowed_ips: Joi.array().items(Joi.string().ip()),
      ssl_certificate: Joi.string()
    })
  }),

  configure: Joi.object({
    server_id: Joi.string().uuid().required(),
    configuration: Joi.object({
      max_users: Joi.number().integer().min(1),
      features_enabled: Joi.array().items(Joi.string()),
      sync_frequency: Joi.string().valid('realtime', '5min', '15min', '30min', 'hourly'),
      backup_settings: Joi.object({
        enabled: Joi.boolean(),
        frequency: Joi.string(),
        retention_days: Joi.number().integer()
      }),
      monitoring_settings: Joi.object({
        metrics_enabled: Joi.boolean(),
        alerts_enabled: Joi.boolean(),
        alert_thresholds: Joi.object()
      })
    }).required()
  }),

  deploy: Joi.object({
    server_id: Joi.string().uuid().required(),
    deployment_type: Joi.string().valid('new', 'update', 'rollback').required(),
    version: Joi.string().pattern(/^\d+\.\d+\.\d+$/),
    components: Joi.array().items(
      Joi.string().valid('core', 'api', 'database', 'vault', 'ui', 'all')
    ).default(['all']),
    pre_checks: Joi.boolean().default(true),
    auto_rollback: Joi.boolean().default(true),
    maintenance_mode: Joi.boolean().default(true)
  })
};

// POST /api/v1/protocols/guilty-spark/initialize - Initialise un nouveau serveur local
router.post(
  '/initialize',
  authorize(['admin']),
  require2FA,
  validateRequest(schemas.initialize),
  rateLimiter('guiltySpark:initialize'),
  auditLog('guiltySpark.initialize'),
  async (req, res, next) => {
    try {
      const server = await GuiltySparkService.initializeServer({
        ...req.body,
        initialized_by: req.user.member_id
      });

      res.status(201).json({
        success: true,
        data: server,
        message: 'Serveur local initialisé. Configuration en cours...'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/protocols/guilty-spark/configure - Configure un serveur local
router.post(
  '/configure',
  authorize(['admin']),
  validateRequest(schemas.configure),
  rateLimiter('guiltySpark:configure'),
  auditLog('guiltySpark.configure'),
  async (req, res, next) => {
    try {
      const config = await GuiltySparkService.configureServer({
        ...req.body,
        configured_by: req.user.member_id
      });

      res.json({
        success: true,
        data: config,
        message: 'Configuration appliquée avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/protocols/guilty-spark/deploy - Déploie le serveur local
router.post(
  '/deploy',
  authorize(['admin']),
  require2FA,
  validateRequest(schemas.deploy),
  rateLimiter('guiltySpark:deploy'),
  auditLog('guiltySpark.deploy'),
  async (req, res, next) => {
    try {
      const deployment = await GuiltySparkService.deployServer({
        ...req.body,
        deployed_by: req.user.member_id
      });

      res.status(202).json({
        success: true,
        data: deployment,
        message: 'Déploiement initié. Surveillez le statut pour la progression.'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/protocols/guilty-spark/servers - Liste les serveurs gérés par 343
router.get(
  '/servers',
  authorize(['admin', 'operator']),
  rateLimiter('guiltySpark:list'),
  async (req, res, next) => {
    try {
      const {
        status,
        geo_id,
        page = 1,
        limit = 20
      } = req.query;

      const servers = await GuiltySparkService.listServers({
        filters: { status, geo_id },
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: servers
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/protocols/guilty-spark/servers/:id - Détails d'un serveur
router.get(
  '/servers/:id',
  authorize(['admin', 'operator']),
  rateLimiter('guiltySpark:get'),
  async (req, res, next) => {
    try {
      const server = await GuiltySparkService.getServer({
        server_id: req.params.id,
        include_metrics: req.query.include_metrics === 'true',
        include_logs: req.query.include_logs === 'true'
      });

      if (!server) {
        return res.status(404).json({
          success: false,
          error: { code: 'SHUGO-404', message: 'Serveur non trouvé' }
        });
      }

      res.json({
        success: true,
        data: server
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/protocols/guilty-spark/servers/:id/health-check - Contrôle de santé
router.post(
  '/servers/:id/health-check',
  authorize(['admin', 'operator']),
  rateLimiter('guiltySpark:healthCheck'),
  async (req, res, next) => {
    try {
      const health = await GuiltySparkService.performHealthCheck({
        server_id: req.params.id,
        checks: req.body.checks || ['all']
      });

      res.json({
        success: true,
        data: health,
        message: `Santé: ${health.overall_status}`
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/protocols/guilty-spark/servers/:id/sync - Force la synchronisation
router.post(
  '/servers/:id/sync',
  authorize(['admin']),
  rateLimiter('guiltySpark:sync'),
  auditLog('guiltySpark.sync'),
  async (req, res, next) => {
    try {
      const sync = await GuiltySparkService.forceSynchronization({
        server_id: req.params.id,
        sync_type: req.body.sync_type || 'incremental',
        components: req.body.components || ['all']
      });

      res.json({
        success: true,
        data: sync,
        message: 'Synchronisation lancée'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/protocols/guilty-spark/servers/:id/maintenance - Mode maintenance
router.post(
  '/servers/:id/maintenance',
  authorize(['admin']),
  rateLimiter('guiltySpark:maintenance'),
  auditLog('guiltySpark.maintenance'),
  async (req, res, next) => {
    try {
      const { enable, duration_minutes, reason } = req.body;

      const result = await GuiltySparkService.toggleMaintenanceMode({
        server_id: req.params.id,
        enable,
        duration_minutes,
        reason,
        toggled_by: req.user.member_id
      });

      res.json({
        success: true,
        data: result,
        message: enable ? 'Mode maintenance activé' : 'Mode maintenance désactivé'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/protocols/guilty-spark/servers/:id/decommission - Décommissionne un serveur
router.post(
  '/servers/:id/decommission',
  authorize(['admin']),
  require2FA,
  rateLimiter('guiltySpark:decommission'),
  auditLog('guiltySpark.decommission'),
  async (req, res, next) => {
    try {
      const {
        migrate_data = true,
        target_server_id,
        wipe_data = false,
        confirmation_code
      } = req.body;

      if (!confirmation_code) {
        return res.status(400).json({
          success: false,
          error: { code: 'SHUGO-400', message: 'Code de confirmation requis' }
        });
      }

      const result = await GuiltySparkService.decommissionServer({
        server_id: req.params.id,
        migrate_data,
        target_server_id,
        wipe_data,
        confirmation_code,
        decommissioned_by: req.user.member_id
      });

      res.json({
        success: true,
        data: result,
        message: 'Serveur décommissionné avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/protocols/guilty-spark/deployment-status/:id - Statut d'un déploiement
router.get(
  '/deployment-status/:id',
  authorize(['admin', 'operator']),
  rateLimiter('guiltySpark:deploymentStatus'),
  async (req, res, next) => {
    try {
      const status = await GuiltySparkService.getDeploymentStatus({
        deployment_id: req.params.id
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

// POST /api/v1/protocols/guilty-spark/rollback - Rollback d'un déploiement
router.post(
  '/rollback',
  authorize(['admin']),
  require2FA,
  rateLimiter('guiltySpark:rollback'),
  auditLog('guiltySpark.rollback'),
  async (req, res, next) => {
    try {
      const {
        server_id,
        target_version,
        reason
      } = req.body;

      const rollback = await GuiltySparkService.rollbackDeployment({
        server_id,
        target_version,
        reason,
        initiated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: rollback,
        message: 'Rollback initié'
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
