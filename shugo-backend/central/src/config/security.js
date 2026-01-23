'use strict';

/**
 * SHUGO v7.0 - Configuration de sécurité
 *
 * Paramètres de sécurité centralisés pour le serveur central.
 *
 * @see Document Technique V7.0 - Chapitre 5
 */

module.exports = {
  // ============================================
  // JWT (JSON Web Tokens)
  // ============================================
  jwt: {
    // Durée de vie du token d'accès (en secondes)
    accessTokenExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',

    // Durée de vie du refresh token
    refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',

    // Algorithme de signature
    algorithm: 'HS512',

    // Issuer
    issuer: 'shugo-central',

    // Audience
    audience: 'shugo-users',

    // Secret (DOIT être défini en production)
    secret: process.env.JWT_SECRET,

    // Secret pour les refresh tokens
    refreshSecret: process.env.JWT_REFRESH_SECRET
  },

  // ============================================
  // CHIFFREMENT AES
  // ============================================
  encryption: {
    // Algorithme de chiffrement
    algorithm: 'aes-256-gcm',

    // Longueur de la clé en bytes
    keyLength: 32,

    // Longueur du vecteur d'initialisation
    ivLength: 16,

    // Longueur du tag d'authentification
    authTagLength: 16,

    // Clé de chiffrement principale (DOIT être définie en production)
    key: process.env.ENCRYPTION_KEY,

    // Clé HMAC pour les signatures
    hmacKey: process.env.HMAC_KEY,

    // Rotation des clés
    rotation: {
      // Période de rotation (jours)
      periodDays: 365,

      // Date de début pour le calcul de rotation (1er décembre)
      startMonth: 12,
      startDay: 1,

      // Période de grâce pour double chiffrement (jours)
      gracePeriodDays: 30
    }
  },

  // ============================================
  // MOTS DE PASSE (Argon2)
  // ============================================
  password: {
    // Longueur minimale
    minLength: 12,

    // Longueur maximale
    maxLength: 128,

    // Exiger une majuscule
    requireUppercase: true,

    // Exiger une minuscule
    requireLowercase: true,

    // Exiger un chiffre
    requireNumber: true,

    // Exiger un caractère spécial
    requireSpecial: true,

    // Caractères spéciaux autorisés
    specialChars: '@$!%*?&',

    // Configuration Argon2
    argon2: {
      type: 2, // argon2id
      memoryCost: 65536, // 64 MB
      timeCost: 3,
      parallelism: 4,
      hashLength: 32
    },

    // Historique des mots de passe (empêcher réutilisation)
    historyCount: 5
  },

  // ============================================
  // AUTHENTIFICATION À DEUX FACTEURS
  // ============================================
  twoFactor: {
    // Méthodes disponibles
    methods: ['totp', 'email'],

    // 2FA obligatoire pour certains rôles
    requiredForRoles: ['Admin', 'Admin_N1'],

    // Configuration TOTP
    totp: {
      // Nom de l'application dans l'authenticator
      appName: 'SHUGO',

      // Algorithme
      algorithm: 'SHA1',

      // Nombre de chiffres
      digits: 6,

      // Période de validité (secondes)
      period: 30,

      // Fenêtre de tolérance (nombre de périodes)
      window: 1
    },

    // Configuration email
    email: {
      // Durée de validité du code (minutes)
      codeValidityMinutes: 10,

      // Délai avant renvoi (secondes)
      resendDelaySeconds: 60
    }
  },

  // ============================================
  // CODES D'URGENCE
  // ============================================
  emergencyCodes: {
    // Nombre de codes générés
    count: 100,

    // Longueur de chaque code
    codeLength: 8,

    // Format (alphanumerique)
    format: 'alphanumeric',

    // Codes à usage unique
    singleUse: true
  },

  // ============================================
  // SESSIONS
  // ============================================
  sessions: {
    // Durée maximale d'une session (heures)
    maxDurationHours: 24,

    // Nombre maximal de sessions actives par utilisateur
    maxActiveSessions: 5,

    // Durée d'inactivité avant déconnexion (minutes)
    inactivityTimeoutMinutes: 30,

    // Régénérer l'ID de session après connexion
    regenerateAfterLogin: true,

    // Stocker les informations de session
    storeInfo: {
      ip: true,
      userAgent: true,
      device: true,
      location: false
    }
  },

  // ============================================
  // PROTECTION CONTRE LES ATTAQUES
  // ============================================
  protection: {
    // Verrouillage de compte
    accountLockout: {
      // Nombre de tentatives avant verrouillage
      maxAttempts: 5,

      // Durée du verrouillage (minutes)
      lockoutDurationMinutes: 30,

      // Réinitialiser le compteur après (minutes)
      resetAfterMinutes: 15
    },

    // Rate limiting
    rateLimit: {
      // Fenêtre de temps (millisecondes)
      windowMs: 15 * 60 * 1000, // 15 minutes

      // Nombre maximum de requêtes par fenêtre
      maxRequests: 100,

      // Rate limit spécifique pour l'authentification
      auth: {
        windowMs: 15 * 60 * 1000,
        maxRequests: 5
      },

      // Rate limit pour les APIs sensibles
      sensitive: {
        windowMs: 60 * 1000,
        maxRequests: 10
      }
    },

    // Protection CSRF
    csrf: {
      enabled: true,
      cookieName: '_csrf',
      headerName: 'X-CSRF-Token'
    },

    // Protection XSS
    xss: {
      enabled: true,
      sanitizeInputs: true
    },

    // Protection contre les injections SQL
    sqlInjection: {
      enabled: true,
      useParameterizedQueries: true
    }
  },

  // ============================================
  // COOKIES
  // ============================================
  cookies: {
    // Secret pour la signature des cookies
    secret: process.env.COOKIE_SECRET,

    // Options par défaut
    defaults: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/'
    },

    // Noms des cookies
    names: {
      session: 'shugo_session',
      refresh: 'shugo_refresh',
      csrf: 'shugo_csrf'
    }
  },

  // ============================================
  // HEADERS DE SÉCURITÉ
  // ============================================
  headers: {
    // Content Security Policy
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"]
      }
    },

    // Autres headers
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },

    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    xXssProtection: '1; mode=block',
    referrerPolicy: 'strict-origin-when-cross-origin'
  },

  // ============================================
  // CORS
  // ============================================
  cors: {
    // Origines autorisées
    allowedOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],

    // Méthodes autorisées
    allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    // Headers autorisés
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-ID'],

    // Exposer les headers
    exposedHeaders: ['X-Request-ID', 'X-RateLimit-Remaining'],

    // Autoriser les credentials
    credentials: true,

    // Durée du cache preflight (secondes)
    maxAge: 86400
  },

  // ============================================
  // AUDIT ET LOGS
  // ============================================
  audit: {
    // Activer l'audit
    enabled: true,

    // Actions à auditer
    actions: [
      'auth.*',
      'user.create',
      'user.update',
      'user.delete',
      'guard.create',
      'guard.update',
      'mission.*',
      'protocol.*',
      'vault.*',
      'admin.*'
    ],

    // Inclure les données sensibles (masquées)
    includeSensitiveData: false,

    // Rétention des logs d'audit (jours)
    retentionDays: 365
  },

  // ============================================
  // VAULT
  // ============================================
  vault: {
    // Clé maître du vault
    masterKey: process.env.VAULT_MASTER_KEY,

    // Algorithme de chiffrement
    algorithm: 'aes-256-gcm',

    // Timeout d'accès (secondes)
    accessTimeout: 300,

    // Nombre maximum d'accès simultanés
    maxConcurrentAccess: 10
  }
};
