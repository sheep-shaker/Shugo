// src/routes/locations.js
// Routes pour la gestion des locations avec système geo_id hiérarchique

const router = require('express').Router();
const { body, param, query, validationResult } = require('express-validator');
const { authenticateToken, checkRole } = require('../middleware/auth');
const { sequelize } = require('../database/connection');
const logger = require('../utils/logger');
const Location = require('../models/Location');
const { Op } = require('sequelize');

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

// Regex pour valider le format geo_id: 02-033-04-01-00
const GEO_ID_REGEX = /^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/;

/**
 * @route   GET /api/v1/locations
 * @desc    Obtenir la liste des locations
 * @access  Authenticated
 */
router.get('/',
    authenticateToken,
    [
        query('parent_id').optional().matches(GEO_ID_REGEX),
        query('is_active').optional().isBoolean(),
        query('include_children').optional().isBoolean(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 })
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 50;
            const offset = (page - 1) * limit;

            const where = {};

            // Filtrer par parent si spécifié
            if (req.query.parent_id) {
                where.parent_id = req.query.parent_id;
            }

            // Filtrer par statut si spécifié
            if (req.query.is_active !== undefined) {
                where.status = req.query.is_active === 'true' ? 'active' : 'inactive';
            }

            const { count, rows: locations } = await Location.findAndCountAll({
                where,
                limit,
                offset,
                order: [['name', 'ASC']]
            });

            logger.info('Locations list requested', {
                user: req.user.member_id,
                params: req.query
            });

            res.json({
                success: true,
                data: locations,
                pagination: {
                    total: count,
                    page,
                    pages: Math.ceil(count / limit),
                    limit
                }
            });

        } catch (error) {
            logger.error('Error fetching locations', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching locations',
                error: error.message
            });
        }
    }
);

/**
 * @route   GET /api/v1/locations/parents
 * @desc    Obtenir les locations parentes (geo_id se terminant par -00)
 * @access  Authenticated
 */
router.get('/parents',
    authenticateToken,
    [
        query('is_active').optional().isBoolean()
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const where = {
                local_id: '00' // Parents have local_id = '00'
            };

            if (req.query.is_active !== undefined) {
                where.status = req.query.is_active === 'true' ? 'active' : 'inactive';
            }

            const parents = await Location.findAll({
                where,
                order: [['name', 'ASC']]
            });

            // Pour chaque parent, récupérer ses enfants
            const parentsWithChildren = await Promise.all(
                parents.map(async (parent) => {
                    const parentJson = parent.toJSON();
                    const children = await Location.findChildren(parent.geo_id);

                    // TODO: Compter les membres et guards actifs depuis les tables associées
                    return {
                        ...parentJson,
                        is_active: parentJson.status === 'active',
                        members_count: 0, // TODO: Count from Users table
                        active_guards: 0, // TODO: Count from Guards table
                        children: children.map(child => ({
                            ...child.toJSON(),
                            is_active: child.status === 'active',
                            members_count: 0,
                            active_guards: 0
                        }))
                    };
                })
            );

            logger.info('Parent locations requested', {
                user: req.user.member_id
            });

            res.json({
                success: true,
                data: parentsWithChildren
            });

        } catch (error) {
            logger.error('Error fetching parent locations', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching parent locations',
                error: error.message
            });
        }
    }
);

/**
 * @route   GET /api/v1/locations/:geoId
 * @desc    Obtenir une location par geo_id
 * @access  Authenticated
 */
router.get('/:geoId',
    authenticateToken,
    param('geoId').matches(GEO_ID_REGEX),
    handleValidationErrors,
    async (req, res) => {
        try {
            const location = await Location.findByPk(req.params.geoId);

            if (!location) {
                return res.status(404).json({
                    success: false,
                    message: 'Location not found'
                });
            }

            const locationJson = location.toJSON();
            locationJson.is_active = locationJson.status === 'active';

            logger.info('Location requested', {
                geoId: req.params.geoId,
                user: req.user.member_id
            });

            res.json({
                success: true,
                data: locationJson
            });

        } catch (error) {
            logger.error('Error fetching location', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching location',
                error: error.message
            });
        }
    }
);

/**
 * @route   GET /api/v1/locations/:geoId/children
 * @desc    Obtenir les enfants d'une location parente
 * @access  Authenticated
 */
