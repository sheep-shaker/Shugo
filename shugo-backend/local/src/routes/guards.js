// packages/local/src/routes/guards.js
// Guard management routes for local server

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { LocalGuard, LocalAssignment, LocalUser, SyncQueue } = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { validateGuard } = require('../utils/validator');
const logger = require('../utils/logger');
const cache = require('../middleware/cache');

/**
 * GET /api/local/guards
 * Get all guards for this geo_id
 */
router.get('/', authMiddleware, cache.middleware(300), async (req, res, next) => {
    try {
        const {
            date,
            start_date,
            end_date,
            status = 'open',
            type,
            page = 1,
            limit = 50
        } = req.query;
        
        // Build query
        const where = {
            geo_id: req.user.geo_id
        };
        
        // Date filters
        if (date) {
            where.guard_date = date;
        } else if (start_date && end_date) {
            where.guard_date = {
                [Op.between]: [start_date, end_date]
            };
        } else {
            // Default: next 7 days
            const today = new Date();
            const nextWeek = new Date();
            nextWeek.setDate(today.getDate() + 7);
            where.guard_date = {
                [Op.between]: [
                    today.toISOString().split('T')[0],
                    nextWeek.toISOString().split('T')[0]
                ]
            };
        }
        
        if (status && status !== 'all') {
            where.status = status;
        }
        
        if (type) {
            where.guard_type = type;
        }
        
        // Pagination
        const offset = (page - 1) * limit;
        
        // Query
        const { count, rows: guards } = await LocalGuard.findAndCountAll({
            where,
            include: [
                {
                    model: LocalAssignment,
                    as: 'assignments',
                    include: [
                        {
                            model: LocalUser,
                            as: 'user',
                            attributes: ['member_id', 'first_name', 'last_name', 'role']
                        }
                    ]
                },
                {
                    model: LocalUser,
                    as: 'creator',
                    attributes: ['member_id', 'first_name', 'last_name']
                }
            ],
            order: [['guard_date', 'ASC'], ['start_time', 'ASC']],
            limit: parseInt(limit),
            offset
        });
        
        res.json({
            success: true,
            data: guards,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(count / limit)
            }
        });
        
    } catch (error) {
        logger.error('Get guards error:', error);
        next(error);
    }
});

/**
 * GET /api/local/guards/:id
 * Get guard by ID
 */
router.get('/:id', authMiddleware, async (req, res, next) => {
    try {
        const guard = await LocalGuard.findByPk(req.params.id, {
            include: [
                {
                    model: LocalAssignment,
                    as: 'assignments',
                    include: [
                        {
                            model: LocalUser,
                            as: 'user',
                            attributes: ['member_id', 'first_name', 'last_name', 'role', 'group_id']
                        }
                    ]
                },
                {
                    model: LocalUser,
                    as: 'creator',
                    attributes: ['member_id', 'first_name', 'last_name']
                }
            ]
        });
        
        if (!guard) {
            return res.status(404).json({
                success: false,
                error: 'Guard not found'
            });
        }
        
        // Check if user can view this guard
        if (guard.geo_id !== req.user.geo_id && !['Admin'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Permission denied'
            });
        }
        
        res.json({
            success: true,
            data: guard
        });
        
    } catch (error) {
        logger.error('Get guard error:', error);
        next(error);
    }
});

/**
 * POST /api/local/guards
 * Create a new guard (Platinum/Admin only)
 */
router.post('/', authMiddleware, async (req, res, next) => {
    try {
        // Check permission
        if (!['Platinum', 'Admin'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Permission denied'
            });
        }
        
        // Validate input
        const { error, value } = validateGuard.create(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: error.details[0].message
            });
        }
        
        // Create guard
        const guard = await LocalGuard.create({
            ...value,
            geo_id: req.user.geo_id,
            created_by_member_id: req.user.member_id,
            locally_modified: true
        });
        
        // Add to sync queue
        await SyncQueue.enqueue('create', 'guard', guard.toJSON());
        
        // Clear cache
        cache.clear(`guards:${req.user.geo_id}:*`);
        
        logger.info('Guard created', {
            guard_id: guard.guard_id,
            created_by: req.user.member_id
        });
        
        // Emit event
        const eventBus = req.app.locals.eventBus;
        if (eventBus) {
            eventBus.emit('guard.created', {
                guard: guard.toJSON(),
                user: req.user
            });
        }
        
        res.status(201).json({
            success: true,
            data: guard
        });
        
    } catch (error) {
        logger.error('Create guard error:', error);
        next(error);
    }
});

