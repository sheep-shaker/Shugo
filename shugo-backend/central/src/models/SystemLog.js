// src/models/SystemLog.js
// Modèle pour les logs système SHUGO

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

const SystemLog = sequelize.define('SystemLog', {
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
    level: {
        type: DataTypes.ENUM('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'),
        allowNull: false,
        defaultValue: 'INFO'
    },
    module: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: 'Module source: auth, guard, vault, maintenance, etc.'
    },
    action: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Action effectuée'
    },
    message: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    context: {
        type: DataTypes.JSON,
        defaultValue: {},
        comment: 'Contexte supplémentaire'
    },
    member_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        comment: 'Utilisateur concerné si applicable'
    },
    session_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Session associée'
    },
    ip_address: {
        type: DataTypes.INET,
        allowNull: true
    },
    user_agent: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    geo_id: {
        type: DataTypes.STRING(16),
        allowNull: true,
        comment: 'Identifiant géographique'
    },
    error_code: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: 'Code erreur SHUGO si applicable'
    },
    stack_trace: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    duration_ms: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Durée de l\'opération en ms'
    },
    request_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'ID de requête pour traçabilité'
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    }
}, {
    tableName: 'system_logs',
    timestamps: false,
    indexes: [
        { fields: ['timestamp'] },
        { fields: ['level'] },
        { fields: ['module'] },
        { fields: ['member_id'] },
        { fields: ['geo_id'] },
        { fields: ['error_code'] },
        { fields: ['created_at'] },
        {
            fields: ['level', 'timestamp'],
            name: 'idx_system_logs_level_timestamp'
        }
    ]
});

/**
 * Méthodes statiques pour faciliter la création de logs
 */

// Log de niveau DEBUG
SystemLog.debug = async function(module, message, context = {}) {
    return this.create({
        level: 'DEBUG',
        module,
        message,
        context,
        timestamp: new Date()
    });
};

// Log de niveau INFO
SystemLog.info = async function(module, message, context = {}) {
    return this.create({
        level: 'INFO',
        module,
        message,
        context,
        timestamp: new Date()
    });
};

// Log de niveau WARN
SystemLog.warn = async function(module, message, context = {}) {
    return this.create({
        level: 'WARN',
        module,
        message,
        context,
        timestamp: new Date()
    });
};

// Log de niveau ERROR
SystemLog.error = async function(module, message, context = {}, errorCode = null) {
    return this.create({
        level: 'ERROR',
        module,
        message,
        context,
        error_code: errorCode,
        timestamp: new Date()
    });
};

// Log de niveau CRITICAL
SystemLog.critical = async function(module, message, context = {}, errorCode = null) {
    return this.create({
        level: 'CRITICAL',
        module,
        message,
        context,
        error_code: errorCode,
        timestamp: new Date()
    });
};

// Log d'une action utilisateur
SystemLog.logUserAction = async function(memberId, action, module, context = {}, req = null) {
    const logData = {
        level: 'INFO',
        module,
        action,
        message: `User action: ${action}`,
        member_id: memberId,
        context,
        timestamp: new Date()
    };
    
    if (req) {
        logData.ip_address = req.ip;
        logData.user_agent = req.get('user-agent');
        logData.session_id = req.session?.id;
        logData.request_id = req.requestId;
    }
    
    return this.create(logData);
};

// Log d'une erreur système
SystemLog.logSystemError = async function(module, error, context = {}) {
    return this.create({
        level: 'ERROR',
        module,
        message: error.message || 'Unknown error',
        context: {
            ...context,
            errorName: error.name,
            errorMessage: error.message
        },
        stack_trace: error.stack,
        error_code: error.code || 'SYS-ERROR-001',
        timestamp: new Date()
    });
};

// Recherche de logs par période
SystemLog.findByPeriod = async function(startDate, endDate, options = {}) {
    const { Op } = require('sequelize');
    
    const where = {
        timestamp: {
            [Op.between]: [startDate, endDate]
        }
    };
    
    if (options.level) {
        where.level = options.level;
    }
    
    if (options.module) {
        where.module = options.module;
    }
    
    if (options.memberId) {
        where.member_id = options.memberId;
    }
    
    return this.findAll({
        where,
        order: [['timestamp', 'DESC']],
        limit: options.limit || 1000
    });
};

// Statistiques des logs
SystemLog.getStats = async function(period = '24h') {
    const { Op, fn, col, literal } = require('sequelize');
    
    let startDate;
    switch (period) {
        case '1h':
            startDate = new Date(Date.now() - 60 * 60 * 1000);
            break;
        case '24h':
            startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
            break;
        case '7d':
            startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            break;
        case '30d':
            startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            break;
        default:
            startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    }
    
    const stats = await this.findAll({
        attributes: [
            'level',
            [fn('COUNT', col('log_id')), 'count']
        ],
        where: {
            timestamp: { [Op.gte]: startDate }
        },
        group: ['level'],
        raw: true
    });
    
    const total = stats.reduce((sum, s) => sum + parseInt(s.count), 0);
    
    return {
        period,
        startDate,
        total,
        byLevel: stats.reduce((acc, s) => {
            acc[s.level] = parseInt(s.count);
            return acc;
        }, {})
    };
};

// Nettoyage des vieux logs
SystemLog.cleanup = async function(retentionDays = 30, excludeErrors = true) {
    const { Op } = require('sequelize');
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    const where = {
        created_at: { [Op.lt]: cutoffDate }
    };
    
    // Garder les erreurs plus longtemps
    if (excludeErrors) {
        where.level = { [Op.notIn]: ['ERROR', 'CRITICAL'] };
    }
    
    const result = await this.destroy({ where });
    
    return {
        deleted: result,
        cutoffDate,
        excludedErrors: excludeErrors
    };
};

module.exports = SystemLog;
