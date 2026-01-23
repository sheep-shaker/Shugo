'use strict';

/**
 * SHUGO v7.0 - Utilitaires de gestion des dates et heures
 *
 * Gestion des fuseaux horaires pour instances multi-géographiques.
 *
 * @see Document Technique V7.0 - Section 2.6
 */

/**
 * Fuseaux horaires par continent/région
 */
const TIMEZONES = {
  // Europe
  '02-033': 'Europe/Paris',      // France
  '02-032': 'Europe/Brussels',   // Belgique
  '02-041': 'Europe/Zurich',     // Suisse
  '02-039': 'Europe/Rome',       // Italie
  '02-034': 'Europe/Madrid',     // Espagne
  '02-049': 'Europe/Berlin',     // Allemagne
  '02-044': 'Europe/London',     // Royaume-Uni

  // Default Europe
  '02': 'Europe/Paris',

  // Amérique du Nord
  '04-001': 'America/New_York',  // USA Est
  '04-002': 'America/Toronto',   // Canada

  // Default
  'default': 'Europe/Paris'
};

/**
 * Récupère le fuseau horaire pour un geo_id
 * @param {string} geoId
 * @returns {string}
 */
function getTimezone(geoId) {
  if (!geoId) return TIMEZONES.default;

  // Essayer geo_id complet, puis préfixe pays, puis continent
  const prefix5 = geoId.substring(0, 6); // CC-PPP
  const prefix2 = geoId.substring(0, 2); // CC

  return TIMEZONES[prefix5] || TIMEZONES[prefix2] || TIMEZONES.default;
}

/**
 * Retourne la date actuelle
 * @returns {Date}
 */
function now() {
  return new Date();
}

/**
 * Retourne la date d'aujourd'hui au format YYYY-MM-DD
 * @param {string} timezone
 * @returns {string}
 */
function today(timezone = 'Europe/Paris') {
  return formatDate(new Date(), 'YYYY-MM-DD', timezone);
}

/**
 * Retourne l'heure actuelle au format HH:mm:ss
 * @param {string} timezone
 * @returns {string}
 */
function currentTime(timezone = 'Europe/Paris') {
  return formatDate(new Date(), 'HH:mm:ss', timezone);
}

/**
 * Formate une date
 * @param {Date|string} date
 * @param {string} format - YYYY-MM-DD, DD/MM/YYYY, HH:mm:ss, etc.
 * @param {string} timezone
 * @returns {string}
 */
function formatDate(date, format = 'YYYY-MM-DD', timezone = 'Europe/Paris') {
  const d = toDate(date);
  if (!d) return '';

  // Convertir vers le fuseau horaire
  const options = { timeZone: timezone };
  const parts = {
    year: d.toLocaleString('en-US', { ...options, year: 'numeric' }),
    month: d.toLocaleString('en-US', { ...options, month: '2-digit' }),
    day: d.toLocaleString('en-US', { ...options, day: '2-digit' }),
    hour: d.toLocaleString('en-US', { ...options, hour: '2-digit', hour12: false }),
    minute: d.toLocaleString('en-US', { ...options, minute: '2-digit' }),
    second: d.toLocaleString('en-US', { ...options, second: '2-digit' })
  };

  return format
    .replace('YYYY', parts.year)
    .replace('MM', parts.month)
    .replace('DD', parts.day)
    .replace('HH', parts.hour.padStart(2, '0'))
    .replace('mm', parts.minute.padStart(2, '0'))
    .replace('ss', parts.second.padStart(2, '0'));
}

/**
 * Formate pour affichage français
 * @param {Date|string} date
 * @param {Object} options
 * @returns {string}
 */
function formatFrench(date, options = {}) {
  const { includeTime = false, includeDay = false } = options;
  const d = toDate(date);
  if (!d) return '';

  const opts = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Europe/Paris'
  };

  if (includeDay) {
    opts.weekday = 'long';
  }

  if (includeTime) {
    opts.hour = '2-digit';
    opts.minute = '2-digit';
  }

  return d.toLocaleDateString('fr-FR', opts);
}

