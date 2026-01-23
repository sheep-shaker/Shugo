// routes/localServers.js
// Route: /api/v1/local-servers/*
// Description: Gestion des serveurs locaux, heartbeat, synchronisation

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validateRequest } = require('../middleware/validateRequest');
const { rateLimiter } = require('../middleware/rateLimiter');
const { auditLog } = require('../middleware/audit');
const LocalServerService = require('../services/LocalServerService');
const Joi = require('joi');

// Validation schemas
const schemas = {
  registerServer: Joi.object({
    server_name: Joi.string().required().max(100),
    server_type: Joi.string().valid('primary', 'secondary', 'backup', 'test').default('secondary'),
    geo_id: Joi.string().required().pattern(/^[A-Z]{2}-\d{2}-[A-Z0-9]+$/),
    connection_info: Joi.object({
      host: Joi.string().required(),
      port: Joi.number().integer().min(1).max(65535).required(),
      protocol: Joi.string().valid('https', 'wss').default('https'),
      public_key: Joi.string().required()
    }).required(),
    capabilities: Joi.object({
      max_users: Joi.number().integer().min(1),
      storage_gb: Joi.number().min(0),
      features: Joi.array().items(Joi.string())
    }),
    metadata: Joi.object({
      organization: Joi.string(),
      contact_email: Joi.string().email(),
      location: Joi.string(),
      timezone: Joi.string()
    })
  }),

  // Schema simplifié pour l'enregistrement via protocole Guilty Spark
  registerViaToken: Joi.object({
    body: Joi.object({
      server_id: Joi.string().required().max(100),
      server_name: Joi.string().required().max(100),
      geo_id: Joi.string().required().pattern(/^\d{2}-\d{3}-\d{2}-\d{2}-\d{2}$/),
      server_type: Joi.string().valid('local', 'primary', 'secondary', 'backup', 'test').default('local'),
      registration_token: Joi.string().required(),
      shared_secret: Joi.string().required().min(32),
      version: Joi.string().default('7.0.0'),
      platform: Joi.string().default('unknown'),
      capabilities: Joi.object({
        offline_mode: Joi.boolean().default(true),
        sync: Joi.boolean().default(true),
        vault: Joi.boolean().default(true),
        plugins: Joi.boolean().default(true),
      }).default({}),
    }).required(),
  }),

  updateServer: Joi.object({
    server_name: Joi.string().max(100),
    server_type: Joi.string().valid('primary', 'secondary', 'backup', 'test'),
    connection_info: Joi.object(),
    capabilities: Joi.object(),
    metadata: Joi.object(),
    is_active: Joi.boolean()
  }).min(1),

  heartbeat: Joi.object({
    server_id: Joi.string().uuid().required(),
    metrics: Joi.object({
      cpu_usage: Joi.number().min(0).max(100),
      memory_usage: Joi.number().min(0).max(100),
      disk_usage: Joi.number().min(0).max(100),
      active_connections: Joi.number().integer().min(0),
      request_rate: Joi.number().min(0),
      error_rate: Joi.number().min(0)
    }).required(),
    health_status: Joi.string().valid('healthy', 'degraded', 'critical').required(),
    issues: Joi.array().items(
      Joi.object({
        severity: Joi.string().valid('low', 'medium', 'high', 'critical'),
        component: Joi.string(),
        message: Joi.string()
      })
    ),
    last_sync: Joi.date().iso(),
    version: Joi.string().required()
  }),

  syncRequest: Joi.object({
    sync_type: Joi.string().valid('full', 'incremental', 'selective').required(),
    components: Joi.array().items(
      Joi.string().valid('users', 'groups', 'guards', 'configs', 'vault')
    ),
    since_timestamp: Joi.date().iso(),
    force: Joi.boolean().default(false)
  })
};

