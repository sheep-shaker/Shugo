'use strict';

/**
 * SHUGO Central Server - Routes Sync
 * Endpoints pour la synchronisation avec les serveurs locaux
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { Op } = require('sequelize');
const logger = require('../utils/logger');

// Middleware d'authentification des serveurs locaux
const authenticateLocalServer = async (req, res, next) => {
  try {
    const serverId = req.headers['x-server-id'];
    const geoId = req.headers['x-geo-id'];
    const timestamp = req.headers['x-timestamp'];
    const signature = req.headers['x-signature'];

    if (!serverId || !geoId || !timestamp || !signature) {
      return res.status(401).json({
        success: false,
        error: 'Missing authentication headers'
      });
    }

    // Vérifier que le serveur est enregistré
    const LocalInstance = require('../models/LocalInstance');
    const instance = await LocalInstance.findOne({ where: { server_id: serverId } });

    if (!instance || instance.status !== 'active') {
      return res.status(401).json({
        success: false,
        error: 'Unknown or inactive server'
      });
    }

    // Vérifier le timestamp (max 5 minutes de décalage)
    const requestTime = new Date(timestamp);
    const now = new Date();
    const timeDiff = Math.abs(now - requestTime);

    if (timeDiff > 5 * 60 * 1000) {
      return res.status(401).json({
        success: false,
        error: 'Request timestamp too old'
      });
    }

    // Vérifier la signature HMAC
    const expectedSignature = crypto
      .createHmac('sha256', instance.shared_secret)
      .update(JSON.stringify({
        method: req.method,
        url: req.originalUrl,
        timestamp,
        body: req.body
      }))
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(401).json({
        success: false,
        error: 'Invalid signature'
      });
    }

    // Attacher l'instance à la requête
    req.localServer = instance;
    next();

  } catch (error) {
    logger.error('Local server auth error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication error'
    });
  }
};

/**
 * POST /api/sync/heartbeat
 * Heartbeat des serveurs locaux
 */
router.post('/heartbeat', authenticateLocalServer, async (req, res) => {
  try {
    const { metrics, queueSize, timestamp } = req.body;
    const instance = req.localServer;

    // Mettre à jour le statut de l'instance
    await instance.update({
      last_heartbeat: new Date(),
      metrics: JSON.stringify(metrics),
      sync_queue_size: queueSize
    });

    // Vérifier s'il y a des commandes en attente
    const { PendingCommand } = require('../models');
    const pendingCommands = await PendingCommand.findAll({
      where: {
        instance_id: instance.instance_id,
        status: 'pending'
      },
      limit: 10
    });

    // Vérifier si une sync complète est nécessaire
    const needsFullSync = instance.needs_full_sync || false;

    logger.debug('Heartbeat received', {
      instance_id: instance.instance_id,
      geo_id: instance.geo_id,
      queueSize
    });

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      commands: pendingCommands.map(c => c.toJSON()),
      needsFullSync,
      serverTime: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Heartbeat error:', error);
    res.status(500).json({
      success: false,
      error: 'Heartbeat processing failed'
    });
  }
});

/**
 * GET /api/sync/changes
 * Récupérer les changements depuis une date
 */
router.get('/changes', authenticateLocalServer, async (req, res) => {
  try {
    const { since, entities } = req.query;
    const instance = req.localServer;
    const sinceDate = since ? new Date(since) : new Date(0);

    const changes = {};
    const entitiesToSync = entities ? entities.split(',') : ['users', 'guards', 'groups', 'assignments'];

    // Récupérer les changements par entité
    for (const entity of entitiesToSync) {
      changes[entity] = await getChangesForEntity(entity, sinceDate, instance.geo_id);
    }

    // Compter le total
    const totalChanges = Object.values(changes).reduce((sum, arr) => sum + arr.length, 0);

    logger.info('Sync changes requested', {
      instance_id: instance.instance_id,
      since: sinceDate,
      totalChanges
    });

    res.json({
      success: true,
      changes,
      totalChanges,
      syncTimestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Get changes error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get changes'
    });
  }
});

/**
 * POST /api/sync/push
 * Recevoir les changements d'un serveur local
 */
router.post('/push', authenticateLocalServer, async (req, res) => {
  try {
    const { entity, changes, geoId } = req.body;
    const instance = req.localServer;

    if (!entity || !changes || !Array.isArray(changes)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid push request'
      });
    }

    const results = {
      accepted: 0,
      rejected: 0,
      conflicts: []
    };

    // Traiter chaque changement
    for (const change of changes) {
      try {
        const result = await processChange(entity, change, instance);
        if (result.success) {
          results.accepted++;
        } else {
          results.rejected++;
          if (result.conflict) {
            results.conflicts.push({
              id: change.id,
              reason: result.reason
            });
          }
        }
      } catch (error) {
        results.rejected++;
        logger.error('Change processing error:', { change, error: error.message });
      }
    }

    logger.info('Sync push processed', {
      instance_id: instance.instance_id,
      entity,
      ...results
    });

    res.json({
      success: true,
      results
    });

  } catch (error) {
    logger.error('Push error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process push'
    });
  }
});

/**
 * POST /api/sync/item
 * Synchroniser un seul élément
 */
router.post('/item', authenticateLocalServer, async (req, res) => {
  try {
    const { operation, entity, data, id } = req.body;
    const instance = req.localServer;

    const result = await processChange(entity, { operation, data, id }, instance);

    if (result.success) {
      res.json({
        success: true,
        id,
        syncedAt: new Date().toISOString()
      });
    } else {
      res.status(409).json({
        success: false,
        error: result.reason,
        conflict: result.conflict
      });
    }

  } catch (error) {
    logger.error('Sync item error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync item'
    });
  }
});

