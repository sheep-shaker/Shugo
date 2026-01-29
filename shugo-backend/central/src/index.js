// src/index.js
// Point d'entrée principal du serveur SHUGO Central

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const swaggerUi = require('swagger-ui-express');

// Configuration et utilities
const config = require('./config');
const logger = require('./utils/logger');
const { sequelize, testConnection, syncModels, loadModels } = require('./database/connection');

// Load models immediately so they're available for routes
loadModels();

// Middleware
const { errorHandler } = require('./middleware/errorHandler');
const { maintenanceMode } = require('./middleware/maintenance');

// Scheduler (legacy)
const scheduler = require('./cron/scheduler');

// Jobs CRON system
const jobManager = require('./jobs');

// Create Express app
const app = express();

// Trust proxy
if (config.server.trustProxy) {
    app.set('trust proxy', 1);
}

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],  // Required for Swagger UI
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// CORS configuration
app.use(cors(config.cors));

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: config.server.bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: config.server.bodyLimit }));

// Cookie parser
app.use(cookieParser(config.security.cookieSecret));

// Rate limiting
const limiter = rateLimit(config.rateLimit);
app.use('/api/', limiter);

// Request logging
app.use((req, res, next) => {
    logger.http(`${req.method} ${req.url}`, {
        ip: req.ip,
        userAgent: req.get('user-agent')
    });
    next();
});

// Maintenance mode
app.use(maintenanceMode);

// Health check route (before auth)
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        server: config.server.name,
        version: config.server.version,
        timestamp: new Date().toISOString()
    });
});

// API Documentation (Swagger UI)
if (config.isDev || process.env.ENABLE_SWAGGER === 'true') {
    const { swaggerSpec, swaggerUiOptions } = require('./docs/swagger');
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));
    app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));
    logger.info('📚 API Documentation available at /api-docs');
}

// API Routes - Core
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/users', require('./routes/users'));
app.use('/api/v1/guards', require('./routes/guards'));
app.use('/api/v1/groups', require('./routes/groups'));
app.use('/api/v1/locations', require('./routes/locations'));
app.use('/api/v1/notifications', require('./routes/notifications'));
app.use('/api/v1/health', require('./routes/health'));

// API Routes - Guards & Planning
app.use('/api/v1/waiting-list', require('./routes/waitingList'));
app.use('/api/v1/scenarios', require('./routes/scenarios'));
app.use('/api/v1/missions', require('./routes/missions'));

// API Routes - Communication
app.use('/api/v1/messages', require('./routes/messages'));
app.use('/api/v1/support', require('./routes/support'));

// API Routes - Security
app.use('/api/v1/vault', require('./routes/vault'));
app.use('/api/v1/emergency-codes', require('./routes/emergencyCodes'));
app.use('/api/v1/protocols', require('./routes/protocols'));

// API Routes - Administration
app.use('/api/v1/admin', require('./routes/admin'));
app.use('/api/v1/backup', require('./routes/backup'));
app.use('/api/v1/maintenance', require('./routes/maintenance'));
app.use('/api/v1/local-servers', require('./routes/localServers'));
app.use('/api/v1/plugins', require('./routes/plugins'));

// Static files (if needed)
app.use('/public', express.static(path.join(__dirname, '../public')));

// 404 handler
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
        path: req.path
    });
});

// Error handler (must be last)
app.use(errorHandler);

// Initialize database and start server
async function startServer() {
    try {
        logger.info('🚀 Starting SHUGO Central Server...');
        
        // Test database connection
        await testConnection();
        logger.success('✅ Database connected');
        
        // Sync database models (in development only)
        if (config.isDev) {
            // Use force:false to only create missing tables without altering existing ones
            await syncModels({ force: false });
            logger.info('📊 Database models synchronized');
        }
        
        // Start scheduler (legacy)
        if (!config.isTest) {
            scheduler.start();
            logger.success('⏰ Scheduler started');

            // Initialize new job system
            await jobManager.initialize(app);
            logger.success('⏰ Job Manager initialized');
        }
        
        // Start server
        const server = app.listen(config.server.port, config.server.host, () => {
            logger.success(`
╔══════════════════════════════════════════════╗
║                                              ║
║         SHUGO CENTRAL SERVER v${config.server.version}         ║
║                                              ║
║   Server:   ${(config.server.name || 'SHUGO').padEnd(30)}║
║   Host:     ${(config.server.host + ':' + config.server.port).padEnd(30)}║
║   Env:      ${(config.env || 'development').padEnd(30)}║
║   Database: ${(config.database.name || config.database.storage || 'sqlite').padEnd(30)}║
║   2FA:      ${(config.security?.require2FA ? 'Enabled' : 'Disabled').padEnd(30)}║
║                                              ║
║         Server is ready to accept requests   ║
║                                              ║
╚══════════════════════════════════════════════╝
            `);
        });
        
        // Graceful shutdown
        process.on('SIGTERM', () => shutdown(server));
        process.on('SIGINT', () => shutdown(server));
        
    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown function
async function shutdown(server) {
    logger.info('⚠️  Shutting down gracefully...');
    
    // Stop accepting new connections
    server.close(async () => {
        try {
            // Stop scheduler
            scheduler.stop();
            await jobManager.stopAll();
            logger.info('Schedulers stopped');
            
            // Close database connection
            await sequelize.close();
            logger.info('Database connection closed');
            
            logger.success('👋 Server shutdown complete');
            process.exit(0);
        } catch (error) {
            logger.error('Error during shutdown:', error);
            process.exit(1);
        }
    });
    
    // Force shutdown after 30 seconds
    setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 30000);
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Start the server
startServer();

module.exports = app; // For testing
