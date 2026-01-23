// packages/local/src/database/index.js
// Database initialization for local server (SQLite primary, PostgreSQL for sync)

const { Sequelize, DataTypes, Op } = require('sequelize');
const path = require('path');
const fs = require('fs').promises;
const config = require('../config');
const logger = require('../utils/logger');

let sequelize;

/**
 * Initialize database connection
 */
async function initDatabase() {
    try {
        // Ensure data directory exists
        const dataDir = path.dirname(config.database.storage);
        await fs.mkdir(dataDir, { recursive: true });
        
        // Initialize Sequelize with SQLite
        if (config.database.dialect === 'sqlite') {
            sequelize = new Sequelize({
                dialect: 'sqlite',
                storage: config.database.storage,
                logging: config.database.logging ? logger.debug : false,
                pool: config.database.pool,
                define: {
                    timestamps: true,
                    underscored: true,
                    paranoid: true // Soft deletes
                }
            });
            
            // Apply SQLite pragmas for performance
            if (config.database.pragma) {
                for (const [pragma, value] of Object.entries(config.database.pragma)) {
                    await sequelize.query(`PRAGMA ${pragma} = ${value}`);
                }
            }
            
        } else {
            // PostgreSQL for sync or primary
            sequelize = new Sequelize({
                dialect: 'postgres',
                host: config.database.host,
                port: config.database.port,
                database: config.database.database,
                username: config.database.username,
                password: config.database.password,
                logging: config.database.logging ? logger.debug : false,
                pool: config.database.pool,
                timezone: config.database.timezone,
                define: {
                    timestamps: true,
                    underscored: true,
                    paranoid: true
                }
            });
        }
        
        // Test connection
        await sequelize.authenticate();
        logger.info('✅ Database connection established', {
            dialect: config.database.dialect,
            storage: config.database.storage || config.database.database
        });
        
        // Load models
        await loadModels();
        
        // Setup associations
        await setupAssociations();
        
        // Sync database
        if (config.isDevelopment || process.env.FORCE_SYNC === 'true') {
            await sequelize.sync({ alter: true });
            logger.info('✅ Database synchronized');
        }
        
        return sequelize;
        
    } catch (error) {
        logger.error('❌ Database initialization failed:', error);
        throw error;
    }
}

/**
 * Load all models
 */
async function loadModels() {
    const models = require('../models');
    
    // Initialize each model
    for (const modelName in models) {
        if (models[modelName].init) {
            models[modelName].init(sequelize);
            logger.debug(`Model loaded: ${modelName}`);
        }
    }
}

/**
 * Setup model associations
 */
async function setupAssociations() {
    const models = require('../models');
    
    // Call associate method on each model if it exists
    for (const modelName in models) {
        if (models[modelName].associate) {
            models[modelName].associate(models);
            logger.debug(`Associations set for: ${modelName}`);
        }
    }
}

/**
 * Close database connection
 */
async function closeDatabase() {
    if (sequelize) {
        await sequelize.close();
        logger.info('Database connection closed');
    }
}

/**
 * Execute raw query
 */
async function query(sql, options = {}) {
    return await sequelize.query(sql, options);
}

/**
 * Begin transaction
 */
async function transaction(callback) {
    return await sequelize.transaction(callback);
}

module.exports = {
    sequelize,
    Sequelize,
    DataTypes,
    Op,
    initDatabase,
    closeDatabase,
    query,
    transaction
};
