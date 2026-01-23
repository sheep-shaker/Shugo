// middleware/index.js
// Export centralisé de tous les middleware SHUGO v7

// Middleware d'authentification de base (existants)
const authenticate = require('./authenticate');
const authorize = require('./authorize');
const validateRequest = require('./validateRequest');
const errorHandler = require('./errorHandler');

// Nouveaux middleware du BLOC 4
const auth2FA = require('./auth2FA');
const rateLimiter = require('./rateLimiter');
const audit = require('./audit');
const scope = require('./scope');
const permissions = require('./permissions');
const sanitizer = require('./sanitizer');

/**
 * Fonction pour monter tous les middleware globaux
 * @param {Express.Application} app - Application Express
 */
function mountGlobalMiddleware(app) {
  const express = require('express');
  const helmet = require('helmet');
  const cors = require('cors');
  const compression = require('compression');
  const morgan = require('morgan');
  
  // Sécurité de base
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  }));

  // CORS
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
    optionsSuccessStatus: 200
  }));

  // Compression
  app.use(compression());

  // Body parsers
  app.use(express.json({ 
    limit: '10mb',
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    }
  }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Logging
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('combined'));
  }

  // Rate limiting global
  app.use('/api', rateLimiter.api);
  app.use('/auth/login', rateLimiter.login);
  app.use('/auth/register', rateLimiter.register);

  // Sanitisation globale
  app.use(sanitizer.sanitize({}, {
    logAttacks: true,
    strict: false
  }));

  // Audit global pour toutes les requêtes
  if (process.env.ENABLE_AUDIT === 'true') {
    app.use(audit.auditLog({
      entity_type: 'api',
      includeRequestBody: false,
      includeResponseData: false
    }));
  }

  console.log('Global middleware mounted');
}

/**
 * Middleware combinés pour les routes communes
 */
const middlewareSets = {
  // Routes publiques (pas d'auth)
  public: [
    rateLimiter.public,
    sanitizer.sanitize()
  ],

  // Routes authentifiées basiques
  authenticated: [
    authenticate,
    rateLimiter.api,
    sanitizer.sanitize()
  ],

  // Routes admin
  admin: [
    authenticate,
    permissions.adminOnly,
    auth2FA.moderate,
    rateLimiter.admin,
    sanitizer.sanitize(),
    audit.auditLog({ severity: 'warning' })
  ],

  // Routes critiques (vault, backup, etc.)
  critical: [
    authenticate,
    permissions.superAdminOnly,
    auth2FA.critical,
    scope.globalScope,
    rateLimiter.vault,
    sanitizer.sanitize({ }, { strict: true }),
    audit.criticalAudit('critical_operation', 'system')
  ],

  // Routes de protocoles
  protocol: [
    authenticate,
    permissions.requirePermissions(['protocol.*'], { checkAll: false }),
    auth2FA.critical,
    scope.requireScope({ requiredScope: 'global' }),
    rateLimiter.createRateLimiter({ points: 1, duration: 300 }), // 1 req/5min
    audit.auditLog({ 
      severity: 'critical',
      includeRequestBody: true,
      includeResponseData: true 
    })
  ],

  // Routes de données sensibles
  sensitive: [
    authenticate,
    auth2FA.require2FA({ recentWindow: 5 }),
    rateLimiter.vault,
    sanitizer.sanitize({}, { strict: true }),
    audit.auditSensitiveAccess('data')
  ],

  // Routes d'export
  export: [
    authenticate,
    permissions.requirePermissions('user.export'),
    rateLimiter.export,
    audit.auditDataExport('users')
  ],

  // Routes de configuration
  config: [
    authenticate,
    permissions.requirePermissions('system.configure'),
    auth2FA.critical,
    scope.globalScope,
    sanitizer.config,
    audit.auditConfigChange()
  ],

  // Routes de liste d'attente
  waitingList: [
    authenticate,
    scope.localScope,
    rateLimiter.api,
    sanitizer.sanitize()
  ],

  // Routes de missions
  missions: [
    authenticate,
    permissions.requirePermissions(['mission.view', 'mission.create'], { checkAll: false }),
    scope.requireScope({ requiredScope: 'local' }),
    rateLimiter.api,
    sanitizer.sanitize(),
    audit.auditLog({ entity_type: 'mission' })
  ]
};

/**
 * Helper pour appliquer des middleware à un router
 */
function applyMiddleware(router, middlewareSet) {
  if (typeof middlewareSet === 'string') {
    middlewareSet = middlewareSets[middlewareSet];
  }
  
  if (Array.isArray(middlewareSet)) {
    middlewareSet.forEach(mw => router.use(mw));
  }
  
  return router;
}

/**
 * Fonction de vérification de santé des middleware
 */
async function healthCheck() {
  const health = {
    timestamp: new Date(),
    middleware: {}
  };

  // Vérifier rate limiter
  try {
    const rateLimiterStats = await rateLimiter.getStats();
    health.middleware.rateLimiter = {
      status: 'ok',
      ...rateLimiterStats
    };
  } catch (error) {
    health.middleware.rateLimiter = {
      status: 'error',
      error: error.message
    };
  }

  // Vérifier autres middleware si nécessaire
  health.middleware.auth2FA = { status: 'ok', available: true };
  health.middleware.audit = { status: 'ok', available: true };
  health.middleware.sanitizer = { status: 'ok', available: true };
  health.middleware.scope = { status: 'ok', available: true };
  health.middleware.permissions = { status: 'ok', available: true };

  health.overall = Object.values(health.middleware).every(m => m.status === 'ok') ? 
    'healthy' : 'degraded';

  return health;
}

// Export
module.exports = {
  // Middleware existants (BLOC 4 précédent)
  authenticate,
  authorize,
  validateRequest,
  errorHandler,
  
  // Nouveaux middleware (BLOC 4 complet)
  auth2FA,
  rateLimiter,
  audit,
  scope,
  permissions,
  sanitizer,
  
  // Fonctions utilitaires
  mountGlobalMiddleware,
  applyMiddleware,
  middlewareSets,
  healthCheck,
  
  // Raccourcis pour les middleware les plus utilisés
  require2FA: auth2FA.require2FA,
  requirePermissions: permissions.requirePermissions,
  requireScope: scope.requireScope,
  requireRole: permissions.requireRole,
  rateLimit: rateLimiter.createRateLimiter,
  auditLog: audit.auditLog,
  sanitize: sanitizer.sanitize,
  validate: sanitizer.validateSchema
};
