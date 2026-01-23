// packages/local/src/routes/sync.js
// Synchronization routes for local server

const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const { validateSync } = require('../utils/validator');
const logger = require('../utils/logger');
const { SyncQueue } = require('../models');

/**
 * GET /api/local/sync/status
 * Get sync status
 */
router.get('/status', authMiddleware, async (req, res, next) => {
    try {
        const syncManager = req.app.locals.syncManager;
        
        if (!syncManager) {
            return res.status(503).json({
                success: false,
                error: 'Sync service not available'
            });
        }
        
        const queueStats = await SyncQueue.getStatistics();
        
        res.json({
            success: true,
            data: {
                online: syncManager.isOnline,
                syncing: syncManager.isSyncing,
                lastSync: syncManager.lastSyncTime,
                stats: syncManager.stats,
                queue: queueStats,
                mode: syncManager.config.mode
            }
        });
        
    } catch (error) {
        logger.error('Get sync status error:', error);
        next(error);
    }
});

/**
 * POST /api/local/sync/pull
 * Pull changes from central
 */
router.post('/pull', authMiddleware, requireRole('Admin', 'Platinum'), async (req, res, next) => {
    try {
        const { error, value } = validateSync.pull(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: error.details[0].message
            });
        }
        
        const syncManager = req.app.locals.syncManager;
        
        if (!syncManager || !syncManager.isOnline) {
            return res.status(503).json({
                success: false,
                error: 'Cannot pull - offline mode'
            });
        }
        
        if (syncManager.isSyncing) {
            return res.status(409).json({
                success: false,
                error: 'Sync already in progress'
            });
        }
        
        // Start pull
        const result = await syncManager.pullChanges();
        
        res.json({
            success: true,
            data: {
                changes: result,
                timestamp: new Date()
            }
        });
        
    } catch (error) {
        logger.error('Pull sync error:', error);
        next(error);
    }
});

/**
 * POST /api/local/sync/push
 * Push changes to central
 */
router.post('/push', authMiddleware, requireRole('Admin', 'Platinum'), async (req, res, next) => {
    try {
        const syncManager = req.app.locals.syncManager;
        
        if (!syncManager || !syncManager.isOnline) {
            return res.status(503).json({
                success: false,
                error: 'Cannot push - offline mode'
            });
        }
        
        if (syncManager.isSyncing) {
            return res.status(409).json({
                success: false,
                error: 'Sync already in progress'
            });
        }
        
        // Start push
        const pushed = await syncManager.pushChanges();
        
        res.json({
            success: true,
            data: {
                pushed,
                timestamp: new Date()
            }
        });
        
    } catch (error) {
        logger.error('Push sync error:', error);
        next(error);
    }
});

/**
 * POST /api/local/sync/full
 * Perform full sync
 */
router.post('/full', authMiddleware, requireRole('Admin'), async (req, res, next) => {
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
        
        // Perform full sync
        await syncManager.performSync();
        
        res.json({
            success: true,
            data: {
                stats: syncManager.stats,
                lastSync: syncManager.lastSyncTime
            }
        });
        
    } catch (error) {
        logger.error('Full sync error:', error);
        next(error);
    }
});

/**
 * GET /api/local/sync/queue
 * Get sync queue
 */
router.get('/queue', authMiddleware, requireRole('Admin', 'Platinum'), async (req, res, next) => {
    try {
        const { status = 'pending', limit = 50 } = req.query;
        
        const where = {};
        if (status !== 'all') {
            where.status = status;
        }
        
        const items = await SyncQueue.findAll({
            where,
            order: [['priority', 'ASC'], ['created_at', 'ASC']],
            limit: parseInt(limit)
        });
        
        res.json({
            success: true,
            data: items
        });
        
    } catch (error) {
        logger.error('Get sync queue error:', error);
        next(error);
    }
});

/**
 * POST /api/local/sync/queue
 * Add item to sync queue
 */
router.post('/queue', authMiddleware, async (req, res, next) => {
    try {
        const { error, value } = validateSync.push(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: error.details[0].message
            });
        }
        
        const item = await SyncQueue.enqueue(
            value.operation,
            value.entity,
            value.data,
            { priority: value.priority }
        );
        
        // Try to process immediately if online
        const syncManager = req.app.locals.syncManager;
        if (syncManager && syncManager.isOnline) {
            syncManager.processQueue().catch(err => {
                logger.error('Queue processing error:', err);
            });
        }
        
        res.json({
            success: true,
            data: item
        });
        
    } catch (error) {
        logger.error('Add to sync queue error:', error);
        next(error);
    }
});

/**
 * DELETE /api/local/sync/queue/:id
 * Remove item from sync queue
 */
router.delete('/queue/:id', authMiddleware, requireRole('Admin'), async (req, res, next) => {
    try {
        const item = await SyncQueue.findByPk(req.params.id);
        
        if (!item) {
            return res.status(404).json({
                success: false,
                error: 'Queue item not found'
            });
        }
        
        await item.destroy();
        
        res.json({
            success: true,
            message: 'Queue item removed'
        });
        
    } catch (error) {
        logger.error('Remove from sync queue error:', error);
        next(error);
    }
});

/**
 * POST /api/local/sync/retry
 * Retry failed sync items
 */
router.post('/retry', authMiddleware, requireRole('Admin'), async (req, res, next) => {
    try {
        // Reset failed items to pending
        const result = await SyncQueue.update(
            { 
                status: 'pending',
                retries: 0,
                error: null
            },
            { 
                where: { 
                    status: ['failed', 'dead'] 
                }
            }
        );
        
        // Try to process if online
        const syncManager = req.app.locals.syncManager;
        if (syncManager && syncManager.isOnline) {
            syncManager.processQueue().catch(err => {
                logger.error('Queue processing error:', err);
            });
        }
        
        res.json({
            success: true,
            data: {
                reset: result[0],
                message: `${result[0]} items reset for retry`
            }
        });
        
    } catch (error) {
        logger.error('Retry sync error:', error);
        next(error);
    }
});

/**
 * POST /api/local/sync/clear
 * Clear completed sync items
 */
router.post('/clear', authMiddleware, requireRole('Admin'), async (req, res, next) => {
    try {
        const deleted = await SyncQueue.cleanOld(7); // Keep 7 days
        
        res.json({
            success: true,
            data: {
                deleted,
                message: `${deleted} old items cleared`
            }
        });
        
    } catch (error) {
        logger.error('Clear sync queue error:', error);
        next(error);
    }
});

module.exports = router;
