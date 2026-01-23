// middleware/sanitizer.js
// Middleware de nettoyage et validation des entrées utilisateur

const validator = require('validator');
const xss = require('xss');
const DOMPurify = require('isomorphic-dompurify');
const { AuditLog } = require('../models');

// Règles de sanitisation par défaut
const DEFAULT_RULES = {
  // Texte basique
  text: {
    trim: true,
    escape: true,
    maxLength: 1000,
    removeScripts: true
  },
  
  // Email
  email: {
    trim: true,
    lowercase: true,
    normalizeEmail: true,
    validateEmail: true
  },
  
  // URL
  url: {
    trim: true,
    validateUrl: true,
    protocols: ['http', 'https'],
    requireProtocol: true
  },
  
  // Numérique
  number: {
    toInt: false,
    toFloat: false,
    min: null,
    max: null
  },
  
  // HTML
  html: {
    allowedTags: ['p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'li', 'ol'],
    allowedAttributes: {
      'a': ['href', 'target']
    },
    stripScripts: true,
    stripStyles: true
  },
  
  // JSON
  json: {
    parseJson: true,
    maxDepth: 10,
    maxSize: 100000 // 100KB
  },
  
  // Nom de fichier
  filename: {
    trim: true,
    removeSpecialChars: true,
    maxLength: 255,
    allowedExtensions: []
  },
  
  // SQL
  sql: {
    escapeSQL: true,
    blockKeywords: ['DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'EXEC', 'EXECUTE']
  }
};

// Patterns de détection d'attaques
const ATTACK_PATTERNS = {
  xss: [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<iframe/gi,
    /<embed/gi,
    /<object/gi
  ],
  
  sqlInjection: [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE)\b)/gi,
    /(--)|(\/\*[\w\W]*?\*\/)/g,
    /(';)|(';)|(--)/gi,
    /(\bOR\b\s*\d+\s*=\s*\d+)/gi,
    /(\bAND\b\s*\d+\s*=\s*\d+)/gi
  ],
  
  pathTraversal: [
    /\.\.\//g,
    /\.\.%2[fF]/g,
    /%2e%2e/gi,
    /\.\.;/g
  ],
  
  commandInjection: [
    /[;&|<>`$]/g,
    /\$\(.*\)/g,
    /`.*`/g
  ],
  
  xxe: [
    /<!DOCTYPE[^>]*\[[^]]*\]>/gi,
    /<!ENTITY/gi,
    /SYSTEM/gi
  ],
  
  ldapInjection: [
    /[*()\\]/g,
    /\x00/g
  ]
};

/**
 * Middleware principal de sanitisation
 * @param {Object} rules - Règles de sanitisation personnalisées
 * @param {Object} options - Options de configuration
 */
function sanitize(rules = {}, options = {}) {
  const {
    fields = null, // Champs spécifiques à sanitiser
    strict = false, // Mode strict : rejeter au lieu de nettoyer
    logAttacks = true, // Logger les tentatives d'attaque
    removeUnknownFields = false, // Supprimer les champs non définis
    maxRequestSize = 10485760, // 10MB par défaut
    customSanitizers = {} // Sanitizers personnalisés
  } = options;

  return async (req, res, next) => {
    try {
      // Vérifier la taille de la requête
      if (req.headers['content-length'] && 
          parseInt(req.headers['content-length']) > maxRequestSize) {
        return res.status(413).json({
          success: false,
          error: {
            code: 'SHUGO-SANITIZE-001',
            message: 'Requête trop volumineuse'
          }
        });
      }

      // Détecter les attaques potentielles
      const attacks = await detectAttacks(req);
      
      if (attacks.length > 0 && logAttacks) {
        await logAttackAttempt(req, attacks);
        
        if (strict) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'SHUGO-SANITIZE-002',
              message: 'Données invalides détectées'
            }
          });
        }
      }

      // Sanitiser les différentes parties de la requête
      if (req.body) {
        req.body = await sanitizeObject(req.body, rules, fields, customSanitizers);
        
        if (removeUnknownFields && fields) {
          req.body = removeUnknown(req.body, fields);
        }
      }

      if (req.query) {
        req.query = await sanitizeObject(req.query, rules, fields, customSanitizers);
      }

      if (req.params) {
        req.params = await sanitizeObject(req.params, rules, fields, customSanitizers);
      }

      // Ajouter les données sanitisées à la requête
      req.sanitized = {
        body: req.body,
        query: req.query,
        params: req.params,
        attacks: attacks.length
      };

      next();

    } catch (error) {
      console.error('Sanitizer error:', error);
      
      if (strict) {
        return res.status(500).json({
          success: false,
          error: {
            code: 'SHUGO-SANITIZE-500',
            message: 'Erreur de sanitisation'
          }
        });
      }
      
      next();
    }
  };
}

/**
 * Middleware pour valider les entrées avec Joi
 */
function validateSchema(schema, options = {}) {
  const {
    stripUnknown = true,
    abortEarly = false,
    allowUnknown = false,
    context = {}
  } = options;

  return async (req, res, next) => {
    try {
      const toValidate = {
        body: req.body,
        query: req.query,
        params: req.params
      };

      const validationOptions = {
        stripUnknown,
        abortEarly,
        allowUnknown,
        context: { ...context, user: req.user }
      };

      const { error, value } = schema.validate(toValidate, validationOptions);

      if (error) {
        const details = error.details.map(d => ({
          field: d.path.join('.'),
          message: d.message,
          type: d.type
        }));

        return res.status(400).json({
          success: false,
          error: {
            code: 'SHUGO-VALIDATE-001',
            message: 'Validation des données échouée',
            details
          }
        });
      }

      // Remplacer par les valeurs validées
      req.body = value.body || {};
      req.query = value.query || {};
      req.params = value.params || {};
      req.validated = true;

      next();

    } catch (error) {
      console.error('Validation error:', error);
      
      return res.status(500).json({
        success: false,
        error: {
          code: 'SHUGO-VALIDATE-500',
          message: 'Erreur de validation'
        }
      });
    }
  };
}

/**
 * Middleware spécifique pour les uploads de fichiers
 */
function sanitizeFileUpload(options = {}) {
  const {
    allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'],
    maxFileSize = 10485760, // 10MB
    maxFiles = 10,
    scanForVirus = false,
    sanitizeFilename = true
  } = options;

  return async (req, res, next) => {
    try {
      if (!req.files && !req.file) {
        return next();
      }

      const files = req.files || [req.file];

      for (const file of files) {
        // Vérifier le type MIME
        if (!allowedMimeTypes.includes(file.mimetype)) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'SHUGO-FILE-001',
              message: `Type de fichier non autorisé: ${file.mimetype}`
            }
          });
        }

        // Vérifier la taille
        if (file.size > maxFileSize) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'SHUGO-FILE-002',
              message: 'Fichier trop volumineux'
            }
          });
        }

        // Sanitiser le nom de fichier
        if (sanitizeFilename) {
          file.originalname = sanitizeFilenameString(file.originalname);
          file.filename = sanitizeFilenameString(file.filename || file.originalname);
        }

        // Scanner pour virus si configuré
        if (scanForVirus) {
          const isClean = await scanFile(file);
          if (!isClean) {
            return res.status(400).json({
              success: false,
              error: {
                code: 'SHUGO-FILE-003',
                message: 'Fichier potentiellement dangereux détecté'
              }
            });
          }
        }
      }

      // Vérifier le nombre de fichiers
      if (files.length > maxFiles) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'SHUGO-FILE-004',
            message: `Trop de fichiers (max: ${maxFiles})`
          }
        });
      }

      next();

    } catch (error) {
      console.error('File sanitization error:', error);
      
      return res.status(500).json({
        success: false,
        error: {
          code: 'SHUGO-FILE-500',
          message: 'Erreur lors de la vérification du fichier'
        }
      });
    }
  };
}

// Fonctions de sanitisation

async function sanitizeObject(obj, rules, fields, customSanitizers) {
  if (!obj || typeof obj !== 'object') return obj;

  const sanitized = Array.isArray(obj) ? [] : {};

  for (const [key, value] of Object.entries(obj)) {
    // Appliquer les règles spécifiques au champ
    const fieldRules = rules[key] || (fields && fields[key]) || {};
    
    // Sanitizer personnalisé
    if (customSanitizers[key]) {
      sanitized[key] = await customSanitizers[key](value);
      continue;
    }

    // Sanitisation selon le type
    if (value === null || value === undefined) {
      sanitized[key] = value;
    } else if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value, fieldRules);
    } else if (typeof value === 'number') {
      sanitized[key] = sanitizeNumber(value, fieldRules);
    } else if (typeof value === 'boolean') {
      sanitized[key] = value;
    } else if (Array.isArray(value)) {
      sanitized[key] = await Promise.all(
        value.map(item => sanitizeObject(item, rules, fields, customSanitizers))
      );
    } else if (typeof value === 'object') {
      sanitized[key] = await sanitizeObject(value, rules, fields, customSanitizers);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

function sanitizeString(str, rules = {}) {
  let sanitized = str;

  // Trim
  if (rules.trim !== false) {
    sanitized = sanitized.trim();
  }

  // Max length
  if (rules.maxLength) {
    sanitized = sanitized.substring(0, rules.maxLength);
  }

  // Email
  if (rules.validateEmail) {
    if (rules.normalizeEmail) {
      sanitized = validator.normalizeEmail(sanitized) || sanitized;
    }
    if (rules.lowercase) {
      sanitized = sanitized.toLowerCase();
    }
    if (!validator.isEmail(sanitized)) {
      return ''; // Email invalide
    }
  }

  // URL
  if (rules.validateUrl) {
    const urlOptions = {
      protocols: rules.protocols || ['http', 'https'],
      require_protocol: rules.requireProtocol !== false
    };
    
    if (!validator.isURL(sanitized, urlOptions)) {
      return ''; // URL invalide
    }
  }

  // HTML
  if (rules.stripHtml !== false || rules.allowedTags) {
    sanitized = DOMPurify.sanitize(sanitized, {
      ALLOWED_TAGS: rules.allowedTags || [],
      ALLOWED_ATTR: rules.allowedAttributes || [],
      KEEP_CONTENT: true
    });
  }

  // XSS
  if (rules.escape !== false && !rules.allowHtml) {
    sanitized = validator.escape(sanitized);
  }

  // Remove scripts
  if (rules.removeScripts) {
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    sanitized = sanitized.replace(/javascript:/gi, '');
    sanitized = sanitized.replace(/on\w+\s*=/gi, '');
  }

  // SQL
  if (rules.escapeSQL) {
    sanitized = sanitized.replace(/'/g, "''");
    
    if (rules.blockKeywords) {
      for (const keyword of rules.blockKeywords) {
        const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
        if (regex.test(sanitized)) {
          return ''; // Contient un mot-clé SQL interdit
        }
      }
    }
  }

  return sanitized;
}

function sanitizeNumber(num, rules = {}) {
  let sanitized = num;

  // Convertir en entier
  if (rules.toInt) {
    sanitized = parseInt(sanitized);
    if (isNaN(sanitized)) return null;
  }

  // Convertir en float
  if (rules.toFloat) {
    sanitized = parseFloat(sanitized);
    if (isNaN(sanitized)) return null;
  }

  // Min/Max
  if (rules.min !== null && sanitized < rules.min) {
    sanitized = rules.min;
  }
  if (rules.max !== null && sanitized > rules.max) {
    sanitized = rules.max;
  }

  return sanitized;
}

function sanitizeFilenameString(filename) {
  // Garder seulement les caractères alphanumériques, points, tirets et underscores
  let sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  
  // Éviter les doubles extensions
  sanitized = sanitized.replace(/\.+/g, '.');
  
  // Limiter la longueur
  if (sanitized.length > 255) {
    const ext = sanitized.split('.').pop();
    const name = sanitized.substring(0, 250 - ext.length - 1);
    sanitized = `${name}.${ext}`;
  }

  return sanitized;
}

// Détection d'attaques

async function detectAttacks(req) {
  const attacks = [];
  const dataToCheck = JSON.stringify({
    body: req.body,
    query: req.query,
    params: req.params
  });

  // XSS
  for (const pattern of ATTACK_PATTERNS.xss) {
    if (pattern.test(dataToCheck)) {
      attacks.push({ type: 'XSS', pattern: pattern.toString() });
      break;
    }
  }

  // SQL Injection
  for (const pattern of ATTACK_PATTERNS.sqlInjection) {
    if (pattern.test(dataToCheck)) {
      attacks.push({ type: 'SQL_INJECTION', pattern: pattern.toString() });
      break;
    }
  }

  // Path Traversal
  for (const pattern of ATTACK_PATTERNS.pathTraversal) {
    if (pattern.test(dataToCheck)) {
      attacks.push({ type: 'PATH_TRAVERSAL', pattern: pattern.toString() });
      break;
    }
  }

  // Command Injection
  for (const pattern of ATTACK_PATTERNS.commandInjection) {
    if (pattern.test(dataToCheck)) {
      attacks.push({ type: 'COMMAND_INJECTION', pattern: pattern.toString() });
      break;
    }
  }

  return attacks;
}

async function logAttackAttempt(req, attacks) {
  try {
    await AuditLog.create({
      action_type: 'security.attack_attempt',
      member_id: req.user?.member_id,
      entity_type: 'security',
      severity: 'critical',
      details: {
        attacks,
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
        endpoint: req.originalUrl,
        method: req.method
      }
    });

    // Notifier les admins si attaque critique
    if (attacks.some(a => ['SQL_INJECTION', 'COMMAND_INJECTION'].includes(a.type))) {
      const NotificationService = require('../services/NotificationService');
      await NotificationService.broadcastToAdmins({
        type: 'security_attack',
        title: 'Tentative d\'attaque détectée',
        message: `Type: ${attacks[0].type}\nIP: ${req.ip}\nEndpoint: ${req.originalUrl}`,
        priority: 'critical'
      });
    }

  } catch (error) {
    console.error('Failed to log attack attempt:', error);
  }
}

function removeUnknown(obj, allowedFields) {
  const cleaned = {};
  
  for (const field of allowedFields) {
    if (obj.hasOwnProperty(field)) {
      cleaned[field] = obj[field];
    }
  }
  
  return cleaned;
}

async function scanFile(file) {
  // Implémenter le scan antivirus (ClamAV ou autre)
  // Pour l'instant, retourner toujours true
  return true;
}

// Sanitizers pré-configurés

const sanitizers = {
  // Formulaire d'inscription
  registration: sanitize({
    email: DEFAULT_RULES.email,
    password: { minLength: 8, maxLength: 128 },
    first_name: { ...DEFAULT_RULES.text, maxLength: 50 },
    last_name: { ...DEFAULT_RULES.text, maxLength: 50 },
    phone: { trim: true, maxLength: 20 }
  }),

  // Messages
  message: sanitize({
    subject: { ...DEFAULT_RULES.text, maxLength: 200 },
    content: { ...DEFAULT_RULES.html, maxLength: 5000 }
  }),

  // Recherche
  search: sanitize({
    q: { ...DEFAULT_RULES.text, escape: true, maxLength: 100 },
    page: { ...DEFAULT_RULES.number, toInt: true, min: 1, max: 1000 },
    limit: { ...DEFAULT_RULES.number, toInt: true, min: 1, max: 100 }
  }),

  // Configuration
  config: sanitize({}, {
    strict: true,
    removeUnknownFields: true
  })
};

// Export
module.exports = {
  // Middleware principal
  sanitize,
  
  // Middlewares spécialisés
  validateSchema,
  sanitizeFileUpload,
  
  // Sanitizers pré-configurés
  ...sanitizers,
  
  // Constantes et utilitaires
  DEFAULT_RULES,
  ATTACK_PATTERNS,
  
  // Fonctions utilitaires
  sanitizeString,
  sanitizeNumber,
  sanitizeFilenameString,
  detectAttacks
};
