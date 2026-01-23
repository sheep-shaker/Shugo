'use strict';

/**
 * SHUGO v7.0 - Service de gestion des serveurs locaux
 *
 * Gestion des instances de serveurs locaux :
 * - Enregistrement et activation
 * - Monitoring et heartbeat
 * - Configuration à distance
 * - Métriques et statistiques
 *
 * @see Document Technique V7.0 - Section 6.1
 */

const crypto = require('crypto');
const { Op } = require('sequelize');

/**
 * Statuts des serveurs
 */
const SERVER_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  MAINTENANCE: 'maintenance',
  SPARE: 'spare',
  ERROR: 'error'
};

/**
 * Capacités des serveurs
 */
const SERVER_CAPABILITIES = {
  SYNC: 'sync',
  BACKUP: 'backup',
  NOTIFICATIONS: 'notifications',
  OFFLINE_MODE: 'offline_mode',
  LOCAL_AUTH: 'local_auth'
};

// Import paresseux du modèle LocalInstance
let _LocalInstance = null;
function getLocalInstanceModel() {
  if (!_LocalInstance) {
    _LocalInstance = require('../models/LocalInstance');
  }
  return _LocalInstance;
}

class LocalServerService {
  constructor(models) {
    this.models = models;
    this._modelsFromConstructor = models;
    this.LocalInstance = models?.LocalInstance;
    this.AuditLog = models?.AuditLog;

    this._auditService = null;
    this._syncService = null;

    // Cache des serveurs en ligne
    this._onlineCache = new Map();
    this._cacheTTL = 30000; // 30 secondes
  }

  // Getter pour LocalInstance avec fallback sur import direct
  _getLocalInstance() {
    if (this.LocalInstance) return this.LocalInstance;
    return getLocalInstanceModel();
  }

  async initialize(options = {}) {
    const { auditService, syncService } = options;
    this._auditService = auditService;
    this._syncService = syncService;

    console.log('[LocalServerService] Initialisé');
    return { initialized: true };
  }

  // =========================================
  // ENREGISTREMENT ET ACTIVATION
  // =========================================

  /**
   * Enregistre un nouveau serveur local
   */
  async registerServer(serverData) {
    const {
      geoId,
      name,
      ipAddress,
      port = 443,
      publicKey,
      capabilities = [],
      config = {}
    } = serverData;

    // Valider le geo_id
    if (!geoId || !/^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(geoId)) {
      throw new LocalServerError('INVALID_GEO_ID', 'Format geo_id invalide');
    }

    // Vérifier si un serveur existe déjà pour ce geo_id
    const existing = await this.LocalInstance.findOne({ where: { geo_id: geoId } });
    if (existing) {
      throw new LocalServerError('SERVER_EXISTS', 'Un serveur existe déjà pour ce geo_id');
    }

    // Générer un server_id unique
    const serverId = this._generateServerId(geoId);

    // Générer un secret partagé pour l'authentification
    const sharedSecret = crypto.randomBytes(32).toString('hex');
    const sharedSecretHash = crypto.createHash('sha256').update(sharedSecret).digest('hex');

    const server = await this.LocalInstance.create({
      geo_id: geoId,
      name,
      server_id: serverId,
      ip_address: ipAddress,
      port,
      status: SERVER_STATUS.INACTIVE,
      public_key: publicKey,
      shared_secret_hash: sharedSecretHash,
      capabilities,
      config,
      registered_at: new Date()
    });

    await this._logActivity('server_registered', {
      serverId: server.instance_id,
      geoId,
      name
    });

    return {
      instanceId: server.instance_id,
      serverId,
      sharedSecret, // À transmettre de manière sécurisée au serveur local
      status: server.status
    };
  }

