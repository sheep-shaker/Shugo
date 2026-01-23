// src/models/LocalInstance.js
// Modèle pour les instances de serveurs locaux

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');
const cryptoManager = require('../utils/crypto');

const LocalInstance = sequelize.define('LocalInstance', {
    instance_id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },

    geo_id: {
        type: DataTypes.STRING(16),
        allowNull: false,
        validate: {
            is: /^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/
        }
    },

    parent_geo_id: {
        type: DataTypes.STRING(16),
        allowNull: true
    },

    name: {
        type: DataTypes.STRING(255),
        allowNull: false
    },

    server_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        comment: 'Unique server identifier'
    },

    ip_address: {
        type: DataTypes.INET,
        allowNull: true
    },

    port: {
        type: DataTypes.INTEGER,
        defaultValue: 443
    },

    status: {
        type: DataTypes.ENUM('active', 'inactive', 'maintenance', 'spare', 'error'),
        defaultValue: 'inactive',
        allowNull: false
    },

    version: {
        type: DataTypes.STRING(20),
        allowNull: true
    },

    last_seen: {
        type: DataTypes.DATE,
        allowNull: true
    },

    last_maintenance: {
        type: DataTypes.DATE,
        allowNull: true
    },

    heartbeat_interval: {
        type: DataTypes.INTEGER,
        defaultValue: 300
    },

    registered_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },

    activated_at: {
        type: DataTypes.DATE,
        allowNull: true
    },

    // Security
    public_key: {
        type: DataTypes.TEXT,
        allowNull: true
    },

    shared_secret_hash: {
        type: DataTypes.STRING(128),
        allowNull: true
    },

    shared_secret: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'Shared secret for HMAC authentication'
    },

    // Sync fields
    last_heartbeat: {
        type: DataTypes.DATE,
        allowNull: true
    },

    last_full_sync: {
        type: DataTypes.DATE,
        allowNull: true
    },

    last_delta_sync: {
        type: DataTypes.DATE,
        allowNull: true
    },

    needs_full_sync: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },

    sync_queue_size: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },

    // Metrics
    cpu_usage: {
        type: DataTypes.FLOAT,
        allowNull: true
    },

    memory_usage: {
        type: DataTypes.FLOAT,
        allowNull: true
    },

    disk_usage: {
        type: DataTypes.FLOAT,
        allowNull: true
    },

    user_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },

    metrics: {
        type: DataTypes.JSON,
        defaultValue: {}
    },

    config: {
        type: DataTypes.JSON,
        defaultValue: {}
    },

    capabilities: {
        type: DataTypes.JSON,
        defaultValue: []
    },

    maintenance_window: {
        type: DataTypes.JSON,
        defaultValue: { hour: 0, minute: 0, duration: 45, timezone: 'local' }
    },

    backup_config: {
        type: DataTypes.JSON,
        defaultValue: { enabled: true, frequency: 'daily', retention_days: 30 }
    },

    metadata: {
        type: DataTypes.JSON,
        defaultValue: {}
    }
}, {
    tableName: 'local_instances',
    timestamps: true,
    underscored: true,
    indexes: [
        { fields: ['geo_id'] },
        { fields: ['status'] },
        { fields: ['server_id'], unique: true },
        { fields: ['last_seen'] },
        { fields: ['last_heartbeat'] }
    ]
});

// Instance methods
LocalInstance.prototype.isOnline = function() {
    if (!this.last_seen) return false;
    const timeSinceLastSeen = Date.now() - this.last_seen.getTime();
    return timeSinceLastSeen < (this.heartbeat_interval * 2 * 1000);
};

LocalInstance.prototype.updateHeartbeat = async function(metricsData = {}) {
    this.last_seen = new Date();
    this.last_heartbeat = new Date();
    if (metricsData.cpu) this.cpu_usage = metricsData.cpu;
    if (metricsData.memory) this.memory_usage = metricsData.memory;
    if (metricsData.disk) this.disk_usage = metricsData.disk;
    if (metricsData.users !== undefined) this.user_count = metricsData.users;
    if (metricsData) this.metrics = metricsData;
    await this.save();
};

LocalInstance.prototype.setSharedSecret = function(secret) {
    this.shared_secret = secret;
    this.shared_secret_hash = cryptoManager.hashSHA256(secret);
};

LocalInstance.prototype.verifySharedSecret = function(secret) {
    const hash = cryptoManager.hashSHA256(secret);
    return cryptoManager.constantTimeCompare(hash, this.shared_secret_hash);
};

LocalInstance.prototype.activate = async function() {
    this.status = 'active';
    this.activated_at = new Date();
    await this.save();
};

LocalInstance.prototype.deactivate = async function(reason = null) {
    this.status = 'inactive';
    if (reason && this.metadata) {
        this.metadata.deactivation_reason = reason;
        this.metadata.deactivated_at = new Date();
    }
    await this.save();
};

// Class methods
LocalInstance.findActive = async function() {
    return await this.findAll({
        where: { status: 'active' },
        order: [['geo_id', 'ASC']]
    });
};

LocalInstance.findByGeoId = async function(geoId) {
    return await this.findOne({ where: { geo_id: geoId } });
};

LocalInstance.findByServerId = async function(serverId) {
    return await this.findOne({ where: { server_id: serverId } });
};

LocalInstance.findOffline = async function(thresholdMinutes = 10) {
    const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);
    return await this.findAll({
        where: {
            status: 'active',
            last_seen: { [sequelize.Sequelize.Op.lt]: threshold }
        }
    });
};

LocalInstance.getMetrics = async function() {
    const instances = await this.findAll({ where: { status: 'active' } });
    return {
        total: instances.length,
        online: instances.filter(i => i.isOnline()).length,
        offline: instances.filter(i => !i.isOnline()).length,
        totalUsers: instances.reduce((sum, i) => sum + (i.user_count || 0), 0),
        avgCpu: instances.reduce((sum, i) => sum + (i.cpu_usage || 0), 0) / (instances.length || 1),
        avgMemory: instances.reduce((sum, i) => sum + (i.memory_usage || 0), 0) / (instances.length || 1),
        avgDisk: instances.reduce((sum, i) => sum + (i.disk_usage || 0), 0) / (instances.length || 1)
    };
};

module.exports = LocalInstance;
