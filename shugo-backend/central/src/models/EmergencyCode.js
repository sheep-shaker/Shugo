'use strict';

/**
 * Modèle EmergencyCode - Tableau de secours d'urgence
 *
 * Gère les 100 codes de secours (format 3 colonnes: A01-A33, B01-B33, C01-C34).
 * Usage unique par code. Régénération après 85 codes utilisés.
 *
 * @see Document Technique V7.0 - Section 5.9
 */

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const EmergencyCode = sequelize.define('EmergencyCode', {
    code_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique du code'
    },
    tableau_series: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: 'Série du tableau: SECOURS-YYYY-MM-GEOID'
    },
    geo_id: {
      type: DataTypes.STRING(16),
      allowNull: false,
      comment: 'Scope géographique du tableau'
    },
    code_position: {
      type: DataTypes.STRING(4),
      allowNull: false,
      comment: 'Position: A01-A33, B01-B33, C01-C34'
    },
    code_hash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: 'Hash SHA-256 du code (code jamais stocké en clair)'
    },
    is_used: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Si true, code déjà utilisé'
    },
    used_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'utilisation'
    },
    used_by_ip: {
      type: DataTypes.STRING(45),
      allowNull: true,
      comment: 'Adresse IP lors de l\'utilisation'
    },
    used_by_member_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'member_id ayant utilisé le code (si connu)'
    },
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'PENDING',
      comment: 'Statut: PENDING, ACTIVE, USED, REVOKED, EXPIRED'
    },
    activated_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'activation du tableau'
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'expiration du tableau'
    },
    revoked_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date de révocation'
    },
    revoked_reason: {
      type: DataTypes.STRING(128),
      allowNull: true,
      comment: 'Raison de révocation'
    },
    access_type: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: 'Type d\'accès accordé: admin_emergency, vault_access, recovery'
    },
    access_duration_minutes: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 120,
      comment: 'Durée d\'accès accordée (défaut: 2h)'
    }
  }, {
    tableName: 'emergency_codes',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['tableau_series', 'code_position'],
        name: 'idx_emergency_series_position'
      },
      {
        fields: ['geo_id', 'status'],
        name: 'idx_emergency_geo_status'
      },
      {
        fields: ['tableau_series', 'is_used'],
        name: 'idx_emergency_series_used'
      },
      {
        fields: ['status'],
        name: 'idx_emergency_status'
      },
      {
        fields: ['expires_at'],
        name: 'idx_emergency_expires'
      }
    ]
  });

  EmergencyCode.associate = (models) => {
    // Relation avec l'utilisateur ayant utilisé le code
    if (models.User) {
      EmergencyCode.belongsTo(models.User, {
        as: 'UsedByUser',
        foreignKey: 'used_by_member_id'
      });
    }
  };

  /**
   * Méthodes de classe
   */

  // Compter les codes disponibles pour une série
  EmergencyCode.countAvailable = async function(tableauSeries) {
    return this.count({
      where: {
        tableau_series: tableauSeries,
        status: 'ACTIVE',
        is_used: false
      }
    });
  };

  // Vérifier si seuil d'alerte atteint (>= 85 codes utilisés)
  EmergencyCode.checkAlertThreshold = async function(tableauSeries) {
    const used = await this.count({
      where: {
        tableau_series: tableauSeries,
        is_used: true
      }
    });
    return used >= 85;
  };

  return EmergencyCode;
};
