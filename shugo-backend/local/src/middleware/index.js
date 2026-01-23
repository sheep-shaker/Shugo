'use strict';

/**
 * SHUGO Local Server - Middleware Index
 * Export centralisé de tous les middleware
 */

module.exports = {
  auth: require('./auth'),
  cache: require('./cache'),
  errorHandler: require('./errorHandler'),
  requestLogger: require('./requestLogger'),
  rateLimit: require('./rateLimit')
};