router.get('/:geoId/children',
    authenticateToken,
    param('geoId').matches(GEO_ID_REGEX),
    handleValidationErrors,
    async (req, res) => {
        try {
            const children = await Location.findChildren(req.params.geoId);

            const childrenWithStats = children.map(child => {
                const childJson = child.toJSON();
                return {
                    ...childJson,
                    is_active: childJson.status === 'active',
                    members_count: 0, // TODO: Count from Users table
                    active_guards: 0  // TODO: Count from Guards table
                };
            });

            logger.info('Location children requested', {
                parentGeoId: req.params.geoId,
                user: req.user.member_id
            });

            res.json({
                success: true,
                data: childrenWithStats
            });

        } catch (error) {
            logger.error('Error fetching location children', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching location children',
                error: error.message
            });
        }
    }
);

/**
 * @route   GET /api/v1/locations/:geoId/stats
 * @desc    Obtenir les statistiques d'une location
 * @access  Authenticated
 */
router.get('/:geoId/stats',
    authenticateToken,
    param('geoId').matches(GEO_ID_REGEX),
    handleValidationErrors,
    async (req, res) => {
        try {
            const location = await Location.findByPk(req.params.geoId);

            if (!location) {
                return res.status(404).json({
                    success: false,
                    message: 'Location not found'
                });
            }

            const children = await Location.findChildren(req.params.geoId);

            // TODO: Compter depuis les vraies tables Users et Guards
            const stats = {
                members_count: 0,     // TODO: Count users WHERE geo_id = :geoId
                active_guards: 0,     // TODO: Count active guards
                total_guards: 0,      // TODO: Count all guards
                children_count: children.length
            };

            logger.info('Location stats requested', {
                geoId: req.params.geoId,
                user: req.user.member_id
            });

            res.json({
                success: true,
                data: stats
            });

        } catch (error) {
            logger.error('Error fetching location stats', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching location stats',
                error: error.message
            });
        }
    }
);

/**
 * @route   POST /api/v1/locations
 * @desc    Créer une nouvelle location
 * @access  Platinum+
 */
router.post('/',
    authenticateToken,
    checkRole(['Platinum', 'Admin', 'Admin_N1']),
    [
        body('geo_id').matches(GEO_ID_REGEX),
        body('parent_id').optional().matches(GEO_ID_REGEX),
        body('name').notEmpty().isLength({ min: 2, max: 200 }),
        body('description').optional().isLength({ max: 1000 }),
        body('address').optional().isLength({ max: 500 }),
        body('city').optional().isLength({ max: 100 }),
        body('postal_code').optional().isLength({ max: 20 }),
        body('country').optional().isLength({ max: 100 }),
        body('latitude').optional().isFloat({ min: -90, max: 90 }),
        body('longitude').optional().isFloat({ min: -180, max: 180 }),
        body('capacity').optional().isInt({ min: 1 }),
        body('is_active').optional().isBoolean()
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            // Vérifier si le geo_id existe déjà
            const existing = await Location.findByPk(req.body.geo_id);
            if (existing) {
                return res.status(400).json({
                    success: false,
                    message: 'Location with this geo_id already exists'
                });
            }

            // Parser le geo_id pour extraire les composants
            const parts = req.body.geo_id.split('-');
            const locationData = {
                geo_id: req.body.geo_id,
                name: req.body.name,
                address: req.body.address,
                latitude: req.body.latitude,
                longitude: req.body.longitude,
                timezone: req.body.timezone || 'UTC',
                continent_code: parts[0],
                country_code: parts[1],
                region_code: parts[2],
                parent_id: parts[3],
                local_id: parts[4],
                status: req.body.is_active ? 'active' : 'inactive',
                capacity: req.body.capacity,
                contact_email: req.body.contact_email,
                contact_phone: req.body.contact_phone,
                opening_hours: req.body.opening_hours || {},
                features: req.body.features || [],
                metadata: req.body.metadata || {}
            };

            const location = await Location.create(locationData);

            logger.info('Location created', {
                geoId: location.geo_id,
                createdBy: req.user.member_id
            });

            const locationJson = location.toJSON();
            locationJson.is_active = locationJson.status === 'active';

            res.status(201).json({
                success: true,
                message: 'Location created successfully',
                data: locationJson
            });

        } catch (error) {
            logger.error('Error creating location', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error creating location',
                error: error.message
            });
        }
    }
);

/**
 * @route   PUT /api/v1/locations/:geoId
 * @desc    Modifier une location
 * @access  Platinum+
 */
