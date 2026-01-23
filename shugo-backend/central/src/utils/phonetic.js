'use strict';

/**
 * SHUGO v7.0 - Algorithmes de recherche phonétique
 *
 * Permet de rechercher des noms/prénoms de façon approximative,
 * en gérant les variations orthographiques et les fautes de frappe.
 *
 * @see Document Technique V7.0 - Section 2.5.4
 */

/**
 * Génère le code Soundex classique (algorithme américain)
 * @param {string} str
 * @returns {string}
 */
function soundex(str) {
  if (!str || typeof str !== 'string') return '';

  const normalized = str.toUpperCase().replace(/[^A-Z]/g, '');
  if (!normalized) return '';

  const codes = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6'
  };

  let result = normalized[0];
  let prevCode = codes[normalized[0]] || '';

  for (let i = 1; i < normalized.length && result.length < 4; i++) {
    const code = codes[normalized[i]];
    if (code && code !== prevCode) {
      result += code;
    }
    prevCode = code || prevCode;
  }

  return (result + '000').substring(0, 4);
}

/**
 * Génère le code Soundex français (adapté pour les noms français)
 * @param {string} str
 * @returns {string}
 */
function soundexFr(str) {
  if (!str || typeof str !== 'string') return '';

  // Normalisation
  let normalized = str.toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Supprime accents
    .replace(/[^A-Z]/g, '');

  if (!normalized) return '';

  // Prétraitements français
  normalized = normalized
    .replace(/GUI/g, 'KI')
    .replace(/GUE/g, 'KE')
    .replace(/GA/g, 'KA')
    .replace(/GO/g, 'KO')
    .replace(/GU/g, 'K')
    .replace(/CA/g, 'KA')
    .replace(/CO/g, 'KO')
    .replace(/CU/g, 'KU')
    .replace(/Q/g, 'K')
    .replace(/CC/g, 'K')
    .replace(/CK/g, 'K')
    .replace(/PH/g, 'F')
    .replace(/CH/g, 'S')
    .replace(/SCH/g, 'S')
    .replace(/SH/g, 'S')
    .replace(/SS/g, 'S')
    .replace(/SC/g, 'S')
    .replace(/Y/g, 'I')
    .replace(/W/g, 'V');

  const codes = {
    B: '1', P: '1',
    C: '2', K: '2', G: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6',
    F: '7', V: '7',
    S: '8', Z: '8', X: '8', J: '8'
  };

  let result = normalized[0];
  let prevCode = codes[normalized[0]] || '';

  for (let i = 1; i < normalized.length && result.length < 4; i++) {
    const code = codes[normalized[i]];
    if (code && code !== prevCode) {
      result += code;
    }
    prevCode = code || prevCode;
  }

  return (result + '000').substring(0, 4);
}

/**
 * Génère le code Metaphone (plus précis que Soundex)
 * @param {string} str
 * @returns {string}
 */
function metaphone(str) {
  if (!str || typeof str !== 'string') return '';

  let word = str.toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z]/g, '');

  if (!word) return '';

  // Règles de transformation Metaphone
  const transforms = [
    [/^KN/, 'N'],
    [/^GN/, 'N'],
    [/^PN/, 'N'],
    [/^AE/, 'E'],
    [/^WR/, 'R'],
    [/^WH/, 'W'],
    [/MB$/, 'M'],
    [/X/, 'KS'],
    [/^X/, 'S'],
    [/SCH/, 'SK'],
    [/SH/, 'X'],
    [/CIA/, 'XA'],
    [/TIA/, 'XA'],
    [/TIO/, 'XO'],
    [/TCH/, 'X'],
    [/CH/, 'X'],
    [/C(?=[IEY])/, 'S'],
    [/CK/, 'K'],
    [/C/, 'K'],
    [/DG(?=[IEY])/, 'J'],
    [/D/, 'T'],
    [/GH(?=[^AEIOU])/, ''],
    [/GN$/, 'N'],
    [/G(?=[IEY])/, 'J'],
    [/GG/, 'K'],
    [/G/, 'K'],
    [/PH/, 'F'],
    [/Q/, 'K'],
    [/TH/, '0'],
    [/V/, 'F'],
    [/W(?=[^AEIOU])/, ''],
    [/WH/, 'W'],
    [/Z/, 'S'],
    [/([AEIOU])\1+/g, '$1'], // Supprime voyelles doublées
    [/([^AEIOU])\1+/g, '$1'] // Supprime consonnes doublées
  ];

  for (const [pattern, replacement] of transforms) {
    word = word.replace(pattern, replacement);
  }

  // Supprimer les voyelles (sauf en début de mot)
  const first = word[0];
  word = first + word.substring(1).replace(/[AEIOU]/g, '');

  return word.substring(0, 6);
}

