// src/database/connection.js
// Configuration et connexion à la base de données (PostgreSQL ou SQLite)

const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');

// Determine dialect and create appropriate options
const isSQLite = config.database.dialect === 'sqlite';

// Ensure data directory exists for SQLite
if (isSQLite && config.database.storage) {
    const dataDir = path.dirname(config.database.storage);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}

// Build Sequelize options based on dialect
const sequelizeOptions = isSQLite ? {
    dialect: 'sqlite',
    storage: config.database.storage,
    logging: config.isDevelopment ? (msg, timing) => {
        logger.debug(`[${timing || 0}ms] ${msg}`);
    } : false,
    benchmark: config.isDevelopment
} : {
    ...config.database,
    dialectOptions: {
        ssl: config.database.ssl ? {
            require: true,
            rejectUnauthorized: false
        } : false,
        connectTimeout: 30000,
        statement_timeout: 30000,
        idle_in_transaction_session_timeout: 30000
    },
    benchmark: config.isDevelopment,
    logging: config.isDevelopment ? (msg, timing) => {
        logger.debug(`[${timing}ms] ${msg}`);
    } : false
};

// Create Sequelize instance
const sequelize = new Sequelize(sequelizeOptions);

// Test database connection
async function testConnection() {
    try {
        await sequelize.authenticate();

        let dbInfo;
        if (isSQLite) {
            const [results] = await sequelize.query('SELECT sqlite_version() as version');
            dbInfo = {
                dialect: 'sqlite',
                storage: config.database.storage,
                version: results[0].version
            };
        } else {
            const [results] = await sequelize.query('SELECT version()');
            dbInfo = {
                database: config.database.name,
                host: config.database.host,
                port: config.database.port,
                version: results[0].version
            };
        }

        logger.info('Database connection established', dbInfo);

        return true;
    } catch (error) {
        logger.error('Unable to connect to database:', {
            error: error.message,
            dialect: config.database.dialect,
            ...(isSQLite ? { storage: config.database.storage } : {
                database: config.database.name,
                host: config.database.host,
                port: config.database.port
            })
        });
        throw error;
    }
}

// Initialize database schema
async function initializeDatabase() {
    try {
        if (!isSQLite) {
            // PostgreSQL-specific initialization
            await sequelize.query(`
                CREATE SCHEMA IF NOT EXISTS public;
            `);

            // Create extensions
            await sequelize.query(`
                CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
            `).catch(() => {}); // Ignore if already exists

            await sequelize.query(`
                CREATE EXTENSION IF NOT EXISTS "pgcrypto";
            `).catch(() => {});
        }
        // SQLite doesn't need schema initialization

        logger.info('Database schema initialized', { dialect: config.database.dialect });

    } catch (error) {
        logger.error('Failed to initialize database:', error);
        throw error;
    }
}

// Sync all models
async function syncModels(options = {}) {
    try {
        // Import all models to register them
        const models = [
            require('../models/User'),
            require('../models/Location'),
            require('../models/LocalInstance'),
            require('../models/Session'),
            require('../models/AuditLog'),
            require('../models/Guard'),
            require('../models/GuardAssignment'),
            require('../models/Group'),
            require('../models/GroupMembership'),
            require('../models/Notification'),
            require('../models/RegistrationToken')
        ];
        
        // Create associations
        setupAssociations();
        
        // Sync database
        await sequelize.sync(options);
        
        logger.info(`Database synced with ${models.length} models`);
        
    } catch (error) {
        logger.error('Failed to sync models:', error);
        throw error;
    }
}

