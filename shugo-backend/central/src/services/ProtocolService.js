'use strict';

/**
 * SHUGO v7.0 - Protocol Service
 *
 * Service principal pour l'orchestration des protocoles système.
 * Gère l'activation, la désactivation et le monitoring des protocoles de sécurité.
 *
 * @see Document Technique V7.0 - Chapitre 8
 */

const { Op } = require('sequelize');
const { SecurityProtocolLog, AuditLog, User, LocalInstance } = require('../models');

// Import des services de protocoles
const GuiltySparkService = require('./protocols/GuiltySparkService');
const CendreBlancheService = require('./protocols/CendreBlancheService');
const PapierFroisseService = require('./protocols/PapierFroisseService');
const PorteDeGrangeService = require('./protocols/PorteDeGrangeService');
const UpsideModeService = require('./protocols/UpsideModeService');
const CleTotemService = require('./protocols/CleTotemService');

// Module d'integrite (interne)
const { DataIntegrityManager } = require('../core/integrity');

/**
 * Types de protocoles
 */
const PROTOCOL_TYPES = {
  GUILTY_SPARK: 'guilty_spark',
  CENDRE_BLANCHE: 'cendre_blanche',
  PAPIER_FROISSE: 'papier_froisse',
  PORTE_DE_GRANGE: 'porte_de_grange',
  UPSIDE_MODE: 'upside_mode',
  CLE_TOTEM: 'cle_totem'
};

/**
 * Priorites des protocoles (1 = plus haute)
 */
const PROTOCOL_PRIORITIES = {
  [PROTOCOL_TYPES.GUILTY_SPARK]: 1,    // Lockdown systeme
  [PROTOCOL_TYPES.CENDRE_BLANCHE]: 2,  // Sanitization d'urgence
  [PROTOCOL_TYPES.PORTE_DE_GRANGE]: 3, // Isolation serveur
  [PROTOCOL_TYPES.CLE_TOTEM]: 4,       // Override admin
  [PROTOCOL_TYPES.PAPIER_FROISSE]: 5,  // Tracabilite
  [PROTOCOL_TYPES.UPSIDE_MODE]: 6      // Mode degrade
};

/**
 * États possibles des protocoles
 */
const PROTOCOL_STATES = {
  INACTIVE: 'inactive',
  PENDING: 'pending',
  ACTIVE: 'active',
  COOLDOWN: 'cooldown',
  DISABLED: 'disabled'
};

class ProtocolService {
  constructor(models, sequelize, dependencies = {}) {
    this.models = models;
    this.sequelize = sequelize;
    this.notification = dependencies.notification;
    this.vault = dependencies.vault;
    this.audit = dependencies.audit;

    // Mapping des services de protocoles
    this.protocolServices = {
      [PROTOCOL_TYPES.GUILTY_SPARK]: dependencies.guiltySpark || GuiltySparkService,
      [PROTOCOL_TYPES.CENDRE_BLANCHE]: dependencies.cendreBlanche || CendreBlancheService,
      [PROTOCOL_TYPES.PAPIER_FROISSE]: dependencies.papierFroisse || PapierFroisseService,
      [PROTOCOL_TYPES.PORTE_DE_GRANGE]: dependencies.porteDeGrange || PorteDeGrangeService,
      [PROTOCOL_TYPES.UPSIDE_MODE]: dependencies.upsideMode || UpsideModeService,
      [PROTOCOL_TYPES.CLE_TOTEM]: dependencies.cleTotem || CleTotemService
    };

    // Module interne (non expose)
    this._dim = dependencies._dim || null;

    // Cache des états actifs
    this.activeProtocols = new Map();
  }

  /**
   * Obtient le service pour un protocole
   */
  getProtocolService(protocolType) {
    const service = this.protocolServices[protocolType];
    if (!service) {
      throw new Error(`Protocole inconnu: ${protocolType}`);
    }
    return service;
  }

