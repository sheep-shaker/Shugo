// packages/local/src/routes/groups.js
// Group management routes for local server

const express = require('express');
const router = express.Router();
const { LocalGroup, LocalGroupMembership, LocalUser } = require('../models');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { validateGroup } = require('../utils/validator');
const logger = require('../utils/logger');

/**
 * GET /api/local/groups
 * Get all groups
 */
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        const { geo_id, status = 'active' } = req.query;
        
        const where = {};
        
        // Filter by geo_id
        if (req.user.role === 'Silver' || req.user.role === 'Gold') {
            where.geo_id = req.user.geo_id;
        } else if (geo_id) {
            where.geo_id = geo_id;
        }
        
        if (status !== 'all') {
            where.status = status;
        }
        
        const groups = await LocalGroup.findAll({
            where,
            include: [
                {
                    model: LocalUser,
                    as: 'leader',
                    attributes: ['member_id', 'first_name', 'last_name']
                }
            ],
            order: [['name', 'ASC']]
        });
        
        res.json({
            success: true,
            data: groups
        });
        
    } catch (error) {
        logger.error('Get groups error:', error);
        next(error);
    }
});

/**
 * GET /api/local/groups/:id
 * Get group by ID with members
 */
router.get('/:id', authMiddleware, async (req, res, next) => {
    try {
        const group = await LocalGroup.findByPk(req.params.id, {
            include: [
                {
                    model: LocalUser,
                    as: 'leader',
                    attributes: ['member_id', 'first_name', 'last_name']
                },
                {
                    model: LocalUser,
                    as: 'members',
                    attributes: ['member_id', 'first_name', 'last_name', 'role'],
                    through: { attributes: ['role_in_group', 'joined_at'] }
                }
            ]
        });
        
        if (!group) {
            return res.status(404).json({
                success: false,
                error: 'Group not found'
            });
        }
        
        res.json({
            success: true,
            data: group
        });
        
    } catch (error) {
        logger.error('Get group error:', error);
        next(error);
    }
});

/**
 * POST /api/local/groups
 * Create a new group (Platinum/Admin only)
 */
router.post('/', authMiddleware, requireRole('Platinum', 'Admin'), async (req, res, next) => {
    try {
        const { error, value } = validateGroup.create(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: error.details[0].message
            });
        }
        
        // Set geo_id from user if not admin
        if (req.user.role !== 'Admin') {
            value.geo_id = req.user.geo_id;
        }
        
        const group = await LocalGroup.create(value);
        
        // Add to sync queue
        const { SyncQueue } = require('../models');
        await SyncQueue.enqueue('create', 'group', group.toJSON());
        
        logger.info('Group created', {
            group_id: group.group_id,
            created_by: req.user.member_id
        });
        
        res.status(201).json({
            success: true,
            data: group
        });
        
    } catch (error) {
        logger.error('Create group error:', error);
        next(error);
    }
});

/**
 * PUT /api/local/groups/:id
 * Update a group (Gold leader or Platinum/Admin)
 */
router.put('/:id', authMiddleware, async (req, res, next) => {
    try {
        const group = await LocalGroup.findByPk(req.params.id);
        
        if (!group) {
            return res.status(404).json({
                success: false,
                error: 'Group not found'
            });
        }
        
        // Check permission
        const canEdit = ['Platinum', 'Admin'].includes(req.user.role) ||
                       (req.user.role === 'Gold' && group.leader_member_id === req.user.member_id);
        
        if (!canEdit) {
            return res.status(403).json({
                success: false,
                error: 'Permission denied'
            });
        }
        
        const { error, value } = validateGroup.update(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: error.details[0].message
            });
        }
        
        await group.update(value);
        
        // Add to sync queue
        const { SyncQueue } = require('../models');
        await SyncQueue.enqueue('update', 'group', group.toJSON());
        
        logger.info('Group updated', {
            group_id: group.group_id,
            updated_by: req.user.member_id
        });
        
        res.json({
            success: true,
            data: group
        });
        
    } catch (error) {
        logger.error('Update group error:', error);
        next(error);
    }
});

/**
 * POST /api/local/groups/:id/members
 * Add member to group
 */
router.post('/:id/members', authMiddleware, async (req, res, next) => {
    try {
        const group = await LocalGroup.findByPk(req.params.id);
        
        if (!group) {
            return res.status(404).json({
                success: false,
                error: 'Group not found'
            });
        }
        
        // Check permission
        const canAdd = ['Platinum', 'Admin'].includes(req.user.role) ||
                      (req.user.role === 'Gold' && group.leader_member_id === req.user.member_id);
        
        if (!canAdd) {
            return res.status(403).json({
                success: false,
                error: 'Permission denied'
            });
        }
        
        const { member_id, role_in_group = 'member' } = req.body;
        
        // Check if user exists
        const user = await LocalUser.findByPk(member_id);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Check if already member
        const existing = await LocalGroupMembership.findOne({
            where: {
                group_id: group.group_id,
                member_id
            }
        });
        
        if (existing) {
            return res.status(409).json({
                success: false,
                error: 'User is already a member of this group'
            });
        }
        
        // Add member
        const membership = await LocalGroupMembership.create({
            group_id: group.group_id,
            member_id,
            role_in_group
        });
        
        // Update user's group_id if this is their primary group
        if (!user.group_id) {
            user.group_id = group.group_id;
            await user.save();
        }
        
        // Add to sync queue
        const { SyncQueue } = require('../models');
        await SyncQueue.enqueue('create', 'group_membership', membership.toJSON());
        
        logger.info('Member added to group', {
            group_id: group.group_id,
            member_id,
            added_by: req.user.member_id
        });
        
        res.json({
            success: true,
            data: membership
        });
        
    } catch (error) {
        logger.error('Add group member error:', error);
        next(error);
    }
});

/**
 * DELETE /api/local/groups/:id/members/:memberId
 * Remove member from group
 */
router.delete('/:id/members/:memberId', authMiddleware, async (req, res, next) => {
    try {
        const group = await LocalGroup.findByPk(req.params.id);
        
        if (!group) {
            return res.status(404).json({
                success: false,
                error: 'Group not found'
            });
        }
        
        // Check permission
        const canRemove = ['Platinum', 'Admin'].includes(req.user.role) ||
                         (req.user.role === 'Gold' && group.leader_member_id === req.user.member_id) ||
                         req.user.member_id === parseInt(req.params.memberId);
        
        if (!canRemove) {
            return res.status(403).json({
                success: false,
                error: 'Permission denied'
            });
        }
        
        const membership = await LocalGroupMembership.findOne({
            where: {
                group_id: group.group_id,
                member_id: req.params.memberId
            }
        });
        
        if (!membership) {
            return res.status(404).json({
                success: false,
                error: 'Membership not found'
            });
        }
        
        await membership.destroy();
        
        // Update user's group_id if this was their primary group
        const user = await LocalUser.findByPk(req.params.memberId);
        if (user && user.group_id === group.group_id) {
            user.group_id = null;
            await user.save();
        }
        
        // Add to sync queue
        const { SyncQueue } = require('../models');
        await SyncQueue.enqueue('delete', 'group_membership', {
            group_id: group.group_id,
            member_id: req.params.memberId
        });
        
        logger.info('Member removed from group', {
            group_id: group.group_id,
            member_id: req.params.memberId,
            removed_by: req.user.member_id
        });
        
        res.json({
            success: true,
            message: 'Member removed successfully'
        });
        
    } catch (error) {
        logger.error('Remove group member error:', error);
        next(error);
    }
});

module.exports = router;
