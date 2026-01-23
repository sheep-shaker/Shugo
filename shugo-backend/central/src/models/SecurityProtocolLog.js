'use strict';

/**
 * Modèle SecurityProtocolLog - Logs des protocoles de sécurité
 *
 * Trace toutes les activations de protocoles de securite
 * et les opérations sensibles (rotation clés, accès Vault, etc.).
 *
 * @see Document Technique V7.0 - Section 8
 */

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SecurityProtocolLog = sequelize.define('SecurityProtocolLog', {
    protocol_log_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique du log'
    },
    protocol_name: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: 'Nom du protocole: SYS-INT-001, SYS-INT-002, SYS-INT-003, guilty_spark, cendre_blanche, papier_froisse, porte_de_grange, upside_mode, cle_totem, key_rotation, secret_rotation, vault_access, emergency_access'
    },
    protocol_level: {
      type: DataTypes.STRING(16),
      allowNull: true,
      comment: 'Niveau si applicable: 1, 2, 3'
    },
    triggered_by: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'automatic',
      comment: 'Déclenchement: automatic, manual, scheduled, emergency'
    },
    member_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'member_id de l\'initiateur (null si automatique)'
    },
    scope: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'central',
      comment: 'Portée: local, central, local_and_central, global'
    },
    geo_id: {
      type: DataTypes.STRING(16),
      allowNull: true,
      comment: 'Scope géographique'
    },
    local_server_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Serveur local concerné'
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Raison du déclenchement'
    },
    trigger_details: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {},
      comment: 'Détails du déclencheur (anomalie détectée, etc.)'
    },
    actions_taken: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Liste des actions effectuées'
    },
    affected_entities: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {},
      comment: 'Entités affectées (users, sessions, keys, etc.)'
    },
    result: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'pending',
      comment: 'Résultat: pending, success, partial, failed, cancelled'
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Message d\'erreur si échec'
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: 'Début de l\'exécution'
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Fin de l\'exécution'
    },
    duration_ms: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Durée en millisecondes'
    },
    ip_address: {
      type: DataTypes.STRING(45),
      allowNull: true,
      comment: 'Adresse IP de l\'initiateur'
    },
    user_agent: {
      type: DataTypes.STRING(512),
      allowNull: true,
      comment: 'User-Agent si applicable'
    },
    severity: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'medium',
      comment: 'Sévérité: low, medium, high, critical'
    },
    requires_follow_up: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Si true, nécessite un suivi'
    },
    follow_up_notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Notes de suivi'
    },
    acknowledged_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'acquittement'
    },
    acknowledged_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'member_id ayant acquitté'
    }
  }, {
    tableName: 'security_protocols_log',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['protocol_name', 'created_at'],
        name: 'idx_security_log_name_date'
      },
      {
        fields: ['triggered_by', 'created_at'],
        name: 'idx_security_log_trigger_date'
      },
      {
        fields: ['member_id'],
        name: 'idx_security_log_member'
      },
      {
        fields: ['scope', 'geo_id'],
        name: 'idx_security_log_scope_geo'
      },
      {
        fields: ['local_server_id'],
        name: 'idx_security_log_server'
      },
      {
        fields: ['result'],
        name: 'idx_security_log_result'
      },
      {
        fields: ['severity'],
        name: 'idx_security_log_severity'
      },
      {
        fields: ['requires_follow_up'],
        where: { requires_follow_up: true },
        name: 'idx_security_log_follow_up'
      },
      {
        fields: ['started_at'],
        name: 'idx_security_log_started'
      }
    ]
  });

  SecurityProtocolLog.associate = (models) => {
    // Relation avec l'utilisateur initiateur
    if (models.User) {
      SecurityProtocolLog.belongsTo(models.User, {
        as: 'InitiatedByUser',
        foreignKey: 'member_id'
      });
      SecurityProtocolLog.belongsTo(models.User, {
        as: 'AcknowledgedByUser',
        foreignKey: 'acknowledged_by'
      });
    }

    // Relation avec le serveur local
    if (models.LocalInstance) {
      SecurityProtocolLog.belongsTo(models.LocalInstance, {
        foreignKey: 'local_server_id',
        as: 'LocalServer'
      });
    }
  };

  /**
   * Méthodes de classe
   */

  // Obtenir les logs critiques non acquittés
  SecurityProtocolLog.getUnacknowledgedCritical = async function() {
    return this.findAll({
      where: {
        severity: 'critical',
        acknowledged_at: null
      },
      order: [['created_at', 'DESC']]
    });
  };

  // Obtenir les logs nécessitant un suivi
  SecurityProtocolLog.getRequiringFollowUp = async function() {
    return this.findAll({
      where: {
        requires_follow_up: true,
        follow_up_notes: null
      },
      order: [['created_at', 'DESC']]
    });
  };

  return SecurityProtocolLog;
};
