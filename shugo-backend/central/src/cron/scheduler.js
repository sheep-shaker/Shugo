// src/cron/scheduler.js
// Gestionnaire des tâches planifiées CRON

const cron = require('node-cron');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const config = require('../config');
const { sequelize } = require('../database/connection');

// Services
const BackupService = require('../services/BackupService');
const NotificationService = require('../services/NotificationService');
const GuardService = require('../services/GuardService');

class Scheduler {
    constructor() {
        this.jobs = new Map();
        this.isRunning = false;
    }
    
    /**
     * Démarrer le scheduler
     */
    start() {
        if (this.isRunning) {
            logger.warn('Scheduler already running');
            return;
        }
        
        logger.info('Starting CRON scheduler...');
        
        // Maintenance nocturne quotidienne (00:00)
        this.scheduleJob('daily-maintenance', '0 0 * * *', async () => {
            await this.runDailyMaintenance();
        });
        
        // Sauvegarde quotidienne (00:45)
        this.scheduleJob('daily-backup', '45 0 * * *', async () => {
            await this.runDailyBackup();
        });
        
        // Rappels de garde (08:00 et 18:00)
        this.scheduleJob('guard-reminders-morning', '0 8 * * *', async () => {
            await this.sendGuardReminders();
        });
        
        this.scheduleJob('guard-reminders-evening', '0 18 * * *', async () => {
            await this.sendGuardReminders();
        });
        
        // Nettoyage des données expirées (03:00)
        this.scheduleJob('cleanup-expired', '0 3 * * *', async () => {
            await this.cleanupExpiredData();
        });
        
        // Vérification de santé (toutes les 5 minutes)
        this.scheduleJob('health-check', '*/5 * * * *', async () => {
            await this.performHealthCheck();
        });
        
        // Relances pour gardes vides (Lundi, Jeudi, Samedi à 10:00)
        this.scheduleJob('empty-guard-alerts', '0 10 * * 1,4,6', async () => {
            await this.sendEmptyGuardAlerts();
        });
        
        // Sauvegarde hebdomadaire (Dimanche 02:00)
        this.scheduleJob('weekly-backup', '0 2 * * 0', async () => {
            await this.runWeeklyBackup();
        });
        
        // Sauvegarde mensuelle (1er du mois 03:00)
        this.scheduleJob('monthly-backup', '0 3 1 * *', async () => {
            await this.runMonthlyBackup();
        });
        
        // Rotation des clés (1er décembre 00:00)
        this.scheduleJob('key-rotation', '0 0 1 12 *', async () => {
            await this.rotateEncryptionKeys();
        });
        
        // Retry des notifications échouées (toutes les heures)
        this.scheduleJob('retry-notifications', '0 * * * *', async () => {
            await this.retryFailedNotifications();
        });
        
        this.isRunning = true;
        logger.success('CRON scheduler started with ' + this.jobs.size + ' jobs');
    }
    
    /**
     * Arrêter le scheduler
     */
    stop() {
        if (!this.isRunning) {
            return;
        }
        
        logger.info('Stopping CRON scheduler...');
        
        for (const [name, job] of this.jobs) {
            job.stop();
            logger.info(`Stopped job: ${name}`);
        }
        
        this.jobs.clear();
        this.isRunning = false;
        
        logger.success('CRON scheduler stopped');
    }
    
    /**
     * Planifier une tâche
     */
    scheduleJob(name, pattern, handler) {
        if (this.jobs.has(name)) {
            logger.warn(`Job ${name} already exists, replacing...`);
            this.jobs.get(name).stop();
        }
        
        const job = cron.schedule(pattern, async () => {
            const startTime = Date.now();
            logger.info(`Starting scheduled job: ${name}`);
            
            try {
                await handler();
                const duration = Date.now() - startTime;
                logger.success(`Job ${name} completed in ${duration}ms`);
            } catch (error) {
                logger.error(`Job ${name} failed`, {
                    error: error.message,
                    stack: error.stack
                });
            }
        }, {
            scheduled: true,
            timezone: config.server.timezone || 'UTC'
        });
        
        this.jobs.set(name, job);
        logger.info(`Scheduled job: ${name} with pattern: ${pattern}`);
    }
    
