// middleware/rateLimiter.js
// Middleware de limitation du taux de requêtes avec Redis et stratégies adaptatives

const redis = require('redis');
const { RateLimiter } = require('limiter');
const { AuditLog } = require('../models');
const config = require('../config');

// Client Redis pour le stockage distribué
let redisClient = null;

// Limites par défaut (augmentées pour le développement)
const isDev = process.env.NODE_ENV === 'development';
const DEFAULT_LIMITS = {
  // Endpoints publics
  public: { points: isDev ? 1000 : 100, duration: 60 },

  // Auth endpoints (augmentés pour dev)
  login: { points: isDev ? 50 : 5, duration: 60 },
  register: { points: isDev ? 30 : 3, duration: 300 },
  passwordReset: { points: isDev ? 30 : 3, duration: 900 },

  // API générales
  api: { points: isDev ? 2000 : 200, duration: 60 },
  search: { points: isDev ? 300 : 30, duration: 60 },

  // Opérations sensibles
  vault: { points: isDev ? 100 : 10, duration: 60 },
  backup: { points: isDev ? 20 : 2, duration: 3600 },
  admin: { points: isDev ? 500 : 50, duration: 60 },

  // Notifications
  notification: { points: isDev ? 200 : 20, duration: 60 },
  email: { points: isDev ? 50 : 5, duration: 60 },
  sms: { points: isDev ? 20 : 2, duration: 60 },

  // Uploads
  upload: { points: isDev ? 100 : 10, duration: 300 },
  largeUpload: { points: isDev ? 20 : 2, duration: 3600 },

  // Exports
  export: { points: isDev ? 50 : 5, duration: 300 },
  report: { points: isDev ? 30 : 3, duration: 600 },
};

// Stratégies de limitation
const STRATEGIES = {
  // IP-based limiting
  IP: 'ip',
  
  // User-based limiting
  USER: 'user',
  
  // Combined IP + User
  COMBINED: 'combined',
  
  // API key based
  API_KEY: 'api_key',
  
  // Global limiting
  GLOBAL: 'global'
};

/**
 * Initialiser le service de rate limiting
 */
async function initialize() {
  try {
    if (config.redis?.enabled) {
      redisClient = redis.createClient({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db || 0
      });

      await redisClient.connect();
      console.log('RateLimiter: Redis connected');
    } else {
      console.log('RateLimiter: Using in-memory storage (not recommended for production)');
    }
  } catch (error) {
    console.error('RateLimiter initialization error:', error);
  }
}

/**
 * Créer un middleware de rate limiting
 * @param {Object} options - Options de configuration
 * @param {number} options.points - Nombre de points (requêtes) autorisés
 * @param {number} options.duration - Durée en secondes
 * @param {string} options.strategy - Stratégie de limitation
 * @param {boolean} options.skipSuccessfulRequests - Ignorer les requêtes réussies
 * @param {boolean} options.skipFailedRequests - Ignorer les requêtes échouées
 * @param {string} options.keyGenerator - Fonction personnalisée pour générer la clé
 * @param {boolean} options.blockOnLimit - Bloquer temporairement en cas de dépassement
 * @param {number} options.blockDuration - Durée du blocage en secondes
 */
