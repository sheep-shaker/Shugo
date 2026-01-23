'use strict';

/**
 * SHUGO v7.0 - Gestion des identifiants membres (member_id)
 *
 * Format: 10 chiffres numériques
 * - Premiers chiffres: basés sur le geo_id
 * - Derniers chiffres: séquence unique
 *
 * @see Document Technique V7.0 - Section 2.4
 */

const crypto = require('crypto');

/**
 * Expression régulière pour valider un member_id
 */
const MEMBER_ID_REGEX = /^\d{10}$/;

/**
 * Longueur standard d'un member_id
 */
const MEMBER_ID_LENGTH = 10;

/**
 * Valeur minimale d'un member_id
 */
const MEMBER_ID_MIN = 1000000000;

/**
 * Valeur maximale d'un member_id
 */
const MEMBER_ID_MAX = 9999999999;

/**
 * Valide un member_id
 * @param {string|number} memberId
 * @returns {boolean}
 */
function isValid(memberId) {
  if (memberId === null || memberId === undefined) return false;

  const str = String(memberId);
  if (!MEMBER_ID_REGEX.test(str)) return false;

  const num = parseInt(str, 10);
  return num >= MEMBER_ID_MIN && num <= MEMBER_ID_MAX;
}

/**
 * Formate un member_id (avec padding)
 * @param {number|string} memberId
 * @returns {string}
 */
function format(memberId) {
  if (!memberId) return null;
  return String(memberId).padStart(MEMBER_ID_LENGTH, '0');
}

/**
 * Parse un member_id en nombre
 * @param {string|number} memberId
 * @returns {number|null}
 */
function parse(memberId) {
  if (!memberId) return null;

  const parsed = parseInt(String(memberId), 10);
  if (isNaN(parsed) || parsed < 1 || parsed > MEMBER_ID_MAX) {
    return null;
  }
  return parsed;
}

/**
 * Génère un nouveau member_id basé sur le geo_id
 * @param {string} geoId - Format CC-PPP-ZZ-JJ-NN
 * @param {number} sequence - Numéro de séquence
 * @returns {string}
 */
function generate(geoId, sequence) {
  if (!geoId) {
    throw new Error('geo_id requis pour générer un member_id');
  }

  // Extraire les composants du geo_id
  const parts = geoId.split('-');
  if (parts.length !== 5) {
    throw new Error('Format geo_id invalide');
  }

  // Construire le préfixe basé sur le geo_id
  // CC (2) + PPP derniers chiffres (2) + ZZ (2) = 6 chiffres
  const prefix = parts[0] + // continent (2)
                 parts[1].slice(-2) + // pays derniers 2 chiffres
                 parts[2]; // région (2)

  // 4 chiffres restants pour la séquence
  const seq = String(sequence % 10000).padStart(4, '0');

  const memberId = prefix + seq;

  // Vérifier la validité
  if (!isValid(memberId)) {
    throw new Error('member_id généré invalide');
  }

  return memberId;
}

/**
 * Génère un member_id aléatoire sécurisé
 * @param {string} geoId - Format CC-PPP-ZZ-JJ-NN
 * @returns {string}
 */
function generateRandom(geoId) {
  // Générer une séquence aléatoire cryptographiquement sécurisée
  const randomBytes = crypto.randomBytes(4);
  const sequence = randomBytes.readUInt32BE(0) % 10000;

  return generate(geoId, sequence);
}

/**
 * Extrait les informations encodées dans un member_id
 * @param {string|number} memberId
 * @returns {Object|null}
 */
function decode(memberId) {
  const str = format(memberId);
  if (!str || !isValid(str)) return null;

  return {
    raw: str,
    continentCode: str.substring(0, 2),
    countryHint: str.substring(2, 4),
    regionCode: str.substring(4, 6),
    sequence: parseInt(str.substring(6), 10)
  };
}

/**
 * Compare deux member_id
 * @param {string|number} a
 * @param {string|number} b
 * @returns {number} -1, 0, ou 1
 */
