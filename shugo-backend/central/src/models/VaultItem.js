'use strict';

/**
 * Modèle VaultItem - Éléments stockés dans le Vault
 *
 * Stockage sécurisé des secrets, certificats et données sensibles.
 * Chiffrement AES-256-GCM avec clé Vault.
 *
 * @see Document Technique V7.0 - Section 5.3
 */

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const VaultItem = sequelize.define('VaultItem', {
    item_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique de l\'élément'
    },
    vault_type: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'central',
      comment: 'Type de Vault: central, local'
    },
    item_type: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: 'Type: aes_key, secret, certificate, backup_key, emergency_key, api_key, credential'
    },
    item_name: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: 'Nom unique de l\'élément dans le Vault'
    },
    item_data_encrypted: {
      type: DataTypes.BLOB,
      allowNull: false,
      comment: 'Données chiffrées (IV + authTag + encrypted)'
    },
    encryption_key_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Référence vers la clé AES utilisée pour le chiffrement'
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Si true, élément actif et accessible'
    },
    access_level: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'restricted',
      comment: 'Niveau: public, internal, restricted, critical'
    },
    access_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Nombre d\'accès à cet élément'
    },
    last_accessed_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Dernier accès'
    },
    last_accessed_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'member_id du dernier accès'
    },
    created_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'member_id du créateur'
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'expiration (null = jamais)'
    },
    geo_id: {
      type: DataTypes.STRING(16),
      allowNull: true,
      comment: 'Scope géographique'
    },
    local_server_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'ID du serveur local associé'
    },
    tags: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Tags pour classification'
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {},
      comment: 'Métadonnées additionnelles (non chiffrées)'
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Soft delete'
    }
  }, {
    tableName: 'vault_items',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: true,
    deletedAt: 'deleted_at',
    indexes: [
      {
        unique: true,
        fields: ['vault_type', 'item_name'],
        where: { is_active: true },
        name: 'idx_vault_item_name_unique'
      },
      {
        fields: ['vault_type', 'item_type', 'is_active'],
        name: 'idx_vault_type_active'
      },
      {
        fields: ['geo_id'],
        name: 'idx_vault_geo'
      },
      {
        fields: ['local_server_id'],
        name: 'idx_vault_server'
      },
      {
        fields: ['expires_at'],
        name: 'idx_vault_expires'
      },
      {
        fields: ['access_level'],
        name: 'idx_vault_access_level'
      },
      {
        using: 'gin',
        fields: ['tags'],
        name: 'idx_vault_tags'
      }
    ]
  });

  VaultItem.associate = (models) => {
    // Relation avec la clé de chiffrement
    if (models.AesKeyRotation) {
      VaultItem.belongsTo(models.AesKeyRotation, {
        foreignKey: 'encryption_key_id',
        as: 'EncryptionKey'
      });
    }

    // Relation avec l'utilisateur créateur
    if (models.User) {
      VaultItem.belongsTo(models.User, {
        as: 'Creator',
        foreignKey: 'created_by'
      });
      VaultItem.belongsTo(models.User, {
        as: 'LastAccessedByUser',
        foreignKey: 'last_accessed_by'
      });
    }

    // Relation avec le serveur local
    if (models.LocalInstance) {
      VaultItem.belongsTo(models.LocalInstance, {
        foreignKey: 'local_server_id',
        as: 'LocalServer'
      });
    }
  };

  return VaultItem;
};