function createRateLimiter(options = {}) {
  const {
    points = 100,
    duration = 60,
    strategy = STRATEGIES.IP,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    keyGenerator = null,
    blockOnLimit = false,
    blockDuration = 600, // 10 minutes
    message = 'Trop de requêtes, veuillez réessayer plus tard',
    onLimitReached = null
  } = options;

  // Stockage en mémoire si Redis non disponible
  const memoryStorage = new Map();

  return async (req, res, next) => {
    try {
      // Générer la clé de limitation
      const key = await generateKey(req, strategy, keyGenerator);
      
      if (!key) {
        return next(); // Pas de limitation si pas de clé
      }

      // Vérifier si l'utilisateur est bloqué
      if (blockOnLimit) {
        const isBlocked = await checkIfBlocked(key);
        if (isBlocked) {
          return sendRateLimitResponse(res, {
            message: 'Accès temporairement bloqué suite à trop de tentatives',
            retryAfter: blockDuration
          });
        }
      }

      // Récupérer ou créer le limiter
      const limiterKey = `ratelimit:${key}`;
      let consumed = 0;

      if (redisClient) {
        // Utiliser Redis
        consumed = await consumeRedis(limiterKey, points, duration);
      } else {
        // Utiliser la mémoire
        consumed = await consumeMemory(memoryStorage, limiterKey, points, duration);
      }

      // Vérifier si limite atteinte
      if (consumed > points) {
        // Log l'événement
        await logRateLimitExceeded(req, key, strategy);

        // Bloquer si configuré
        if (blockOnLimit) {
          await blockKey(key, blockDuration);
        }

        // Callback personnalisé
        if (onLimitReached) {
          await onLimitReached(req, res, { key, consumed, limit: points });
        }

        return sendRateLimitResponse(res, {
          message,
          limit: points,
          remaining: 0,
          retryAfter: duration
        });
      }

      // Ajouter les headers de rate limit
      res.setHeader('X-RateLimit-Limit', points);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, points - consumed));
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + duration * 1000).toISOString());

      // Gérer les options de skip
      const originalEnd = res.end;
      res.end = function(...args) {
        const shouldSkip = (res.statusCode < 400 && skipSuccessfulRequests) ||
                          (res.statusCode >= 400 && skipFailedRequests);
        
        if (shouldSkip && redisClient) {
          // Rembourser le point consommé
          redisClient.decr(limiterKey).catch(console.error);
        }

        originalEnd.apply(res, args);
      };

      next();

    } catch (error) {
      console.error('Rate limiter error:', error);
      next(); // En cas d'erreur, ne pas bloquer la requête
    }
  };
}

/**
 * Middlewares pré-configurés pour différents endpoints
 */
const rateLimiters = {
  // Authentification
  login: createRateLimiter({
    ...DEFAULT_LIMITS.login,
    strategy: STRATEGIES.IP,
    blockOnLimit: !isDev, // Pas de blocage en dev
    blockDuration: isDev ? 60 : 1800, // 1 min en dev, 30 min en prod
    message: 'Trop de tentatives de connexion'
  }),

  register: createRateLimiter({
    ...DEFAULT_LIMITS.register,
    strategy: STRATEGIES.IP,
    blockOnLimit: !isDev, // Pas de blocage en dev
    message: 'Trop de créations de compte'
  }),

  passwordReset: createRateLimiter({
    ...DEFAULT_LIMITS.passwordReset,
    strategy: STRATEGIES.IP,
    message: 'Trop de demandes de réinitialisation'
  }),

  // API
  api: createRateLimiter({
    ...DEFAULT_LIMITS.api,
    strategy: STRATEGIES.USER,
    skipSuccessfulRequests: false
  }),

  search: createRateLimiter({
    ...DEFAULT_LIMITS.search,
    strategy: STRATEGIES.USER
  }),

  // Opérations sensibles
  vault: createRateLimiter({
    ...DEFAULT_LIMITS.vault,
    strategy: STRATEGIES.USER,
    blockOnLimit: true,
    message: 'Accès au vault limité'
  }),

  backup: createRateLimiter({
    ...DEFAULT_LIMITS.backup,
    strategy: STRATEGIES.USER,
    message: 'Limite de sauvegardes atteinte'
  }),

  admin: createRateLimiter({
    ...DEFAULT_LIMITS.admin,
    strategy: STRATEGIES.USER
  }),

  // Communications
  notification: createRateLimiter({
    ...DEFAULT_LIMITS.notification,
    strategy: STRATEGIES.USER
  }),

  email: createRateLimiter({
    ...DEFAULT_LIMITS.email,
    strategy: STRATEGIES.USER,
    message: 'Limite d\'envoi d\'emails atteinte'
  }),

  sms: createRateLimiter({
    ...DEFAULT_LIMITS.sms,
    strategy: STRATEGIES.USER,
    message: 'Limite d\'envoi de SMS atteinte'
  }),

  // Uploads
  upload: createRateLimiter({
    ...DEFAULT_LIMITS.upload,
    strategy: STRATEGIES.USER
  }),

  // Exports
  export: createRateLimiter({
    ...DEFAULT_LIMITS.export,
    strategy: STRATEGIES.USER
  }),

  // Public endpoints
  public: createRateLimiter({
    ...DEFAULT_LIMITS.public,
    strategy: STRATEGIES.IP
  })
};

