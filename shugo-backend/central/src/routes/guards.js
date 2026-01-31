// src/routes/guards.js
// Routes pour la gestion des gardes et plannings

const router = require('express').Router();
const { body, param, query, validationResult } = require('express-validator');
const { authenticateToken, checkRole, checkScope } = require('../middleware/auth');
const GuardService = require('../services/GuardService');
const { sequelize } = require('../database/connection');
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
            const { Guard, GuardAssignment } = sequelize.models;
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
                    as: 'assignments',
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
            const { Guard } = sequelize.models;
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
            const { Guard } = sequelize.models;
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
 * @route   GET /api/v1/guards/scenarios
 * @desc    Get available guard scenarios for a location
 * @access  Authenticated
 */
router.get('/scenarios',
    authenticateToken,
    async (req, res) => {
        try {
            const { GuardScenario } = sequelize.models;
            const geoId = req.query.geo_id ||
                (req.user.scope && req.user.scope.startsWith('local:')
                    ? req.user.scope.replace('local:', '')
                    : req.user.geo_id);

            const scenarios = await GuardScenario.findAll({
                where: {
                    geo_id: geoId,
                    is_active: true
                },
                order: [['is_default', 'DESC'], ['name', 'ASC']]
            });

            res.json({
                success: true,
                data: scenarios
            });

        } catch (error) {
            logger.error('Error fetching scenarios', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching scenarios',
                error: error.message
            });
        }
    }
);

/**
 * @route   GET /api/v1/guards/slots
 * @desc    Get available guard slots for a date range
 * @access  Authenticated
 */
