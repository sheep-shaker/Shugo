// packages/local/src/routes/users.js
// User management routes for local server

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { LocalUser } = require('../models');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { validateUser } = require('../utils/validator');
const logger = require('../utils/logger');
const cache = require('../middleware/cache');

/**
 * GET /api/local/users
 * Get all users (Admin/Platinum only)
 */
router.get('/', authMiddleware, requireRole('Admin', 'Platinum'), cache.middleware(300), async (req, res, next) => {
    try {
        const {
            role,
            status = 'active',
            geo_id,
            group_id,
            search,
            page = 1,
            limit = 50
        } = req.query;
        
        // Build query
        const where = {};
        
        // Filter by geo_id (Platinum can only see their geo_id)
        if (req.user.role === 'Platinum') {
            where.geo_id = req.user.geo_id;
        } else if (geo_id) {
            where.geo_id = geo_id;
        }
        
        if (role) {
            where.role = role;
        }
        
        if (status !== 'all') {
            where.status = status;
        }
        
        if (group_id) {
            where.group_id = group_id;
        }
        
        // Search by name
        if (search) {
            where[Op.or] = [
                { first_name: { [Op.iLike]: `%${search}%` } },
                { last_name: { [Op.iLike]: `%${search}%` } }
            ];
        }
        
        // Pagination
        const offset = (page - 1) * limit;
        
        // Query
        const { count, rows: users } = await LocalUser.findAndCountAll({
            where,
            attributes: { exclude: ['email_encrypted', 'phone_encrypted'] },
            order: [['last_name', 'ASC'], ['first_name', 'ASC']],
            limit: parseInt(limit),
            offset
        });
        
        res.json({
            success: true,
            data: users.map(u => u.toSafeJSON()),
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(count / limit)
            }
        });
        
    } catch (error) {
        logger.error('Get users error:', error);
        next(error);
    }
});

/**
 * GET /api/local/users/:id
 * Get user by ID
 */
router.get('/:id', authMiddleware, async (req, res, next) => {
    try {
        const user = await LocalUser.findByPk(req.params.id);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Check permission
        const canView = req.user.member_id === user.member_id ||
                       ['Admin', 'Platinum'].includes(req.user.role) ||
                       (req.user.role === 'Gold' && req.user.group_id === user.group_id);
        
        if (!canView) {
            return res.status(403).json({
                success: false,
                error: 'Permission denied'
            });
        }
        
        res.json({
            success: true,
            data: user.toSafeJSON()
        });
        
    } catch (error) {
        logger.error('Get user error:', error);
        next(error);
    }
});

/**
 * PUT /api/local/users/:id
 * Update user (Admin only)
 */
router.put('/:id', authMiddleware, requireRole('Admin'), async (req, res, next) => {
    try {
        const user = await LocalUser.findByPk(req.params.id);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const { error, value } = validateUser.update(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: error.details[0].message
            });
        }
        
        // Update user
        await user.update(value);
        
        // Add to sync queue
        const { SyncQueue } = require('../models');
        await SyncQueue.enqueue('update', 'user', user.toJSON());
        
        // Clear cache
        cache.clear(`users:*`);
        cache.invalidateUser(user.member_id);
        
        logger.info('User updated', {
            member_id: user.member_id,
            updated_by: req.user.member_id
        });
        
        res.json({
            success: true,
            data: user.toSafeJSON()
        });
        
    } catch (error) {
        logger.error('Update user error:', error);
        next(error);
    }
});

/**
 * POST /api/local/users/:id/activate
 * Activate user (Admin only)
 */
router.post('/:id/activate', authMiddleware, requireRole('Admin'), async (req, res, next) => {
    try {
        const user = await LocalUser.findByPk(req.params.id);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        user.status = 'active';
        await user.save();
        
        // Add to sync queue
        const { SyncQueue } = require('../models');
        await SyncQueue.enqueue('update', 'user', { 
            member_id: user.member_id,
            status: 'active'
        });
        
        logger.info('User activated', {
            member_id: user.member_id,
            activated_by: req.user.member_id
        });
        
        res.json({
            success: true,
            message: 'User activated successfully'
        });
        
    } catch (error) {
        logger.error('Activate user error:', error);
        next(error);
    }
});

/**
 * POST /api/local/users/:id/suspend
 * Suspend user (Admin only)
 */
router.post('/:id/suspend', authMiddleware, requireRole('Admin'), async (req, res, next) => {
    try {
        const user = await LocalUser.findByPk(req.params.id);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        user.status = 'suspended';
        await user.save();
        
        // Add to sync queue
        const { SyncQueue } = require('../models');
        await SyncQueue.enqueue('update', 'user', {
            member_id: user.member_id,
            status: 'suspended'
        });
        
        logger.info('User suspended', {
            member_id: user.member_id,
            suspended_by: req.user.member_id,
            reason: req.body.reason
        });
        
        res.json({
            success: true,
            message: 'User suspended successfully'
        });
        
    } catch (error) {
        logger.error('Suspend user error:', error);
        next(error);
    }
});

/**
 * GET /api/local/users/:id/statistics
 * Get user statistics
 */
router.get('/:id/statistics', authMiddleware, async (req, res, next) => {
    try {
        const user = await LocalUser.findByPk(req.params.id);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Check permission
        const canView = req.user.member_id === user.member_id ||
                       ['Admin', 'Platinum', 'Gold'].includes(req.user.role);
        
        if (!canView) {
            return res.status(403).json({
                success: false,
                error: 'Permission denied'
            });
        }
        
        const stats = await user.getStatistics();
        
        res.json({
            success: true,
            data: stats
        });
        
    } catch (error) {
        logger.error('Get user statistics error:', error);
        next(error);
    }
});

module.exports = router;