/**
 * Middleware adaptatif basé sur la réputation
 */
function adaptiveRateLimiter(baseOptions = {}) {
  return async (req, res, next) => {
    try {
      const reputation = await getUserReputation(req);
      
      // Ajuster les limites selon la réputation
      const adjustedOptions = {
        ...baseOptions,
        points: Math.floor(baseOptions.points * reputation.multiplier),
        duration: baseOptions.duration
      };

      // Appliquer le rate limiter avec les options ajustées
      return createRateLimiter(adjustedOptions)(req, res, next);

    } catch (error) {
      console.error('Adaptive rate limiter error:', error);
      return createRateLimiter(baseOptions)(req, res, next);
    }
  };
}

/**
 * Middleware de limitation par geo_id
 */
function geoRateLimiter(options = {}) {
  return createRateLimiter({
    ...options,
    keyGenerator: (req) => {
      const geoId = req.user?.geo_id || req.query.geo_id;
      return geoId ? `geo:${geoId}` : null;
    }
  });
}

// Fonctions utilitaires

async function generateKey(req, strategy, customGenerator) {
  if (customGenerator) {
    return await customGenerator(req);
  }

  switch (strategy) {
    case STRATEGIES.IP:
      return getClientIp(req);
    
    case STRATEGIES.USER:
      return req.user?.member_id ? `user:${req.user.member_id}` : null;
    
    case STRATEGIES.COMBINED:
      const ip = getClientIp(req);
      const userId = req.user?.member_id;
      return userId ? `${ip}:${userId}` : ip;
    
    case STRATEGIES.API_KEY:
      return req.headers['x-api-key'] ? `api:${req.headers['x-api-key']}` : null;
    
    case STRATEGIES.GLOBAL:
      return 'global';
    
    default:
      return getClientIp(req);
  }
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
         req.headers['x-real-ip'] ||
         req.connection.remoteAddress ||
         req.ip;
}

async function consumeRedis(key, points, duration) {
  const multi = redisClient.multi();
  
  multi.incr(key);
  multi.expire(key, duration);
  
  const results = await multi.exec();
  return results[0][1]; // Valeur après incrémentation
}

async function consumeMemory(storage, key, points, duration) {
  const now = Date.now();
  const record = storage.get(key) || { count: 0, resetAt: now + duration * 1000 };
  
  if (now > record.resetAt) {
    record.count = 1;
    record.resetAt = now + duration * 1000;
  } else {
    record.count++;
  }
  
  storage.set(key, record);
  
  // Nettoyer les anciennes entrées
  if (storage.size > 10000) {
    for (const [k, v] of storage.entries()) {
      if (now > v.resetAt) {
        storage.delete(k);
      }
    }
  }
  
  return record.count;
}

async function checkIfBlocked(key) {
  if (!redisClient) return false;
  
  const blocked = await redisClient.get(`blocked:${key}`);
  return !!blocked;
}

async function blockKey(key, duration) {
  if (!redisClient) return;
  
  await redisClient.setex(`blocked:${key}`, duration, '1');
}

