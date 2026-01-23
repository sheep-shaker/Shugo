// src/routes/groups.js
// Routes pour la gestion des groupes

const router = require('express').Router();
const { body, param, query, validationResult } = require('express-validator');
const { authenticateToken, checkRole } = require('../middleware/auth');
const Group = require('../models/Group');
const GroupMembership = require('../models/GroupMembership');
const User = require('../models/User');
const logger = require('../utils/logger');
const { sequelize } = require('../database/connection');

// Middleware de validation
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ 
            success: false, 
            errors: errors.array() 
        });
    }
    next();
};

/**
 * @route   GET /api/v1/groups
 * @desc    Obtenir la liste des groupes
 * @access  Authenticated
 */
router.get('/',
    authenticateToken,
    [
        query('geo_id').optional().matches(/^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/),
        query('status').optional().isIn(['active', 'inactive', 'archived']),
        query('type').optional().isIn(['standard', 'special', 'training', 'admin']),
        query('with_capacity').optional().isBoolean()
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const where = {};
            
            if (req.query.geo_id) {
                where.geo_id = req.query.geo_id;
            } else if (req.user.geo_id) {
                where.geo_id = req.user.geo_id;
            }
            
            if (req.query.status) where.status = req.query.status;
            if (req.query.type) where.type = req.query.type;
            
            if (req.query.with_capacity === 'true') {
                where[Op.literal] = 'current_members < max_members';
            }
            
            const groups = await Group.findAll({
                where,
                include: [{
                    model: User,
                    as: 'leader',
                    attributes: ['member_id', 'first_name_hash', 'last_name_hash']
                }],
                order: [['name', 'ASC']]
            });
            
            res.json({
                success: true,
                data: groups,
                count: groups.length
            });
            
        } catch (error) {
            logger.error('Error fetching groups', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching groups',
                error: error.message
            });
        }
    }
);

/**
 * @route   GET /api/v1/groups/my-groups
 * @desc    Obtenir ses groupes
 * @access  Authenticated
 */
router.get('/my-groups',
    authenticateToken,
    async (req, res) => {
        try {
            const memberships = await GroupMembership.findActiveByMember(req.user.member_id);
            
            res.json({
                success: true,
                data: memberships,
                count: memberships.length
            });
            
        } catch (error) {
            logger.error('Error fetching user groups', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching groups',
                error: error.message
            });
        }
    }
);

/**
 * @route   GET /api/v1/groups/:id
 * @desc    Obtenir un groupe spécifique
 * @access  Authenticated
 */
router.get('/:id',
    authenticateToken,
    param('id').isUUID(),
    handleValidationErrors,
    async (req, res) => {
        try {
            const group = await Group.findByPk(req.params.id, {
                include: [
                    {
                        model: User,
                        as: 'leader',
                        attributes: ['member_id', 'first_name_hash', 'last_name_hash', 'role']
                    },
                    {
                        model: GroupMembership,
                        where: { is_active: true },
                        required: false,
                        include: [{
                            model: User,
                            attributes: ['member_id', 'first_name_hash', 'last_name_hash', 'role']
                        }]
                    }
                ]
            });
            
            if (!group) {
                return res.status(404).json({
                    success: false,
                    message: 'Group not found'
                });
            }
            
            res.json({
                success: true,
                data: group
            });
            
        } catch (error) {
            logger.error('Error fetching group', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching group',
                error: error.message
            });
        }
    }
);

/**
 * @route   GET /api/v1/groups/:id/members
 * @desc    Obtenir les membres d'un groupe
 * @access  Authenticated
 */
router.get('/:id/members',
    authenticateToken,
    param('id').isUUID(),
    handleValidationErrors,
    async (req, res) => {
        try {
            const members = await GroupMembership.findActiveByGroup(req.params.id);
            
            res.json({
                success: true,
                data: members,
                count: members.length
            });
            
        } catch (error) {
            logger.error('Error fetching group members', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching members',
                error: error.message
            });
        }
    }
);

/**
 * @route   POST /api/v1/groups
 * @desc    Créer un nouveau groupe
 * @access  Platinum+
 */