  /**
   * Active un protocole système
   */
  async activateProtocol({ protocol_type, level, scope, reason, triggered_by_member_id, params = {} }) {
    const transaction = await this.sequelize.transaction();

    try {
      // Vérifier si un protocole de priorité supérieure est actif
      const conflictingProtocol = await this.checkProtocolConflicts(protocol_type);
      if (conflictingProtocol) {
        throw new Error(`Protocole ${conflictingProtocol} de priorité supérieure en cours`);
      }

      // Obtenir le service du protocole
      const protocolService = this.getProtocolService(protocol_type);

      // Activer via le service spécifique
      const activation = await protocolService.activate({
        level,
        scope,
        reason,
        triggered_by_member_id,
        ...params
      });

      // Logger dans SecurityProtocolLog
      const log = await SecurityProtocolLog.create({
        protocol_type,
        action: 'activate',
        level,
        scope_type: scope.type,
        scope_value: scope.value,
        triggered_by_member_id,
        reason,
        details: {
          params,
          activation_result: activation
        },
        status: 'active'
      }, { transaction });

      // Audit
      await AuditLog.create({
        action_type: `protocol.${protocol_type}.activate`,
        member_id: triggered_by_member_id,
        entity_type: 'security_protocol',
        entity_id: log.log_id,
        severity: 'critical',
        details: { protocol_type, level, scope, reason }
      }, { transaction });

      // Mettre à jour le cache
      this.activeProtocols.set(protocol_type, {
        log_id: log.log_id,
        level,
        scope,
        activated_at: new Date()
      });

      // Notifier les administrateurs
      await this.notifyProtocolActivation(protocol_type, level, scope, reason);

      await transaction.commit();

      return {
        success: true,
        log_id: log.log_id,
        protocol_type,
        level,
        scope,
        status: 'active'
      };

    } catch (error) {
      await transaction.rollback();
      console.error(`Erreur activation protocole ${protocol_type}:`, error);
      throw error;
    }
  }

  /**
   * Désactive un protocole système
   */
  async deactivateProtocol({ protocol_type, deactivated_by_member_id, reason, authorization_code }) {
    const transaction = await this.sequelize.transaction();

    try {
      // Vérifier que le protocole est actif
      const activeLog = await SecurityProtocolLog.findOne({
        where: {
          protocol_type,
          status: 'active'
        },
        order: [['created_at', 'DESC']]
      });

      if (!activeLog) {
        throw new Error(`Protocole ${protocol_type} non actif`);
      }

      // Vérifier l'autorisation pour certains protocoles
      if ([PROTOCOL_TYPES.SYS_INT_001, PROTOCOL_TYPES.SYS_INT_002, PROTOCOL_TYPES.SYS_INT_003, PROTOCOL_TYPES.GUILTY_SPARK].includes(protocol_type)) {
        const isAuthorized = await this.verifyDeactivationAuthorization(
          protocol_type,
          deactivated_by_member_id,
          authorization_code
        );
        if (!isAuthorized) {
          throw new Error('Autorisation insuffisante pour désactiver ce protocole');
        }
      }

      // Obtenir le service du protocole
      const protocolService = this.getProtocolService(protocol_type);

      // Désactiver via le service spécifique
      await protocolService.deactivate({
        log_id: activeLog.log_id,
        deactivated_by_member_id,
        reason
      });

      // Mettre à jour le log
      await activeLog.update({
        status: 'deactivated',
        deactivated_at: new Date(),
        deactivated_by_member_id,
        deactivation_reason: reason
      }, { transaction });

      // Audit
      await AuditLog.create({
        action_type: `protocol.${protocol_type}.deactivate`,
        member_id: deactivated_by_member_id,
        entity_type: 'security_protocol',
        entity_id: activeLog.log_id,
        severity: 'critical',
        details: { protocol_type, reason }
      }, { transaction });

      // Retirer du cache
      this.activeProtocols.delete(protocol_type);

      // Notifier
      await this.notifyProtocolDeactivation(protocol_type, reason);

      await transaction.commit();

      return {
        success: true,
        log_id: activeLog.log_id,
        protocol_type,
        status: 'deactivated'
      };

    } catch (error) {
      await transaction.rollback();
      console.error(`Erreur désactivation protocole ${protocol_type}:`, error);
      throw error;
    }
  }