/**
 * Génère le code Double Metaphone (version améliorée)
 * @param {string} str
 * @returns {Object} { primary: string, alternate: string }
 */
function doubleMetaphone(str) {
  if (!str || typeof str !== 'string') {
    return { primary: '', alternate: '' };
  }

  // Simplification: utiliser metaphone pour les deux
  const code = metaphone(str);
  return { primary: code, alternate: code };
}

/**
 * Calcule la distance de Levenshtein entre deux chaînes
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshteinDistance(a, b) {
  if (!a || !b) return Math.max((a || '').length, (b || '').length);

  a = a.toLowerCase();
  b = b.toLowerCase();

  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // suppression
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calcule la similarité entre deux chaînes (0 à 1)
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

/**
 * Calcule la similarité phonétique
 * @param {string} a
 * @param {string} b
 * @returns {number} 0 à 1
 */
function phoneticSimilarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  // Comparer les codes phonétiques
  const soundexA = soundexFr(a);
  const soundexB = soundexFr(b);
  const metaphoneA = metaphone(a);
  const metaphoneB = metaphone(b);

  let score = 0;

  // Soundex exact = 0.4
  if (soundexA === soundexB) score += 0.4;
  else score += similarity(soundexA, soundexB) * 0.2;

  // Metaphone exact = 0.4
  if (metaphoneA === metaphoneB) score += 0.4;
  else score += similarity(metaphoneA, metaphoneB) * 0.2;

  // Similarité textuelle = 0.2
  score += similarity(a, b) * 0.2;

  return Math.min(1, score);
}

/**
 * Vérifie si deux noms correspondent phonétiquement
 * @param {string} name1
 * @param {string} name2
 * @param {number} threshold - Seuil de similarité (0-1)
 * @returns {boolean}
 */
function matches(name1, name2, threshold = 0.7) {
  return phoneticSimilarity(name1, name2) >= threshold;
}

/**
 * Recherche les meilleurs correspondances dans une liste
 * @param {string} query - Terme recherché
 * @param {Array<string>} candidates - Liste de candidats
 * @param {Object} options
 * @returns {Array<{value: string, score: number}>}
 */
function search(query, candidates, options = {}) {
  const { threshold = 0.5, limit = 10 } = options;

  if (!query || !candidates || candidates.length === 0) {
    return [];
  }

  const results = candidates
    .map(candidate => ({
      value: candidate,
      score: phoneticSimilarity(query, candidate)
    }))
    .filter(r => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;
}

/**
 * Génère tous les codes phonétiques pour une chaîne
 * @param {string} str
 * @returns {Object}
 */
function getAllCodes(str) {
  return {
    soundex: soundex(str),
    soundexFr: soundexFr(str),
    metaphone: metaphone(str),
    doubleMetaphone: doubleMetaphone(str)
  };
}

/**
 * Normalise un nom pour la recherche
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
  if (!name) return '';

  return name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s-]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Sépare un nom complet en parties
 * @param {string} fullName
 * @returns {Object}
 */
function parseName(fullName) {
  if (!fullName) return { firstName: '', lastName: '' };

  const parts = fullName.trim().split(/\s+/);

  if (parts.length === 1) {
    return { firstName: '', lastName: parts[0] };
  }

  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1]
  };
}

module.exports = {
  // Algorithmes phonétiques
  soundex,
  soundexFr,
  metaphone,
  doubleMetaphone,

  // Distance et similarité
  levenshteinDistance,
  similarity,
  phoneticSimilarity,

  // Recherche
  matches,
  search,

  // Utilitaires
  getAllCodes,
  normalizeName,
  parseName
};
