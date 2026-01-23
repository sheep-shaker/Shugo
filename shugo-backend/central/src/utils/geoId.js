'use strict';

/**
 * SHUGO v7.0 - Gestion des identifiants géographiques (geo_id)
 * Format: CC-PPP-ZZ-JJ-NN
 *
 * CC  = Code continent (2 chiffres)
 * PPP = Code pays (3 chiffres)
 * ZZ  = Code région/zone (2 chiffres)
 * JJ  = Code parent/juridiction (2 chiffres)
 * NN  = Code local (2 chiffres, 00 = instance parente)
 *
 * @see Document Technique V7.0 - Section 2.4.3
 */

/**
 * Codes des continents
 */
const CONTINENT_CODES = {
  '01': { name: 'Asie & Océanie', nameEn: 'Asia & Oceania' },
  '02': { name: 'Europe', nameEn: 'Europe' },
  '03': { name: 'Afrique', nameEn: 'Africa' },
  '04': { name: 'Amérique du Nord', nameEn: 'North America' },
  '05': { name: 'Amérique du Sud', nameEn: 'South America' },
  '06': { name: 'Russie', nameEn: 'Russia' }
};

/**
 * Codes pays courants (extrait)
 */
const COUNTRY_CODES = {
  // Europe (02)
  '033': { name: 'France', continent: '02' },
  '032': { name: 'Belgique', continent: '02' },
  '041': { name: 'Suisse', continent: '02' },
  '039': { name: 'Italie', continent: '02' },
  '034': { name: 'Espagne', continent: '02' },
  '049': { name: 'Allemagne', continent: '02' },
  '044': { name: 'Royaume-Uni', continent: '02' },

  // Amérique du Nord (04)
  '001': { name: 'États-Unis', continent: '04' },
  '001': { name: 'Canada', continent: '04' },

  // Asie (01)
  '081': { name: 'Japon', continent: '01' },
  '086': { name: 'Chine', continent: '01' }
};

/**
 * Expression régulière pour valider un geo_id
 */
const GEO_ID_REGEX = /^(\d{2})-(\d{1,3})-(\d{2})-(\d{2})-(\d{2})$/;

/**
 * Parse un geo_id et retourne ses composants
 * @param {string} geoId - Format: CC-PPP-ZZ-JJ-NN
 * @returns {Object|null}
 */
function parse(geoId) {
  if (!geoId || typeof geoId !== 'string') return null;

  const match = geoId.match(GEO_ID_REGEX);
  if (!match) return null;

  const [, continentCode, countryCode, regionCode, parentCode, localCode] = match;

  return {
    raw: geoId,
    continentCode,
    countryCode: countryCode.padStart(3, '0'),
    regionCode,
    parentCode,
    localCode,
    isParent: localCode === '00',
    isGlobal: geoId === '00-000-00-00-00',
    continent: CONTINENT_CODES[continentCode]?.name || 'Inconnu',
    country: COUNTRY_CODES[countryCode.padStart(3, '0')]?.name || null
  };
}

/**
 * Valide un geo_id
 * @param {string} geoId
 * @returns {boolean}
 */
function isValid(geoId) {
  if (!geoId || typeof geoId !== 'string') return false;
  return GEO_ID_REGEX.test(geoId);
}

/**
 * Vérifie si un geo_id représente une instance parente
 * @param {string} geoId
 * @returns {boolean}
 */
function isParentInstance(geoId) {
  const parsed = parse(geoId);
  return parsed?.isParent || false;
}

/**
 * Vérifie si un geo_id est global (super admin)
 * @param {string} geoId
 * @returns {boolean}
 */
function isGlobal(geoId) {
  return geoId === '00-000-00-00-00';
}

/**
 * Construit un geo_id à partir de ses composants
 * @param {Object} components
 * @returns {string}
 */
function build({ continentCode, countryCode, regionCode, parentCode, localCode }) {
  return [
    String(continentCode).padStart(2, '0'),
    String(countryCode).padStart(3, '0'),
    String(regionCode).padStart(2, '0'),
    String(parentCode).padStart(2, '0'),
    String(localCode).padStart(2, '0')
  ].join('-');
}

/**
 * Récupère le geo_id parent d'un geo_id enfant
 * @param {string} geoId
 * @returns {string|null}
 */
function getParent(geoId) {
  const parsed = parse(geoId);
  if (!parsed || parsed.isParent) return null;

  return build({
    continentCode: parsed.continentCode,
    countryCode: parsed.countryCode,
    regionCode: parsed.regionCode,
    parentCode: parsed.parentCode,
    localCode: '00'
  });
}

/**
 * Récupère le geo_id régional
 * @param {string} geoId
 * @returns {string|null}
 */
function getRegion(geoId) {
  const parsed = parse(geoId);
  if (!parsed) return null;

  return build({
    continentCode: parsed.continentCode,
    countryCode: parsed.countryCode,
    regionCode: parsed.regionCode,
    parentCode: '00',
    localCode: '00'
  });
}

/**
 * Récupère le geo_id du pays
 * @param {string} geoId
 * @returns {string|null}
 */
