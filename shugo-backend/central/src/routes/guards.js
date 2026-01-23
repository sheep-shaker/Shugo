// src/routes/guards.js
// Routes pour la gestion des gardes et plannings

const router = require('express').Router();
const { body, param, query, validationResult } = require('express-validator');
const { authenticateToken, checkRole, checkScope } = require('../middleware/auth');
const GuardService = require('../services/GuardService');
const Guard = require('../models/Guard');
const GuardAssignment = require('../models/GuardAssignment');
const logger = require('../utils/logger');
const { Op } = require('sequelize');

// Middleware de validation des erreurs
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
 * @route   GET /api/v1/guards
 * @desc    Obtenir la liste des gardes
 * @access  Authenticated
 */
router.get('/',
    authenticateToken,
    [
        query('geo_id').optional().matches(/^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/),
        query('start_date').optional().isISO8601(),
        query('end_date').optional().isISO8601(),
        query('status').optional().isIn(['open', 'full', 'closed', 'cancelled']),
        query('type').optional().isIn(['standard', 'preparation', 'closure', 'special', 'maintenance']),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 })
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const {
                geo_id,
                start_date,
                end_date,
                status,
                type,
                page = 1,
                limit = 20
            } = req.query;
            
            const where = {};
            
            // Filtrer par geo_id selon le scope de l'utilisateur
            if (geo_id) {
                where.geo_id = geo_id;
            } else if (req.user.scope && req.user.scope.startsWith('local:')) {
                where.geo_id = req.user.scope.replace('local:', '');
            }
            
            if (start_date && end_date) {
                where.guard_date = {
                    [Op.between]: [start_date, end_date]
                };
            } else if (start_date) {
                where.guard_date = {
                    [Op.gte]: start_date
                };
            } else if (end_date) {
                where.guard_date = {
                    [Op.lte]: end_date
                };
            }
            
            if (status) where.status = status;
            if (type) where.guard_type = type;
            
            const offset = (page - 1) * limit;
            
            const { count, rows } = await Guard.findAndCountAll({
                where,
                limit,
                offset,
                order: [['guard_date', 'ASC'], ['start_time', 'ASC']],
                include: [{
                    model: GuardAssignment,
                    where: { status: 'confirmed' },
                    required: false
                }]
            });
            
            res.json({
                success: true,
                data: rows,
                pagination: {
                    total: count,
                    page: parseInt(page),
                    pages: Math.ceil(count / limit),
                    limit: parseInt(limit)
                }
            });
            
        } catch (error) {
            logger.error('Error fetching guards', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching guards',
                error: error.message
            });
        }
    }
);

/**
 * @route   GET /api/v1/guards/upcoming
 * @desc    Obtenir les prochaines gardes
 * @access  Authenticated
 */
router.get('/upcoming',
    authenticateToken,
    async (req, res) => {
        try {
            const days = parseInt(req.query.days) || 7;
            const geoId = req.query.geo_id || 
                (req.user.scope && req.user.scope.startsWith('local:') 
                    ? req.user.scope.replace('local:', '') 
                    : null);
            
            const guards = await Guard.findUpcoming(days, geoId);
            
            res.json({
                success: true,
                data: guards,
                count: guards.length
            });
            
        } catch (error) {
            logger.error('Error fetching upcoming guards', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching upcoming guards',
                error: error.message
            });
        }
    }
);

/**
 * @route   GET /api/v1/guards/empty
 * @desc    Obtenir les gardes vides
 * @access  Gold+
 */
router.get('/empty',
    authenticateToken,
    checkRole(['Gold', 'Platinum', 'Admin', 'Admin_N1']),
    async (req, res) => {
        try {
            const days = parseInt(req.query.days) || 7;
            const geoId = req.query.geo_id || 
                (req.user.scope && req.user.scope.startsWith('local:') 
                    ? req.user.scope.replace('local:', '') 
                    : null);
            
            const guards = await GuardService.getEmptyGuards(geoId, days);
            
            res.json({
                success: true,
                data: guards,
                count: guards.length
            });
            
        } catch (error) {
            logger.error('Error fetching empty guards', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching empty guards',
                error: error.message
            });
        }
    }
);

/**
 * @route   GET /api/v1/guards/critical
 * @desc    Obtenir les gardes critiques (sous-effectif)
 * @access  Platinum+
 */