/**
 * Convertit en objet Date
 * @param {Date|string|number} value
 * @returns {Date|null}
 */
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Parse une date au format français (DD/MM/YYYY)
 * @param {string} str
 * @returns {Date|null}
 */
function parseFrenchDate(str) {
  if (!str) return null;
  const match = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;

  const [, day, month, year] = match;
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
}

/**
 * Ajoute des jours à une date
 * @param {Date|string} date
 * @param {number} days
 * @returns {Date}
 */
function addDays(date, days) {
  const d = toDate(date) || new Date();
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Ajoute des heures à une date
 * @param {Date|string} date
 * @param {number} hours
 * @returns {Date}
 */
function addHours(date, hours) {
  const d = toDate(date) || new Date();
  return new Date(d.getTime() + hours * 60 * 60 * 1000);
}

/**
 * Ajoute des minutes à une date
 * @param {Date|string} date
 * @param {number} minutes
 * @returns {Date}
 */
function addMinutes(date, minutes) {
  const d = toDate(date) || new Date();
  return new Date(d.getTime() + minutes * 60 * 1000);
}

/**
 * Ajoute des mois à une date
 * @param {Date|string} date
 * @param {number} months
 * @returns {Date}
 */
function addMonths(date, months) {
  const d = toDate(date) || new Date();
  const result = new Date(d);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Ajoute des années à une date
 * @param {Date|string} date
 * @param {number} years
 * @returns {Date}
 */
function addYears(date, years) {
  const d = toDate(date) || new Date();
  const result = new Date(d);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

/**
 * Début du jour
 * @param {Date|string} date
 * @returns {Date}
 */
function startOfDay(date) {
  const d = toDate(date) || new Date();
  const result = new Date(d);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Fin du jour
 * @param {Date|string} date
 * @returns {Date}
 */
function endOfDay(date) {
  const d = toDate(date) || new Date();
  const result = new Date(d);
  result.setHours(23, 59, 59, 999);
  return result;
}

/**
 * Début de la semaine (lundi)
 * @param {Date|string} date
 * @returns {Date}
 */
function startOfWeek(date) {
  const d = toDate(date) || new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const result = new Date(d);
  result.setDate(diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Fin de la semaine (dimanche)
 * @param {Date|string} date
 * @returns {Date}
 */
function endOfWeek(date) {
  const start = startOfWeek(date);
  return addDays(start, 6);
}

/**
 * Début du mois
 * @param {Date|string} date
 * @returns {Date}
 */
function startOfMonth(date) {
  const d = toDate(date) || new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * Fin du mois
 * @param {Date|string} date
 * @returns {Date}
 */
function endOfMonth(date) {
  const d = toDate(date) || new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/**
 * Différence en jours
 * @param {Date|string} date1
 * @param {Date|string} date2
 * @returns {number}
 */
function diffDays(date1, date2) {
  const d1 = toDate(date1);
  const d2 = toDate(date2);
  if (!d1 || !d2) return 0;

  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((d2 - d1) / msPerDay);
}

/**
 * Différence en heures
 * @param {Date|string} date1
 * @param {Date|string} date2
 * @returns {number}
 */
function diffHours(date1, date2) {
  const d1 = toDate(date1);
  const d2 = toDate(date2);
  if (!d1 || !d2) return 0;

  return Math.abs(d2 - d1) / (1000 * 60 * 60);
}

/**
 * Différence en minutes
 * @param {Date|string} date1
 * @param {Date|string} date2
 * @returns {number}
 */
function diffMinutes(date1, date2) {
  const d1 = toDate(date1);
  const d2 = toDate(date2);
  if (!d1 || !d2) return 0;

  return Math.abs(d2 - d1) / (1000 * 60);
}

/**
 * Vérifie si une date est dans le passé
 * @param {Date|string} date
 * @returns {boolean}
 */
function isPast(date) {
  const d = toDate(date);
  return d ? d < new Date() : false;
}

/**
 * Vérifie si une date est dans le futur
 * @param {Date|string} date
 * @returns {boolean}
 */
function isFuture(date) {
  const d = toDate(date);
  return d ? d > new Date() : false;
}

/**
 * Vérifie si une date est aujourd'hui
 * @param {Date|string} date
 * @returns {boolean}
 */
function isToday(date) {
  const d = toDate(date);
  if (!d) return false;
  const today = new Date();
  return d.toDateString() === today.toDateString();
}

/**
 * Vérifie si deux dates sont le même jour
 * @param {Date|string} date1
 * @param {Date|string} date2
 * @returns {boolean}
 */
function isSameDay(date1, date2) {
  const d1 = toDate(date1);
  const d2 = toDate(date2);
  if (!d1 || !d2) return false;
  return d1.toDateString() === d2.toDateString();
}

/**
 * Vérifie si une date est un week-end
 * @param {Date|string} date
 * @returns {boolean}
 */
function isWeekend(date) {
  const d = toDate(date);
  if (!d) return false;
  const day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * Récupère le numéro de semaine ISO
 * @param {Date|string} date
 * @returns {number}
 */
function getWeekNumber(date) {
  const d = toDate(date);
  if (!d) return 0;

  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target) / 604800000);
}

/**
 * Formate une durée relative (il y a X minutes, dans X jours)
 * @param {Date|string} date
 * @param {string} locale
 * @returns {string}
 */
function formatRelative(date, locale = 'fr-FR') {
  const d = toDate(date);
  if (!d) return '';

  const now = new Date();
  const diffMs = d - now;
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHour = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHour / 24);

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (Math.abs(diffSec) < 60) {
    return rtf.format(diffSec, 'second');
  } else if (Math.abs(diffMin) < 60) {
    return rtf.format(diffMin, 'minute');
  } else if (Math.abs(diffHour) < 24) {
    return rtf.format(diffHour, 'hour');
  } else if (Math.abs(diffDay) < 30) {
    return rtf.format(diffDay, 'day');
  } else {
    return formatFrench(d);
  }
}

/**
 * Parse une heure au format HH:mm ou HH:mm:ss
 * @param {string} timeStr
 * @returns {Object|null}
 */
function parseTime(timeStr) {
  if (!timeStr) return null;

  const match = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = match[3] ? parseInt(match[3], 10) : 0;

  if (hours < 0 || hours > 23) return null;
  if (minutes < 0 || minutes > 59) return null;
  if (seconds < 0 || seconds > 59) return null;

  return { hours, minutes, seconds };
}

/**
 * Combine une date et une heure
 * @param {Date|string} date
 * @param {string} time - Format HH:mm ou HH:mm:ss
 * @returns {Date|null}
 */
function combineDateAndTime(date, time) {
  const d = toDate(date);
  const t = parseTime(time);

  if (!d || !t) return null;

  const result = new Date(d);
  result.setHours(t.hours, t.minutes, t.seconds, 0);
  return result;
}

module.exports = {
  // Constants
  TIMEZONES,

  // Current
  now,
  today,
  currentTime,
  getTimezone,

  // Formatting
  formatDate,
  formatFrench,
  formatRelative,

  // Parsing
  toDate,
  parseFrenchDate,
  parseTime,
  combineDateAndTime,

  // Manipulation
  addDays,
  addHours,
  addMinutes,
  addMonths,
  addYears,

  // Boundaries
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,

  // Difference
  diffDays,
  diffHours,
  diffMinutes,

  // Comparison
  isPast,
  isFuture,
  isToday,
  isSameDay,
  isWeekend,
  getWeekNumber
};
