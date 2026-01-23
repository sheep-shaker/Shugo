'use strict';

/**
 * SHUGO v7.0 - Service de Synchronisation Central/Local
 *
 * Gestion de la synchronisation bidirectionnelle entre le serveur central
 * et les serveurs locaux :
 * - File de synchronisation avec priorités
 * - Gestion des conflits (central master)
 * - Retry automatique avec backoff exponentiel
 * - Validation d'intégrité (checksum)
 * - Mode dégradé (Upside Mode) compatible
 * - Batch processing pour performance
 *
 * @see Document Technique V7.0 - Section 6.2 (Synchronisation)
 */

const crypto = require('crypto');
const { Op } = require('sequelize');

/**
 * Types d'opérations de synchronisation
 */
const SYNC_OPERATIONS = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  SYNC: 'sync',
  BULK: 'bulk'
};

/**
 * Directions de synchronisation
 */
const SYNC_DIRECTIONS = {
  LOCAL_TO_CENTRAL: 'local_to_central',
  CENTRAL_TO_LOCAL: 'central_to_local',
  BIDIRECTIONAL: 'bidirectional'
};

/**
 * Statuts de synchronisation
 */
const SYNC_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  RETRY: 'retry'
};

/**
 * Entités synchronisables
 */
const SYNCABLE_ENTITIES = {
  USER: 'user',
  GUARD: 'guard',
  ASSIGNMENT: 'assignment',
  GROUP: 'group',
  NOTIFICATION: 'notification',
  AUDIT_LOG: 'audit_log',
  SETTING: 'setting',
  KEY_ROTATION: 'key_rotation'
};

/**
 * Priorités de synchronisation
 */
const SYNC_PRIORITIES = {
  LOW: 1,
  NORMAL: 5,
  HIGH: 8,
  URGENT: 10
};

/**
 * Configuration par défaut
 */
const DEFAULT_CONFIG = {
  batchSize: 100,
  maxRetries: 3,
  retryBaseDelay: 1000,
  retryMaxDelay: 60000,
  processingTimeout: 30000,
  healthCheckInterval: 60000,
  conflictResolution: 'central_wins',
  checksumValidation: true,
  compressionEnabled: true
};

/**
 * Service de synchronisation
 */
class SyncService {
  constructor(models) {
    this.models = models;
    this.LocalInstance = models?.LocalInstance;
    this.LocalSyncQueue = models?.LocalSyncQueue;
    this.AuditLog = models?.AuditLog;

    this._auditService = null;
    this._notificationService = null;
    this._upsideModeService = null;

    this.config = { ...DEFAULT_CONFIG };

    this._isProcessing = false;
    this._processingInterval = null;
    this._healthCheckInterval = null;
    this._pendingOperations = new Map();

    this._stats = {
      totalSynced: 0,
      totalFailed: 0,
      totalConflicts: 0,
      lastSyncTime: null,
      averageLatency: 0,
      serverStats: new Map()
    };

    this._entityHandlers = new Map();
  }

  // =========================================
  // INITIALISATION
  // =========================================

  async initialize(options = {}) {
    const { auditService, notificationService, upsideModeService, config } = options;

    this._auditService = auditService;
    this._notificationService = notificationService;
    this._upsideModeService = upsideModeService;

    if (config) {
      this.config = { ...this.config, ...config };
    }

    this._registerDefaultHandlers();
    this._startProcessingLoop();
    this._startHealthChecks();

    console.log('[SyncService] Initialisé avec config:', {
      batchSize: this.config.batchSize,
      maxRetries: this.config.maxRetries,
      conflictResolution: this.config.conflictResolution
    });

    return { initialized: true };
  }

  async shutdown() {
    if (this._processingInterval) {
      clearInterval(this._processingInterval);
      this._processingInterval = null;
    }

    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
      this._healthCheckInterval = null;
    }

    const maxWait = 30000;
    const startWait = Date.now();
    while (this._isProcessing && Date.now() - startWait < maxWait) {
      await new Promise(r => setTimeout(r, 100));
    }