// Setup model associations
function setupAssociations() {
    const models = sequelize.models;
    
    // User associations
    if (models.User && models.Session) {
        models.User.hasMany(models.Session, {
            foreignKey: 'member_id',
            as: 'sessions'
        });
        models.Session.belongsTo(models.User, {
            foreignKey: 'member_id',
            as: 'user'
        });
    }
    
    // Guard associations
    if (models.Guard && models.GuardAssignment) {
        models.Guard.hasMany(models.GuardAssignment, {
            foreignKey: 'guard_id',
            as: 'assignments'
        });
        models.GuardAssignment.belongsTo(models.Guard, {
            foreignKey: 'guard_id',
            as: 'guard'
        });
    }
    
    if (models.GuardAssignment && models.User) {
        models.GuardAssignment.belongsTo(models.User, {
            foreignKey: 'member_id',
            as: 'member'
        });
        models.User.hasMany(models.GuardAssignment, {
            foreignKey: 'member_id',
            as: 'guardAssignments'
        });
    }
    
    // Group associations
    if (models.Group && models.GroupMembership) {
        models.Group.hasMany(models.GroupMembership, {
            foreignKey: 'group_id',
            as: 'memberships'
        });
        models.GroupMembership.belongsTo(models.Group, {
            foreignKey: 'group_id',
            as: 'group'
        });
    }
    
    if (models.GroupMembership && models.User) {
        models.GroupMembership.belongsTo(models.User, {
            foreignKey: 'member_id',
            as: 'user'
        });
        models.User.hasMany(models.GroupMembership, {
            foreignKey: 'member_id',
            as: 'groupMemberships'
        });
    }
    
    if (models.Group && models.User) {
        models.Group.belongsTo(models.User, {
            foreignKey: 'leader_member_id',
            as: 'leader'
        });
    }
    
    // Notification associations
    if (models.Notification && models.User) {
        models.Notification.belongsTo(models.User, {
            foreignKey: 'member_id',
            as: 'recipient'
        });
        models.Notification.belongsTo(models.User, {
            foreignKey: 'sender_member_id',
            as: 'sender'
        });
    }
    
    // Location associations (without FK constraint to allow standalone server registration)
    if (models.Location && models.LocalInstance) {
        models.Location.hasMany(models.LocalInstance, {
            foreignKey: { name: 'geo_id', allowNull: true },
            as: 'instances',
            constraints: false  // Disable FK constraint for Guilty Spark protocol
        });
        models.LocalInstance.belongsTo(models.Location, {
            foreignKey: { name: 'geo_id', allowNull: true },
            as: 'location',
            constraints: false  // Disable FK constraint for Guilty Spark protocol
        });
    }
    
    logger.debug('Model associations configured');
}

// Database utilities
const dbUtils = {
    // Transaction helper
    async transaction(callback) {
        const t = await sequelize.transaction();
        try {
            const result = await callback(t);
            await t.commit();
            return result;
        } catch (error) {
            await t.rollback();
            throw error;
        }
    },
    
    // Bulk operations with error handling
    async bulkCreate(model, data, options = {}) {
        try {
            return await model.bulkCreate(data, {
                ...options,
                returning: true,
                ignoreDuplicates: true
            });
        } catch (error) {
            logger.error(`Bulk create failed for ${model.name}:`, error);
            throw error;
        }
    },
    
    // Safe destroy with audit
    async safeDestroy(model, where, userId = null) {
        const transaction = await sequelize.transaction();
        try {
            // Log the deletion
            const records = await model.findAll({ where, transaction });
            
            // Perform deletion
            const result = await model.destroy({ where, transaction });
            
            // Audit log
            if (userId && sequelize.models.AuditLog) {
                await sequelize.models.AuditLog.create({
                    member_id: userId,
                    action: 'DELETE',
                    resource_type: model.name,
                    resource_id: records.map(r => r.id).join(','),
                    old_values: JSON.stringify(records),
                    result: 'success'
                }, { transaction });
            }
            
            await transaction.commit();
            return result;
            
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    }
};

module.exports = {
    sequelize,
    testConnection,
    initializeDatabase,
    syncModels,
    setupAssociations,
    dbUtils,
    Sequelize
};