  /**
   * Enregistre un serveur via token (Protocole Guilty Spark)
   * Utilisé par le script d'installation automatisé
   */
  async registerServerViaToken(serverData) {
    const {
      server_id,
      server_name,
      geo_id,
      server_type = 'local',
      shared_secret,
      version = '7.0.0',
      platform = 'unknown',
      capabilities = {},
      ip_address,
      user_agent
    } = serverData;

    const LocalInstance = this._getLocalInstance();
    if (!LocalInstance) {
      throw new LocalServerError('MODEL_NOT_FOUND', 'Modèle LocalInstance non disponible');
    }

    // Valider le geo_id (format: CC-PPP-ZZ-JJ-NN)
    if (!geo_id || !/^\d{2}-\d{3}-\d{2}-\d{2}-\d{2}$/.test(geo_id)) {
      throw new LocalServerError('INVALID_GEO_ID', 'Format geo_id invalide (attendu: CC-PPP-ZZ-JJ-NN)');
    }

    // Vérifier si un serveur existe déjà pour ce server_id
    const existingById = await LocalInstance.findOne({ where: { server_id } });
    if (existingById) {
      throw new LocalServerError('SERVER_ID_EXISTS', 'Ce server_id est déjà enregistré');
    }

    // Vérifier si un serveur existe déjà pour ce geo_id
    const existingByGeo = await LocalInstance.findOne({ where: { geo_id } });
    if (existingByGeo) {
      throw new LocalServerError('GEO_ID_EXISTS', 'Un serveur existe déjà pour ce geo_id');
    }

    // Hash du shared secret pour stockage
    const sharedSecretHash = crypto.createHash('sha256').update(shared_secret).digest('hex');

    // Créer le serveur
    const server = await LocalInstance.create({
      geo_id,
      name: server_name,
      server_id,
      server_type,
      ip_address: ip_address || 'unknown',
      status: SERVER_STATUS.ACTIVE, // Actif immédiatement via Guilty Spark
      shared_secret_hash: sharedSecretHash,
      version,
      capabilities: {
        sync: capabilities.sync !== false,
        offline_mode: capabilities.offline_mode !== false,
        vault: capabilities.vault !== false,
        plugins: capabilities.plugins !== false,
      },
      metadata: {
        registered_via: 'guilty_spark_protocol',
        platform,
        user_agent,
        registration_ip: ip_address
      },
      registered_at: new Date(),
      activated_at: new Date(),
      last_seen: new Date()
    });

    await this._logActivity('server_registered_via_token', {
      serverId: server.instance_id,
      server_id,
      geoId: geo_id,
      name: server_name,
      protocol: 'guilty_spark'
    });

    console.log(`[LocalServerService] Serveur enregistré via Guilty Spark: ${server_id} (${geo_id})`);

    return {
      instance_id: server.instance_id,
      server_id: server.server_id,
      geo_id: server.geo_id,
      status: server.status,
      registered_at: server.registered_at
    };
  }

  /**
   * Active un serveur enregistré
   */
  async activateServer(instanceId, activationData = {}) {
    const server = await this.LocalInstance.findByPk(instanceId);
    if (!server) {
      throw new LocalServerError('SERVER_NOT_FOUND', 'Serveur non trouvé');
    }

    if (server.status === SERVER_STATUS.ACTIVE) {
      throw new LocalServerError('ALREADY_ACTIVE', 'Serveur déjà actif');
    }

    // Vérifier la connectivité
    const isReachable = await this._checkConnectivity(server);
    if (!isReachable) {
      throw new LocalServerError('UNREACHABLE', 'Serveur inaccessible');
    }

    await server.activate();

    await this._logActivity('server_activated', {
      serverId: server.instance_id,
      geoId: server.geo_id
    });

    return {
      instanceId: server.instance_id,
      status: server.status,
      activatedAt: server.activated_at
    };
  }

  /**
   * Désactive un serveur
   */
  async deactivateServer(instanceId, reason = null) {
    const server = await this.LocalInstance.findByPk(instanceId);
    if (!server) {
      throw new LocalServerError('SERVER_NOT_FOUND', 'Serveur non trouvé');
    }

    await server.deactivate(reason);

    await this._logActivity('server_deactivated', {
      serverId: server.instance_id,
      geoId: server.geo_id,
      reason
    });

    return { success: true };
  }

  /**
   * Supprime un serveur
   */
  async deleteServer(instanceId) {
    const server = await this.LocalInstance.findByPk(instanceId);
    if (!server) {
      throw new LocalServerError('SERVER_NOT_FOUND', 'Serveur non trouvé');
    }

    if (server.status === SERVER_STATUS.ACTIVE) {
      throw new LocalServerError('STILL_ACTIVE', 'Désactivez le serveur avant suppression');
    }

    const geoId = server.geo_id;
    await server.destroy();

    await this._logActivity('server_deleted', {
      serverId: instanceId,
      geoId
    });

    return { success: true };
  }

  // =========================================
  // HEARTBEAT ET MONITORING
  // =========================================

  /**
   * Traite un heartbeat de serveur local
   */
  async handleHeartbeat(serverId, heartbeatData) {
    const { metrics, version, status } = heartbeatData;

    const server = await this.LocalInstance.findOne({
      where: { server_id: serverId }
    });

    if (!server) {
      throw new LocalServerError('SERVER_NOT_FOUND', 'Serveur non reconnu');
    }

    // Mettre à jour les métriques
    await server.updateHeartbeat({
      cpu: metrics?.cpu,
      memory: metrics?.memory,
      disk: metrics?.disk,
      users: metrics?.users
    });

    // Mettre à jour la version si différente
    if (version && version !== server.version) {
      await server.update({ version });
    }

    // Mettre en cache
    this._onlineCache.set(server.instance_id, {
      expiry: Date.now() + this._cacheTTL
    });

    return {
      acknowledged: true,
      serverTime: new Date().toISOString(),
      commands: await this._getPendingCommands(server.instance_id)
    };
  }