router.put('/:geoId',
    authenticateToken,
    checkRole(['Platinum', 'Admin', 'Admin_N1']),
    [
        param('geoId').matches(GEO_ID_REGEX),
        body('name').optional().isLength({ min: 2, max: 200 }),
        body('description').optional().isLength({ max: 1000 }),
        body('address').optional().isLength({ max: 500 }),
        body('city').optional().isLength({ max: 100 }),
        body('postal_code').optional().isLength({ max: 20 }),
        body('country').optional().isLength({ max: 100 }),
        body('latitude').optional().isFloat({ min: -90, max: 90 }),
        body('longitude').optional().isFloat({ min: -180, max: 180 }),
        body('capacity').optional().isInt({ min: 1 }),
        body('is_active').optional().isBoolean()
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const location = await Location.findByPk(req.params.geoId);

            if (!location) {
                return res.status(404).json({
                    success: false,
                    message: 'Location not found'
                });
            }

            const updateData = {};

            if (req.body.name) updateData.name = req.body.name;
            if (req.body.address) updateData.address = req.body.address;
            if (req.body.latitude) updateData.latitude = req.body.latitude;
            if (req.body.longitude) updateData.longitude = req.body.longitude;
            if (req.body.timezone) updateData.timezone = req.body.timezone;
            if (req.body.capacity) updateData.capacity = req.body.capacity;
            if (req.body.contact_email) updateData.contact_email = req.body.contact_email;
            if (req.body.contact_phone) updateData.contact_phone = req.body.contact_phone;
            if (req.body.opening_hours) updateData.opening_hours = req.body.opening_hours;
            if (req.body.features) updateData.features = req.body.features;
            if (req.body.metadata) updateData.metadata = req.body.metadata;
            if (req.body.is_active !== undefined) {
                updateData.status = req.body.is_active ? 'active' : 'inactive';
            }

            await location.update(updateData);

            logger.info('Location updated', {
                geoId: req.params.geoId,
                updatedBy: req.user.member_id
            });

            const locationJson = location.toJSON();
            locationJson.is_active = locationJson.status === 'active';

            res.json({
                success: true,
                message: 'Location updated successfully',
                data: locationJson
            });

        } catch (error) {
            logger.error('Error updating location', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error updating location',
                error: error.message
            });
        }
    }
);

/**
 * @route   DELETE /api/v1/locations/:geoId
 * @desc    Supprimer une location
 * @access  Admin+
 */
router.delete('/:geoId',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1']),
    param('geoId').matches(GEO_ID_REGEX),
    handleValidationErrors,
    async (req, res) => {
        try {
            const location = await Location.findByPk(req.params.geoId);

            if (!location) {
                return res.status(404).json({
                    success: false,
                    message: 'Location not found'
                });
            }

            // Vérifier qu'il n'y a pas d'enfants actifs
            const children = await Location.findChildren(req.params.geoId);
            if (children.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot delete location with active children. Delete children first.'
                });
            }

            // TODO: Vérifier qu'il n'y a pas de membres ou de guards actifs

            await location.destroy();

            logger.warn('Location deleted', {
                geoId: req.params.geoId,
                deletedBy: req.user.member_id
            });

            res.json({
                success: true,
                message: 'Location deleted successfully'
            });

        } catch (error) {
            logger.error('Error deleting location', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error deleting location',
                error: error.message
            });
        }
    }
);

/**
 * @route   PATCH /api/v1/locations/:geoId/toggle
 * @desc    Activer/désactiver une location
 * @access  Platinum+
 */
router.patch('/:geoId/toggle',
    authenticateToken,
    checkRole(['Platinum', 'Admin', 'Admin_N1']),
    [
        param('geoId').matches(GEO_ID_REGEX),
        body('is_active').isBoolean()
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const location = await Location.findByPk(req.params.geoId);

            if (!location) {
                return res.status(404).json({
                    success: false,
                    message: 'Location not found'
                });
            }

            const newStatus = req.body.is_active ? 'active' : 'inactive';
            await location.update({ status: newStatus });

            logger.info('Location status toggled', {
                geoId: req.params.geoId,
                isActive: req.body.is_active,
                toggledBy: req.user.member_id
            });

            const locationJson = location.toJSON();
            locationJson.is_active = locationJson.status === 'active';

            res.json({
                success: true,
                message: `Location ${req.body.is_active ? 'activated' : 'deactivated'} successfully`,
                data: locationJson
            });

        } catch (error) {
            logger.error('Error toggling location status', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error toggling location status',
                error: error.message
            });
        }
    }
);

module.exports = router;
