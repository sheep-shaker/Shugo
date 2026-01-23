'use strict';

/**
 * SHUGO v7.0 - Export centralisé des utilitaires
 *
 * @see Document Technique V7.0
 */

// === Modules utilitaires ===
const crypto = require('./crypto');
const logger = require('./logger');
const helpers = require('./helpers');
const geoId = require('./geoId');
const memberId = require('./memberId');
const phonetic = require('./phonetic');
const dateTime = require('./dateTime');
const validators = require('./validators');
const constants = require('./constants');

// Constantes des rôles (V7.0 Section 2.7.1)
const ROLES = {
  SILVER: 'Silver',
  GOLD: 'Gold',
  PLATINUM: 'Platinum',
  ADMIN: 'Admin',
  ADMIN_N1: 'Admin_N1'
};

// Hiérarchie des rôles (niveau numérique)
const ROLE_HIERARCHY = {
  [ROLES.SILVER]: 1,
  [ROLES.GOLD]: 2,
  [ROLES.PLATINUM]: 3,
  [ROLES.ADMIN]: 4,
  [ROLES.ADMIN_N1]: 5
};

// Statuts utilisateur
const USER_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
  DELETED: 'deleted',
  PENDING_2FA: 'pending_2fa',
  BLOCKED: 'blocked'
};

// Statuts de garde
const GUARD_STATUS = {
  OPEN: 'open',
  FULL: 'full',
  CLOSED: 'closed',
  CANCELLED: 'cancelled'
};

// Types de garde
const GUARD_TYPES = {
  STANDARD: 'standard',
  PREPARATION: 'preparation',
  CLOSURE: 'closure',
  SPECIAL: 'special',
  MAINTENANCE: 'maintenance'
};

// Canaux de notification
const NOTIFICATION_CHANNELS = {
  EMAIL: 'email',
  MATRIX: 'matrix',
  BOTH: 'both',
  SMS: 'sms',
  PUSH: 'push'
};

// Langues supportées
const SUPPORTED_LANGUAGES = ['fr', 'en', 'it', 'es', 'pt'];

// Codes continents (V7.0 Section 2.4.3)
const CONTINENT_CODES = {
  '01': 'Asie & Océanie',
  '02': 'Europe',
  '03': 'Afrique',
  '04': 'Amérique du Nord',
  '05': 'Amérique du Sud',
  '06': 'Russie'
};

/**
 * Vérifie si un rôle a un niveau suffisant
 * @param {string} userRole - Rôle de l'utilisateur
 * @param {string} requiredRole - Rôle minimum requis
 * @returns {boolean}
 */
function hasMinRole(userRole, requiredRole) {
  return (ROLE_HIERARCHY[userRole] || 0) >= (ROLE_HIERARCHY[requiredRole] || 0);
}

/**
 * Vérifie si un rôle peut gérer un autre rôle
 * @param {string} managerRole
 * @param {string} targetRole
 * @returns {boolean}
 */
function canManageRole(managerRole, targetRole) {
  return (ROLE_HIERARCHY[managerRole] || 0) > (ROLE_HIERARCHY[targetRole] || 0);
}

/**
 * Parse un geo_id et retourne ses composants
 * @param {string} geoId - Format: CC-PPP-ZZ-JJ-NN
 * @returns {Object|null}
 */
function parseGeoId(geoId) {
  if (!geoId) return null;
  
  const parts = geoId.split('-');
  if (parts.length !== 5) return null;

  return {
    continentCode: parts[0],
    countryCode: parts[1],
    regionCode: parts[2],
    parentCode: parts[3],
    localCode: parts[4],
    isParent: parts[4] === '00',
    continent: CONTINENT_CODES[parts[0]] || 'Inconnu'
  };
}

/**
 * Vérifie si un geo_id est valide
 * @param {string} geoId
 * @returns {boolean}
 */
function isValidGeoId(geoId) {
  if (!geoId || typeof geoId !== 'string') return false;
  return /^\d{2}-\d{1,3}-\d{2}-\d{2}-\d{2}$/.test(geoId);
}

/**
 * Vérifie si un geo_id est parent d'un autre
 * @param {string} parentGeoId
 * @param {string} childGeoId
 * @returns {boolean}
 */
function isGeoIdParent(parentGeoId, childGeoId) {
  if (!parentGeoId || !childGeoId) return false;
  
  const parent = parseGeoId(parentGeoId);
  const child = parseGeoId(childGeoId);
  
  if (!parent || !child) return false;

  return parent.continentCode === child.continentCode &&
         parent.countryCode === child.countryCode &&
         parent.regionCode === child.regionCode &&
         parent.parentCode === child.parentCode &&
         parent.isParent;
}

/**
 * Formate un member_id (10 chiffres)
 * @param {number} memberId
 * @returns {string}
 */
function formatMemberId(memberId) {
  return String(memberId).padStart(10, '0');
}