async function getUserReputation(req) {
  // Calculer la réputation basée sur l'historique
  const defaultReputation = { multiplier: 1.0, score: 100 };
  
  if (!req.user?.member_id) {
    return defaultReputation;
  }

  try {
    // Vérifier le cache
    if (redisClient) {
      const cached = await redisClient.get(`reputation:${req.user.member_id}`);
      if (cached) {
        return JSON.parse(cached);
      }
    }

    // Calculer la réputation
    const user = await require('../models').User.findByPk(req.user.member_id);
    
    if (!user) return defaultReputation;

    let score = 100;
    let multiplier = 1.0;

    // Facteurs positifs
    if (user.created_at < new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)) {
      score += 20; // Compte ancien
      multiplier += 0.2;
    }
    
    if (user.two_factor_enabled) {
      score += 10; // 2FA activé
      multiplier += 0.1;
    }

    if (user.email_verified) {
      score += 10;
      multiplier += 0.1;
    }

    // Facteurs négatifs
    if (user.failed_login_attempts > 10) {
      score -= 30;
      multiplier -= 0.3;
    }

    const reputation = { 
      multiplier: Math.max(0.5, Math.min(2.0, multiplier)), 
      score 
    };

    // Mettre en cache
    if (redisClient) {
      await redisClient.setex(
        `reputation:${req.user.member_id}`,
        300, // 5 minutes
        JSON.stringify(reputation)
      );
    }

    return reputation;

  } catch (error) {
    console.error('Get user reputation error:', error);
    return defaultReputation;
  }
}

async function logRateLimitExceeded(req, key, strategy) {
  try {
    await AuditLog.create({
      action_type: 'rate_limit.exceeded',
      member_id: req.user?.member_id,
      entity_type: 'security',
      severity: 'warning',
      details: {
        key,
        strategy,
        endpoint: req.originalUrl,
        method: req.method,
        ip_address: getClientIp(req),
        user_agent: req.headers['user-agent']
      }
    });
  } catch (error) {
    console.error('Log rate limit error:', error);
  }
}

function sendRateLimitResponse(res, options) {
  const { message, limit, remaining = 0, retryAfter } = options;
  
  res.status(429)
    .setHeader('Retry-After', retryAfter)
    .json({
      success: false,
      error: {
        code: 'SHUGO-RATE-001',
        message,
        limit,
        remaining,
        retry_after: retryAfter
      }
    });
}

/**
 * Réinitialiser les limites pour un utilisateur (admin only)
 */
async function resetLimits(identifier) {
  if (!redisClient) return false;

  try {
    const keys = await redisClient.keys(`ratelimit:*${identifier}*`);
    
    if (keys.length > 0) {
      await redisClient.del(keys);
    }

    // Débloquer aussi
    const blockKeys = await redisClient.keys(`blocked:*${identifier}*`);
    if (blockKeys.length > 0) {
      await redisClient.del(blockKeys);
    }

    return true;

  } catch (error) {
    console.error('Reset limits error:', error);
    return false;
  }
}

/**
 * Obtenir les statistiques de rate limiting
 */
async function getStats() {
  if (!redisClient) {
    return { available: false };
  }

  try {
    const keys = await redisClient.keys('ratelimit:*');
    const blocked = await redisClient.keys('blocked:*');

    return {
      available: true,
      active_limiters: keys.length,
      blocked_keys: blocked.length,
      timestamp: new Date()
    };

  } catch (error) {
    console.error('Get stats error:', error);
    return { available: false, error: error.message };
  }
}

// Initialisation au chargement du module
initialize().catch(console.error);

/**
 * Factory function for rate limiters by name
 * Returns pre-configured limiter if exists, or creates a new one
 */
function rateLimiter(name) {
  if (rateLimiters[name]) {
    return rateLimiters[name];
  }
  // Create default limiter for unknown names
  return createRateLimiter({
    points: 100,
    duration: 60,
    strategy: STRATEGIES.IP
  });
}

// Export
module.exports = {
  // Factory function
  rateLimiter,

  // Fonction principale
  createRateLimiter,

  // Middlewares pré-configurés
  ...rateLimiters,

  // Middlewares spécialisés
  adaptiveRateLimiter,
  geoRateLimiter,

  // Utilitaires
  resetLimits,
  getStats,

  // Constantes
  STRATEGIES,
  DEFAULT_LIMITS
};