router.post('/',
    authenticateToken,
    checkRole(['Platinum', 'Admin', 'Admin_N1']),
    [
        body('name').notEmpty().isLength({ min: 3, max: 100 }),
        body('description').optional().isLength({ max: 1000 }),
        body('geo_id').matches(/^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/),
        body('max_members').optional().isInt({ min: 1, max: 500 }),
        body('type').optional().isIn(['standard', 'special', 'training', 'admin']),
        body('leader_member_id').optional().isInt(),
        body('color_code').optional().matches(/^#[0-9A-Fa-f]{6}$/)
    ],
    handleValidationErrors,
    async (req, res) => {
        const transaction = await sequelize.transaction();
        
        try {
            // Créer le groupe
            const group = await Group.create({
                ...req.body,
                created_by_member_id: req.user.member_id
            }, { transaction });
            
            // Si un leader est spécifié, l'ajouter au groupe
            if (req.body.leader_member_id) {
                await GroupMembership.create({
                    group_id: group.group_id,
                    member_id: req.body.leader_member_id,
                    role_in_group: 'leader',
                    added_by_member_id: req.user.member_id
                }, { transaction });
            }
            
            await transaction.commit();
            
            logger.info('Group created', {
                groupId: group.group_id,
                createdBy: req.user.member_id
            });
            
            res.status(201).json({
                success: true,
                message: 'Group created successfully',
                data: group
            });
            
        } catch (error) {
            await transaction.rollback();
            logger.error('Error creating group', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error creating group',
                error: error.message
            });
        }
    }
);

/**
 * @route   PUT /api/v1/groups/:id
 * @desc    Modifier un groupe
 * @access  Gold+ (leader) ou Platinum+
 */
router.put('/:id',
    authenticateToken,
    param('id').isUUID(),
    handleValidationErrors,
    async (req, res) => {
        try {
            const group = await Group.findByPk(req.params.id);
            
            if (!group) {
                return res.status(404).json({
                    success: false,
                    message: 'Group not found'
                });
            }
            
            // Vérifier les permissions
            const canEdit = 
                ['Platinum', 'Admin', 'Admin_N1'].includes(req.user.role) ||
                (req.user.role === 'Gold' && group.leader_member_id === req.user.member_id);
            
            if (!canEdit) {
                return res.status(403).json({
                    success: false,
                    message: 'Insufficient permissions'
                });
            }
            
            await group.update(req.body);
            
            logger.info('Group updated', {
                groupId: group.group_id,
                updatedBy: req.user.member_id
            });
            
            res.json({
                success: true,
                message: 'Group updated successfully',
                data: group
            });
            
        } catch (error) {
            logger.error('Error updating group', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error updating group',
                error: error.message
            });
        }
    }
);

/**
 * @route   POST /api/v1/groups/:id/add-member
 * @desc    Ajouter un membre au groupe
 * @access  Gold+ (leader) ou Platinum+
 */
router.post('/:id/add-member',
    authenticateToken,
    [
        param('id').isUUID(),
        body('member_id').isInt(),
        body('role_in_group').optional().isIn(['member', 'deputy', 'leader'])
    ],
    handleValidationErrors,
    async (req, res) => {
        const transaction = await sequelize.transaction();
        
        try {
            const group = await Group.findByPk(req.params.id, { transaction });
            
            if (!group) {
                await transaction.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Group not found'
                });
            }
            
            // Vérifier les permissions
            const canAdd = 
                ['Platinum', 'Admin', 'Admin_N1'].includes(req.user.role) ||
                (req.user.role === 'Gold' && group.leader_member_id === req.user.member_id);
            
            if (!canAdd) {
                await transaction.rollback();
                return res.status(403).json({
                    success: false,
                    message: 'Insufficient permissions'
                });
            }
            
            // Vérifier la capacité
            if (group.isFull()) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Group is full'
                });
            }
            
            // Ajouter le membre
            const membership = await GroupMembership.create({
                group_id: group.group_id,
                member_id: req.body.member_id,
                role_in_group: req.body.role_in_group || 'member',
                added_by_member_id: req.user.member_id
            }, { transaction });
            
            await transaction.commit();
            
            logger.info('Member added to group', {
                groupId: group.group_id,
                memberId: req.body.member_id,
                addedBy: req.user.member_id
            });
            
            res.status(201).json({
                success: true,
                message: 'Member added successfully',
                data: membership
            });
            
        } catch (error) {
            await transaction.rollback();
            logger.error('Error adding member', { error: error.message });
            res.status(500).json({
                success: false,
                message: error.message || 'Error adding member'
            });
        }
    }
);

/**
 * @route   POST /api/v1/groups/:id/remove-member
 * @desc    Retirer un membre du groupe
 * @access  Gold+ (leader) ou Platinum+
 */
