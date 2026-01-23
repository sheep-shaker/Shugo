// src/models/AuditLog.js
// Modèle pour les logs d'audit et traçabilité

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

const AuditLog = sequelize.define('AuditLog', {
    log_id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    
    timestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    },
    
    member_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: {
            model: 'users',
            key: 'member_id'
        }
    },
    
    session_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'sessions',
            key: 'session_id'
        }
    },
    
    action: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: 'Action performed (CREATE, READ, UPDATE, DELETE, LOGIN, etc.)'
    },
    
    resource_type: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: 'Type of resource (user, guard, group, system, vault)'
    },
    
    resource_id: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'ID of the affected resource'
    },
    
    old_values: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Values before modification'
    },
    
    new_values: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Values after modification'
    },
    
    ip_address: {
        type: DataTypes.INET,
        allowNull: true
    },
    
    user_agent: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    
    result: {
        type: DataTypes.ENUM('success', 'failure', 'partial'),
        allowNull: false,
        defaultValue: 'success'
    },
    
    error_code: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: 'Error code if operation failed'
    },
    
    error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Error message if operation failed'
    },
    
    severity: {
        type: DataTypes.ENUM('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'),
        defaultValue: 'INFO'
    },
    
    category: {
        type: DataTypes.ENUM('auth', 'data', 'security', 'system', 'admin'),
        defaultValue: 'data'
    },
    
    geo_id: {
        type: DataTypes.STRING(16),
        allowNull: true
    },
    
    server_id: {
        type: DataTypes.STRING(64),
        allowNull: true
    },
    
    request_method: {
        type: DataTypes.STRING(10),
        allowNull: true,
        comment: 'HTTP method (GET, POST, PUT, DELETE, etc.)'
    },
    
    request_path: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'API endpoint path'
    },
    
    response_time_ms: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Response time in milliseconds'
    },
    
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    
    flags: {
        type: DataTypes.JSON,
        defaultValue: {
            reviewed: false,
            flagged: false,
            archived: false
        }
    },
    
    metadata: {
        type: DataTypes.JSON,
        defaultValue: {}
    }
}, {
    tableName: 'audit_logs',
    timestamps: false, // We use our own timestamp field
    underscored: true,
    indexes: [
        { fields: ['timestamp'] },
        { fields: ['member_id'] },
        { fields: ['session_id'] },
        { fields: ['action'] },
        { fields: ['resource_type', 'resource_id'] },
        { fields: ['result'] },
        { fields: ['severity'] },
        { fields: ['category'] },
        { fields: ['ip_address'] },
        { fields: ['geo_id'] }
    ]
});

// Instance methods
AuditLog.prototype.flag = async function(reason = null) {
    if (!this.flags) this.flags = {};
    this.flags.flagged = true;
    this.flags.flagged_at = new Date();
    if (reason) this.flags.flag_reason = reason;
    await this.save();
};

AuditLog.prototype.review = async function(reviewerId, notes = null) {
    if (!this.flags) this.flags = {};
    this.flags.reviewed = true;
    this.flags.reviewed_at = new Date();
    this.flags.reviewed_by = reviewerId;
    if (notes) this.notes = notes;
    await this.save();
};

// Class methods
AuditLog.logAction = async function(data) {
    return await this.create({
        member_id: data.userId || data.member_id,
        session_id: data.sessionId || data.session_id,
        action: data.action,
        resource_type: data.resourceType || data.resource_type,
        resource_id: data.resourceId || data.resource_id,
        old_values: data.oldValues || data.old_values,
        new_values: data.newValues || data.new_values,
        ip_address: data.ipAddress || data.ip_address || data.ip,
        user_agent: data.userAgent || data.user_agent,
        result: data.result || 'success',
        error_code: data.errorCode || data.error_code,
        error_message: data.errorMessage || data.error_message,
        severity: data.severity || 'INFO',
        category: data.category || 'data',
        geo_id: data.geoId || data.geo_id,
        server_id: data.serverId || data.server_id,
        request_method: data.method,
        request_path: data.path,
        response_time_ms: data.responseTime,
        notes: data.notes,
        metadata: data.metadata || {}
    });
};

AuditLog.findByUser = async function(memberId, options = {}) {
    const where = { member_id: memberId };
    
    if (options.startDate) {
        where.timestamp = where.timestamp || {};
        where.timestamp[sequelize.Sequelize.Op.gte] = options.startDate;
    }
    
    if (options.endDate) {
        where.timestamp = where.timestamp || {};
        where.timestamp[sequelize.Sequelize.Op.lte] = options.endDate;
    }
    
    if (options.action) where.action = options.action;
    if (options.result) where.result = options.result;
    if (options.category) where.category = options.category;
    
    return await this.findAll({
        where,
        order: [['timestamp', 'DESC']],
        limit: options.limit || 100
    });
};

AuditLog.findByResource = async function(resourceType, resourceId, options = {}) {
    const where = {
        resource_type: resourceType,
        resource_id: resourceId
    };
    
    if (options.startDate) {
        where.timestamp = where.timestamp || {};
        where.timestamp[sequelize.Sequelize.Op.gte] = options.startDate;
    }
    
    if (options.endDate) {
        where.timestamp = where.timestamp || {};
        where.timestamp[sequelize.Sequelize.Op.lte] = options.endDate;
    }
    
    return await this.findAll({
        where,
        order: [['timestamp', 'DESC']],
        limit: options.limit || 100
    });
};

AuditLog.findSecurityEvents = async function(options = {}) {
    const where = {
        category: 'security'
    };
    
    if (options.severity) {
        where.severity = options.severity;
    } else {
        where.severity = {
            [sequelize.Sequelize.Op.in]: ['WARN', 'ERROR', 'CRITICAL']
        };
    }
    
    if (options.startDate) {
        where.timestamp = where.timestamp || {};
        where.timestamp[sequelize.Sequelize.Op.gte] = options.startDate;
    }
    
    return await this.findAll({
        where,
        order: [['timestamp', 'DESC']],
        limit: options.limit || 100
    });
};

AuditLog.cleanup = async function(daysToKeep = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    // Don't delete flagged or critical logs
    return await this.destroy({
        where: {
            timestamp: {
                [sequelize.Sequelize.Op.lt]: cutoffDate
            },
            severity: {
                [sequelize.Sequelize.Op.notIn]: ['ERROR', 'CRITICAL']
            },
            [sequelize.Sequelize.Op.or]: [
                { flags: null },
                { 'flags.flagged': false }
            ]
        }
    });
};

AuditLog.getStatistics = async function(startDate, endDate) {
    const where = {};
    
    if (startDate) {
        where.timestamp = where.timestamp || {};
        where.timestamp[sequelize.Sequelize.Op.gte] = startDate;
    }
    
    if (endDate) {
        where.timestamp = where.timestamp || {};
        where.timestamp[sequelize.Sequelize.Op.lte] = endDate;
    }
    
    const [results] = await sequelize.query(`
        SELECT 
            COUNT(*) as total,
            COUNT(DISTINCT member_id) as unique_users,
            AVG(response_time_ms) as avg_response_time,
            COUNT(CASE WHEN result = 'success' THEN 1 END) as success_count,
            COUNT(CASE WHEN result = 'failure' THEN 1 END) as failure_count,
            COUNT(CASE WHEN severity IN ('ERROR', 'CRITICAL') THEN 1 END) as error_count
        FROM audit_logs
        WHERE timestamp >= :startDate AND timestamp <= :endDate
    `, {
        replacements: { startDate, endDate },
        type: sequelize.QueryTypes.SELECT
    });
    
    return results[0];
};

module.exports = AuditLog;