  /**
   * Vérifie si un serveur est en ligne
   */
  async isServerOnline(instanceId) {
    // Vérifier le cache d'abord
    const cached = this._onlineCache.get(instanceId);
    if (cached && cached.expiry > Date.now()) {
      return true;
    }

    const server = await this.LocalInstance.findByPk(instanceId);
    if (!server) return false;

    return server.isOnline();
  }

  /**
   * Récupère les serveurs offline
   */
  async getOfflineServers(thresholdMinutes = 10) {
    return await this.LocalInstance.findOffline(thresholdMinutes);
  }

  // =========================================
  // CONFIGURATION
  // =========================================

  /**
   * Met à jour la configuration d'un serveur
   */
  async updateServerConfig(instanceId, newConfig) {
    const server = await this.LocalInstance.findByPk(instanceId);
    if (!server) {
      throw new LocalServerError('SERVER_NOT_FOUND', 'Serveur non trouvé');
    }

    const mergedConfig = {
      ...server.config,
      ...newConfig
    };

    await server.update({ config: mergedConfig });

    // Planifier l'envoi de la config au serveur
    if (this._syncService && server.status === SERVER_STATUS.ACTIVE) {
      await this._syncService.enqueue({
        serverId: server.instance_id,
        operationType: 'sync',
        entityType: 'setting',
        entityId: server.instance_id,
        data: { config: mergedConfig },
        priority: 8
      });
    }

    await this._logActivity('server_config_updated', {
      serverId: server.instance_id
    });

    return { success: true, config: mergedConfig };
  }

  /**
   * Met à jour les capacités d'un serveur
   */
  async updateCapabilities(instanceId, capabilities) {
    const server = await this.LocalInstance.findByPk(instanceId);
    if (!server) {
      throw new LocalServerError('SERVER_NOT_FOUND', 'Serveur non trouvé');
    }

    await server.update({ capabilities });

    return { success: true, capabilities };
  }

  /**
   * Configure la fenêtre de maintenance
   */
  async setMaintenanceWindow(instanceId, window) {
    const server = await this.LocalInstance.findByPk(instanceId);
    if (!server) {
      throw new LocalServerError('SERVER_NOT_FOUND', 'Serveur non trouvé');
    }

    await server.update({ maintenance_window: window });

    return { success: true, maintenanceWindow: window };
  }

  // =========================================
  // RÉCUPÉRATION ET LISTE
  // =========================================

  /**
   * Récupère un serveur par ID
   */
  async getServer(instanceId) {
    const server = await this.LocalInstance.findByPk(instanceId);
    if (!server) {
      throw new LocalServerError('SERVER_NOT_FOUND', 'Serveur non trouvé');
    }

    return this._formatServer(server);
  }

  /**
   * Récupère un serveur par geo_id
   */
  async getServerByGeoId(geoId) {
    const server = await this.LocalInstance.findByGeoId(geoId);
    if (!server) return null;

    return this._formatServer(server);
  }

  /**
   * Liste tous les serveurs
   */
  async listServers(options = {}) {
    const { status, page = 1, limit = 50 } = options;

    const where = {};
    if (status) {
      where.status = status;
    }

    const { count, rows } = await this.LocalInstance.findAndCountAll({
      where,
      order: [['geo_id', 'ASC']],
      limit: Math.min(limit, 100),
      offset: (page - 1) * limit
    });

    return {
      servers: rows.map(s => this._formatServer(s)),
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    };
  }

  /**
   * Récupère les serveurs actifs
   */
  async getActiveServers() {
    const servers = await this.LocalInstance.findActive();
    return servers.map(s => this._formatServer(s));
  }

  // =========================================
  // STATISTIQUES ET MÉTRIQUES
  // =========================================

  /**
   * Récupère les métriques globales
   */
  async getGlobalMetrics() {
    return await this.LocalInstance.getMetrics();
  }

  /**
   * Récupère les métriques d'un serveur
   */
  async getServerMetrics(instanceId) {
    const server = await this.LocalInstance.findByPk(instanceId);
    if (!server) {
      throw new LocalServerError('SERVER_NOT_FOUND', 'Serveur non trouvé');
    }

    return {
      instanceId: server.instance_id,
      geoId: server.geo_id,
      status: server.status,
      isOnline: server.isOnline(),
      metrics: {
        cpu: server.cpu_usage,
        memory: server.memory_usage,
        disk: server.disk_usage,
        users: server.user_count
      },
      lastSeen: server.last_seen,
      uptime: server.activated_at
        ? Date.now() - server.activated_at.getTime()
        : 0
    };
  }

