'use strict';

/**
 * Configuration principale SHUGO
 * 
 * Centralise toutes les configurations et valide les variables d'environnement.
 * 
 * @see Document Technique V7.0 - Section 2.8
 */

require('dotenv').config();

const path = require('path');

// Validation des variables obligatoires
const requiredEnvVars = [
  'NODE_ENV',
  'DB_HOST',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'ENCRYPTION_KEY',
  'HMAC_KEY'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0 && process.env.NODE_ENV === 'production') {
  throw new Error(`Variables d'environnement manquantes: ${missingVars.join(', ')}`);
}

/**
 * Configuration exportée
 */
const config = {
  // === ENVIRONNEMENT ===
  env: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV === 'development',
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',

  // === APPLICATION ===
  app: {
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    apiUrl: process.env.API_URL || 'http://localhost:3000'
  },

  // === SERVEUR ===
  server: {
    name: process.env.SERVER_NAME || 'SHUGO-CENTRAL',
    version: process.env.SERVER_VERSION || '7.0.0',
    port: parseInt(process.env.PORT, 10) || 3000,
    host: process.env.HOST || '0.0.0.0',
    serverId: process.env.SERVER_ID || 'central-001',
    serverType: process.env.SERVER_TYPE || 'central', // central ou local
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    apiVersion: 'v1',
    apiPrefix: '/api/v1',
    trustProxy: process.env.TRUST_PROXY === 'true'
  },

  // === BASE DE DONNÉES ===
  database: {
    // Support SQLite in development mode if DB_DIALECT=sqlite
    dialect: process.env.DB_DIALECT || 'postgres',
    // SQLite config (for development without PostgreSQL)
    ...(process.env.DB_DIALECT === 'sqlite' ? {
      storage: process.env.DB_STORAGE || path.join(__dirname, '../../data/shugo_central.db')
    } : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      name: process.env.DB_NAME || 'shugo_central',
      user: process.env.DB_USER || 'shugo',
      password: process.env.DB_PASSWORD || ''
    }),
    pool: {
      max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
      min: parseInt(process.env.DB_POOL_MIN, 10) || 5,
      acquire: parseInt(process.env.DB_POOL_ACQUIRE, 10) || 30000,
      idle: parseInt(process.env.DB_POOL_IDLE, 10) || 10000
    },
    logging: process.env.DB_LOGGING === 'true' ? console.log : false,
    timezone: process.env.DB_TIMEZONE || '+00:00',
    ssl: process.env.DB_SSL === 'true' ? {
      require: true,
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
    } : false
  },

  // === REDIS (Cache et sessions) ===
  redis: {
    enabled: process.env.REDIS_ENABLED === 'true',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || null,
    db: parseInt(process.env.REDIS_DB, 10) || 0,
    keyPrefix: process.env.REDIS_PREFIX || 'shugo:'
  },

  // === JWT ET AUTHENTIFICATION ===
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',
    issuer: process.env.JWT_ISSUER || 'shugo-central',
    audience: process.env.JWT_AUDIENCE || 'shugo-users',
    algorithm: 'HS512'
  },

  // === SÉCURITÉ ET CRYPTOGRAPHIE ===
  security: {
    // Clé AES-256 (64 caractères hex = 32 bytes)
    encryptionKey: process.env.ENCRYPTION_KEY || '0'.repeat(64),
    // Clé HMAC pour signatures
    hmacKey: process.env.HMAC_KEY || '0'.repeat(64),
    // Clé maître du Vault
    vaultMasterKey: process.env.VAULT_MASTER_KEY || '0'.repeat(64),
    // Cookie secret
    cookieSecret: process.env.COOKIE_SECRET || 'dev-cookie-secret',
    
    // Argon2 (hachage mot de passe)
    argon2: {
      type: 2, // argon2id
      memoryCost: parseInt(process.env.ARGON2_MEMORY, 10) || 65536, // 64 MB
      timeCost: parseInt(process.env.ARGON2_TIME, 10) || 3,
      parallelism: parseInt(process.env.ARGON2_PARALLELISM, 10) || 4,
      hashLength: 32
    },

    // TOTP (2FA)
    totp: {
      issuer: process.env.TOTP_ISSUER || 'SHUGO',
      window: parseInt(process.env.TOTP_WINDOW, 10) || 1,
      step: 30,
      digits: 6,
      algorithm: 'sha1'
    },

    // Rotation des clés
    keyRotation: {
      aesIntervalDays: 365, // Rotation annuelle
      secretIntervalDays: 365,
      warningDays: 30 // Alerte 30 jours avant expiration
    },

    // Rate limiting
    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW, 10) || 15 * 60 * 1000, // 15 min
      max: parseInt(process.env.RATE_LIMIT_MAX, 10) || (process.env.NODE_ENV === 'development' ? 10000 : 100),
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100, // Legacy, kept for compatibility
      maxAuthAttempts: parseInt(process.env.RATE_LIMIT_AUTH, 10) || 5,
      authLockoutMinutes: parseInt(process.env.AUTH_LOCKOUT_MINUTES, 10) || 15,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests, please try again later.' }
    },

    // Session
    session: {
      maxConcurrent: parseInt(process.env.MAX_CONCURRENT_SESSIONS, 10) || 5,
      inactivityTimeout: parseInt(process.env.SESSION_INACTIVITY, 10) || 30 * 60 * 1000 // 30 min
    }
  },

  // === GÉOGRAPHIE ===
  geo: {
    defaultGeoId: process.env.DEFAULT_GEO_ID || '02-33-06-01-00',
    defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Europe/Paris',
    defaultLanguage: process.env.DEFAULT_LANGUAGE || 'fr'
  },

  // === NOTIFICATIONS ===
  notifications: {
    // Mailjet
    mailjet: {
      apiKey: process.env.MAILJET_API_KEY || '',
      apiSecret: process.env.MAILJET_API_SECRET || '',
      fromEmail: process.env.MAILJET_FROM_EMAIL || 'noreply@shugo.app',
      fromName: process.env.MAILJET_FROM_NAME || 'SHUGO',
      enabled: process.env.MAILJET_ENABLED === 'true'
    },
    
    // Matrix/Element
    matrix: {
      homeserverUrl: process.env.MATRIX_HOMESERVER || '',
      accessToken: process.env.MATRIX_ACCESS_TOKEN || '',
      userId: process.env.MATRIX_USER_ID || '',
      enabled: process.env.MATRIX_ENABLED === 'true'
    },

    // Firebase Cloud Messaging (Push notifications)
    fcm: {
      enabled: process.env.FCM_ENABLED === 'true',
      serverKey: process.env.FCM_SERVER_KEY || '',
      senderId: process.env.FCM_SENDER_ID || '',
      icon: process.env.FCM_NOTIFICATION_ICON || '/icons/notification.png',
      defaultClickAction: process.env.FCM_CLICK_ACTION || 'https://app.shugo.app'
    },

    // Paramètres de relance
    reminders: {
      guardReminderDays: [2, 0], // J-2 et J
      guardReminderTimes: ['12:00', '08:00'],
      emptySlotDays: [7, 3, 1], // J-7, J-3, J-1
      relanceDays: [1, 4, 6] // Lundi, Jeudi, Samedi
    }
  },

  // === MAINTENANCE ===
  maintenance: {
    enabled: process.env.MAINTENANCE_ENABLED !== 'false',
    nightlyHour: parseInt(process.env.MAINTENANCE_HOUR, 10) || 0, // 00h00
    nightlyMinute: parseInt(process.env.MAINTENANCE_MINUTE, 10) || 0,
    durationMinutes: parseInt(process.env.MAINTENANCE_DURATION, 10) || 45,
    timezone: process.env.MAINTENANCE_TIMEZONE || 'local' // 'local' ou 'UTC'
  },

  // === SAUVEGARDE ===
  backup: {
    enabled: process.env.BACKUP_ENABLED !== 'false',
    dailyHour: parseInt(process.env.BACKUP_DAILY_HOUR, 10) || 0,
    dailyMinute: parseInt(process.env.BACKUP_DAILY_MINUTE, 10) || 30,
    weeklyDay: parseInt(process.env.BACKUP_WEEKLY_DAY, 10) || 0, // Dimanche
    weeklyHour: parseInt(process.env.BACKUP_WEEKLY_HOUR, 10) || 2,
    retentionDays: {
      daily: parseInt(process.env.BACKUP_RETENTION_DAILY, 10) || 30,
      weekly: parseInt(process.env.BACKUP_RETENTION_WEEKLY, 10) || 90,
      monthly: parseInt(process.env.BACKUP_RETENTION_MONTHLY, 10) || 365
    },
    storagePath: process.env.BACKUP_PATH || path.join(__dirname, '../../backups'),
    externalStorage: {
      enabled: process.env.BACKUP_EXTERNAL_ENABLED === 'true',
      type: process.env.BACKUP_EXTERNAL_TYPE || 's3', // s3, gcs, azure
      bucket: process.env.BACKUP_EXTERNAL_BUCKET || '',
      region: process.env.BACKUP_EXTERNAL_REGION || ''
    }
  },

  // === LOGS ===
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json', // json ou simple
    directory: process.env.LOG_DIR || path.join(__dirname, '../../logs'),
    maxSize: process.env.LOG_MAX_SIZE || '20m',
    maxFiles: process.env.LOG_MAX_FILES || '14d',
    auditRetentionDays: parseInt(process.env.AUDIT_RETENTION_DAYS, 10) || 365
  },

  // === PLUGINS ===
  plugins: {
    enabled: process.env.PLUGINS_ENABLED !== 'false',
    directory: process.env.PLUGINS_DIR || path.join(__dirname, '../../plugins'),
    autoLoad: process.env.PLUGINS_AUTOLOAD === 'true'
  },

  // === CORS ===
  cors: {
    enabled: process.env.CORS_ENABLED !== 'false',
    origins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-ID'],
    credentials: true,
    maxAge: 86400
  },

  // === FEATURES FLAGS ===
  features: {
    twoFactorRequired: process.env.FEATURE_2FA_REQUIRED === 'true',
    emailVerificationRequired: process.env.FEATURE_EMAIL_VERIFY === 'true',
    registrationOpen: process.env.FEATURE_REGISTRATION_OPEN !== 'false',
    maintenanceMode: process.env.FEATURE_MAINTENANCE_MODE === 'true',
    debugMode: process.env.FEATURE_DEBUG_MODE === 'true'
  }
};

// Validation supplémentaire en production
if (config.isProd) {
  if (config.security.encryptionKey === '0'.repeat(64)) {
    throw new Error('ENCRYPTION_KEY doit être défini en production');
  }
  if (config.jwt.secret === 'dev-secret-change-in-production') {
    throw new Error('JWT_SECRET doit être défini en production');
  }
}

module.exports = config;
