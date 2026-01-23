'use strict';

/**
 * Service Porte de Grange - Isolation Réseau
 * @see Document Technique V7.0 - Section 8.4
 */

const { Op } = require('sequelize');

const ISOLATION_STATUS = { ACTIVE: 'active', ISOLATED: 'isolated', MAINTENANCE: 'maintenance', RECONNECTING: 'reconnecting' };

class PorteDeGrangeService {
  constructor(models, sequelize, services = {}) {
    this.models = models;
    this.sequelize = sequelize;
    this.notificationService = services.notification;
    this._isolatedServers = new Map();
  }

  async isolateServer(serverId, adminId, options = {}) {
    const { reason = 'Isolation manuelle', disconnectUsers = true } = options;
    console.log(`[Porte de Grange] Isolation du serveur ${serverId}`);

    const server = await this.models.LocalInstance.findOne({ where: { server_id: serverId } });
    if (!server) throw new PorteDeGrangeError('SERVER_NOT_FOUND', 'Serveur non trouvé');

    const protocolLog = await this.models.SecurityProtocolLog.create({
      protocol_name: 'porte_de_grange', triggered_by: 'manual', member_id: adminId, scope: 'local',
      reason, actions_taken: [], result: 'pending', started_at: new Date()
    });

    const actions = [];
    try {
      if (disconnectUsers) {
        const [count] = await this.models.Session.update({ is_active: false, logout_reason: 'maintenance' }, { where: { is_active: true } });
        actions.push({ action: 'disconnect_users', count });
      }
      global[`SHUGO_SERVER_ISOLATED_${serverId}`] = true;
      await server.update({ status: ISOLATION_STATUS.ISOLATED });
      this._isolatedServers.set(serverId, { isolatedAt: new Date(), reason, isolatedBy: adminId });
      
      if (this.notificationService) {
        const admins = await this.models.User.findAll({ where: { role: { [Op.in]: ['Admin', 'Admin_N1'] }, status: 'active' } });
        for (const admin of admins) {
          try { await this.notificationService.send(admin.member_id, 'system_alert', { type: 'server_isolated', serverId, reason }, { priority: 'high', immediate: true }); } catch (e) {}
        }
      }

      await protocolLog.update({ actions_taken: actions, result: 'success', completed_at: new Date() });
      await this.models.AuditLog.create({ member_id: adminId, action: 'server_isolated', resource_type: 'server', resource_id: serverId, result: 'success' });
      
      return { success: true, serverId, status: ISOLATION_STATUS.ISOLATED, protocolId: protocolLog.protocol_log_id, actions };
    } catch (error) {
      await protocolLog.update({ result: 'failed', completed_at: new Date() });
      throw new PorteDeGrangeError('ISOLATION_FAILED', error.message);
    }
  }

  async isolateMultiple(serverIds, adminId, options = {}) {
    const results = [];
    for (const serverId of serverIds) {
      try {
        const result = await this.isolateServer(serverId, adminId, options);
        results.push({ serverId, success: true, ...result });
      } catch (err) {
        results.push({ serverId, success: false, error: err.message });
      }
    }
    return { totalRequested: serverIds.length, isolated: results.filter(r => r.success).length, results };
  }

  async reconnectServer(serverId, adminId, options = {}) {
    console.log(`[Porte de Grange] Réintégration du serveur ${serverId}`);
    const server = await this.models.LocalInstance.findOne({ where: { server_id: serverId } });
    if (!server) throw new PorteDeGrangeError('SERVER_NOT_FOUND', 'Serveur non trouvé');
    if (server.status !== ISOLATION_STATUS.ISOLATED) throw new PorteDeGrangeError('NOT_ISOLATED', 'Le serveur n\'est pas isolé');

    try {
      await server.update({ status: ISOLATION_STATUS.RECONNECTING });
      delete global[`SHUGO_SERVER_ISOLATED_${serverId}`];
      await server.update({ status: ISOLATION_STATUS.ACTIVE, last_seen: new Date() });
      this._isolatedServers.delete(serverId);
      await this.models.AuditLog.create({ member_id: adminId, action: 'server_reconnected', resource_type: 'server', resource_id: serverId, result: 'success' });
      return { success: true, serverId, status: ISOLATION_STATUS.ACTIVE };
    } catch (error) {
      throw new PorteDeGrangeError('RECONNECTION_FAILED', error.message);
    }
  }

  getIsolatedServers() { return Array.from(this._isolatedServers.entries()).map(([serverId, info]) => ({ serverId, ...info })); }
  isIsolated(serverId) { return this._isolatedServers.has(serverId) || !!global[`SHUGO_SERVER_ISOLATED_${serverId}`]; }
  
  async getStatus() {
    const servers = await this.models.LocalInstance.findAll({ where: { status: ISOLATION_STATUS.ISOLATED } });
    return { isolatedCount: servers.length, servers: servers.map(s => ({ serverId: s.server_id, geoId: s.geo_id })) };
  }
}

class PorteDeGrangeError extends Error { constructor(code, message) { super(message); this.name = 'PorteDeGrangeError'; this.code = code; } }

module.exports = PorteDeGrangeService;
module.exports.PorteDeGrangeError = PorteDeGrangeError;
module.exports.ISOLATION_STATUS = ISOLATION_STATUS;