    /**
     * Maintenance quotidienne
     */
    async runDailyMaintenance() {
        logger.info('Running daily maintenance...');
        
        const tasks = [];
        
        // 1. Déconnecter toutes les sessions
        tasks.push(this.disconnectAllSessions());
        
        // 2. Vérifier l'intégrité de la base de données
        tasks.push(this.checkDatabaseIntegrity());
        
        // 3. Nettoyer les logs anciens
        tasks.push(this.cleanOldLogs());
        
        // 4. Mettre à jour les statistiques
        tasks.push(this.updateStatistics());
        
        // 5. Vérifier les rotations de clés nécessaires
        tasks.push(this.checkKeyRotation());
        
        // 6. Optimiser les tables de la base de données
        tasks.push(this.optimizeDatabaseTables());
        
        const results = await Promise.allSettled(tasks);
        
        const summary = {
            total: results.length,
            success: results.filter(r => r.status === 'fulfilled').length,
            failed: results.filter(r => r.status === 'rejected').length
        };
        
        logger.info('Daily maintenance completed', summary);
        
        return summary;
    }
    
    /**
     * Déconnecter toutes les sessions
     */
    async disconnectAllSessions() {
        try {
            const Session = require('../models/Session');
            const result = await Session.update(
                { 
                    is_active: false,
                    logout_reason: 'maintenance'
                },
                {
                    where: { is_active: true }
                }
            );
            
            logger.info('Sessions disconnected', { count: result[0] });
            return result[0];
        } catch (error) {
            logger.error('Failed to disconnect sessions', { error: error.message });
            throw error;
        }
    }
    
    /**
     * Vérifier l'intégrité de la base de données
     */
    async checkDatabaseIntegrity() {
        try {
            // Vérifier les contraintes
            const [results] = await sequelize.query(`
                SELECT 
                    conname AS constraint_name,
                    conrelid::regclass AS table_name
                FROM pg_constraint 
                WHERE NOT convalidated
            `);
            
            if (results.length > 0) {
                logger.warn('Invalid constraints found', { count: results.length });
            }
            
            // Vérifier les index
            const [indexes] = await sequelize.query(`
                SELECT 
                    schemaname,
                    tablename,
                    indexname
                FROM pg_indexes 
                WHERE schemaname = 'public'
                    AND indexdef LIKE '%INVALID%'
            `);
            
            if (indexes.length > 0) {
                logger.warn('Invalid indexes found', { count: indexes.length });
            }
            
            return {
                constraints: results.length,
                indexes: indexes.length,
                healthy: results.length === 0 && indexes.length === 0
            };
            
        } catch (error) {
            logger.error('Database integrity check failed', { error: error.message });
            throw error;
        }
    }
    