  /**
   * Récupère l'historique de disponibilité
   */
  async getAvailabilityHistory(instanceId, days = 30) {
    // À implémenter avec une table d'historique
    return {
      instanceId,
      period: days,
      availability: 99.5, // Placeholder
      downtimeMinutes: 0
    };
  }

  // =========================================
  // COMMANDES À DISTANCE
  // =========================================

  /**
   * Envoie une commande au serveur
   */
  async sendCommand(instanceId, command, params = {}) {
    const server = await this.LocalInstance.findByPk(instanceId);
    if (!server) {
      throw new LocalServerError('SERVER_NOT_FOUND', 'Serveur non trouvé');
    }

    if (!server.isOnline()) {
      throw new LocalServerError('SERVER_OFFLINE', 'Serveur hors ligne');
    }

    // Enregistrer la commande
    const commandId = crypto.randomBytes(8).toString('hex');

    const commandEntry = {
      id: commandId,
      command,
      params,
      createdAt: new Date(),
      status: 'pending'
    };

    // Stocker dans metadata
    const pendingCommands = server.metadata?.pendingCommands || [];
    pendingCommands.push(commandEntry);

    await server.update({
      metadata: {
        ...server.metadata,
        pendingCommands
      }
    });

    await this._logActivity('server_command_sent', {
      serverId: server.instance_id,
      command,
      commandId
    });

    return { commandId, status: 'pending' };
  }

  /**
   * Récupère les commandes en attente
   */
  async _getPendingCommands(instanceId) {
    const server = await this.LocalInstance.findByPk(instanceId);
    if (!server) return [];

    const commands = server.metadata?.pendingCommands || [];

    // Nettoyer les commandes envoyées
    if (commands.length > 0) {
      await server.update({
        metadata: {
          ...server.metadata,
          pendingCommands: []
        }
      });
    }

    return commands;
  }

  // =========================================
  // MÉTHODES PRIVÉES
  // =========================================

  _generateServerId(geoId) {
    const random = crypto.randomBytes(4).toString('hex');
    const sanitizedGeoId = geoId.replace(/-/g, '');
    return `shugo_${sanitizedGeoId}_${random}`;
  }

  async _checkConnectivity(server) {
    try {
      const https = require('https');
      const url = server.api_endpoint ||
        `https://${server.ip_address}:${server.port}/api/v1/health`;

      return new Promise((resolve) => {
        const req = https.get(url, {
          timeout: 5000,
          rejectUnauthorized: false
        }, (res) => {
          resolve(res.statusCode === 200);
        });

        req.on('error', () => resolve(false));
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
      });
    } catch (error) {
      return false;
    }
  }

  _formatServer(server) {
    return {
      instanceId: server.instance_id,
      serverId: server.server_id,
      geoId: server.geo_id,
      name: server.name,
      status: server.status,
      version: server.version,
      isOnline: server.isOnline ? server.isOnline() : false,
      endpoint: server.api_endpoint,
      capabilities: server.capabilities,
      metrics: {
        cpu: server.cpu_usage,
        memory: server.memory_usage,
        disk: server.disk_usage,
        users: server.user_count
      },
      lastSeen: server.last_seen,
      registeredAt: server.registered_at,
      activatedAt: server.activated_at
    };
  }

  async _logActivity(action, data) {
    try {
      if (this._auditService) {
        await this._auditService.logOperation(action, {
          module: 'local_servers',
          ...data
        });
      }
    } catch (err) {
      console.error('[LocalServerService] Erreur audit:', err.message);
    }
  }
}

class LocalServerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LocalServerError';
    this.code = code;
  }
}

// Création d'une instance singleton pour utilisation dans les routes
// Les routes utilisent LocalServerService.method() comme des méthodes statiques
const singletonInstance = new LocalServerService({});

// Proxy pour permettre l'utilisation en tant que classe ou instance singleton
const LocalServerServiceProxy = new Proxy(LocalServerService, {
  get(target, prop) {
    // Si c'est une propriété de la classe elle-même (static ou constructor)
    if (prop in target) {
      return target[prop];
    }
    // Sinon, déléguer à l'instance singleton
    if (prop in singletonInstance) {
      const value = singletonInstance[prop];
      return typeof value === 'function' ? value.bind(singletonInstance) : value;
    }
    return undefined;
  }
});

module.exports = LocalServerServiceProxy;
module.exports.LocalServerService = LocalServerService;
module.exports.LocalServerError = LocalServerError;
module.exports.SERVER_STATUS = SERVER_STATUS;
module.exports.SERVER_CAPABILITIES = SERVER_CAPABILITIES;
