'use strict';

/**
 * SHUGO v7.0 - Fonctions utilitaires diverses
 * @see Document Technique V7.0 - Section utilitaires
 */

/**
 * Délai asynchrone
 * @param {number} ms - Millisecondes
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry une fonction avec backoff exponentiel
 * @param {Function} fn - Fonction à exécuter
 * @param {Object} options - Options
 * @returns {Promise<any>}
 */
async function retry(fn, options = {}) {
  const { maxRetries = 3, baseDelay = 1000, maxDelay = 30000 } = options;
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const delayMs = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        await delay(delayMs);
      }
    }
  }

  throw lastError;
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
 * Convertit un objet snake_case en camelCase (récursif)
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
 * Convertit un objet camelCase en snake_case (récursif)
 * @param {Object} obj
 * @returns {Object}
 */
function objectToSnakeCase(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(objectToSnakeCase);

  const result = {};
  for (const key in obj) {
    result[camelToSnake(key)] = objectToSnakeCase(obj[key]);
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
 * Deep clone d'un objet
 * @param {any} obj
 * @returns {any}
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj);
  if (Array.isArray(obj)) return obj.map(deepClone);

  const cloned = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
}

/**
 * Deep merge de deux objets
 * @param {Object} target
 * @param {Object} source
 * @returns {Object}
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

/**
 * Groupe un tableau par une clé
 * @param {Array} array
 * @param {string|Function} key
 * @returns {Object}
 */
function groupBy(array, key) {
  return array.reduce((result, item) => {
    const groupKey = typeof key === 'function' ? key(item) : item[key];
    (result[groupKey] = result[groupKey] || []).push(item);
    return result;
  }, {});
}

/**
 * Supprime les doublons d'un tableau
 * @param {Array} array
 * @param {string|Function} key - Optionnel, pour objets
 * @returns {Array}
 */
function unique(array, key = null) {
  if (!key) {
    return [...new Set(array)];
  }

  const seen = new Set();
  return array.filter(item => {
    const value = typeof key === 'function' ? key(item) : item[key];
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/**
 * Chunk un tableau en sous-tableaux
 * @param {Array} array
 * @param {number} size
 * @returns {Array<Array>}
 */
function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Flatten un tableau imbriqué
 * @param {Array} array
 * @param {number} depth
 * @returns {Array}
 */
function flatten(array, depth = 1) {
  return depth > 0
    ? array.reduce((acc, val) =>
        acc.concat(Array.isArray(val) ? flatten(val, depth - 1) : val), [])
    : array.slice();
}

/**
 * Pick des propriétés d'un objet
 * @param {Object} obj
 * @param {Array<string>} keys
 * @returns {Object}
 */
function pick(obj, keys) {
  return keys.reduce((result, key) => {
    if (key in obj) {
      result[key] = obj[key];
    }
    return result;
  }, {});
}

/**
 * Omit des propriétés d'un objet
 * @param {Object} obj
 * @param {Array<string>} keys
 * @returns {Object}
 */
function omit(obj, keys) {
  const result = { ...obj };
  keys.forEach(key => delete result[key]);
  return result;
}

/**
 * Vérifie si un objet est vide
 * @param {any} obj
 * @returns {boolean}
 */
function isEmpty(obj) {
  if (obj == null) return true;
  if (Array.isArray(obj) || typeof obj === 'string') return obj.length === 0;
  if (typeof obj === 'object') return Object.keys(obj).length === 0;
  return false;
}

/**
 * Génère un ID aléatoire
 * @param {number} length
 * @returns {string}
 */
function randomId(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Génère un code aléatoire numérique
 * @param {number} length
 * @returns {string}
 */
function randomCode(length = 6) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 10);
  }
  return result;
}

/**
 * Capitalise la première lettre
 * @param {string} str
 * @returns {string}
 */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Capitalise chaque mot
 * @param {string} str
 * @returns {string}
 */
function titleCase(str) {
  if (!str) return '';
  return str.split(' ').map(capitalize).join(' ');
}

/**
 * Parse un booléen de façon permissive
 * @param {any} value
 * @returns {boolean}
 */
function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  }
  return Boolean(value);
}

/**
 * Parse un entier de façon sécurisée
 * @param {any} value
 * @param {number} defaultValue
 * @returns {number}
 */
function safeParseInt(value, defaultValue = 0) {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse un float de façon sécurisée
 * @param {any} value
 * @param {number} defaultValue
 * @returns {number}
 */
function safeParseFloat(value, defaultValue = 0) {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Formate un nombre avec séparateurs de milliers
 * @param {number} num
 * @param {string} locale
 * @returns {string}
 */
function formatNumber(num, locale = 'fr-FR') {
  return new Intl.NumberFormat(locale).format(num);
}

/**
 * Formate des bytes en taille lisible
 * @param {number} bytes
 * @param {number} decimals
 * @returns {string}
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Formate une durée en millisecondes
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

/**
 * Calcule un hash simple d'une chaîne (non cryptographique)
 * @param {string} str
 * @returns {number}
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Debounce une fonction
 * @param {Function} fn
 * @param {number} wait
 * @returns {Function}
 */
function debounce(fn, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

/**
 * Throttle une fonction
 * @param {Function} fn
 * @param {number} limit
 * @returns {Function}
 */
function throttle(fn, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

module.exports = {
  // Async
  delay,
  retry,

  // Case conversion
  snakeToCamel,
  camelToSnake,
  objectToCamelCase,
  objectToSnakeCase,

  // String
  normalizeForSearch,
  slugify,
  truncate,
  maskEmail,
  maskPhone,
  capitalize,
  titleCase,

  // Object
  deepClone,
  deepMerge,
  pick,
  omit,
  isEmpty,

  // Array
  groupBy,
  unique,
  chunk,
  flatten,

  // Random
  randomId,
  randomCode,

  // Parsing
  parseBoolean,
  safeParseInt,
  safeParseFloat,

  // Formatting
  formatNumber,
  formatBytes,
  formatDuration,

  // Utility
  simpleHash,
  debounce,
  throttle
};
