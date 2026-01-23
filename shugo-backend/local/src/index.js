// packages/local/src/index.js
// SHUGO Local Server - Optimized for Raspberry Pi

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const path = require('path');

// Configuration
const config = require('./config');
const logger = require('./utils/logger');

// Database
const { initDatabase } = require('./database');

// Middleware
const errorHandler = require('./middleware/errorHandler');
const requestLogger = require('./middleware/requestLogger');
const rateLimit = require('./middleware/rateLimit');
const cache = require('./middleware/cache');

// Services
const SyncManager = require('./sync/SyncManager');
const LocalVault = require('./vault/LocalVault');
const HealthMonitor = require('./services/HealthMonitor');

// Core
const { EventBus } = require('@shugo/core/events/EventBus');

// Create Express app
const app = express();

// Initialize services
let syncManager;
let vault;
let healthMonitor;
let eventBus;

/**
 * Initialize the server
 */
async function initialize() {
    try {
        logger.info('🚀 Starting SHUGO Local Server', {
            version: config.app.version,
            serverId: config.server.id,
            geoId: config.server.geo_id,
            environment: config.app.environment
        });
        
        // Initialize Event Bus
        eventBus = new EventBus({
            serverId: config.server.id,
            maxHistorySize: 100 // Keep small for Pi
        });
        
        // Initialize database
        logger.info('📊 Initializing database...');
        await initDatabase();
        logger.info('✅ Database initialized');
        
        // Initialize Local Vault
        logger.info('🔐 Initializing Local Vault...');
        vault = new LocalVault(config.vault);
        await vault.initialize();
        logger.info('✅ Vault initialized');
        
        // Initialize Sync Manager
        if (config.sync.enabled) {
            logger.info('🔄 Initializing Sync Manager...');
            syncManager = new SyncManager(config.sync, eventBus);
            await syncManager.initialize();
            logger.info('✅ Sync Manager initialized');
        }
        
        // Initialize Health Monitor
        logger.info('💓 Initializing Health Monitor...');
        healthMonitor = new HealthMonitor(config, eventBus);
        await healthMonitor.start();
        logger.info('✅ Health Monitor started');
        
        // Setup middleware
        setupMiddleware();
        
        // Setup routes
        setupRoutes();
        
        // Setup error handling
        app.use(errorHandler);
        
        // Start server
        const server = app.listen(config.server.port, config.server.host, () => {
            logger.info(`✅ Server running at http://${config.server.host}:${config.server.port}`);
            logger.info('📍 Geo ID:', config.server.geo_id);
            logger.info('🔄 Sync Mode:', config.sync.mode);
            logger.info('💾 Database:', config.database.dialect);
            
            // Emit server started event
            eventBus.emit('server.started', {
                serverId: config.server.id,
                geoId: config.server.geo_id,
                port: config.server.port
            });
        });
        
        // Graceful shutdown
        setupGracefulShutdown(server);
        
        // Memory management for Pi
        if (config.performance.gcInterval) {
            setInterval(() => {
                if (global.gc) {
                    global.gc();
                    logger.debug('Garbage collection triggered');
                }
            }, config.performance.gcInterval);
        }
        
        return server;
        
    } catch (error) {
        logger.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

/**
 * Setup Express middleware
 */
function setupMiddleware() {
    // Security
    app.use(helmet({
        contentSecurityPolicy: false // For local network
    }));
    
    // CORS - Allow local network
    app.use(cors({
        origin: (origin, callback) => {
            // Allow requests from local network
            if (!origin || origin.includes('192.168.') || origin.includes('10.') || origin.includes('localhost')) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true
    }));
    
    // Compression
    app.use(compression());
    
    // Body parsing
    app.use(express.json({ limit: config.performance.maxRequestSize }));
    app.use(express.urlencoded({ extended: true, limit: config.performance.maxRequestSize }));
    
    // Request logging
    if (config.isDevelopment) {
        app.use(requestLogger);
    }
    
    // Rate limiting
    app.use('/api', rateLimit);
    
    // Cache
    if (config.cache.enabled) {
        app.use('/api/local', cache.middleware());
    }
    
    // Request timeout
    app.use((req, res, next) => {
        req.setTimeout(config.performance.requestTimeout);
        next();
    });
}

/**
 * Setup API routes
 */
function setupRoutes() {
    // Health check
    app.get('/health', (req, res) => {
        res.json({
            status: 'healthy',
            server: config.server.name,
            serverId: config.server.id,
            geoId: config.server.geo_id,
            version: config.app.version,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        });
    });
    
    // Local API routes
    app.use('/api/local/auth', require('./routes/auth'));
    app.use('/api/local/guards', require('./routes/guards'));
    app.use('/api/local/users', require('./routes/users'));
    app.use('/api/local/groups', require('./routes/groups'));
    app.use('/api/local/assignments', require('./routes/assignments'));
    app.use('/api/local/sync', require('./routes/sync'));
    app.use('/api/local/notifications', require('./routes/notifications'));
    app.use('/api/local/system', require('./routes/system'));
    
    // Plugin routes (dynamic loading)
    const pluginRouter = require('./routes/plugins');
    app.use('/api/local/plugins', pluginRouter);
    
    // Static files (if needed)
    app.use('/public', express.static(path.join(__dirname, '../public')));
    
    // 404 handler
    app.use((req, res) => {
        res.status(404).json({
            error: 'Not Found',
            message: `Route ${req.method} ${req.path} not found`
        });
    });
}

/**
 * Setup graceful shutdown
 */
function setupGracefulShutdown(server) {
    const shutdown = async (signal) => {
        logger.info(`⚠️ ${signal} received, starting graceful shutdown...`);
        
        // Stop accepting new connections
        server.close(() => {
            logger.info('🔒 Server closed to new connections');
        });
        
        try {
            // Stop services
            if (healthMonitor) {
                await healthMonitor.stop();
                logger.info('✅ Health Monitor stopped');
            }
            
            if (syncManager) {
                await syncManager.shutdown();
                logger.info('✅ Sync Manager stopped');
            }
            
            if (vault) {
                await vault.close();
                logger.info('✅ Vault closed');
            }
            
            // Close database
            const { sequelize } = require('./database');
            await sequelize.close();
            logger.info('✅ Database closed');
            
            logger.info('👋 Graceful shutdown complete');
            process.exit(0);
            
        } catch (error) {
            logger.error('❌ Error during shutdown:', error);
            process.exit(1);
        }
    };
    
    // Listen for termination signals
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
        logger.error('❌ Uncaught Exception:', error);
        shutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        logger.error('❌ Unhandled Rejection:', reason);
        shutdown('unhandledRejection');
    });
}

// Export for testing
module.exports = { app, initialize };

// Start server if not in test mode
if (require.main === module) {
    initialize().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}
