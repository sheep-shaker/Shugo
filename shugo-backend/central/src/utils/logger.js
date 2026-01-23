// src/utils/logger.js
// Configuration du système de logging avec Winston

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Custom log levels
const customLevels = {
    levels: {
        error: 0,
        warn: 1,
        info: 2,
        http: 3,
        success: 4,
        debug: 5
    },
    colors: {
        error: 'red',
        warn: 'yellow',
        info: 'blue',
        http: 'magenta',
        success: 'green',
        debug: 'gray'
    }
};

// Add colors to winston
winston.addColors(customLevels.colors);

// Custom format for console output
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.colorize({ all: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let msg = `${timestamp} [${level}]: ${message}`;
        if (Object.keys(meta).length > 0) {
            msg += ` ${JSON.stringify(meta, null, 2)}`;
        }
        return msg;
    })
);

// Custom format for file output
const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Create daily rotate file transport for all logs
const dailyRotateFileTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'shugo-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '30d',
    format: fileFormat,
    level: 'debug'
});

// Create daily rotate file transport for errors only
const errorFileTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '90d',
    format: fileFormat,
    level: 'error'
});

// Create the logger
const logger = winston.createLogger({
    levels: customLevels.levels,
    level: process.env.LOG_LEVEL || 'info',
    transports: [
        dailyRotateFileTransport,
        errorFileTransport
    ],
    exitOnError: false
});

// Add console transport in non-production
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: consoleFormat,
        level: process.env.LOG_LEVEL || 'debug'
    }));
}

// Add custom success method
logger.success = function(message, meta = {}) {
    this.log('success', message, meta);
};

// Stream for Morgan HTTP logging
logger.stream = {
    write: (message) => {
        logger.http(message.trim());
    }
};

// Error handling for the logger itself
dailyRotateFileTransport.on('error', (error) => {
    console.error('Logger error:', error);
});

errorFileTransport.on('error', (error) => {
    console.error('Error logger error:', error);
});

// Export utility functions
const loggerUtils = {
    // Log API request
    logRequest(req, responseTime = null) {
        const logData = {
            method: req.method,
            url: req.url,
            ip: req.ip,
            userAgent: req.get('user-agent'),
            userId: req.user?.member_id || null
        };
        
        if (responseTime) {
            logData.responseTime = `${responseTime}ms`;
        }
        
        logger.http('API Request', logData);
    },
    
    // Log API response
    logResponse(req, res, responseTime) {
        const logData = {
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            responseTime: `${responseTime}ms`,
            userId: req.user?.member_id || null
        };
        
        if (res.statusCode >= 400) {
            logger.warn('API Error Response', logData);
        } else {
            logger.http('API Response', logData);
        }
    },
    
    // Log database query
    logQuery(query, timing = null) {
        const logData = {
            query: query.substring(0, 500), // Limit query length
            timing: timing ? `${timing}ms` : null
        };
        
        logger.debug('Database Query', logData);
    },
    
    // Log security event
    logSecurity(event, data = {}) {
        logger.warn(`Security Event: ${event}`, {
            ...data,
            timestamp: new Date().toISOString()
        });
    },
    
    // Log audit event
    logAudit(action, userId, resourceType, resourceId, result = 'success', details = {}) {
        logger.info('Audit Event', {
            action,
            userId,
            resourceType,
            resourceId,
            result,
            details,
            timestamp: new Date().toISOString()
        });
    },
    
    // Clear old logs
    async clearOldLogs(daysToKeep = 90) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        
        try {
            const files = fs.readdirSync(logsDir);
            let deletedCount = 0;
            
            for (const file of files) {
                const filePath = path.join(logsDir, file);
                const stats = fs.statSync(filePath);
                
                if (stats.mtime < cutoffDate) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            }
            
            logger.info(`Cleared ${deletedCount} old log files`);
            return deletedCount;
            
        } catch (error) {
            logger.error('Failed to clear old logs:', error);
            throw error;
        }
    },
    
    // Get log file size
    getLogSize() {
        try {
            const files = fs.readdirSync(logsDir);
            let totalSize = 0;
            
            for (const file of files) {
                const filePath = path.join(logsDir, file);
                const stats = fs.statSync(filePath);
                totalSize += stats.size;
            }
            
            return {
                bytes: totalSize,
                mb: (totalSize / (1024 * 1024)).toFixed(2),
                files: files.length
            };
            
        } catch (error) {
            logger.error('Failed to get log size:', error);
            return { bytes: 0, mb: 0, files: 0 };
        }
    }
};

// Attach utils to logger
logger.utils = loggerUtils;

module.exports = logger;