  /**
   * Obtient le statut de tous les protocoles
   */
  async getProtocolStatus() {
    try {
      const status = {};

      for (const protocolType of Object.values(PROTOCOL_TYPES)) {
        const activeLog = await SecurityProtocolLog.findOne({
          where: {
            protocol_type: protocolType,
            status: 'active'
          },
          order: [['created_at', 'DESC']]
        });

        if (activeLog) {
          status[protocolType] = {
            state: PROTOCOL_STATES.ACTIVE,
            log_id: activeLog.log_id,
            level: activeLog.level,
            scope: {
              type: activeLog.scope_type,
              value: activeLog.scope_value
            },
            activated_at: activeLog.created_at,
            triggered_by: activeLog.triggered_by_member_id
          };
        } else {
          status[protocolType] = {
            state: PROTOCOL_STATES.INACTIVE,
            last_activation: await this.getLastActivation(protocolType)
          };
        }
      }

      return {
        protocols: status,
        active_count: Object.values(status).filter(s => s.state === PROTOCOL_STATES.ACTIVE).length,
        timestamp: new Date()
      };

    } catch (error) {
      console.error('Erreur récupération statut protocoles:', error);
      throw error;
    }
  }

  /**
   * Obtient le statut d'un protocole spécifique
   */
  async getProtocolDetail(protocolType) {
    try {
      const protocolService = this.getProtocolService(protocolType);

      // Logs récents
      const recentLogs = await SecurityProtocolLog.findAll({
        where: { protocol_type: protocolType },
        order: [['created_at', 'DESC']],
        limit: 10,
        include: [{
          model: User,
          as: 'triggeredBy',
          attributes: ['member_id', 'first_name', 'last_name']
        }]
      });

      // Statut actuel
      const currentStatus = await this.getProtocolStatus();

      // Statistiques
      const stats = await this.getProtocolStats(protocolType);

      return {
        protocol_type: protocolType,
        priority: PROTOCOL_PRIORITIES[protocolType],
        status: currentStatus.protocols[protocolType],
        recent_logs: recentLogs,
        stats,
        description: this.getProtocolDescription(protocolType)
      };

    } catch (error) {
      console.error(`Erreur détail protocole ${protocolType}:`, error);
      throw error;
    }
  }

  /**
   * Vérifie les conflits entre protocoles
   */
  async checkProtocolConflicts(newProtocolType) {
    const newPriority = PROTOCOL_PRIORITIES[newProtocolType];

    for (const [activeType, data] of this.activeProtocols) {
      const activePriority = PROTOCOL_PRIORITIES[activeType];
      if (activePriority < newPriority) {
        return activeType;
      }
    }

    // Vérifier aussi en base de données
    const activeProtocols = await SecurityProtocolLog.findAll({
      where: { status: 'active' }
    });

    for (const protocol of activeProtocols) {
      const activePriority = PROTOCOL_PRIORITIES[protocol.protocol_type];
      if (activePriority < newPriority) {
        return protocol.protocol_type;
      }
    }

    return null;
  }

  /**
   * Vérifie l'autorisation de désactivation
   */
  async verifyDeactivationAuthorization(protocolType, memberId, authCode) {
    // Vérifier le rôle de l'utilisateur
    const user = await User.findByPk(memberId);
    if (!user) return false;

    // Pour GUILTY_SPARK, admin ou root_admin
    if (protocolType === PROTOCOL_TYPES.GUILTY_SPARK) {
      return ['admin', 'root_admin'].includes(user.role);
    }

    return true;
  }

  /**
   * Obtient la dernière activation d'un protocole
   */
  async getLastActivation(protocolType) {
    const lastLog = await SecurityProtocolLog.findOne({
      where: { protocol_type: protocolType },
      order: [['created_at', 'DESC']]
    });

    return lastLog ? {
      log_id: lastLog.log_id,
      activated_at: lastLog.created_at,
      deactivated_at: lastLog.deactivated_at,
      duration_minutes: lastLog.deactivated_at
        ? Math.round((new Date(lastLog.deactivated_at) - new Date(lastLog.created_at)) / 60000)
        : null
    } : null;
  }

  /**
   * Obtient les statistiques d'un protocole
   */
  async getProtocolStats(protocolType) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const logs = await SecurityProtocolLog.findAll({
      where: {
        protocol_type: protocolType,
        created_at: { [Op.gte]: thirtyDaysAgo }
      }
    });

    const activations = logs.filter(l => l.action === 'activate');
    const durations = logs
      .filter(l => l.deactivated_at)
      .map(l => (new Date(l.deactivated_at) - new Date(l.created_at)) / 60000);

