'use strict';

/**
 * SHUGO Local Server - Routes Index
 * Export centralisé de toutes les routes
 */

module.exports = {
  auth: require('./auth'),
  guards: require('./guards'),
  users: require('./users'),
  groups: require('./groups'),
  assignments: require('./assignments'),
  notifications: require('./notifications'),
  sync: require('./sync'),
  system: require('./system'),
  plugins: require('./plugins')
};