router.post('/:id/remove-member',
    authenticateToken,
    [
        param('id').isUUID(),
        body('member_id').isInt(),
        body('reason').optional().isString()
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const group = await Group.findByPk(req.params.id);
            
            if (!group) {
                return res.status(404).json({
                    success: false,
                    message: 'Group not found'
                });
            }
            
            // Vérifier les permissions
            const canRemove = 
                ['Platinum', 'Admin', 'Admin_N1'].includes(req.user.role) ||
                (req.user.role === 'Gold' && group.leader_member_id === req.user.member_id);
            
            if (!canRemove) {
                return res.status(403).json({
                    success: false,
                    message: 'Insufficient permissions'
                });
            }
            
            const membership = await GroupMembership.findOne({
                where: {
                    group_id: group.group_id,
                    member_id: req.body.member_id,
                    is_active: true
                }
            });
            
            if (!membership) {
                return res.status(404).json({
                    success: false,
                    message: 'Member not found in group'
                });
            }
            
            await membership.leave(req.body.reason, req.user.member_id);
            
            logger.info('Member removed from group', {
                groupId: group.group_id,
                memberId: req.body.member_id,
                removedBy: req.user.member_id
            });
            
            res.json({
                success: true,
                message: 'Member removed successfully'
            });
            
        } catch (error) {
            logger.error('Error removing member', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error removing member',
                error: error.message
            });
        }
    }
);

/**
 * @route   POST /api/v1/groups/:id/leave
 * @desc    Quitter un groupe
 * @access  Authenticated
 */
router.post('/:id/leave',
    authenticateToken,
    param('id').isUUID(),
    handleValidationErrors,
    async (req, res) => {
        try {
            const membership = await GroupMembership.findOne({
                where: {
                    group_id: req.params.id,
                    member_id: req.user.member_id,
                    is_active: true
                }
            });
            
            if (!membership) {
                return res.status(404).json({
                    success: false,
                    message: 'You are not a member of this group'
                });
            }
            
            // Empêcher le leader de quitter sans transfert
            if (membership.role_in_group === 'leader') {
                return res.status(400).json({
                    success: false,
                    message: 'Leader cannot leave without transferring leadership'
                });
            }
            
            await membership.leave('Voluntary leave');
            
            logger.info('Member left group', {
                groupId: req.params.id,
                memberId: req.user.member_id
            });
            
            res.json({
                success: true,
                message: 'Successfully left the group'
            });
            
        } catch (error) {
            logger.error('Error leaving group', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error leaving group',
                error: error.message
            });
        }
    }
);

/**
 * @route   POST /api/v1/groups/:id/transfer-leadership
 * @desc    Transférer le leadership
 * @access  Gold+ (current leader)
 */
router.post('/:id/transfer-leadership',
    authenticateToken,
    [
        param('id').isUUID(),
        body('new_leader_id').isInt()
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const group = await Group.findByPk(req.params.id);
            
            if (!group) {
                return res.status(404).json({
                    success: false,
                    message: 'Group not found'
                });
            }
            
            // Vérifier que l'utilisateur est le leader actuel
            if (group.leader_member_id !== req.user.member_id && 
                !['Admin', 'Admin_N1'].includes(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    message: 'Only current leader can transfer leadership'
                });
            }
            
            await GroupMembership.transferLeadership(group.group_id, req.body.new_leader_id);
            
            group.leader_member_id = req.body.new_leader_id;
            await group.save();
            
            logger.info('Leadership transferred', {
                groupId: group.group_id,
                oldLeader: req.user.member_id,
                newLeader: req.body.new_leader_id
            });
            
            res.json({
                success: true,
                message: 'Leadership transferred successfully'
            });
            
        } catch (error) {
            logger.error('Error transferring leadership', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error transferring leadership',
                error: error.message
            });
        }
    }
);

/**
 * @route   DELETE /api/v1/groups/:id
 * @desc    Archiver un groupe
 * @access  Platinum+
 */
router.delete('/:id',
    authenticateToken,
    checkRole(['Platinum', 'Admin', 'Admin_N1']),
    param('id').isUUID(),
    handleValidationErrors,
    async (req, res) => {
        try {
            const group = await Group.findByPk(req.params.id);
            
            if (!group) {
                return res.status(404).json({
                    success: false,
                    message: 'Group not found'
                });
            }
            
            await group.archive();
            
            logger.warn('Group archived', {
                groupId: group.group_id,
                archivedBy: req.user.member_id
            });
            
            res.json({
                success: true,
                message: 'Group archived successfully'
            });
            
        } catch (error) {
            logger.error('Error archiving group', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error archiving group',
                error: error.message
            });
        }
    }
);

module.exports = router;
