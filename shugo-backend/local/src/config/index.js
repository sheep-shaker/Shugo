// packages/local/src/config/index.js
// Configuration serveur local optimisée pour Raspberry Pi

require('dotenv').config();
const path = require('path');
const baseConfig = require('@shugo/core/config/base');

module.exports = {
    // Hérite de la config de base
    ...baseConfig,
    
    // Override pour serveur local
    server: {
        port: process.env.PORT || 3001,
        host: process.env.HOST || '0.0.0.0',
        name: process.env.SERVER_NAME || 'SHUGO-LOCAL',
        id: process.env.SERVER_ID || require('crypto').randomBytes(16).toString('hex'),
        geo_id: process.env.GEO_ID || '00-00-00-00-00',
        type: 'local'
    },
    
    // Central server connection
    central: {
        url: process.env.CENTRAL_URL || 'https://central.shugo.local',
        apiKey: process.env.CENTRAL_API_KEY,
        sharedSecret: process.env.SHARED_SECRET,
        timeout: 10000,
        retryAttempts: 3
    },
    
    // Database - SQLite par défaut pour Pi
    database: {
        ...baseConfig.database,
        dialect: process.env.DB_DIALECT || 'sqlite',
        storage: process.env.DB_PATH || path.join(__dirname, '../../data/shugo_local.db'),
        
        // PostgreSQL for sync only (optional)
        sync: {
            enabled: process.env.PG_SYNC_ENABLED === 'true',
            host: process.env.PG_HOST,
            port: process.env.PG_PORT || 5432,
            database: process.env.PG_DATABASE,
            username: process.env.PG_USER,
            password: process.env.PG_PASSWORD
        },
        
        // SQLite specific optimizations
        pool: {
            max: 1,
            min: 0,
            acquire: 30000,
            idle: 10000
        },
        
        // Performance tuning for Pi
        pragma: {
            journal_mode: 'WAL',
            synchronous: 'NORMAL',
            cache_size: 10000,
            temp_store: 'MEMORY'
        }
    },
    
    // Cache optimisé pour Pi
    cache: {
        enabled: true,
        type: 'memory',
        ttl: 300, // 5 minutes
        checkPeriod: 60,
        maxKeys: 500, // Limite pour économiser RAM
        useClones: false // Économie mémoire
    },
    
    // Synchronisation
    sync: {
        enabled: true,
        mode: process.env.SYNC_MODE || 'auto', // auto, manual, offline
        interval: 5 * 60 * 1000, // 5 minutes
        batchSize: 50, // Petits paquets pour Pi
        compression: true,
        
        // Queues
        maxQueueSize: 1000,
        queueConcurrency: 2, // Limite concurrence pour Pi
        
        // Heartbeat
        heartbeatInterval: 5 * 60 * 1000, // 5 minutes
        heartbeatTimeout: 30000,
        
        // Data sync priorities
        priorities: {
            users: 1,      // Highest priority
            guards: 2,
            assignments: 3,
            groups: 4,
            notifications: 5,
            logs: 10       // Lowest priority
        },
        
        // Conflict resolution
        conflictResolution: 'local_priority', // local_priority, central_priority, newest_wins
        
        // Offline mode
        offline: {
            maxDuration: 7 * 24 * 60 * 60 * 1000, // 7 days
            dataRetention: 30 * 24 * 60 * 60 * 1000 // 30 days
        }
    },
    
    // Paths locaux
    paths: {
        root: path.resolve(__dirname, '../..'),
        data: path.join(__dirname, '../../data'),
        backups: path.join(__dirname, '../../backups'),
        logs: path.join(__dirname, '../../logs'),
        uploads: path.join(__dirname, '../../uploads'),
        temp: '/tmp/shugo'
    },
    
    // Performance optimizations for Pi
    performance: {
        maxMemory: 256 * 1024 * 1024, // 256MB max heap
        gcInterval: 60 * 1000, // Force GC every minute
        
        // Request limits
        maxRequestSize: '10mb',
        maxUploadSize: 5 * 1024 * 1024, // 5MB
        
        // Timeouts
        requestTimeout: 30000,
        
        // Process management
        clustering: false, // Disable clustering on Pi
        workers: 1
    },
    
    // Security - Local vault
    vault: {
        enabled: true,
        // Disable key rotation in dev, use 30 days in prod (within 32-bit safe range)
        keyRotation: process.env.NODE_ENV === 'production' ? 30 * 24 * 60 * 60 * 1000 : null,
        backupEncryption: true,
        
        // Local encryption keys
        keys: {
            master: process.env.VAULT_MASTER_KEY,
            data: process.env.VAULT_DATA_KEY,
            backup: process.env.VAULT_BACKUP_KEY
        }
    },
    
    // Logging optimized for Pi
    logging: {
        ...baseConfig.logging,
        level: process.env.LOG_LEVEL || 'warn', // Less verbose
        maxFiles: 7, // Keep only 1 week
        maxSize: '10m', // Smaller files
        
        // Separate logs by type
        transports: {
            error: true,
            combined: true,
            sync: true,
            access: false // Disable access logs to save space
        }
    },
    
    // Backup configuration
    backup: {
        enabled: true,
        schedule: '0 3 * * *', // 3 AM daily
        retention: 7, // Keep 7 days
        compress: true,
        encrypt: true,
        
        // Destinations
        destinations: {
            local: true,
            central: false, // Upload to central
            external: process.env.BACKUP_EXTERNAL_PATH // USB/Network drive
        }
    },
    
    // Feature flags
    features: {
        guards: true,
        groups: true,
        notifications: true,
        calendar: false, // Plugin
        matrix: false, // Plugin
        sso: false, // Plugin
        
        // Advanced features
        offline_mode: true,
        auto_sync: true,
        backup: true,
        monitoring: true
    },
    
    // Rate limiting for Pi
    rateLimit: {
        windowMs: 15 * 60 * 1000,
        max: 50, // Lower limit for Pi
        skipSuccessfulRequests: true
    },
    
    // Development
    isDevelopment: process.env.NODE_ENV === 'development',
    isProduction: process.env.NODE_ENV === 'production',
    debug: process.env.DEBUG === 'true'
};