/**
 * POST /api/sync/full
 * Demander une synchronisation complète
 */
router.post('/full', authenticateLocalServer, async (req, res) => {
  try {
    const instance = req.localServer;
    const { entities } = req.body;

    const data = {};
    const entitiesToSync = entities || ['users', 'guards', 'groups', 'assignments'];

    for (const entity of entitiesToSync) {
      data[entity] = await getFullDataForEntity(entity, instance.geo_id);
    }

    // Marquer la sync complète comme effectuée
    await instance.update({
      last_full_sync: new Date(),
      needs_full_sync: false
    });

    logger.info('Full sync completed', {
      instance_id: instance.instance_id,
      entities: entitiesToSync
    });

    res.json({
      success: true,
      data,
      syncTimestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Full sync error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform full sync'
    });
  }
});

/**
 * POST /api/sync/register
 * Enregistrer un nouveau serveur local
 */
router.post('/register', async (req, res) => {
  try {
    const { serverId, geoId, serverName, publicKey } = req.body;
    const registrationToken = req.headers['x-registration-token'];

    // Vérifier le token d'enregistrement
    const { SystemConfig } = require('../models');
    const validToken = await SystemConfig.findOne({
      where: { key: 'local_registration_token' }
    });

    if (!validToken || validToken.value !== registrationToken) {
      return res.status(401).json({
        success: false,
        error: 'Invalid registration token'
      });
    }

    // Générer le secret partagé
    const sharedSecret = crypto.randomBytes(32).toString('hex');

    // Créer l'instance
    const { LocalInstance } = require('../models');
    const instance = await LocalInstance.create({
      instance_id: serverId,
      geo_id: geoId,
      name: serverName,
      shared_secret: sharedSecret,
      public_key: publicKey,
      status: 'active',
      registered_at: new Date()
    });

    logger.info('New local server registered', {
      instance_id: serverId,
      geo_id: geoId
    });

    res.status(201).json({
      success: true,
      data: {
        instanceId: instance.instance_id,
        sharedSecret,
        centralUrl: process.env.CENTRAL_URL || 'https://central.shugo.app',
        syncConfig: {
          heartbeatInterval: 5 * 60 * 1000,
          syncInterval: 5 * 60 * 1000,
          batchSize: 100
        }
      }
    });

  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed'
    });
  }
});

/**
 * GET /api/sync/status
 * Statut de synchronisation d'un serveur
 */
router.get('/status', authenticateLocalServer, async (req, res) => {
  try {
    const instance = req.localServer;

    res.json({
      success: true,
      data: {
        instanceId: instance.instance_id,
        geoId: instance.geo_id,
        status: instance.status,
        lastHeartbeat: instance.last_heartbeat,
        lastFullSync: instance.last_full_sync,
        lastDeltaSync: instance.last_delta_sync,
        syncQueueSize: instance.sync_queue_size,
        needsFullSync: instance.needs_full_sync
      }
    });

  } catch (error) {
    logger.error('Status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get status'
    });
  }
});

// ===================
// Helper Functions
// ===================

async function getChangesForEntity(entity, sinceDate, geoId) {
  const models = require('../models');
  const modelMap = {
    'users': { model: models.User, geoFilter: true },
    'guards': { model: models.Guard, geoFilter: true },
    'groups': { model: models.Group, geoFilter: true },
    'assignments': { model: models.Assignment, geoFilter: false }
  };

  const config = modelMap[entity];
  if (!config) return [];

  const where = {
    updated_at: { [Op.gt]: sinceDate }
  };

  if (config.geoFilter && geoId) {
    where.geo_id = geoId;
  }

  const records = await config.model.findAll({
    where,
    order: [['updated_at', 'ASC']],
    limit: 1000
  });

  return records.map(r => ({
    id: r.id || r.member_id || r.guard_id || r.group_id,
    operation: 'update',
    data: r.toJSON(),
    updatedAt: r.updated_at
  }));
}

async function getFullDataForEntity(entity, geoId) {
  const models = require('../models');
  const modelMap = {
    'users': { model: models.User, geoFilter: true },
    'guards': { model: models.Guard, geoFilter: true },
    'groups': { model: models.Group, geoFilter: true },
    'assignments': { model: models.Assignment, geoFilter: false }
  };

  const config = modelMap[entity];
  if (!config) return [];

  const where = {};
  if (config.geoFilter && geoId) {
    where.geo_id = geoId;
  }

  const records = await config.model.findAll({ where });
  return records.map(r => r.toJSON());
}

async function processChange(entity, change, instance) {
  const models = require('../models');
  const modelMap = {
    'users': models.User,
    'guards': models.Guard,
    'groups': models.Group,
    'assignments': models.Assignment
  };

  const Model = modelMap[entity];
  if (!Model) {
    return { success: false, reason: 'Unknown entity' };
  }

  try {
    switch (change.operation) {
      case 'create':
        await Model.create({
          ...change.data,
          synced_from_local: instance.instance_id,
          synced_at: new Date()
        });
        break;

      case 'update':
        const [updated] = await Model.update(
          {
            ...change.data,
            synced_from_local: instance.instance_id,
            synced_at: new Date()
          },
          { where: { id: change.id } }
        );
        if (!updated) {
          return { success: false, reason: 'Record not found', conflict: true };
        }
        break;

      case 'delete':
        await Model.destroy({ where: { id: change.id } });
        break;

      default:
        return { success: false, reason: 'Unknown operation' };
    }

    return { success: true };

  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return { success: false, reason: 'Duplicate entry', conflict: true };
    }
    throw error;
  }
}

module.exports = router;
