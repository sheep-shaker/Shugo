// packages/core/config/base.js
// Configuration de base partagée entre tous les serveurs

module.exports = {
    // Application
    app: {
        name: process.env.APP_NAME || 'SHUGO',
        version: '7.0.0',
        environment: process.env.NODE_ENV || 'development'
    },
    
    // Security defaults
    security: {
        jwtAlgorithm: 'HS256',
        jwtExpiresIn: '24h',
        jwtRefreshExpiresIn: '7d',
        bcryptRounds: 10,
        maxLoginAttempts: 5,
        lockoutDuration: 15 * 60 * 1000, // 15 minutes
        sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
        
        // Encryption
        encryption: {
            algorithm: 'aes-256-gcm',
            ivLength: 16,
            tagLength: 16,
            saltLength: 32
        },
        
        // Password policy
        password: {
            minLength: 8,
            requireUppercase: true,
            requireLowercase: true,
            requireNumbers: true,
            requireSymbols: false
        }
    },
    
    // Database defaults
    database: {
        dialect: 'postgres',
        pool: {
            min: 0,
            max: 5,
            acquire: 30000,
            idle: 10000
        },
        logging: false,
        timezone: 'UTC'
    },
    
    // Logging
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        format: 'json',
        maxFiles: 30,
        maxSize: '20m'
    },
    
    // Business rules
    business: {
        guard: {
            maxDaysAdvance: 90,
            minParticipants: 1,
            maxParticipants: 10,
            slotDuration: 30, // minutes
            cancellation: {
                normal: 7 * 24 * 60 * 60 * 1000,    // 7 days
                early: 3 * 24 * 60 * 60 * 1000,     // 3 days
                late: 0                               // Less than 3 days
            },
            reminder: {
                first: 2 * 24 * 60 * 60 * 1000,     // 2 days before
                second: 8 * 60 * 60 * 1000          // 8 hours before
            }
        },
        
        user: {
            roles: ['Silver', 'Gold', 'Platinum', 'Admin', 'Admin_N1'],
            defaultRole: 'Silver',
            maxGroupsPerUser: 5
        },
        
        notification: {
            channels: ['email', 'matrix', 'push'],
            defaultChannel: 'email',
            batchSize: 100,
            retryAttempts: 3
        }
    },
    
    // Sync configuration (for local servers)
    sync: {
        enabled: false,
        interval: 5 * 60 * 1000,        // 5 minutes
        batchSize: 100,
        compression: true,
        retryAttempts: 3,
        retryDelay: 60 * 1000,          // 1 minute
        heartbeatInterval: 5 * 60 * 1000 // 5 minutes
    },
    
    // Cache configuration
    cache: {
        enabled: false,
        ttl: 5 * 60,                    // 5 minutes in seconds
        checkPeriod: 60,                // 60 seconds
        maxKeys: 1000
    },
    
    // File storage
    storage: {
        maxFileSize: 10 * 1024 * 1024,  // 10MB
        allowedMimeTypes: [
            'image/jpeg',
            'image/png',
            'image/gif',
            'application/pdf'
        ],
        uploadDir: './uploads'
    },
    
    // Rate limiting
    rateLimit: {
        windowMs: 15 * 60 * 1000,       // 15 minutes
        max: 100,                        // Limit each IP to 100 requests per windowMs
        message: 'Too many requests from this IP'
    },
    
    // Maintenance
    maintenance: {
        daily: {
            enabled: true,
            time: '00:00',               // Midnight local time
            duration: 45                 // minutes
        }
    }
};