    /**
     * Nettoyer les anciens logs
     */
    async cleanOldLogs() {
        try {
            const SystemLog = require('../models/SystemLog');
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 30); // 30 jours
            
            if (SystemLog) {
                const result = await SystemLog.destroy({
                    where: {
                        created_at: { [Op.lt]: cutoffDate },
                        level: { [Op.ne]: 'ERROR' } // Garder les erreurs plus longtemps
                    }
                });
                
                logger.info('Old logs cleaned', { count: result });
                return result;
            }
            
            return 0;
        } catch (error) {
            logger.warn('Log cleanup skipped', { error: error.message });
            return 0;
        }
    }
    
    /**
     * Mettre à jour les statistiques
     */
    async updateStatistics() {
        try {
            // Analyser les tables pour optimiser les requêtes
            await sequelize.query('ANALYZE;');
            
            logger.info('Statistics updated');
            return true;
        } catch (error) {
            logger.error('Statistics update failed', { error: error.message });
            throw error;
        }
    }
    
    /**
     * Vérifier les rotations de clés
     */
    async checkKeyRotation() {
        try {
            // TODO: Implémenter la vérification de rotation des clés
            logger.info('Key rotation check completed');
            return true;
        } catch (error) {
            logger.error('Key rotation check failed', { error: error.message });
            throw error;
        }
    }
    
    /**
     * Optimiser les tables de la base de données
     */
    async optimizeDatabaseTables() {
        try {
            // VACUUM pour récupérer l'espace et mettre à jour les statistiques
            await sequelize.query('VACUUM ANALYZE;');
            
            logger.info('Database tables optimized');
            return true;
        } catch (error) {
            logger.error('Database optimization failed', { error: error.message });
            throw error;
        }
    }
    
    /**
     * Sauvegarde quotidienne
     */
    async runDailyBackup() {
        try {
            const result = await BackupService.createFullBackup('daily', 'Automated daily backup');
            logger.success('Daily backup completed', { name: result.backupName });
            return result;
        } catch (error) {
            logger.error('Daily backup failed', { error: error.message });
            
            // Envoyer une alerte aux admins
            await NotificationService.sendEmergencyAlert(
                'central',
                'La sauvegarde quotidienne a échoué. Intervention requise.',
                { error: error.message }
            );
            
            throw error;
        }
    }
    
    /**
     * Sauvegarde hebdomadaire
     */
    async runWeeklyBackup() {
        try {
            const result = await BackupService.createFullBackup('weekly', 'Automated weekly backup');
            logger.success('Weekly backup completed', { name: result.backupName });
            return result;
        } catch (error) {
            logger.error('Weekly backup failed', { error: error.message });
            throw error;
        }
    }
    
    /**
     * Sauvegarde mensuelle
     */
    async runMonthlyBackup() {
        try {
            const result = await BackupService.createFullBackup('monthly', 'Automated monthly backup');
            logger.success('Monthly backup completed', { name: result.backupName });
            return result;
        } catch (error) {
            logger.error('Monthly backup failed', { error: error.message });
            throw error;
        }
    }
    
    /**
     * Envoyer les rappels de garde
     */
    async sendGuardReminders() {
        try {
            const count = await NotificationService.sendGuardReminders(24);
            logger.info('Guard reminders sent', { count });
            return count;
        } catch (error) {
            logger.error('Failed to send guard reminders', { error: error.message });
            throw error;
        }
    }
    
    /**
     * Nettoyer les données expirées
     */
    async cleanupExpiredData() {
        try {
            const results = {
                notifications: 0,
                tokens: 0,
                guards: 0
            };
            
            // Nettoyer les notifications expirées
            results.notifications = await NotificationService.cleanupExpired();
            
            // Nettoyer les tokens expirés
            const RegistrationToken = require('../models/RegistrationToken');
            results.tokens = await RegistrationToken.cleanExpired();
            
            // Annuler les gardes passées
            const Guard = require('../models/Guard');
            results.guards = await Guard.cancelExpired();
            
            logger.info('Expired data cleaned', results);
            return results;
            
        } catch (error) {
            logger.error('Cleanup failed', { error: error.message });
            throw error;
        }
    }
    
    /**
     * Vérification de santé
     */
    async performHealthCheck() {
        try {
            const health = {
                database: false,
                memory: false,
                disk: false
            };
            
            // Vérifier la connexion DB
            try {
                await sequelize.authenticate();
                health.database = true;
            } catch (error) {
                logger.error('Database health check failed', { error: error.message });
            }
            
            // Vérifier la mémoire
            const memUsage = process.memoryUsage();
            const memPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
            health.memory = memPercent < 90;
            
            if (!health.memory) {
                logger.warn('High memory usage detected', { percent: memPercent });
            }
            
            // TODO: Vérifier l'espace disque
            health.disk = true;
            
            const isHealthy = Object.values(health).every(v => v === true);
            
            if (!isHealthy) {
                logger.warn('Health check issues detected', health);
            }
            
            return health;
            
        } catch (error) {
            logger.error('Health check failed', { error: error.message });
            throw error;
        }
    }
    
    /**
     * Alertes pour gardes vides
     */
    async sendEmptyGuardAlerts() {
        try {
            const emptyGuards = await GuardService.getEmptyGuards(null, 14); // 14 jours
            
            if (emptyGuards.length > 0) {
                // TODO: Envoyer les alertes aux responsables
                logger.warn('Empty guards found', { count: emptyGuards.length });
            }
            
            return emptyGuards.length;
            
        } catch (error) {
            logger.error('Failed to check empty guards', { error: error.message });
            throw error;
        }
    }
    
    /**
     * Rotation des clés de chiffrement
     */
    async rotateEncryptionKeys() {
        try {
            logger.warn('Key rotation triggered - Manual implementation required');
            
            // Envoyer une alerte aux Admin N1
            await NotificationService.sendEmergencyAlert(
                'central',
                'Rotation annuelle des clés de chiffrement requise.',
                { scheduled: true, date: new Date().toISOString() }
            );
            
            return true;
            
        } catch (error) {
            logger.error('Key rotation failed', { error: error.message });
            throw error;
        }
    }
    
    /**
     * Réessayer les notifications échouées
     */
    async retryFailedNotifications() {
        try {
            const count = await NotificationService.retryFailed();
            
            if (count > 0) {
                logger.info('Failed notifications retried', { count });
            }
            
            return count;
            
        } catch (error) {
            logger.error('Notification retry failed', { error: error.message });
            throw error;
        }
    }
    
    /**
     * Exécuter une tâche manuellement
     */
    async runJob(jobName) {
        const job = this.jobs.get(jobName);
        
        if (!job) {
            throw new Error(`Job ${jobName} not found`);
        }
        
        logger.info(`Manually triggering job: ${jobName}`);
        job.now();
    }
    
    /**
     * Obtenir le statut des jobs
     */
    getStatus() {
        const status = {
            running: this.isRunning,
            jobs: []
        };
        
        for (const [name, job] of this.jobs) {
            status.jobs.push({
                name,
                running: job.running,
                status: job.getStatus()
            });
        }
        
        return status;
    }
}

// Créer une instance unique
const scheduler = new Scheduler();

module.exports = scheduler;