    console.log('[SyncService] Arrêté');
  }

  _registerDefaultHandlers() {
    this._entityHandlers.set(SYNCABLE_ENTITIES.USER, {
      validate: (data) => data && data.member_id,
      transform: (data, direction) => {
        if (direction === SYNC_DIRECTIONS.CENTRAL_TO_LOCAL) {
          const { password_hash, ...safe } = data;
          return safe;
        }
        return data;
      },
      getKey: (data) => `user_${data.member_id}`
    });

    this._entityHandlers.set(SYNCABLE_ENTITIES.GUARD, {
      validate: (data) => data && data.guard_id,
      transform: (data) => data,
      getKey: (data) => `guard_${data.guard_id}`
    });

    this._entityHandlers.set(SYNCABLE_ENTITIES.ASSIGNMENT, {
      validate: (data) => data && data.assignment_id,
      transform: (data) => data,
      getKey: (data) => `assignment_${data.assignment_id}`
    });

    this._entityHandlers.set(SYNCABLE_ENTITIES.GROUP, {
      validate: (data) => data && data.group_id,
      transform: (data) => data,
      getKey: (data) => `group_${data.group_id}`
    });
  }

  // =========================================
  // ENQUEUE - MISE EN FILE
  // =========================================

  async enqueue(operation) {
    const {
      serverId,
      operationType,
      entityType,
      entityId,
      data,
      priority = SYNC_PRIORITIES.NORMAL,
      direction = SYNC_DIRECTIONS.CENTRAL_TO_LOCAL,
      dependencies = [],
      metadata = {}
    } = operation;

    if (!operationType || !Object.values(SYNC_OPERATIONS).includes(operationType)) {
      throw new SyncError('INVALID_OPERATION', 'Type d\'opération invalide');
    }

    if (!entityType || !Object.values(SYNCABLE_ENTITIES).includes(entityType)) {
      throw new SyncError('INVALID_ENTITY', 'Type d\'entité invalide');
    }

    let checksum = null;
    if (this.config.checksumValidation && data) {
      checksum = this._calculateChecksum(data);
    }

    const entry = await this.LocalSyncQueue.create({
      server_id: serverId,
      operation_type: operationType,
      entity_type: entityType,
      entity_id: entityId,
      data,
      priority,
      direction,
      dependencies,
      metadata,
      checksum,
      status: SYNC_STATUS.PENDING
    });

    await this._logActivity('sync_enqueued', {
      syncId: entry.sync_id,
      entityType,
      entityId,
      operationType,
      serverId,
      priority
    });

    return {
      syncId: entry.sync_id,
      status: entry.status,
      createdAt: entry.created_at
    };
  }

  async enqueueBatch(operations) {
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new SyncError('INVALID_BATCH', 'Liste d\'opérations invalide');
    }

    const batchId = `batch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const results = [];
    const errors = [];

    for (const op of operations) {
      try {
        const result = await this.enqueue({
          ...op,
          metadata: { ...op.metadata, batchId }
        });
        results.push({ success: true, ...result });
      } catch (err) {
        errors.push({ success: false, error: err.message, operation: op });
      }
    }

    return {
      batchId,
      total: operations.length,
      success: results.length,
      failed: errors.length,
      results,
      errors
    };
  }

  async syncToAllServers(entityType, entityId, data, options = {}) {
    const { geoId, priority = SYNC_PRIORITIES.NORMAL, operationType = SYNC_OPERATIONS.SYNC } = options;

    const whereClause = { status: 'active' };
    if (geoId) {
      whereClause.geo_id = geoId;
    }

    const servers = await this.LocalInstance.findAll({ where: whereClause });

    if (servers.length === 0) {
      return { synced: 0, servers: [] };
    }

    const operations = servers.map(server => ({
      serverId: server.instance_id,
      operationType,
      entityType,
      entityId,
      data,
      priority,
      direction: SYNC_DIRECTIONS.CENTRAL_TO_LOCAL
    }));

    const result = await this.enqueueBatch(operations);

    return {
      synced: result.success,
      servers: servers.map(s => s.instance_id),
      batchId: result.batchId
    };
  }

  // =========================================
  // TRAITEMENT DE LA FILE
  // =========================================

  _startProcessingLoop() {
    this._processingInterval = setInterval(async () => {
      if (this._isProcessing) return;

      if (this._upsideModeService && !await this._upsideModeService.isActionAllowed('sync')) {
        return;
      }

      try {
        await this.processQueue();
      } catch (err) {
        console.error('[SyncService] Erreur traitement file:', err.message);
      }
    }, 5000);
  }

  async processQueue() {
    if (this._isProcessing) {
      return { skipped: true, reason: 'already_processing' };
    }

    this._isProcessing = true;
    const startTime = Date.now();
    const processed = { success: 0, failed: 0, skipped: 0 };

    try {
      const servers = await this.LocalInstance.findActive();

      for (const server of servers) {
        if (!server.isOnline()) {
          processed.skipped++;
          continue;
        }

        const operations = await this.LocalSyncQueue.getNextBatch(
          server.instance_id,
          this.config.batchSize
        );

        for (const op of operations) {
          try {
            await this._processOperation(op, server);
            processed.success++;
          } catch (err) {
            await this._handleOperationError(op, err);
            processed.failed++;
          }
        }
      }

      const broadcastOps = await this.LocalSyncQueue.findAll({
        where: {
          server_id: null,
          status: { [Op.in]: [SYNC_STATUS.PENDING, SYNC_STATUS.RETRY] }
        },
        order: [['priority', 'DESC'], ['created_at', 'ASC']],
        limit: this.config.batchSize
      });

      for (const op of broadcastOps) {
        try {
          await this._processBroadcastOperation(op);
          processed.success++;
        } catch (err) {
          await this._handleOperationError(op, err);
          processed.failed++;
        }
      }

      this._stats.lastSyncTime = new Date();
      this._stats.averageLatency = Date.now() - startTime;

    } finally {
      this._isProcessing = false;
    }

    return processed;
  }

  async _processOperation(operation, server) {
    await operation.update({ status: SYNC_STATUS.PROCESSING });

    if (operation.dependencies && operation.dependencies.length > 0) {
      const unmetDeps = await this._checkDependencies(operation.dependencies);
      if (unmetDeps.length > 0) {
        throw new SyncError('UNMET_DEPENDENCIES', `Dépendances non satisfaites: ${unmetDeps.join(', ')}`);
      }
    }

    if (this.config.checksumValidation && operation.checksum) {
      const calculatedChecksum = this._calculateChecksum(operation.data);
      if (calculatedChecksum !== operation.checksum) {
        throw new SyncError('CHECKSUM_MISMATCH', 'Corruption de données détectée');
      }
    }

    const handler = this._entityHandlers.get(operation.entity_type);
    if (handler) {
      if (!handler.validate(operation.data)) {
        throw new SyncError('INVALID_DATA', 'Données invalides pour l\'entité');
      }
      operation.data = handler.transform(operation.data, operation.direction);
    }

    const result = await this._sendToServer(server, operation);

    await operation.markAsProcessed();
    operation.acknowledged_at = new Date();
    await operation.save();

    this._stats.totalSynced++;

    await this._logActivity('sync_completed', {
      syncId: operation.sync_id,
      serverId: server.instance_id,
      entityType: operation.entity_type,
      entityId: operation.entity_id,
      latency: result.latency
    });

    return result;
  }

  async _processBroadcastOperation(operation) {
    const servers = await this.LocalInstance.findActive();
    const results = [];

    for (const server of servers) {
      if (!server.isOnline()) continue;

      try {
        const result = await this._sendToServer(server, operation);
        results.push({ serverId: server.instance_id, success: true, result });
      } catch (err) {
        results.push({ serverId: server.instance_id, success: false, error: err.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    if (successCount > 0) {
      await operation.markAsProcessed();
      operation.metadata = { ...operation.metadata, broadcastResults: results };
      await operation.save();
    } else if (results.length > 0) {
      throw new SyncError('BROADCAST_FAILED', 'Aucun serveur n\'a pu recevoir la synchronisation');
    }

    return results;
  }

  async _sendToServer(server, operation) {
    const startTime = Date.now();

    const payload = {
      syncId: operation.sync_id,
      operation: operation.operation_type,
      entityType: operation.entity_type,
      entityId: operation.entity_id,
      data: operation.data,
      checksum: operation.checksum,
      timestamp: new Date().toISOString()
    };

    let body = JSON.stringify(payload);
    if (this.config.compressionEnabled && body.length > 1024) {
      const zlib = require('zlib');
      body = zlib.gzipSync(body);
    }

    const endpoint = server.api_endpoint || `https://${server.ip_address}:${server.port}/api/v1`;

    try {
      const response = await this._makeRequest(`${endpoint}/sync/receive`, {
        method: 'POST',
        body,
        headers: {
          'Content-Type': this.config.compressionEnabled ? 'application/gzip' : 'application/json',
          'X-Server-ID': server.server_id,
          'X-Sync-ID': operation.sync_id.toString()
        },
        timeout: this.config.processingTimeout
      });

      const latency = Date.now() - startTime;
      this._updateServerStats(server.instance_id, latency, true);

      return { success: true, latency, response };
    } catch (err) {
      const latency = Date.now() - startTime;
      this._updateServerStats(server.instance_id, latency, false);
      throw err;
    }
  }

  async _makeRequest(url, options) {
    return new Promise((resolve, reject) => {
      const https = require('https');
      const urlObj = new URL(url);

      const req = https.request({
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: options.timeout || 30000,
        rejectUnauthorized: false
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, body: data });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  // =========================================
  // GESTION DES ERREURS ET RETRY
  // =========================================

  async _handleOperationError(operation, error) {
    console.error(`[SyncService] Erreur sync ${operation.sync_id}:`, error.message);

    operation.error_message = error.message;

    if (operation.canRetry()) {
      await operation.incrementRetry();

      const delay = Math.min(
        this.config.retryBaseDelay * Math.pow(2, operation.retry_count),
        this.config.retryMaxDelay
      );

      setTimeout(async () => {
        try {
          await operation.update({ status: SYNC_STATUS.PENDING });
        } catch (err) {
          console.error('[SyncService] Erreur réactivation retry:', err.message);
        }
      }, delay);

    } else {
      operation.status = SYNC_STATUS.FAILED;
      await operation.save();
      this._stats.totalFailed++;

      await this._logActivity('sync_failed', {
        syncId: operation.sync_id,
        entityType: operation.entity_type,
        entityId: operation.entity_id,
        error: error.message,
        retryCount: operation.retry_count
      });
    }
  }

  async _checkDependencies(dependencyIds) {
    const deps = await this.LocalSyncQueue.findAll({
      where: { sync_id: { [Op.in]: dependencyIds } }
    });

    const unmet = [];
    for (const dep of deps) {
      if (dep.status !== SYNC_STATUS.COMPLETED) {
        unmet.push(dep.sync_id);
      }
    }

    return unmet;
  }

  // =========================================
  // RÉCEPTION DEPUIS SERVEURS LOCAUX
  // =========================================

  async receiveFromLocal(serverId, payload) {
    const { entityType, entityId, data, operation, checksum, localTimestamp } = payload;

    const server = await this.LocalInstance.findOne({
      where: { server_id: serverId, status: 'active' }
    });

    if (!server) {
      throw new SyncError('UNKNOWN_SERVER', 'Serveur non reconnu ou inactif');
    }

    await server.updateHeartbeat();

    if (this.config.checksumValidation && checksum) {
      const calculatedChecksum = this._calculateChecksum(data);
      if (calculatedChecksum !== checksum) {
        throw new SyncError('CHECKSUM_MISMATCH', 'Corruption de données détectée');
      }
    }

    const conflict = await this._checkConflict(entityType, entityId, localTimestamp);
    if (conflict) {
      return await this._resolveConflict(conflict, data, server);
    }

    const result = await this._applyLocalChanges(entityType, entityId, data, operation);

    await this._logActivity('sync_received', {
      serverId: server.instance_id,
      entityType,
      entityId,
      operation
    });

    return { success: true, result };
  }

  async _checkConflict(entityType, entityId, localTimestamp) {
    const recentOp = await this.LocalSyncQueue.findOne({
      where: {
        entity_type: entityType,
        entity_id: entityId,
        direction: SYNC_DIRECTIONS.CENTRAL_TO_LOCAL,
        status: { [Op.in]: [SYNC_STATUS.PENDING, SYNC_STATUS.PROCESSING, SYNC_STATUS.COMPLETED] },
        created_at: { [Op.gt]: new Date(localTimestamp) }
      },
      order: [['created_at', 'DESC']]
    });

    return recentOp;
  }

  async _resolveConflict(conflictOp, localData, server) {
    this._stats.totalConflicts++;

    switch (this.config.conflictResolution) {
      case 'central_wins':
        await this._logActivity('sync_conflict_resolved', {
          resolution: 'central_wins',
          entityType: conflictOp.entity_type,
          entityId: conflictOp.entity_id,
          serverId: server.instance_id
        });
        return {
          success: false,
          conflict: true,
          resolution: 'central_wins',
          message: 'Données locales ignorées - version centrale plus récente'
        };

      case 'local_wins':
        return { success: true, conflict: true, resolution: 'local_wins' };

      case 'manual':
        await this._createConflictTicket(conflictOp, localData, server);
        return {
          success: false,
          conflict: true,
          resolution: 'pending_manual',
          message: 'Conflit en attente de résolution manuelle'
        };

      default:
        return { success: false, conflict: true, resolution: 'unknown' };
    }
  }

  async _applyLocalChanges(entityType, entityId, data, operation) {
    const modelName = this._getModelName(entityType);
    const Model = this.models[modelName];

    if (!Model) {
      throw new SyncError('UNKNOWN_ENTITY', `Type d'entité inconnu: ${entityType}`);
    }

    switch (operation) {
      case SYNC_OPERATIONS.CREATE:
        return await Model.create(data);

      case SYNC_OPERATIONS.UPDATE:
        const [updated] = await Model.update(data, {
          where: { [this._getPrimaryKey(entityType)]: entityId }
        });
        return { updated };

      case SYNC_OPERATIONS.DELETE:
        const deleted = await Model.destroy({
          where: { [this._getPrimaryKey(entityType)]: entityId }
        });
        return { deleted };

      case SYNC_OPERATIONS.SYNC:
        const [instance, created] = await Model.upsert(data);
        return { instance, created };

      default:
        throw new SyncError('INVALID_OPERATION', `Opération non supportée: ${operation}`);
    }
  }

  _getModelName(entityType) {
    const mapping = {
      [SYNCABLE_ENTITIES.USER]: 'User',
      [SYNCABLE_ENTITIES.GUARD]: 'Guard',
      [SYNCABLE_ENTITIES.ASSIGNMENT]: 'GuardAssignment',
      [SYNCABLE_ENTITIES.GROUP]: 'Group',
      [SYNCABLE_ENTITIES.NOTIFICATION]: 'Notification',
      [SYNCABLE_ENTITIES.AUDIT_LOG]: 'AuditLog',
      [SYNCABLE_ENTITIES.SETTING]: 'Setting',
      [SYNCABLE_ENTITIES.KEY_ROTATION]: 'AesKeyRotation'
    };
    return mapping[entityType];
  }

  _getPrimaryKey(entityType) {
    const mapping = {
      [SYNCABLE_ENTITIES.USER]: 'member_id',
      [SYNCABLE_ENTITIES.GUARD]: 'guard_id',
      [SYNCABLE_ENTITIES.ASSIGNMENT]: 'assignment_id',
      [SYNCABLE_ENTITIES.GROUP]: 'group_id',
      [SYNCABLE_ENTITIES.NOTIFICATION]: 'notification_id',
      [SYNCABLE_ENTITIES.AUDIT_LOG]: 'log_id',
      [SYNCABLE_ENTITIES.SETTING]: 'setting_id',
      [SYNCABLE_ENTITIES.KEY_ROTATION]: 'rotation_id'
    };
    return mapping[entityType];
  }

  // =========================================
  // HEALTH CHECKS
  // =========================================

  _startHealthChecks() {
    this._healthCheckInterval = setInterval(async () => {
      try {
        await this._performHealthChecks();
      } catch (err) {
        console.error('[SyncService] Erreur health check:', err.message);
      }
    }, this.config.healthCheckInterval);
  }

  async _performHealthChecks() {
    const servers = await this.LocalInstance.findActive();
    const results = [];

    for (const server of servers) {
      try {
        const endpoint = server.api_endpoint || `https://${server.ip_address}:${server.port}/api/v1`;
        const startTime = Date.now();

        const response = await this._makeRequest(`${endpoint}/health`, {
          method: 'GET',
          timeout: 5000
        });

        const latency = Date.now() - startTime;
        await server.updateHeartbeat();

        results.push({
          serverId: server.instance_id,
          status: 'online',
          latency,
          version: response.body?.version
        });
      } catch (err) {
        results.push({
          serverId: server.instance_id,
          status: 'offline',
          error: err.message
        });

        if (!server.isOnline()) {
          await this._handleServerOffline(server);
        }
      }
    }

    return results;
  }

  async _handleServerOffline(server) {
    const offlineDuration = server.last_seen
      ? Date.now() - server.last_seen.getTime()
      : Infinity;

    if (offlineDuration > 10 * 60 * 1000) {
      await this._logActivity('server_offline', {
        serverId: server.instance_id,
        geoId: server.geo_id,
        lastSeen: server.last_seen,
        offlineDuration: Math.round(offlineDuration / 1000)
      });
    }
  }

  // =========================================
  // STATISTIQUES ET MONITORING
  // =========================================

  _updateServerStats(serverId, latency, success) {
    let stats = this._stats.serverStats.get(serverId);
    if (!stats) {
      stats = { totalOps: 0, successOps: 0, failedOps: 0, totalLatency: 0 };
      this._stats.serverStats.set(serverId, stats);
    }

    stats.totalOps++;
    stats.totalLatency += latency;
    if (success) {
      stats.successOps++;
    } else {
      stats.failedOps++;
    }
  }

  getStatistics() {
    const serverStatsArray = [];
    for (const [serverId, stats] of this._stats.serverStats) {
      serverStatsArray.push({
        serverId,
        ...stats,
        avgLatency: stats.totalOps > 0 ? Math.round(stats.totalLatency / stats.totalOps) : 0,
        successRate: stats.totalOps > 0 ? Math.round((stats.successOps / stats.totalOps) * 100) : 0
      });
    }

    return {
      totalSynced: this._stats.totalSynced,
      totalFailed: this._stats.totalFailed,
      totalConflicts: this._stats.totalConflicts,
      lastSyncTime: this._stats.lastSyncTime,
      averageLatency: this._stats.averageLatency,
      isProcessing: this._isProcessing,
      serverStats: serverStatsArray
    };
  }

  async getQueueStatus(filters = {}) {
    const { serverId, status, entityType, page = 1, limit = 50 } = filters;

    const where = {};
    if (serverId) where.server_id = serverId;
    if (status) where.status = status;
    if (entityType) where.entity_type = entityType;

    const { count, rows } = await this.LocalSyncQueue.findAndCountAll({
      where,
      order: [['priority', 'DESC'], ['created_at', 'ASC']],
      limit: Math.min(limit, 100),
      offset: (page - 1) * limit
    });

    const statusCounts = await this.LocalSyncQueue.findAll({
      attributes: [
        'status',
        [this.models.sequelize.fn('COUNT', '*'), 'count']
      ],
      group: ['status']
    });

    return {
      queue: rows.map(op => ({
        syncId: op.sync_id,
        serverId: op.server_id,
        entityType: op.entity_type,
        entityId: op.entity_id,
        operation: op.operation_type,
        status: op.status,
        priority: op.priority,
        retryCount: op.retry_count,
        createdAt: op.created_at,
        processedAt: op.processed_at
      })),
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      },
      statusSummary: statusCounts.reduce((acc, s) => {
        acc[s.status] = parseInt(s.get('count'));
        return acc;
      }, {})
    };
  }

  async cleanupQueue(daysToKeep = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const deleted = await this.LocalSyncQueue.destroy({
      where: {
        status: { [Op.in]: [SYNC_STATUS.COMPLETED, SYNC_STATUS.FAILED] },
        created_at: { [Op.lt]: cutoffDate }
      }
    });

    await this._logActivity('sync_cleanup', { deletedCount: deleted, daysKept: daysToKeep });

    return deleted;
  }

  // =========================================
  // UTILITAIRES
  // =========================================

  _calculateChecksum(data) {
    const str = JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  async _createConflictTicket(conflictOp, localData, server) {
    console.log('[SyncService] Conflit détecté, ticket à créer:', {
      entityType: conflictOp.entity_type,
      entityId: conflictOp.entity_id,
      serverId: server.instance_id
    });
  }

  async _logActivity(action, data) {
    try {
      if (this._auditService) {
        await this._auditService.logOperation(action, {
          module: 'sync',
          ...data
        });
      }
    } catch (err) {
      console.error('[SyncService] Erreur audit:', err.message);
    }
  }

  registerEntityHandler(entityType, handler) {
    this._entityHandlers.set(entityType, handler);
  }
}

/**
 * Classe d'erreur sync
 */
class SyncError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
  }
}

module.exports = SyncService;
module.exports.SyncError = SyncError;
module.exports.SYNC_OPERATIONS = SYNC_OPERATIONS;
module.exports.SYNC_DIRECTIONS = SYNC_DIRECTIONS;
module.exports.SYNC_STATUS = SYNC_STATUS;
module.exports.SYNCABLE_ENTITIES = SYNCABLE_ENTITIES;
module.exports.SYNC_PRIORITIES = SYNC_PRIORITIES;