router.get('/critical',
    authenticateToken,
    checkRole(['Platinum', 'Admin', 'Admin_N1']),
    async (req, res) => {
        try {
            const hours = parseInt(req.query.hours) || 72;
            const geoId = req.query.geo_id || 
                (req.user.scope && req.user.scope.startsWith('local:') 
                    ? req.user.scope.replace('local:', '') 
                    : null);
            
            const guards = await Guard.findCritical(hours, geoId);
            
            res.json({
                success: true,
                data: guards,
                count: guards.length
            });
            
        } catch (error) {
            logger.error('Error fetching critical guards', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching critical guards',
                error: error.message
            });
        }
    }
);

/**
 * @route   GET /api/v1/guards/my-schedule
 * @desc    Obtenir son planning personnel
 * @access  Authenticated
 */
router.get('/my-schedule',
    authenticateToken,
    async (req, res) => {
        try {
            const startDate = req.query.start_date || new Date().toISOString().split('T')[0];
            const endDate = req.query.end_date || 
                new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            
            const schedule = await GuardService.getMemberSchedule(
                req.user.member_id,
                startDate,
                endDate
            );
            
            res.json({
                success: true,
                data: schedule,
                count: schedule.length
            });
            
        } catch (error) {
            logger.error('Error fetching member schedule', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching schedule',
                error: error.message
            });
        }
    }
);

/**
 * @route   GET /api/v1/guards/coverage-stats
 * @desc    Obtenir les statistiques de couverture
 * @access  Platinum+
 */
router.get('/coverage-stats',
    authenticateToken,
    checkRole(['Platinum', 'Admin', 'Admin_N1']),
    async (req, res) => {
        try {
            const geoId = req.query.geo_id || req.user.geo_id;
            const startDate = req.query.start_date || new Date().toISOString().split('T')[0];
            const endDate = req.query.end_date || 
                new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            
            const stats = await GuardService.getCoverageStatistics(
                geoId,
                startDate,
                endDate
            );
            
            res.json({
                success: true,
                data: stats
            });
            
        } catch (error) {
            logger.error('Error fetching coverage statistics', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching statistics',
                error: error.message
            });
        }
    }
);

/**
 * @route   GET /api/v1/guards/:id
 * @desc    Obtenir une garde spécifique
 * @access  Authenticated
 */
router.get('/:id',
    authenticateToken,
    param('id').isUUID(),
    handleValidationErrors,
    async (req, res) => {
        try {
            const guard = await Guard.findByPk(req.params.id, {
                include: [{
                    model: GuardAssignment,
                    where: { status: 'confirmed' },
                    required: false,
                    include: [{
                        model: require('../models/User'),
                        attributes: ['member_id', 'first_name_hash', 'last_name_hash', 'role']
                    }]
                }]
            });
            
            if (!guard) {
                return res.status(404).json({
                    success: false,
                    message: 'Guard not found'
                });
            }
            
            res.json({
                success: true,
                data: guard
            });
            
        } catch (error) {
            logger.error('Error fetching guard', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching guard',
                error: error.message
            });
        }
    }
);

/**
 * @route   POST /api/v1/guards
 * @desc    Créer une nouvelle garde
 * @access  Platinum+
 */
router.post('/',
    authenticateToken,
    checkRole(['Platinum', 'Admin', 'Admin_N1']),
    [
        body('geo_id').matches(/^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/),
        body('guard_date').isISO8601(),
        body('start_time').matches(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/),
        body('end_time').matches(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/),
        body('guard_type').optional().isIn(['standard', 'preparation', 'closure', 'special', 'maintenance']),
        body('max_participants').optional().isInt({ min: 1, max: 100 }),
        body('min_participants').optional().isInt({ min: 0, max: 100 }),
        body('priority').optional().isInt({ min: 1, max: 3 }),
        body('description').optional().isString().isLength({ max: 1000 })
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const guard = await GuardService.createGuard(
                req.body,
                req.user.member_id
            );
            
            logger.info('Guard created', {
                guardId: guard.guard_id,
                createdBy: req.user.member_id
            });
            
            res.status(201).json({
                success: true,
                message: 'Guard created successfully',
                data: guard
            });
            
        } catch (error) {
            logger.error('Error creating guard', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error creating guard',
                error: error.message
            });
        }
    }
);

/**
 * @route   PUT /api/v1/guards/:id
 * @desc    Modifier une garde
 * @access  Platinum+
 */
router.put('/:id',
    authenticateToken,
    checkRole(['Platinum', 'Admin', 'Admin_N1']),
    param('id').isUUID(),
    handleValidationErrors,
    async (req, res) => {
        try {
            const guard = await Guard.findByPk(req.params.id);
            
            if (!guard) {
                return res.status(404).json({
                    success: false,
                    message: 'Guard not found'
                });
            }
            
            await guard.update(req.body);
            
            logger.info('Guard updated', {
                guardId: guard.guard_id,
                updatedBy: req.user.member_id
            });
            
            res.json({
                success: true,
                message: 'Guard updated successfully',
                data: guard
            });
            
        } catch (error) {
            logger.error('Error updating guard', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error updating guard',
                error: error.message
            });
        }
    }
);

