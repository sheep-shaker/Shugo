'use strict';

/**
 * Modèle AesKeyRotation - Rotation des clés AES-256-GCM
 *
 * Gère le cycle de vie des clés de chiffrement AES avec rotation annuelle.
 *
 * @see Document Technique V7.0 - Section 5.4
 */

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AesKeyRotation = sequelize.define('AesKeyRotation', {
    rotation_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique de la rotation'
    },
    key_type: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: 'Type de clé: vault_local, vault_central, backup, logs'
    },
    key_version: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      comment: 'Version de la clé (incrémentée à chaque rotation)'
    },
    key_encrypted: {
      type: DataTypes.BLOB,
      allowNull: false,
      comment: 'Clé AES-256 chiffrée avec la clé maître (IV + authTag + encrypted)'
    },
    initialization_vector: {
      type: DataTypes.BLOB,
      allowNull: false,
      comment: 'IV utilisé lors de la création de la clé (12 bytes)'
    },
    key_hash: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: 'Hash SHA-256 de la clé pour vérification intégrité'
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Si true, clé actuellement utilisée pour ce type'
    },
    activated_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'activation de la clé'
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Date d\'expiration (1 an après création par défaut)'
    },
    rotated_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date de rotation (quand remplacée par nouvelle clé)'
    },
    rotated_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'member_id de l\'admin ayant effectué la rotation'
    },
    rotation_reason: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: 'Raison: scheduled, manual, compromise, emergency'
    },
    previous_key_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'aes_keys_rotation',
        key: 'rotation_id'
      },
      comment: 'Référence vers la clé précédente'
    },
    access_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Nombre d\'accès à cette clé'
    },
    last_accessed_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Dernier accès à cette clé'
    },
    geo_id: {
      type: DataTypes.STRING(16),
      allowNull: true,
      comment: 'Scope géographique (null = central)'
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {},
      comment: 'Métadonnées additionnelles'
    }
  }, {
    tableName: 'aes_keys_rotation',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['key_type', 'key_version'],
        name: 'idx_aes_key_type_version'
      },
      {
        fields: ['key_type', 'is_active'],
        name: 'idx_aes_key_type_active'
      },
      {
        fields: ['expires_at'],
        name: 'idx_aes_expires_at'
      },
      {
        fields: ['geo_id'],
        name: 'idx_aes_geo_id'
      }
    ]
  });

  AesKeyRotation.associate = (models) => {
    // Auto-référence pour la clé précédente
    AesKeyRotation.belongsTo(AesKeyRotation, {
      as: 'PreviousKey',
      foreignKey: 'previous_key_id'
    });
    AesKeyRotation.hasOne(AesKeyRotation, {
      as: 'NextKey',
      foreignKey: 'previous_key_id'
    });

    // Relation avec l'admin ayant effectué la rotation
    if (models.User) {
      AesKeyRotation.belongsTo(models.User, {
        as: 'RotatedByUser',
        foreignKey: 'rotated_by'
      });
    }

    // Relation avec les backups utilisant cette clé
    if (models.BackupJob) {
      AesKeyRotation.hasMany(models.BackupJob, {
        foreignKey: 'encryption_key_id',
        as: 'Backups'
      });
    }
  };

  return AesKeyRotation;
};