// GET /api/v1/local-servers - Liste des serveurs locaux
router.get(
  '/',
  authenticate,
  authorize(['admin', 'operator']),
  rateLimiter('localServers:list'),
  async (req, res, next) => {
    try {
      const {
        status,
        geo_id,
        server_type,
        include_metrics = 'false',
        page = 1,
        limit = 20
      } = req.query;

      const servers = await LocalServerService.listServers({
        filters: { status, geo_id, server_type },
        include_metrics: include_metrics === 'true',
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: servers.data,
        meta: {
          total: servers.total,
          online: servers.online_count,
          offline: servers.offline_count,
          page: servers.page,
          pages: servers.pages,
          limit: servers.limit
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/local-servers/:id - Détails d'un serveur local
router.get(
  '/:id',
  authenticate,
  authorize(['admin', 'operator']),
  rateLimiter('localServers:read'),
  async (req, res, next) => {
    try {
      const server = await LocalServerService.getServer({
        server_id: req.params.id,
        include_metrics: true,
        include_history: req.query.include_history === 'true'
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

// POST /api/v1/local-servers/register - Enregistre un nouveau serveur (authentifié)
router.post(
  '/register',
  authenticate,
  authorize(['admin', 'system']),
  validateRequest(schemas.registerServer),
  rateLimiter('localServers:register'),
  auditLog('localServer.register'),
  async (req, res, next) => {
    try {
      const server = await LocalServerService.registerServer({
        ...req.body,
        registered_by: req.user.member_id
      });

      res.status(201).json({
        success: true,
        data: server,
        message: 'Serveur local enregistré avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/local-servers/register-token - Enregistre via token (Protocole Guilty Spark)
// Cet endpoint permet l'enregistrement automatisé d'un serveur local sans authentification JWT
// en utilisant le token d'enregistrement généré lors de l'installation du central
router.post(
  '/register-token',
  validateRequest(schemas.registerViaToken),
  rateLimiter('localServers:registerToken'),
  async (req, res, next) => {
    try {
      const {
        server_id,
        server_name,
        geo_id,
        server_type,
        registration_token,
        shared_secret,
        version,
        platform,
        capabilities
      } = req.body;

      // Vérifier le token d'enregistrement
      const expectedToken = process.env.LOCAL_REGISTRATION_TOKEN;
      if (!expectedToken || registration_token !== expectedToken) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'SHUGO-401',
            message: 'Token d\'enregistrement invalide'
          }
        });
      }

      // Enregistrer le serveur via le service
      const server = await LocalServerService.registerServerViaToken({
        server_id,
        server_name,
        geo_id,
        server_type,
        shared_secret,
        version,
        platform,
        capabilities,
        ip_address: req.ip || req.connection.remoteAddress,
        user_agent: req.headers['user-agent']
      });

      // Log l'action
      console.log(`[GuiltySparkProtocol] Serveur enregistré: ${server_id} (${geo_id})`);

      res.status(201).json({
        success: true,
        data: {
          instance_id: server.instance_id,
          server_id: server.server_id,
          registration_status: 'active',
          sync_enabled: true,
          central_time: new Date().toISOString()
        },
        message: 'Serveur local enregistré via protocole Guilty Spark'
      });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/v1/local-servers/:id - Met à jour un serveur
router.patch(
  '/:id',
  authenticate,
  authorize(['admin']),
  validateRequest(schemas.updateServer),
  rateLimiter('localServers:update'),
  auditLog('localServer.update'),
  async (req, res, next) => {
    try {
      const server = await LocalServerService.updateServer({
        server_id: req.params.id,
        updates: req.body,
        updated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: server,
        message: 'Serveur mis à jour avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/local-servers/:id - Désenregistre un serveur
router.delete(
  '/:id',
  authenticate,
  authorize(['admin']),
  rateLimiter('localServers:unregister'),
  auditLog('localServer.unregister'),
  async (req, res, next) => {
    try {
      await LocalServerService.unregisterServer({
        server_id: req.params.id,
        reason: req.body.reason,
        force: req.body.force === true,
        unregistered_by: req.user.member_id
      });

      res.json({
        success: true,
        message: 'Serveur désenregistré avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/local-servers/heartbeat - Réception heartbeat
router.post(
  '/heartbeat',
  authenticate,
  authorize(['system', 'local_server']),
  validateRequest(schemas.heartbeat),
  rateLimiter('localServers:heartbeat'),
  async (req, res, next) => {
    try {
      const result = await LocalServerService.processHeartbeat(req.body);

      res.json({
        success: true,
        data: {
          acknowledged: true,
          server_time: new Date().toISOString(),
          next_heartbeat_expected: result.next_heartbeat,
          pending_commands: result.commands || []
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/local-servers/:id/sync - Synchronisation
router.post(
  '/:id/sync',
  authenticate,
  authorize(['admin', 'system']),
  validateRequest(schemas.syncRequest),
  rateLimiter('localServers:sync'),
  auditLog('localServer.sync'),
  async (req, res, next) => {
    try {
      const sync = await LocalServerService.initiateSync({
        server_id: req.params.id,
        ...req.body,
        initiated_by: req.user.member_id
      });

      res.status(202).json({
        success: true,
        data: sync,
        message: 'Synchronisation initiée'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/local-servers/:id/status - État du serveur
router.get(
  '/:id/status',
  authenticate,
  authorize(['admin', 'operator', 'monitor']),
  rateLimiter('localServers:status'),
  async (req, res, next) => {
    try {
      const status = await LocalServerService.getServerStatus({
        server_id: req.params.id,
        detailed: req.query.detailed === 'true'
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

// POST /api/v1/local-servers/:id/command - Envoie une commande
router.post(
  '/:id/command',
  authenticate,
  authorize(['admin']),
  rateLimiter('localServers:command'),
  auditLog('localServer.command'),
  async (req, res, next) => {
    try {
      const { command_type, parameters, priority = 'normal' } = req.body;

      const result = await LocalServerService.sendCommand({
        server_id: req.params.id,
        command_type,
        parameters,
        priority,
        sent_by: req.user.member_id
      });

      res.json({
        success: true,
        data: result,
        message: 'Commande envoyée'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/local-servers/:id/logs - Logs du serveur
router.get(
  '/:id/logs',
  authenticate,
  authorize(['admin', 'operator']),
  rateLimiter('localServers:logs'),
  async (req, res, next) => {
    try {
      const {
        level,
        component,
        date_from,
        date_to,
        limit = 100
      } = req.query;

      const logs = await LocalServerService.getServerLogs({
        server_id: req.params.id,
        filters: { level, component, date_from, date_to },
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

// GET /api/v1/local-servers/:id/metrics - Métriques du serveur
router.get(
  '/:id/metrics',
  authenticate,
  authorize(['admin', 'operator', 'monitor']),
  rateLimiter('localServers:metrics'),
  async (req, res, next) => {
    try {
      const {
        metric_type = 'all',
        period = 'hour',
        points = 24
      } = req.query;

      const metrics = await LocalServerService.getServerMetrics({
        server_id: req.params.id,
        metric_type,
        period,
        points: parseInt(points)
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

// POST /api/v1/local-servers/:id/restart - Redémarre un serveur
router.post(
  '/:id/restart',
  authenticate,
  authorize(['admin']),
  rateLimiter('localServers:restart'),
  auditLog('localServer.restart'),
  async (req, res, next) => {
    try {
      const { 
        restart_type = 'graceful',
        delay_seconds = 0,
        reason 
      } = req.body;

      const result = await LocalServerService.restartServer({
        server_id: req.params.id,
        restart_type,
        delay_seconds,
        reason,
        initiated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: result,
        message: 'Redémarrage initié'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/local-servers/health-summary - Résumé santé globale
router.get(
  '/health-summary',
  authenticate,
  authorize(['admin', 'operator', 'monitor']),
  rateLimiter('localServers:healthSummary'),
  async (req, res, next) => {
    try {
      const summary = await LocalServerService.getHealthSummary();

      res.json({
        success: true,
        data: summary
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