/**
 * Parse un member_id
 * @param {string|number} memberId
 * @returns {number|null}
 */
function parseMemberId(memberId) {
  const parsed = parseInt(memberId, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 9999999999) {
    return null;
  }
  return parsed;
}

/**
 * Formate une date pour l'affichage
 * @param {Date|string} date
 * @param {string} locale
 * @returns {string}
 */
function formatDate(date, locale = 'fr-FR') {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Formate une heure
 * @param {string} time - Format HH:MM:SS
 * @returns {string} Format HH:MM
 */
function formatTime(time) {
  if (!time) return '';
  return time.substring(0, 5);
}

/**
 * Calcule la différence en heures entre deux dates
 * @param {Date|string} date1
 * @param {Date|string} date2
 * @returns {number}
 */
function hoursBetween(date1, date2) {
  const d1 = date1 instanceof Date ? date1 : new Date(date1);
  const d2 = date2 instanceof Date ? date2 : new Date(date2);
  return Math.abs(d2 - d1) / (1000 * 60 * 60);
}

/**
 * Vérifie si une date est dans le futur
 * @param {Date|string} date
 * @returns {boolean}
 */
function isFuture(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d > new Date();
}

/**
 * Retourne la date d'aujourd'hui au format YYYY-MM-DD
 * @returns {string}
 */
function today() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Ajoute des jours à une date
 * @param {Date|string} date
 * @param {number} days
 * @returns {Date}
 */
function addDays(date, days) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Convertit snake_case en camelCase
 * @param {string} str
 * @returns {string}
 */
function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convertit camelCase en snake_case
 * @param {string} str
 * @returns {string}
 */
function camelToSnake(str) {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * Convertit un objet snake_case en camelCase
 * @param {Object} obj
 * @returns {Object}
 */
function objectToCamelCase(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(objectToCamelCase);
  
  const result = {};
  for (const key in obj) {
    result[snakeToCamel(key)] = objectToCamelCase(obj[key]);
  }
  return result;
}

/**
 * Nettoie et normalise une chaîne pour recherche
 * @param {string} str
 * @returns {string}
 */
function normalizeForSearch(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Génère un slug URL-friendly
 * @param {string} str
 * @returns {string}
 */
function slugify(str) {
  return normalizeForSearch(str)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Tronque une chaîne avec ellipsis
 * @param {string} str
 * @param {number} maxLength
 * @returns {string}
 */
function truncate(str, maxLength = 100) {
  if (!str || str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Masque partiellement un email
 * @param {string} email
 * @returns {string}
 */
function maskEmail(email) {
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  
  const maskedLocal = local.length > 2 
    ? local[0] + '*'.repeat(local.length - 2) + local[local.length - 1]
    : '*'.repeat(local.length);
  
  return `${maskedLocal}@${domain}`;
}

/**
 * Masque partiellement un numéro de téléphone
 * @param {string} phone
 * @returns {string}
 */
function maskPhone(phone) {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 4) return '*'.repeat(cleaned.length);
  return '*'.repeat(cleaned.length - 4) + cleaned.slice(-4);
}

/**
 * Délai asynchrone
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry une fonction avec backoff exponentiel
 * @param {Function} fn
 * @param {number} maxRetries
 * @param {number} baseDelay
 * @returns {Promise<any>}
 */
async function retry(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        await delay(baseDelay * Math.pow(2, attempt));
      }
    }
  }
  
  throw lastError;
}

module.exports = {
  // === Modules complets ===
  crypto,
  logger,
  helpers,
  geoId,
  memberId,
  phonetic,
  dateTime,
  validators,
  constants,

  // === Constantes (raccourcis) ===
  ROLES,
  ROLE_HIERARCHY,
  USER_STATUS,
  GUARD_STATUS,
  GUARD_TYPES,
  NOTIFICATION_CHANNELS,
  SUPPORTED_LANGUAGES,
  CONTINENT_CODES,

  // Constantes depuis constants.js
  ...constants,

  // === Fonctions rôles ===
  hasMinRole,
  canManageRole,

  // === Fonctions geo_id (raccourcis) ===
  parseGeoId,
  isValidGeoId,
  isGeoIdParent,

  // === Fonctions member_id (raccourcis) ===
  formatMemberId,
  parseMemberId,

  // === Fonctions date/heure (raccourcis) ===
  formatDate,
  formatTime,
  hoursBetween,
  isFuture,
  today,
  addDays,

  // === Fonctions chaînes ===
  snakeToCamel,
  camelToSnake,
  objectToCamelCase,
  normalizeForSearch,
  slugify,
  truncate,
  maskEmail,
  maskPhone,

  // === Utilitaires async ===
  delay,
  retry,

  // === Fonctions helpers (raccourcis) ===
  ...helpers,

  // === Validation (raccourcis) ===
  PATTERNS: validators.PATTERNS,
  validateMiddleware: validators.validateMiddleware
};