    return {
      activations_30d: activations.length,
      avg_duration_minutes: durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0,
      max_duration_minutes: durations.length > 0 ? Math.round(Math.max(...durations)) : 0,
      last_30_days_logs: logs.length
    };
  }

  /**
   * Description des protocoles
   */
  getProtocolDescription(protocolType) {
    const descriptions = {
      [PROTOCOL_TYPES.GUILTY_SPARK]: {
        name: 'Guilty Spark',
        description: 'Lockdown système complet',
        severity: 'HAUTE',
        requires_authorization: true
      },
      [PROTOCOL_TYPES.CENDRE_BLANCHE]: {
        name: 'Cendre Blanche',
        description: 'Sanitization d\'urgence des données sensibles',
        severity: 'HAUTE',
        requires_authorization: false
      },
      [PROTOCOL_TYPES.PAPIER_FROISSE]: {
        name: 'Papier Froissé',
        description: 'Mode traçabilité renforcée',
        severity: 'MOYENNE',
        requires_authorization: false
      },
      [PROTOCOL_TYPES.PORTE_DE_GRANGE]: {
        name: 'Porte de Grange',
        description: 'Isolation d\'un serveur local',
        severity: 'MOYENNE',
        requires_authorization: false
      },
      [PROTOCOL_TYPES.UPSIDE_MODE]: {
        name: 'Upside Mode',
        description: 'Mode dégradé pour continuité de service',
        severity: 'BASSE',
        requires_authorization: false
      },
      [PROTOCOL_TYPES.CLE_TOTEM]: {
        name: 'Clé Totem',
        description: 'Override administrateur temporaire',
        severity: 'HAUTE',
        requires_authorization: false
      }
    };

    return descriptions[protocolType] || { name: protocolType, description: 'Inconnu' };
  }

  /**
   * Notifie l'activation d'un protocole
   */
  async notifyProtocolActivation(protocolType, level, scope, reason) {
    if (!this.notification) return;

    const desc = this.getProtocolDescription(protocolType);

    // Notifier tous les admins
    const admins = await User.findAll({
      where: { role: { [Op.in]: ['admin', 'root_admin'] } }
    });

    for (const admin of admins) {
      await this.notification.send({
        user_id: admin.member_id,
        type: 'protocol_activated',
        title: `Protocole ${desc.name} activé`,
        message: `Niveau: ${level}, Raison: ${reason}`,
        priority: 'critical',
        data: { protocol_type: protocolType, level, scope }
      });
    }
  }

  /**
   * Notifie la désactivation d'un protocole
   */
  async notifyProtocolDeactivation(protocolType, reason) {
    if (!this.notification) return;

    const desc = this.getProtocolDescription(protocolType);

    const admins = await User.findAll({
      where: { role: { [Op.in]: ['admin', 'root_admin'] } }
    });

    for (const admin of admins) {
      await this.notification.send({
        user_id: admin.member_id,
        type: 'protocol_deactivated',
        title: `Protocole ${desc.name} désactivé`,
        message: reason,
        priority: 'high',
        data: { protocol_type: protocolType }
      });
    }
  }

  /**
   * Historique des protocoles
   */
  async getProtocolHistory({ protocol_type, date_from, date_to, page = 1, limit = 50 }) {
    try {
      const where = {};

      if (protocol_type) {
        where.protocol_type = protocol_type;
      }

      if (date_from || date_to) {
        where.created_at = {};
        if (date_from) where.created_at[Op.gte] = new Date(date_from);
        if (date_to) where.created_at[Op.lte] = new Date(date_to);
      }

      const offset = (page - 1) * limit;

      const { count, rows } = await SecurityProtocolLog.findAndCountAll({
        where,
        limit,
        offset,
        order: [['created_at', 'DESC']],
        include: [{
          model: User,
          as: 'triggeredBy',
          attributes: ['member_id', 'first_name', 'last_name']
        }]
      });

      return {
        data: rows,
        total: count,
        page,
        pages: Math.ceil(count / limit)
      };

    } catch (error) {
      console.error('Erreur historique protocoles:', error);
      throw error;
    }
  }
}

module.exports = ProtocolService;
module.exports.PROTOCOL_TYPES = PROTOCOL_TYPES;
module.exports.PROTOCOL_PRIORITIES = PROTOCOL_PRIORITIES;
module.exports.PROTOCOL_STATES = PROTOCOL_STATES;
