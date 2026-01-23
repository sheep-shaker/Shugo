'use strict';

/**
 * Modèle SharedSecret - Secrets partagés entre Central et Local
 *
 * Gère les secrets cryptographiques partagés entre les serveurs.
 * Rotation annuelle obligatoire.
 *
 * @see Document Technique V7.0 - Section 5.5
 */

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SharedSecret = sequelize.define('SharedSecret', {
    secret_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique du secret'
    },
    secret_type: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: 'Type de secret: local_central, emergency, backup, sync'
    },
    secret_encrypted: {
      type: DataTypes.BLOB,
      allowNull: false,
      comment: 'Secret chiffré avec la clé maître du Vault'
    },
    secret_hash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: 'Hash SHA-256 du secret pour validation'
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Si true, secret actuellement utilisé'
    },
    activated_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'activation'
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Date d\'expiration (rotation annuelle)'
    },
    previous_secret_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'shared_secrets',
        key: 'secret_id'
      },
      comment: 'Référence vers le secret précédent'
    },
    rotation_reason: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: 'Raison: initial, scheduled, manual, compromise'
    },
    rotated_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'member_id de l\'admin ayant effectué la rotation'
    },
    local_server_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'ID du serveur local associé (null = global)'
    },
    geo_id: {
      type: DataTypes.STRING(16),
      allowNull: true,
      comment: 'Scope géographique'
    },
    access_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Nombre d\'utilisations'
    },
    last_used_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Dernière utilisation'
    },
    last_validated_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Dernière validation croisée'
    },
    validation_status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'pending',
      comment: 'Statut: pending, validated, invalid, expired'
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {},
      comment: 'Métadonnées additionnelles'
    }
  }, {
    tableName: 'shared_secrets',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['secret_type', 'local_server_id'],
        where: { is_active: true },
        name: 'idx_shared_secret_active_unique'
      },
      {
        fields: ['secret_type', 'is_active'],
        name: 'idx_shared_secret_type_active'
      },
      {
        fields: ['local_server_id'],
        name: 'idx_shared_secret_server'
      },
      {
        fields: ['expires_at'],
        name: 'idx_shared_secret_expires'
      },
      {
        fields: ['geo_id'],
        name: 'idx_shared_secret_geo'
      }
    ]
  });

  SharedSecret.associate = (models) => {
    // Auto-référence pour le secret précédent
    SharedSecret.belongsTo(SharedSecret, {
      as: 'PreviousSecret',
      foreignKey: 'previous_secret_id'
    });
    SharedSecret.hasOne(SharedSecret, {
      as: 'NextSecret',
      foreignKey: 'previous_secret_id'
    });

    // Relation avec l'admin
    if (models.User) {
      SharedSecret.belongsTo(models.User, {
        as: 'RotatedByUser',
        foreignKey: 'rotated_by'
      });
    }

    // Relation avec le serveur local
    if (models.LocalInstance) {
      SharedSecret.belongsTo(models.LocalInstance, {
        foreignKey: 'local_server_id',
        as: 'LocalServer'
      });
    }
  };

  return SharedSecret;
};
