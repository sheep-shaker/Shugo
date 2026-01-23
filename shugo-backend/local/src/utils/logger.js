// packages/local/src/utils/logger.js
// Logger configuration for local server

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Ensure logs directory exists
const logsDir = config.paths?.logs || path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    if (Object.keys(metadata).length > 0) {
        msg += ` ${JSON.stringify(metadata)}`;
    }
    
    return msg;
});

// Create logger instance
const logger = winston.createLogger({
    level: config.logging?.level || 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat()
    ),
    
    defaultMeta: {
        service: 'shugo-local',
        serverId: config.server?.id,
        geoId: config.server?.geo_id
    },
    
    transports: [
        // Console transport
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                consoleFormat
            ),
            silent: process.env.NODE_ENV === 'test'
        }),
        
        // Error file transport
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            format: winston.format.json(),
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: config.logging?.maxFiles || 7
        }),
        
        // Combined file transport
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            format: winston.format.json(),
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: config.logging?.maxFiles || 7
        }),
        
        // Sync-specific logs
        new winston.transports.File({
            filename: path.join(logsDir, 'sync.log'),
            level: 'info',
            format: winston.format.json(),
            maxsize: 5 * 1024 * 1024, // 5MB
            maxFiles: 3
        })
    ],
    
    exceptionHandlers: [
        new winston.transports.File({
            filename: path.join(logsDir, 'exceptions.log'),
            format: winston.format.json()
        })
    ],
    
    rejectionHandlers: [
        new winston.transports.File({
            filename: path.join(logsDir, 'rejections.log'),
            format: winston.format.json()
        })
    ]
});

// Add performance logging in development
if (config.isDevelopment) {
    logger.add(new winston.transports.File({
        filename: path.join(logsDir, 'performance.log'),
        level: 'debug',
        format: winston.format.json()
    }));
}

// Helper methods for structured logging
logger.logRequest = (req, res, responseTime) => {
    logger.info('HTTP Request', {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        user: req.user?.member_id,
        statusCode: res.statusCode,
        responseTime: `${responseTime}ms`
    });
};

logger.logError = (error, context = {}) => {
    logger.error(error.message, {
        ...context,
        stack: error.stack,
        code: error.code,
        name: error.name
    });
};

logger.logSync = (action, details = {}) => {
    logger.info(`Sync: ${action}`, {
        ...details,
        category: 'sync'
    });
};

logger.logSecurity = (event, details = {}) => {
    logger.warn(`Security: ${event}`, {
        ...details,
        category: 'security'
    });
};

logger.logPerformance = (operation, duration, details = {}) => {
    logger.debug(`Performance: ${operation}`, {
        duration: `${duration}ms`,
        ...details,
        category: 'performance'
    });
};

// Log rotation check
setInterval(() => {
    const stats = fs.statSync(path.join(logsDir, 'combined.log'));
    if (stats.size > 50 * 1024 * 1024) { // 50MB
        logger.warn('Log file size warning', {
            size: stats.size,
            file: 'combined.log'
        });
    }
}, 60 * 60 * 1000); // Check every hour

module.exports = logger;
