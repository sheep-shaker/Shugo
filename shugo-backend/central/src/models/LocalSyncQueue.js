// models/LocalSyncQueue.js
// Modèle pour la file de synchronisation des serveurs locaux

module.exports = (sequelize, DataTypes) => {
  const LocalSyncQueue = sequelize.define('LocalSyncQueue', {
    sync_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    server_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'local_servers',
        key: 'server_id'
      }
    },
    operation_type: {
      type: DataTypes.ENUM('create', 'update', 'delete', 'sync', 'bulk'),
      allowNull: false
    },
    entity_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'Type d\'entité (user, guard, assignment, etc.)'
    },
    entity_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'ID de l\'entité concernée'
    },
    data: {
      type: DataTypes.JSON,
      allowNull: false,
      comment: 'Données à synchroniser'
    },
    priority: {
      type: DataTypes.INTEGER,
      defaultValue: 5,
      validate: {
        min: 1,
        max: 10
      },
      comment: '1=basse, 10=urgente'
    },
    status: {
      type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed', 'retry'),
      defaultValue: 'pending'
    },
    retry_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    max_retries: {
      type: DataTypes.INTEGER,
      defaultValue: 3
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    direction: {
      type: DataTypes.ENUM('local_to_central', 'central_to_local', 'bidirectional'),
      defaultValue: 'local_to_central'
    },
    batch_id: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'ID de batch pour grouper les opérations'
    },
    dependencies: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'IDs des sync_id dont cette opération dépend'
    },
    processed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    acknowledged_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Métadonnées supplémentaires'
    },
    checksum: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: 'Hash SHA256 des données pour vérification'
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'local_sync_queue',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['status', 'priority', 'created_at'],
        name: 'idx_sync_queue_priority'
      },
      {
        fields: ['server_id', 'status'],
        name: 'idx_sync_server_status'
      },
      {
        fields: ['batch_id'],
        name: 'idx_sync_batch'
      },
      {
        fields: ['entity_type', 'entity_id'],
        name: 'idx_sync_entity'
      }
    ]
  });

  LocalSyncQueue.associate = function(models) {
    LocalSyncQueue.belongsTo(models.LocalServer, {
      foreignKey: 'server_id',
      as: 'server'
    });
  };

  // Méthodes d'instance
  LocalSyncQueue.prototype.canRetry = function() {
    return this.retry_count < this.max_retries;
  };

  LocalSyncQueue.prototype.incrementRetry = async function() {
    this.retry_count++;
    if (this.retry_count >= this.max_retries) {
      this.status = 'failed';
    } else {
      this.status = 'retry';
    }
    return await this.save();
  };

  LocalSyncQueue.prototype.markAsProcessed = async function() {
    this.status = 'completed';
    this.processed_at = new Date();
    return await this.save();
  };

  LocalSyncQueue.prototype.calculateChecksum = function() {
    const crypto = require('crypto');
    const dataString = JSON.stringify(this.data);
    return crypto.createHash('sha256').update(dataString).digest('hex');
  };

  // Méthodes statiques
  LocalSyncQueue.getNextBatch = async function(serverId, limit = 100) {
    return await this.findAll({
      where: {
        server_id: serverId,
        status: { [sequelize.Op.in]: ['pending', 'retry'] },
        retry_count: { [sequelize.Op.lt]: sequelize.col('max_retries') }
      },
      order: [
        ['priority', 'DESC'],
        ['created_at', 'ASC']
      ],
      limit
    });
  };

  LocalSyncQueue.createBatch = async function(operations, batchId = null) {
    if (!batchId) {
      batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    const entries = operations.map(op => ({
      ...op,
      batch_id: batchId,
      checksum: this.prototype.calculateChecksum.call({ data: op.data })
    }));

    return await this.bulkCreate(entries);
  };

  return LocalSyncQueue;
};