/**
 * PUT /api/local/guards/:id
 * Update a guard (Platinum/Admin or creator)
 */
router.put('/:id', authMiddleware, async (req, res, next) => {
    try {
        const guard = await LocalGuard.findByPk(req.params.id);
        
        if (!guard) {
            return res.status(404).json({
                success: false,
                error: 'Guard not found'
            });
        }
        
        // Check permission
        const canEdit = ['Platinum', 'Admin'].includes(req.user.role) ||
                       guard.created_by_member_id === req.user.member_id;
        
        if (!canEdit) {
            return res.status(403).json({
                success: false,
                error: 'Permission denied'
            });
        }
        
        // Validate input
        const { error, value } = validateGuard.update(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: error.details[0].message
            });
        }
        
        // Update guard
        await guard.update({
            ...value,
            locally_modified: true
        });
        
        // Add to sync queue
        await SyncQueue.enqueue('update', 'guard', guard.toJSON());
        
        // Clear cache
        cache.clear(`guards:${guard.geo_id}:*`);
        
        logger.info('Guard updated', {
            guard_id: guard.guard_id,
            updated_by: req.user.member_id
        });
        
        // Emit event
        const eventBus = req.app.locals.eventBus;
        if (eventBus) {
            eventBus.emit('guard.updated', {
                guard: guard.toJSON(),
                user: req.user
            });
        }
        
        res.json({
            success: true,
            data: guard
        });
        
    } catch (error) {
        logger.error('Update guard error:', error);
        next(error);
    }
});

/**
 * DELETE /api/local/guards/:id
 * Cancel a guard (Platinum/Admin or creator)
 */
router.delete('/:id', authMiddleware, async (req, res, next) => {
    try {
        const guard = await LocalGuard.findByPk(req.params.id);
        
        if (!guard) {
            return res.status(404).json({
                success: false,
                error: 'Guard not found'
            });
        }
        
        // Check permission
        const canDelete = ['Platinum', 'Admin'].includes(req.user.role) ||
                         guard.created_by_member_id === req.user.member_id;
        
        if (!canDelete) {
            return res.status(403).json({
                success: false,
                error: 'Permission denied'
            });
        }
        
        // Cancel instead of delete
        guard.status = 'cancelled';
        guard.locally_modified = true;
        await guard.save();
        
        // Cancel all assignments
        await LocalAssignment.update(
            { status: 'cancelled' },
            { where: { guard_id: guard.guard_id } }
        );
        
        // Add to sync queue
        await SyncQueue.enqueue('update', 'guard', guard.toJSON());
        
        // Clear cache
        cache.clear(`guards:${guard.geo_id}:*`);
        
        logger.info('Guard cancelled', {
            guard_id: guard.guard_id,
            cancelled_by: req.user.member_id
        });
        
        // Emit event
        const eventBus = req.app.locals.eventBus;
        if (eventBus) {
            eventBus.emit('guard.cancelled', {
                guard: guard.toJSON(),
                user: req.user
            });
        }
        
        res.json({
            success: true,
            message: 'Guard cancelled successfully'
        });
        
    } catch (error) {
        logger.error('Cancel guard error:', error);
        next(error);
    }
});

/**
 * POST /api/local/guards/:id/join
 * Join a guard
 */
router.post('/:id/join', authMiddleware, async (req, res, next) => {
    try {
        const guard = await LocalGuard.findByPk(req.params.id);
        
        if (!guard) {
            return res.status(404).json({
                success: false,
                error: 'Guard not found'
            });
        }
        
        // Check if guard is open
        if (guard.status !== 'open') {
            return res.status(400).json({
                success: false,
                error: `Guard is ${guard.status}`
            });
        }
        
        // Check if guard is full
        if (guard.isFull()) {
            return res.status(400).json({
                success: false,
                error: 'Guard is full'
            });
        }
        
        // Check if already assigned
        const existing = await LocalAssignment.findOne({
            where: {
                guard_id: guard.guard_id,
                member_id: req.user.member_id,
                status: { [Op.ne]: 'cancelled' }
            }
        });
        
        if (existing) {
            return res.status(400).json({
                success: false,
                error: 'Already assigned to this guard'
            });
        }
        
        // Create assignment
        const assignment = await LocalAssignment.create({
            guard_id: guard.guard_id,
            member_id: req.user.member_id,
            assigned_by_member_id: req.user.member_id,
            assignment_type: 'voluntary'
        });
        
        // Update participant count
        await guard.addParticipant();
        
        // Add to sync queue
        await SyncQueue.enqueue('create', 'assignment', assignment.toJSON());
        
        // Clear cache
        cache.clear(`guards:${guard.geo_id}:*`);
        
        logger.info('User joined guard', {
            guard_id: guard.guard_id,
            member_id: req.user.member_id
        });
        
        // Emit event
        const eventBus = req.app.locals.eventBus;
        if (eventBus) {
            eventBus.emit('guard.assigned', {
                guard: guard.toJSON(),
                assignment: assignment.toJSON(),
                user: req.user
            });
        }
        
        res.json({
            success: true,
            data: assignment
        });
        
    } catch (error) {
        logger.error('Join guard error:', error);
        next(error);
    }
});

