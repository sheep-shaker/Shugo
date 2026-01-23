// packages/core/utils/logger.js
// Shared logger configuration

const winston = require('winston');

const createLogger = (service = 'shugo-core') => {
    return winston.createLogger({
        level: process.env.LOG_LEVEL || 'info',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json()
        ),
        defaultMeta: { service },
        transports: [
            new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.simple()
                )
            })
        ]
    });
};

module.exports = createLogger('shugo-core');
module.exports.createLogger = createLogger;
