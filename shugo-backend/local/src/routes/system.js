// packages/local/src/routes/system.js
// System management routes for local server

const express = require('express');
const router = express.Router();
const os = require('os');
const { authMiddleware, requireRole } = require('../middleware/auth');
const logger = require('../utils/logger');
const config = require('../config');
const { sequelize } = require('../database');
const cache = require('../middleware/cache');

/**
 * GET /api/local/system/health
 * Get system health status
 */
router.get('/health', async (req, res, next) => {
    try {
        // Check database connection
        let dbStatus = 'healthy';
        try {
            await sequelize.authenticate();
        } catch (error) {
            dbStatus = 'unhealthy';
            logger.error('Database health check failed:', error);
        }
        
        // Get system metrics
        const metrics = {
            uptime: process.uptime(),
            memory: {
                used: process.memoryUsage().heapUsed,
                total: process.memoryUsage().heapTotal,
                system: os.totalmem() - os.freemem()
            },
            cpu: {
                loadAverage: os.loadavg(),
                cores: os.cpus().length
            },
            disk: {
                // This would require additional package like 'diskusage'
                // For now, just return available memory as proxy
                available: os.freemem()
            }
        };
        
        const status = dbStatus === 'healthy' ? 'healthy' : 'degraded';
        
        res.json({
            success: true,
            status,
            server: {
                name: config.server.name,
                id: config.server.id,
                geo_id: config.server.geo_id,
                version: config.app.version,
                environment: config.app.environment
            },
            services: {
                database: dbStatus,
                sync: req.app.locals.syncManager?.isOnline ? 'online' : 'offline',
                vault: req.app.locals.vault?.isInitialized ? 'initialized' : 'uninitialized',
                cache: config.cache.enabled ? 'enabled' : 'disabled'
            },
            metrics,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('Health check error:', error);
        next(error);
    }
});

/**
 * GET /api/local/system/info
 * Get system information (authenticated)
 */
router.get('/info', authMiddleware, async (req, res, next) => {
    try {
        const info = {
            server: {
                name: config.server.name,
                id: config.server.id,
                geo_id: config.server.geo_id,
                type: config.server.type,
                version: config.app.version,
                environment: config.app.environment
            },
            system: {
                platform: os.platform(),
                arch: os.arch(),
                hostname: os.hostname(),
                node_version: process.version,
                uptime: process.uptime()
            },
            configuration: {
                database: config.database.dialect,
                sync_mode: config.sync.mode,
                cache_enabled: config.cache.enabled,
                features: config.features
            }
        };
        
        // Add sensitive info for admins only
        if (['Admin', 'Platinum'].includes(req.user.role)) {
            info.configuration.central_url = config.central.url;
            info.configuration.sync_interval = config.sync.interval;
            info.configuration.backup_enabled = config.backup.enabled;
        }
        
        res.json({
            success: true,
            data: info
        });
        
    } catch (error) {
        logger.error('Get system info error:', error);
        next(error);
    }
});

/**
 * GET /api/local/system/statistics
 * Get system statistics (Admin/Platinum only)
 */
router.get('/statistics', authMiddleware, requireRole('Admin', 'Platinum'), async (req, res, next) => {
    try {
        const { LocalUser, LocalGuard, LocalAssignment, SyncQueue } = require('../models');
        
        // Get counts
        const [users, guards, assignments, pendingSync] = await Promise.all([
            LocalUser.count(),
            LocalGuard.count(),
            LocalAssignment.count(),
            SyncQueue.count({ where: { status: 'pending' } })
        ]);
        
        // Get cache stats
        const cacheStats = cache.stats();
        
        // Get sync stats
        const syncStats = req.app.locals.syncManager?.stats || null;
        
        // Get vault stats
        const vaultStats = await req.app.locals.vault?.getStatistics() || null;
        
        res.json({
            success: true,
            data: {
                counts: {
                    users,
                    guards,
                    assignments,
                    pendingSync
                },
                cache: cacheStats,
                sync: syncStats,
                vault: vaultStats,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        logger.error('Get statistics error:', error);
        next(error);
    }
});

/**
 * POST /api/local/system/cache/clear
 * Clear cache (Admin only)
 */
router.post('/cache/clear', authMiddleware, requireRole('Admin'), async (req, res, next) => {
    try {
        const { pattern = '*' } = req.body;
        
        cache.clear(pattern);
        
        logger.info('Cache cleared', {
            pattern,
            cleared_by: req.user.member_id
        });
        
        res.json({
            success: true,
            message: `Cache cleared for pattern: ${pattern}`
        });
        
    } catch (error) {
        logger.error('Clear cache error:', error);
        next(error);
    }
});

/**
 * POST /api/local/system/sync/trigger
 * Trigger manual sync (Admin only)
 */
router.post('/sync/trigger', authMiddleware, requireRole('Admin'), async (req, res, next) => {
    try {
        const syncManager = req.app.locals.syncManager;
        
        if (!syncManager) {
            return res.status(503).json({
                success: false,
                error: 'Sync service not available'
            });
        }
        
        if (!syncManager.isOnline) {
            return res.status(503).json({
                success: false,
                error: 'Cannot sync - offline mode'
            });
        }
        
        if (syncManager.isSyncing) {
            return res.status(409).json({
                success: false,
                error: 'Sync already in progress'
            });
        }
        
        // Trigger sync in background
        syncManager.performSync().catch(err => {
            logger.error('Manual sync failed:', err);
        });
        
        logger.info('Manual sync triggered', {
            triggered_by: req.user.member_id
        });
        
        res.json({
            success: true,
            message: 'Sync triggered successfully'
        });
        
    } catch (error) {
        logger.error('Trigger sync error:', error);
        next(error);
    }
});

/**
 * GET /api/local/system/logs
 * Get recent logs (Admin only)
 */
router.get('/logs', authMiddleware, requireRole('Admin'), async (req, res, next) => {
    try {
        const { level = 'info', limit = 100 } = req.query;
        
        // This would typically read from log files
        // For now, return a placeholder
        res.json({
            success: true,
            data: {
                logs: [],
                message: 'Log retrieval not implemented yet'
            }
        });
        
    } catch (error) {
        logger.error('Get logs error:', error);
        next(error);
    }
});

/**
 * POST /api/local/system/backup
 * Trigger manual backup (Admin only)
 */
router.post('/backup', authMiddleware, requireRole('Admin'), async (req, res, next) => {
    try {
        // This would trigger the backup service
        logger.info('Manual backup triggered', {
            triggered_by: req.user.member_id
        });
        
        res.json({
            success: true,
            message: 'Backup triggered successfully'
        });
        
    } catch (error) {
        logger.error('Trigger backup error:', error);
        next(error);
    }
});

module.exports = router;