/**
 * @route   DELETE /api/v1/guards/:id
 * @desc    Annuler une garde
 * @access  Platinum+
 */
router.delete('/:id',
    authenticateToken,
    checkRole(['Platinum', 'Admin', 'Admin_N1']),
    param('id').isUUID(),
    handleValidationErrors,
    async (req, res) => {
        try {
            const guard = await Guard.findByPk(req.params.id);
            
            if (!guard) {
                return res.status(404).json({
                    success: false,
                    message: 'Guard not found'
                });
            }
            
            guard.status = 'cancelled';
            await guard.save();
            
            logger.warn('Guard cancelled', {
                guardId: guard.guard_id,
                cancelledBy: req.user.member_id
            });
            
            res.json({
                success: true,
                message: 'Guard cancelled successfully'
            });
            
        } catch (error) {
            logger.error('Error cancelling guard', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error cancelling guard',
                error: error.message
            });
        }
    }
);

/**
 * @route   POST /api/v1/guards/:id/assign
 * @desc    S'inscrire ou inscrire quelqu'un à une garde
 * @access  Authenticated (Silver pour soi, Gold+ pour autres)
 */
router.post('/:id/assign',
    authenticateToken,
    [
        param('id').isUUID(),
        body('member_id').optional().isInt(),
        body('notes').optional().isString().isLength({ max: 500 })
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const guardId = req.params.id;
            const targetMemberId = req.body.member_id || req.user.member_id;
            
            // Vérifier les permissions
            if (targetMemberId !== req.user.member_id) {
                // Doit être au moins Gold pour inscrire quelqu'un d'autre
                if (!['Gold', 'Platinum', 'Admin', 'Admin_N1'].includes(req.user.role)) {
                    return res.status(403).json({
                        success: false,
                        message: 'Insufficient permissions to assign other members'
                    });
                }
            }
            
            const assignment = await GuardService.assignMember(
                guardId,
                targetMemberId,
                req.user.member_id,
                req.body.notes
            );
            
            res.status(201).json({
                success: true,
                message: 'Successfully assigned to guard',
                data: assignment
            });
            
        } catch (error) {
            logger.error('Error assigning to guard', { error: error.message });
            res.status(500).json({
                success: false,
                message: error.message || 'Error assigning to guard'
            });
        }
    }
);

/**
 * @route   POST /api/v1/guards/:id/cancel-assignment
 * @desc    Annuler son affectation à une garde
 * @access  Authenticated
 */
router.post('/:id/cancel-assignment',
    authenticateToken,
    [
        param('id').isUUID(),
        body('reason').notEmpty().isString(),
        body('replacement_member_id').optional().isInt()
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const assignment = await GuardAssignment.findOne({
                where: {
                    guard_id: req.params.id,
                    member_id: req.user.member_id,
                    status: 'confirmed'
                }
            });
            
            if (!assignment) {
                return res.status(404).json({
                    success: false,
                    message: 'Assignment not found'
                });
            }
            
            await GuardService.cancelAssignment(
                assignment.assignment_id,
                req.body.reason,
                req.body.replacement_member_id
            );
            
            res.json({
                success: true,
                message: 'Assignment cancelled successfully'
            });
            
        } catch (error) {
            logger.error('Error cancelling assignment', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error cancelling assignment',
                error: error.message
            });
        }
    }
);

/**
 * @route   POST /api/v1/guards/generate
 * @desc    Générer des gardes depuis un scénario
 * @access  Platinum+
 */
router.post('/generate',
    authenticateToken,
    checkRole(['Platinum', 'Admin', 'Admin_N1']),
    [
        body('scenario_id').optional().isUUID(),
        body('start_date').isISO8601(),
        body('end_date').isISO8601(),
        body('geo_id').matches(/^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/)
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const { scenario_id, start_date, end_date, geo_id } = req.body;
            
            const guards = await GuardService.generateFromScenario(
                scenario_id,
                start_date,
                end_date,
                geo_id
            );
            
            res.status(201).json({
                success: true,
                message: `${guards.length} guards generated successfully`,
                data: guards
            });
            
        } catch (error) {
            logger.error('Error generating guards', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error generating guards',
                error: error.message
            });
        }
    }
);

module.exports = router;