function getCountry(geoId) {
  const parsed = parse(geoId);
  if (!parsed) return null;

  return build({
    continentCode: parsed.continentCode,
    countryCode: parsed.countryCode,
    regionCode: '00',
    parentCode: '00',
    localCode: '00'
  });
}

/**
 * Récupère le geo_id du continent
 * @param {string} geoId
 * @returns {string|null}
 */
function getContinent(geoId) {
  const parsed = parse(geoId);
  if (!parsed) return null;

  return build({
    continentCode: parsed.continentCode,
    countryCode: '000',
    regionCode: '00',
    parentCode: '00',
    localCode: '00'
  });
}

/**
 * Vérifie si un geo_id est parent d'un autre
 * @param {string} parentGeoId
 * @param {string} childGeoId
 * @returns {boolean}
 */
function isParentOf(parentGeoId, childGeoId) {
  const parent = parse(parentGeoId);
  const child = parse(childGeoId);

  if (!parent || !child) return false;
  if (!parent.isParent) return false;

  return parent.continentCode === child.continentCode &&
         parent.countryCode === child.countryCode &&
         parent.regionCode === child.regionCode &&
         parent.parentCode === child.parentCode;
}

/**
 * Vérifie si un geo_id est dans le périmètre d'un autre
 * @param {string} scopeGeoId - Périmètre de référence
 * @param {string} targetGeoId - Geo_id à vérifier
 * @returns {boolean}
 */
function isInScope(scopeGeoId, targetGeoId) {
  if (isGlobal(scopeGeoId)) return true;

  const scope = parse(scopeGeoId);
  const target = parse(targetGeoId);

  if (!scope || !target) return false;

  // Même continent obligatoire
  if (scope.continentCode !== target.continentCode) return false;

  // Si scope est au niveau continent
  if (scope.countryCode === '000') return true;

  // Même pays obligatoire
  if (scope.countryCode !== target.countryCode) return false;

  // Si scope est au niveau pays
  if (scope.regionCode === '00') return true;

  // Même région obligatoire
  if (scope.regionCode !== target.regionCode) return false;

  // Si scope est au niveau région
  if (scope.parentCode === '00') return true;

  // Même parent obligatoire
  if (scope.parentCode !== target.parentCode) return false;

  // Si scope est au niveau parent (00)
  if (scope.isParent) return true;

  // Même local
  return scope.localCode === target.localCode;
}

/**
 * Calcule le niveau hiérarchique d'un geo_id
 * @param {string} geoId
 * @returns {number} 0=global, 1=continent, 2=pays, 3=région, 4=parent, 5=local
 */
function getLevel(geoId) {
  const parsed = parse(geoId);
  if (!parsed) return -1;

  if (parsed.isGlobal) return 0;
  if (parsed.countryCode === '000') return 1;
  if (parsed.regionCode === '00') return 2;
  if (parsed.parentCode === '00') return 3;
  if (parsed.localCode === '00') return 4;
  return 5;
}

/**
 * Retourne le nom du niveau
 * @param {number} level
 * @returns {string}
 */
function getLevelName(level) {
  const names = ['Global', 'Continent', 'Pays', 'Région', 'Parent', 'Local'];
  return names[level] || 'Inconnu';
}

/**
 * Compare deux geo_id pour le tri
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compare(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

/**
 * Formate un geo_id pour l'affichage
 * @param {string} geoId
 * @param {Object} options
 * @returns {string}
 */
function format(geoId, options = {}) {
  const { showContinent = true, showCountry = true } = options;
  const parsed = parse(geoId);
  if (!parsed) return geoId;

  const parts = [];

  if (showContinent && parsed.continent) {
    parts.push(parsed.continent);
  }

  if (showCountry && parsed.country) {
    parts.push(parsed.country);
  }

  if (parsed.regionCode !== '00') {
    parts.push(`R${parsed.regionCode}`);
  }

  if (parsed.parentCode !== '00') {
    parts.push(`P${parsed.parentCode}`);
  }

  if (parsed.localCode !== '00') {
    parts.push(`L${parsed.localCode}`);
  }

  return parts.join(' / ') || 'Global';
}

/**
 * Génère un nouveau geo_id local dans un parent
 * @param {string} parentGeoId - Geo_id du parent
 * @param {number} localNumber - Numéro local (1-99)
 * @returns {string|null}
 */
function generateChild(parentGeoId, localNumber) {
  const parent = parse(parentGeoId);
  if (!parent || !parent.isParent) return null;
  if (localNumber < 1 || localNumber > 99) return null;

  return build({
    continentCode: parent.continentCode,
    countryCode: parent.countryCode,
    regionCode: parent.regionCode,
    parentCode: parent.parentCode,
    localCode: String(localNumber).padStart(2, '0')
  });
}

module.exports = {
  // Constants
  CONTINENT_CODES,
  COUNTRY_CODES,
  GEO_ID_REGEX,

  // Parsing
  parse,
  isValid,
  build,

  // Hierarchy
  isParentInstance,
  isGlobal,
  getParent,
  getRegion,
  getCountry,
  getContinent,
  isParentOf,
  isInScope,
  getLevel,
  getLevelName,
  generateChild,

  // Utility
  compare,
  format
};