/**
 * POST /api/local/guards/:id/leave
 * Leave a guard
 */
router.post('/:id/leave', authMiddleware, async (req, res, next) => {
    try {
        const guard = await LocalGuard.findByPk(req.params.id);
        
        if (!guard) {
            return res.status(404).json({
                success: false,
                error: 'Guard not found'
            });
        }
        
        // Find assignment
        const assignment = await LocalAssignment.findOne({
            where: {
                guard_id: guard.guard_id,
                member_id: req.user.member_id,
                status: { [Op.ne]: 'cancelled' }
            }
        });
        
        if (!assignment) {
            return res.status(404).json({
                success: false,
                error: 'Assignment not found'
            });
        }
        
        // Cancel assignment
        assignment.status = 'cancelled';
        assignment.cancelled_at = new Date();
        assignment.cancellation_reason = req.body.reason || 'User cancelled';
        await assignment.save();
        
        // Update participant count
        await guard.removeParticipant();
        
        // Add to sync queue
        await SyncQueue.enqueue('update', 'assignment', assignment.toJSON());
        
        // Clear cache
        cache.clear(`guards:${guard.geo_id}:*`);
        
        logger.info('User left guard', {
            guard_id: guard.guard_id,
            member_id: req.user.member_id
        });
        
        // Emit event
        const eventBus = req.app.locals.eventBus;
        if (eventBus) {
            eventBus.emit('guard.unassigned', {
                guard: guard.toJSON(),
                assignment: assignment.toJSON(),
                user: req.user
            });
        }
        
        res.json({
            success: true,
            message: 'Successfully left the guard'
        });
        
    } catch (error) {
        logger.error('Leave guard error:', error);
        next(error);
    }
});

/**
 * GET /api/local/guards/my-assignments
 * Get user's guard assignments
 */
router.get('/my-assignments', authMiddleware, async (req, res, next) => {
    try {
        const { status = 'confirmed', upcoming = true } = req.query;
        
        const where = {
            member_id: req.user.member_id
        };
        
        if (status !== 'all') {
            where.status = status;
        }
        
        const include = [
            {
                model: LocalGuard,
                as: 'guard',
                where: upcoming ? {
                    guard_date: {
                        [Op.gte]: new Date().toISOString().split('T')[0]
                    }
                } : {}
            }
        ];
        
        const assignments = await LocalAssignment.findAll({
            where,
            include,
            order: [[{ model: LocalGuard, as: 'guard' }, 'guard_date', 'ASC']]
        });
        
        res.json({
            success: true,
            data: assignments
        });
        
    } catch (error) {
        logger.error('Get assignments error:', error);
        next(error);
    }
});

/**
 * GET /api/local/guards/statistics
 * Get guard statistics for this geo_id
 */
router.get('/statistics', authMiddleware, cache.middleware(600), async (req, res, next) => {
    try {
        const { start_date, end_date } = req.query;
        
        const where = {
            geo_id: req.user.geo_id
        };
        
        if (start_date && end_date) {
            where.guard_date = {
                [Op.between]: [start_date, end_date]
            };
        }
        
        // Get statistics
        const total = await LocalGuard.count({ where });
        const open = await LocalGuard.count({ where: { ...where, status: 'open' } });
        const full = await LocalGuard.count({ where: { ...where, status: 'full' } });
        const cancelled = await LocalGuard.count({ where: { ...where, status: 'cancelled' } });
        
        // Coverage rate
        const coverageRate = total > 0 ? ((full / total) * 100).toFixed(2) : 0;
        
        // Low participation guards
        const lowParticipation = await LocalGuard.getLowParticipation(req.user.geo_id);
        
        res.json({
            success: true,
            data: {
                total,
                open,
                full,
                cancelled,
                coverageRate: parseFloat(coverageRate),
                lowParticipation: lowParticipation.length,
                needsAttention: lowParticipation.slice(0, 5)
            }
        });
        
    } catch (error) {
        logger.error('Get statistics error:', error);
        next(error);
    }
});

module.exports = router;