function compare(a, b) {
  const numA = parse(a) || 0;
  const numB = parse(b) || 0;

  if (numA < numB) return -1;
  if (numA > numB) return 1;
  return 0;
}

/**
 * Vérifie si deux member_id sont du même geo (même préfixe)
 * @param {string|number} memberId1
 * @param {string|number} memberId2
 * @returns {boolean}
 */
function sameGeo(memberId1, memberId2) {
  const str1 = format(memberId1);
  const str2 = format(memberId2);

  if (!str1 || !str2) return false;

  // Comparer les 6 premiers chiffres (préfixe geo)
  return str1.substring(0, 6) === str2.substring(0, 6);
}

/**
 * Masque un member_id pour l'affichage
 * @param {string|number} memberId
 * @param {Object} options
 * @returns {string}
 */
function mask(memberId, options = {}) {
  const { showFirst = 2, showLast = 2 } = options;
  const str = format(memberId);

  if (!str) return '**********';

  const first = str.substring(0, showFirst);
  const last = str.substring(str.length - showLast);
  const middle = '*'.repeat(str.length - showFirst - showLast);

  return first + middle + last;
}

/**
 * Formate pour affichage avec séparateurs
 * @param {string|number} memberId
 * @param {string} separator
 * @returns {string}
 */
function formatDisplay(memberId, separator = '-') {
  const str = format(memberId);
  if (!str) return '';

  // Format: XX-XX-XX-XXXX
  return [
    str.substring(0, 2),
    str.substring(2, 4),
    str.substring(4, 6),
    str.substring(6)
  ].join(separator);
}

/**
 * Vérifie si un member_id est dans une plage
 * @param {string|number} memberId
 * @param {string|number} minId
 * @param {string|number} maxId
 * @returns {boolean}
 */
function isInRange(memberId, minId, maxId) {
  const num = parse(memberId);
  const min = parse(minId);
  const max = parse(maxId);

  if (num === null) return false;
  if (min !== null && num < min) return false;
  if (max !== null && num > max) return false;

  return true;
}

/**
 * Génère le prochain member_id dans une séquence
 * @param {string|number} currentMemberId
 * @returns {string|null}
 */
function getNext(currentMemberId) {
  const current = parse(currentMemberId);
  if (current === null) return null;

  const next = current + 1;
  if (next > MEMBER_ID_MAX) return null;

  return format(next);
}

/**
 * Calcule un checksum pour vérification d'intégrité
 * @param {string|number} memberId
 * @returns {string}
 */
function checksum(memberId) {
  const str = format(memberId);
  if (!str) return null;

  // Algorithme de Luhn simplifié
  let sum = 0;
  for (let i = 0; i < str.length; i++) {
    let digit = parseInt(str[i], 10);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }

  return String((10 - (sum % 10)) % 10);
}

/**
 * Ajoute un checksum à un member_id (pour affichage externe)
 * @param {string|number} memberId
 * @returns {string}
 */
function withChecksum(memberId) {
  const str = format(memberId);
  if (!str) return null;

  return str + checksum(str);
}

/**
 * Vérifie un member_id avec checksum
 * @param {string} memberIdWithChecksum
 * @returns {boolean}
 */
function verifyChecksum(memberIdWithChecksum) {
  if (!memberIdWithChecksum || memberIdWithChecksum.length !== 11) return false;

  const memberId = memberIdWithChecksum.substring(0, 10);
  const providedChecksum = memberIdWithChecksum.substring(10);

  return checksum(memberId) === providedChecksum;
}

module.exports = {
  // Constants
  MEMBER_ID_REGEX,
  MEMBER_ID_LENGTH,
  MEMBER_ID_MIN,
  MEMBER_ID_MAX,

  // Validation
  isValid,
  parse,
  format,

  // Generation
  generate,
  generateRandom,
  getNext,

  // Analysis
  decode,
  compare,
  sameGeo,
  isInRange,

  // Display
  mask,
  formatDisplay,

  // Checksum
  checksum,
  withChecksum,
  verifyChecksum
};