router.get('/slots',
    authenticateToken,
    [
        query('start_date').isISO8601(),
        query('end_date').isISO8601(),
        query('geo_id').optional().matches(/^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/)
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const { Guard, GuardScenario } = sequelize.models;
            const { start_date, end_date } = req.query;
            const geoId = req.query.geo_id ||
                (req.user.scope && req.user.scope.startsWith('local:')
                    ? req.user.scope.replace('local:', '')
                    : req.user.geo_id);

            const scenario = await GuardScenario.findOne({
                where: {
                    geo_id: geoId,
                    is_default: true,
                    is_active: true
                }
            });

            if (!scenario) {
                return res.status(404).json({
                    success: false,
                    message: 'No default scenario found for this location'
                });
            }

            const existingGuards = await Guard.findAll({
                where: {
                    geo_id: geoId,
                    guard_date: {
                        [Op.between]: [start_date, end_date]
                    },
                    status: { [Op.ne]: 'cancelled' }
                },
                order: [['guard_date', 'ASC'], ['start_time', 'ASC']]
            });

            const slotsByDate = {};
            const startD = new Date(start_date);
            const endD = new Date(end_date);

            for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                const dayOfWeek = d.getDay();
                const weekdayConfig = scenario.template_data.weekday_config?.[dayOfWeek];

                if (!weekdayConfig?.enabled) continue;

                const templateSlots = scenario.template_data.slots || [];
                const nightSlot = scenario.template_data.night_slot;

                slotsByDate[dateStr] = {
                    date: dateStr,
                    day_of_week: dayOfWeek,
                    day_label: weekdayConfig?.label || '',
                    slots: templateSlots.map(slot => {
                        const existingGuard = existingGuards.find(g =>
                            g.guard_date === dateStr &&
                            g.start_time === slot.start_time
                        );

                        return {
                            ...slot,
                            activated: !!existingGuard,
                            guard_id: existingGuard?.guard_id || null,
                            current_participants: existingGuard?.current_participants || 0,
                            status: existingGuard?.status || 'inactive'
                        };
                    }),
                    night_slot: nightSlot ? {
                        ...nightSlot,
                        activated: existingGuards.some(g =>
                            g.guard_date === dateStr &&
                            g.start_time === nightSlot.start_time
                        ),
                        guard_id: existingGuards.find(g =>
                            g.guard_date === dateStr &&
                            g.start_time === nightSlot.start_time
                        )?.guard_id || null
                    } : null
                };
            }

            res.json({
                success: true,
                data: {
                    scenario,
                    slots_by_date: slotsByDate,
                    total_days: Object.keys(slotsByDate).length
                }
            });

        } catch (error) {
            logger.error('Error fetching slots', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching slots',
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
            const { Guard, GuardAssignment, User } = sequelize.models;
            const guard = await Guard.findByPk(req.params.id, {
                include: [{
                    model: GuardAssignment,
                    as: 'assignments',
                    where: { status: 'confirmed' },
                    required: false,
                    include: [{
                        model: User,
                        as: 'member',
                        attributes: ['member_id', 'role']
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
 * @desc    Creer une nouvelle garde
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
            const { Guard } = sequelize.models;
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
            const { Guard } = sequelize.models;
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
 * @desc    S'inscrire ou inscrire quelqu'un a une garde
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

            // Verifier les permissions
            if (targetMemberId !== req.user.member_id) {
                // Doit etre au moins Gold pour inscrire quelqu'un d'autre
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
 * @desc    Annuler son affectation a une garde
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
            const { GuardAssignment } = sequelize.models;
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
 * @desc    Generer des gardes depuis un scenario
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

/**
 * @route   POST /api/v1/guards/slots/activate
 * @desc    Activate guard slots for a date range
 * @access  Platinum+
 */
router.post('/slots/activate',
    authenticateToken,
    checkRole(['Platinum', 'Admin', 'Admin_N1']),
    [
        body('start_date').isISO8601(),
        body('end_date').isISO8601(),
        body('geo_id').matches(/^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/),
        body('slot_indices').optional().isArray(),
        body('include_night').optional().isBoolean()
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const { Guard, GuardScenario } = sequelize.models;
            const { start_date, end_date, geo_id, slot_indices, include_night } = req.body;

            // Get default scenario
            const scenario = await GuardScenario.findOne({
                where: {
                    geo_id: geo_id,
                    is_default: true,
                    is_active: true
                }
            });

            if (!scenario) {
                return res.status(404).json({
                    success: false,
                    message: 'No default scenario found for this location'
                });
            }

            const createdGuards = [];
            const startD = new Date(start_date);
            const endD = new Date(end_date);

            for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                const dayOfWeek = d.getDay();
                const weekdayConfig = scenario.template_data.weekday_config?.[dayOfWeek];

                if (!weekdayConfig?.enabled) continue;

                // Filter slots if indices provided
                let slotsToActivate = scenario.template_data.slots || [];
                if (slot_indices && slot_indices.length > 0) {
                    slotsToActivate = slotsToActivate.filter(s => slot_indices.includes(s.slot_index));
                }

                for (const slot of slotsToActivate) {
                    // Check if guard already exists
                    const existing = await Guard.findOne({
                        where: {
                            geo_id: geo_id,
                            guard_date: dateStr,
                            start_time: slot.start_time,
                            status: { [Op.ne]: 'cancelled' }
                        }
                    });

                    if (existing) continue;

                    // Create guard for this slot
                    const guard = await Guard.create({
                        geo_id: geo_id,
                        guard_date: dateStr,
                        start_time: slot.start_time,
                        end_time: slot.end_time,
                        slot_duration: slot.duration_minutes,
                        max_participants: slot.max_participants,
                        min_participants: slot.min_participants,
                        guard_type: slot.guard_type,
                        status: 'open',
                        created_by_member_id: req.user.member_id,
                        scenario_id: scenario.scenario_id,
                        auto_generated: true
                    });

                    createdGuards.push(guard);
                }

                // Night slot
                if (include_night && scenario.template_data.night_slot) {
                    const nightSlot = scenario.template_data.night_slot;
                    const existingNight = await Guard.findOne({
                        where: {
                            geo_id: geo_id,
                            guard_date: dateStr,
                            start_time: nightSlot.start_time,
                            status: { [Op.ne]: 'cancelled' }
                        }
                    });

                    if (!existingNight) {
                        const guard = await Guard.create({
                            geo_id: geo_id,
                            guard_date: dateStr,
                            start_time: nightSlot.start_time,
                            end_time: nightSlot.end_time,
                            slot_duration: nightSlot.duration_minutes,
                            max_participants: nightSlot.max_participants,
                            min_participants: nightSlot.min_participants,
                            guard_type: nightSlot.guard_type,
                            description: nightSlot.description,
                            status: 'open',
                            created_by_member_id: req.user.member_id,
                            scenario_id: scenario.scenario_id,
                            auto_generated: true
                        });
                        createdGuards.push(guard);
                    }
                }
            }

            logger.info('Guard slots activated', {
                count: createdGuards.length,
                geo_id,
                start_date,
                end_date,
                activated_by: req.user.member_id
            });

            res.status(201).json({
                success: true,
                message: `${createdGuards.length} guard slots activated`,
                data: createdGuards
            });

        } catch (error) {
            logger.error('Error activating slots', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error activating slots',
                error: error.message
            });
        }
    }
);

/**
 * @route   POST /api/v1/guards/slots/deactivate
 * @desc    Deactivate (cancel) guard slots for a date range
 * @access  Platinum+
 */
router.post('/slots/deactivate',
    authenticateToken,
    checkRole(['Platinum', 'Admin', 'Admin_N1']),
    [
        body('start_date').isISO8601(),
        body('end_date').isISO8601(),
        body('geo_id').matches(/^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/),
        body('slot_indices').optional().isArray(),
        body('include_night').optional().isBoolean(),
        body('reason').optional().isString()
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const { Guard, GuardAssignment, GuardScenario } = sequelize.models;
            const { start_date, end_date, geo_id, slot_indices, include_night, reason } = req.body;

            // Get scenario for slot times
            const scenario = await GuardScenario.findOne({
                where: {
                    geo_id: geo_id,
                    is_default: true,
                    is_active: true
                }
            });

            const where = {
                geo_id: geo_id,
                guard_date: {
                    [Op.between]: [start_date, end_date]
                },
                status: { [Op.ne]: 'cancelled' }
            };

            // If specific slots, filter by start_time
            if (slot_indices && slot_indices.length > 0 && scenario) {
                const slotTimes = scenario.template_data.slots
                    .filter(s => slot_indices.includes(s.slot_index))
                    .map(s => s.start_time);

                if (!include_night || !scenario.template_data.night_slot) {
                    where.start_time = { [Op.in]: slotTimes };
                }
            }

            const guards = await Guard.findAll({ where });

            // Check for registered participants
            const guardsWithParticipants = [];
            const guardsToCancel = [];

            for (const guard of guards) {
                const assignments = await GuardAssignment.count({
                    where: {
                        guard_id: guard.guard_id,
                        status: 'confirmed'
                    }
                });

                if (assignments > 0) {
                    guardsWithParticipants.push({
                        guard_id: guard.guard_id,
                        guard_date: guard.guard_date,
                        start_time: guard.start_time,
                        participants: assignments
                    });
                } else {
                    guardsToCancel.push(guard);
                }
            }

            // Cancel guards without participants
            for (const guard of guardsToCancel) {
                await guard.update({
                    status: 'cancelled',
                    description: reason ? `${guard.description || ''}\n[DÉSACTIVÉ: ${reason}]` : guard.description
                });
            }

            logger.info('Guard slots deactivated', {
                cancelled: guardsToCancel.length,
                with_participants: guardsWithParticipants.length,
                geo_id,
                deactivated_by: req.user.member_id
            });

            res.json({
                success: true,
                message: `${guardsToCancel.length} guard slots deactivated`,
                data: {
                    cancelled_count: guardsToCancel.length,
                    skipped: guardsWithParticipants,
                    skipped_count: guardsWithParticipants.length
                }
            });

        } catch (error) {
            logger.error('Error deactivating slots', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error deactivating slots',
                error: error.message
            });
        }
    }
);

/**
 * @route   POST /api/v1/guards/slots/toggle
 * @desc    Toggle a single guard slot
 * @access  Platinum+
 */
router.post('/slots/toggle',
    authenticateToken,
    checkRole(['Platinum', 'Admin', 'Admin_N1']),
    [
        body('date').isISO8601(),
        body('start_time').matches(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/),
        body('geo_id').matches(/^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/),
        body('activate').isBoolean()
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const { Guard, GuardScenario, GuardAssignment } = sequelize.models;
            const { date, start_time, geo_id, activate } = req.body;

            // Find scenario for slot configuration
            const scenario = await GuardScenario.findOne({
                where: {
                    geo_id: geo_id,
                    is_default: true,
                    is_active: true
                }
            });

            if (!scenario) {
                return res.status(404).json({
                    success: false,
                    message: 'No default scenario found'
                });
            }

            // Find slot in template
            const slotConfig = scenario.template_data.slots?.find(s => s.start_time === start_time) ||
                              (scenario.template_data.night_slot?.start_time === start_time ? scenario.template_data.night_slot : null);

            if (!slotConfig) {
                return res.status(404).json({
                    success: false,
                    message: 'Slot not found in scenario template'
                });
            }

            if (activate) {
                // Create guard if not exists
                const existing = await Guard.findOne({
                    where: {
                        geo_id: geo_id,
                        guard_date: date,
                        start_time: start_time,
                        status: { [Op.ne]: 'cancelled' }
                    }
                });

                if (existing) {
                    return res.json({
                        success: true,
                        message: 'Slot already activated',
                        data: existing
                    });
                }

                const guard = await Guard.create({
                    geo_id: geo_id,
                    guard_date: date,
                    start_time: start_time,
                    end_time: slotConfig.end_time,
                    slot_duration: slotConfig.duration_minutes,
                    max_participants: slotConfig.max_participants,
                    min_participants: slotConfig.min_participants,
                    guard_type: slotConfig.guard_type,
                    description: slotConfig.description || null,
                    status: 'open',
                    created_by_member_id: req.user.member_id,
                    scenario_id: scenario.scenario_id,
                    auto_generated: true
                });

                res.status(201).json({
                    success: true,
                    message: 'Slot activated',
                    data: guard
                });

            } else {
                // Deactivate (cancel) guard
                const guard = await Guard.findOne({
                    where: {
                        geo_id: geo_id,
                        guard_date: date,
                        start_time: start_time,
                        status: { [Op.ne]: 'cancelled' }
                    }
                });

                if (!guard) {
                    return res.json({
                        success: true,
                        message: 'Slot already inactive'
                    });
                }

                // Check for participants
                const assignments = await GuardAssignment.count({
                    where: {
                        guard_id: guard.guard_id,
                        status: 'confirmed'
                    }
                });

                if (assignments > 0) {
                    return res.status(400).json({
                        success: false,
                        message: `Cannot deactivate slot with ${assignments} registered participant(s)`,
                        data: { participants: assignments }
                    });
                }

                await guard.update({ status: 'cancelled' });

                res.json({
                    success: true,
                    message: 'Slot deactivated'
                });
            }

        } catch (error) {
            logger.error('Error toggling slot', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error toggling slot',
                error: error.message
            });
        }
    }
);

module.exports = router;
