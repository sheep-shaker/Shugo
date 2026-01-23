'use strict';

/**
 * SHUGO v7.0 - Job de synchronisation des serveurs locaux
 *
 * Exécution: Toutes les 2 minutes
 * - Traite la file de synchronisation
 * - Vérifie la connectivité des serveurs locaux
 * - Gère les retry des opérations échouées
 * - Déclenche la resynchronisation si nécessaire
 *
 * @see Document Technique V7.0 - Section 6.2
 */

const cron = require('node-cron');
const { Op } = require('sequelize');

const DEFAULT_CONFIG = {
  schedule: '*/2 * * * *',      // Toutes les 2 minutes
  batchSize: 100,               // Opérations par batch
  maxRetries: 3,                // Tentatives max par opération
  serverTimeout: 10000,         // Timeout connexion serveur (ms)
  enabled: true
};

class SyncLocalServersJob {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cronJob = null;
    this.isRunning = false;
    this.lastRun = null;
    this.stats = {
      runs: 0,
      operationsProcessed: 0,
      operationsFailed: 0,
      serversChecked: 0,
      serversOffline: 0
    };
  }

  async start() {
    if (this.cronJob) {
      console.log('[SyncLocalServersJob] Déjà démarré');
      return;
    }

    if (!this.config.enabled) {
      console.log('[SyncLocalServersJob] Désactivé par configuration');
      return;
    }

    this.cronJob = cron.schedule(this.config.schedule, async () => {
      await this.execute();
    }, { scheduled: true });

    console.log(`[SyncLocalServersJob] Démarré (${this.config.schedule})`);
  }

  async stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    console.log('[SyncLocalServersJob] Arrêté');
  }

  async execute() {
    if (this.isRunning) {
      console.log('[SyncLocalServersJob] Déjà en cours');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      console.log('[SyncLocalServersJob] Début synchronisation...');

      const models = require('../models');
      const { LocalInstance, LocalSyncQueue } = models;

      if (!LocalInstance || !LocalSyncQueue) {
        console.log('[SyncLocalServersJob] Modèles non disponibles');
        return { processed: 0, failed: 0 };
      }

      const results = {
        serversOnline: 0,
        serversOffline: 0,
        operationsProcessed: 0,
        operationsFailed: 0,
        operationsRetried: 0
      };

      // 1. Vérifier les serveurs actifs
      const servers = await LocalInstance.findAll({
        where: { status: 'active' }
      });

      this.stats.serversChecked += servers.length;

      for (const server of servers) {
        const isOnline = server.isOnline ? server.isOnline() : this._checkServerOnline(server);

        if (isOnline) {
          results.serversOnline++;

          // Traiter les opérations en attente pour ce serveur
          const operations = await LocalSyncQueue.findAll({
            where: {
              server_id: server.instance_id,
              status: { [Op.in]: ['pending', 'retry'] },
              retry_count: { [Op.lt]: this.config.maxRetries }
            },
            order: [['priority', 'DESC'], ['created_at', 'ASC']],
            limit: this.config.batchSize
          });

          for (const op of operations) {
            try {
              await this._processOperation(op, server);
              results.operationsProcessed++;
              this.stats.operationsProcessed++;
            } catch (error) {
              results.operationsFailed++;
              this.stats.operationsFailed++;
              await this._handleOperationFailure(op, error);
            }
          }
        } else {
          results.serversOffline++;
          this.stats.serversOffline++;

          // Marquer les opérations comme retry si le serveur est offline
          await LocalSyncQueue.update(
            { status: 'retry' },
            {
              where: {
                server_id: server.instance_id,
                status: 'pending'
              }
            }
          );
        }
      }

      // 2. Traiter les opérations broadcast (sans serveur spécifique)
      const broadcastOps = await LocalSyncQueue.findAll({
        where: {
          server_id: null,
          status: { [Op.in]: ['pending', 'retry'] }
        },
        order: [['priority', 'DESC'], ['created_at', 'ASC']],
        limit: this.config.batchSize
      });

      for (const op of broadcastOps) {
        try {
          await this._processBroadcastOperation(op, servers.filter(s => s.isOnline ? s.isOnline() : true));
          results.operationsProcessed++;
        } catch (error) {
          results.operationsFailed++;
          await this._handleOperationFailure(op, error);
        }
      }

      // 3. Nettoyer les opérations terminées anciennes
      await this._cleanupCompletedOperations(LocalSyncQueue);

      this.stats.runs++;
      this.lastRun = new Date();

      const duration = Date.now() - startTime;
      console.log(`[SyncLocalServersJob] Terminé en ${duration}ms:`, results);

      return results;

    } catch (error) {
      console.error('[SyncLocalServersJob] Erreur:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  _checkServerOnline(server) {
    if (!server.last_seen) return false;
    const timeSinceLastSeen = Date.now() - server.last_seen.getTime();
    const heartbeatInterval = server.heartbeat_interval || 300;
    return timeSinceLastSeen < (heartbeatInterval * 2 * 1000);
  }

  async _processOperation(operation, server) {
    // Marquer comme en cours
    await operation.update({ status: 'processing' });

    try {
      // Envoyer au serveur local
      const result = await this._sendToServer(server, operation);

      // Marquer comme terminé
      await operation.update({
        status: 'completed',
        processed_at: new Date(),
        acknowledged_at: new Date()
      });

      return result;
    } catch (error) {
      // Remettre en pending pour retry
      await operation.update({ status: 'pending' });
      throw error;
    }
  }

  async _processBroadcastOperation(operation, onlineServers) {
    if (onlineServers.length === 0) {
      throw new Error('Aucun serveur en ligne');
    }

    await operation.update({ status: 'processing' });

    const results = [];
    let successCount = 0;

    for (const server of onlineServers) {
      try {
        await this._sendToServer(server, operation);
        results.push({ serverId: server.instance_id, success: true });
        successCount++;
      } catch (error) {
        results.push({ serverId: server.instance_id, success: false, error: error.message });
      }
    }

    if (successCount > 0) {
      await operation.update({
        status: 'completed',
        processed_at: new Date(),
        metadata: { ...operation.metadata, broadcastResults: results }
      });
    } else {
      await operation.update({ status: 'pending' });
      throw new Error('Broadcast échoué sur tous les serveurs');
    }

    return results;
  }

  async _sendToServer(server, operation) {
    // Construire le payload
    const payload = {
      syncId: operation.sync_id,
      operation: operation.operation_type,
      entityType: operation.entity_type,
      entityId: operation.entity_id,
      data: operation.data,
      checksum: operation.checksum,
      timestamp: new Date().toISOString()
    };

    // Endpoint du serveur
    const endpoint = server.api_endpoint ||
      `https://${server.ip_address}:${server.port || 443}/api/v1`;

    // Envoyer la requête
    const https = require('https');
    const url = new URL(`${endpoint}/sync/receive`);

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Server-ID': server.server_id,
          'X-Sync-ID': operation.sync_id.toString()
        },
        timeout: this.config.serverTimeout,
        rejectUnauthorized: false
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, body: data });
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });

      req.write(JSON.stringify(payload));
      req.end();
    });
  }

  async _handleOperationFailure(operation, error) {
    const retryCount = (operation.retry_count || 0) + 1;

    if (retryCount >= this.config.maxRetries) {
      await operation.update({
        status: 'failed',
        retry_count: retryCount,
        error_message: error.message
      });

      // Logger l'échec définitif
      try {
        const { AuditLog } = require('../models');
        if (AuditLog) {
          await AuditLog.create({
            action_type: 'sync.failed',
            entity_type: 'sync_operation',
            entity_id: operation.sync_id,
            severity: 'error',
            details: {
              entityType: operation.entity_type,
              entityId: operation.entity_id,
              error: error.message,
              retryCount
            }
          });
        }
      } catch (e) {
        console.error('[SyncLocalServersJob] Erreur log:', e.message);
      }
    } else {
      await operation.update({
        status: 'retry',
        retry_count: retryCount,
        error_message: error.message
      });
    }
  }

  async _cleanupCompletedOperations(LocalSyncQueue) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 7); // Garder 7 jours

      const deleted = await LocalSyncQueue.destroy({
        where: {
          status: { [Op.in]: ['completed', 'failed'] },
          created_at: { [Op.lt]: cutoffDate }
        }
      });

      if (deleted > 0) {
        console.log(`[SyncLocalServersJob] ${deleted} opérations anciennes supprimées`);
      }
    } catch (error) {
      console.error('[SyncLocalServersJob] Erreur nettoyage:', error.message);
    }
  }

  async runManual() {
    console.log('[SyncLocalServersJob] Exécution manuelle demandée');
    return await this.execute();
  }

  getStatus() {
    return {
      name: 'syncLocalServers',
      enabled: this.config.enabled,
      schedule: this.config.schedule,
      running: this.isRunning,
      lastRun: this.lastRun,
      stats: { ...this.stats }
    };
  }
}

module.exports = new SyncLocalServersJob();
module.exports.SyncLocalServersJob = SyncLocalServersJob;
