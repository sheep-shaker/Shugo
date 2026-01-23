'use strict';

/**
 * SHUGO Local Server - Services Index
 * Export centralisé de tous les services locaux
 */

const HealthMonitor = require('./HealthMonitor');
const BackupService = require('./BackupService');
const NotificationService = require('./NotificationService');

module.exports = {
  HealthMonitor,
  BackupService,
  NotificationService
};
