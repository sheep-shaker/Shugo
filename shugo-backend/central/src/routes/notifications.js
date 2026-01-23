// src/routes/notifications.js
// Routes pour la gestion des notifications

const router = require('express').Router();
const { body, param, query, validationResult } = require('express-validator');
const { authenticateToken, checkRole } = require('../middleware/auth');
const NotificationService = require('../services/NotificationService');
const Notification = require('../models/Notification');
const logger = require('../utils/logger');
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

/**
 * @route   GET /api/v1/notifications
 * @desc    Obtenir ses notifications
 * @access  Authenticated
 */
router.get('/',
    authenticateToken,
    [
        query('status').optional().isIn(['pending', 'sent', 'delivered', 'failed', 'cancelled', 'read']),
        query('priority').optional().isIn(['low', 'normal', 'high', 'urgent']),
        query('category').optional().isIn(['system', 'guard', 'admin', 'security', 'info']),
        query('unread_only').optional().isBoolean(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 })
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const {
                status,
                priority,
                category,
                unread_only,
                page = 1,
                limit = 20
            } = req.query;
            
            const where = {
                member_id: req.user.member_id,
                expires_at: { [Op.gt]: new Date() }
            };
            
            if (status) where.status = status;
            if (priority) where.priority = priority;
            if (category) where.category = category;
            
            if (unread_only === 'true') {
                where.status = { [Op.ne]: 'read' };
            }
            
            const offset = (page - 1) * limit;
            
            const { count, rows } = await Notification.findAndCountAll({
                where,
                limit,
                offset,
                order: [
                    ['priority', 'DESC'],
                    ['created_at', 'DESC']
                ]
            });
            
            res.json({
                success: true,
                data: rows,
                pagination: {
                    total: count,
                    page: parseInt(page),
                    pages: Math.ceil(count / limit),
                    limit: parseInt(limit)
                },
                unread_count: await Notification.countUnread(req.user.member_id)
            });
            
        } catch (error) {
            logger.error('Error fetching notifications', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching notifications',
                error: error.message
            });
        }
    }
);

/**
 * @route   GET /api/v1/notifications/unread-count
 * @desc    Obtenir le nombre de notifications non lues
 * @access  Authenticated
 */
router.get('/unread-count',
    authenticateToken,
    async (req, res) => {
        try {
            const count = await Notification.countUnread(req.user.member_id);
            
            res.json({
                success: true,
                data: { count }
            });
            
        } catch (error) {
            logger.error('Error counting unread notifications', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error counting notifications',
                error: error.message
            });
        }
    }
);

/**
 * @route   GET /api/v1/notifications/:id
 * @desc    Obtenir une notification spécifique
 * @access  Authenticated (owner only)
 */
router.get('/:id',
    authenticateToken,
    param('id').isUUID(),
    handleValidationErrors,
    async (req, res) => {
        try {
            const notification = await Notification.findByPk(req.params.id);
            
            if (!notification) {
                return res.status(404).json({
                    success: false,
                    message: 'Notification not found'
                });
            }
            
            // Vérifier que l'utilisateur est le destinataire
            if (notification.member_id !== req.user.member_id) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }
            
            res.json({
                success: true,
                data: notification
            });
            
        } catch (error) {
            logger.error('Error fetching notification', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error fetching notification',
                error: error.message
            });
        }
    }
);

/**
 * @route   POST /api/v1/notifications
 * @desc    Créer une notification (Gold+ pour groupe, Platinum+ pour tous)
 * @access  Gold+
 */
router.post('/',
    authenticateToken,
    checkRole(['Gold', 'Platinum', 'Admin', 'Admin_N1']),
    [
        body('type').isIn(['message', 'announcement', 'system_alert']),
        body('title').notEmpty().isLength({ max: 200 }),
        body('message').notEmpty(),
        body('priority').optional().isIn(['low', 'normal', 'high', 'urgent']),
        body('category').optional().isIn(['system', 'guard', 'admin', 'security', 'info']),
        body('target_type').isIn(['individual', 'group', 'geo_id', 'global']),
        body('target_ids').isArray(),
        body('expires_in_hours').optional().isInt({ min: 1, max: 720 })
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const {
                type,
                title,
                message,
                priority = 'normal',
                category = 'info',
                target_type,
                target_ids,
                expires_in_hours = 72,
                action_url,
                action_label
            } = req.body;
            
            // Vérifier les permissions selon le target_type
            if (target_type === 'global' && !['Admin', 'Admin_N1'].includes(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    message: 'Insufficient permissions for global notifications'
                });
            }
            
            if (target_type === 'geo_id' && !['Platinum', 'Admin', 'Admin_N1'].includes(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    message: 'Insufficient permissions for geo-wide notifications'
                });
            }
            
            const expires_at = new Date(Date.now() + expires_in_hours * 60 * 60 * 1000);
            
            let results;
            
            if (target_type === 'individual') {
                results = await NotificationService.sendBulkNotifications(target_ids, {
                    type,
                    title,
                    message,
                    priority,
                    category,
                    expires_at,
                    action_url,
                    action_label,
                    sender_id: req.user.member_id
                });
            } else if (target_type === 'group') {
                // Pour chaque groupe dans target_ids
                results = { success: [], failed: [] };
                for (const groupId of target_ids) {
                    const groupResults = await NotificationService.sendGroupNotification(groupId, {
                        type,
                        title,
                        message,
                        priority,
                        category,
                        expires_at,
                        action_url,
                        action_label,
                        sender_id: req.user.member_id
                    });
                    results.success.push(...groupResults.success);
                    results.failed.push(...groupResults.failed);
                }
            } else {
                // TODO: Implémenter pour geo_id et global
                return res.status(501).json({
                    success: false,
                    message: 'Target type not yet implemented'
                });
            }
            
            logger.info('Notifications created', {
                createdBy: req.user.member_id,
                targetType: target_type,
                successCount: results.success.length,
                failedCount: results.failed.length
            });
            
            res.status(201).json({
                success: true,
                message: 'Notifications sent',
                data: results
            });
            
        } catch (error) {
            logger.error('Error creating notifications', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error creating notifications',
                error: error.message
            });
        }
    }
);

/**
 * @route   PUT /api/v1/notifications/:id/read
 * @desc    Marquer une notification comme lue
 * @access  Authenticated (owner only)
 */
router.put('/:id/read',
    authenticateToken,
    param('id').isUUID(),
    handleValidationErrors,
    async (req, res) => {
        try {
            const notification = await Notification.findByPk(req.params.id);
            
            if (!notification) {
                return res.status(404).json({
                    success: false,
                    message: 'Notification not found'
                });
            }
            
            // Vérifier que l'utilisateur est le destinataire
            if (notification.member_id !== req.user.member_id) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }
            
            await notification.markAsRead();
            
            res.json({
                success: true,
                message: 'Notification marked as read'
            });
            
        } catch (error) {
            logger.error('Error marking notification as read', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error updating notification',
                error: error.message
            });
        }
    }
);

/**
 * @route   PUT /api/v1/notifications/read-all
 * @desc    Marquer toutes les notifications comme lues
 * @access  Authenticated
 */
router.put('/read-all',
    authenticateToken,
    async (req, res) => {
        try {
            const result = await Notification.markAllAsRead(req.user.member_id);
            
            res.json({
                success: true,
                message: `${result[0]} notifications marked as read`
            });
            
        } catch (error) {
            logger.error('Error marking all notifications as read', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error updating notifications',
                error: error.message
            });
        }
    }
);

/**
 * @route   DELETE /api/v1/notifications/:id
 * @desc    Supprimer une notification
 * @access  Authenticated (owner only)
 */
router.delete('/:id',
    authenticateToken,
    param('id').isUUID(),
    handleValidationErrors,
    async (req, res) => {
        try {
            const notification = await Notification.findByPk(req.params.id);
            
            if (!notification) {
                return res.status(404).json({
                    success: false,
                    message: 'Notification not found'
                });
            }
            
            // Vérifier que l'utilisateur est le destinataire
            if (notification.member_id !== req.user.member_id) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }
            
            await notification.destroy();
            
            res.json({
                success: true,
                message: 'Notification deleted'
            });
            
        } catch (error) {
            logger.error('Error deleting notification', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error deleting notification',
                error: error.message
            });
        }
    }
);

/**
 * @route   POST /api/v1/notifications/send-emergency
 * @desc    Envoyer une alerte d'urgence
 * @access  Admin only
 */
router.post('/send-emergency',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1']),
    [
        body('geo_id').matches(/^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/),
        body('message').notEmpty(),
        body('metadata').optional().isObject()
    ],
    handleValidationErrors,
    async (req, res) => {
        try {
            const { geo_id, message, metadata } = req.body;
            
            const notifications = await NotificationService.sendEmergencyAlert(
                geo_id,
                message,
                metadata
            );
            
            logger.warn('Emergency alert sent', {
                sentBy: req.user.member_id,
                geoId: geo_id,
                count: notifications.length
            });
            
            res.status(201).json({
                success: true,
                message: `Emergency alert sent to ${notifications.length} administrators`,
                data: notifications
            });
            
        } catch (error) {
            logger.error('Error sending emergency alert', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error sending emergency alert',
                error: error.message
            });
        }
    }
);

/**
 * @route   POST /api/v1/notifications/test
 * @desc    Envoyer une notification de test
 * @access  Authenticated
 */
router.post('/test',
    authenticateToken,
    async (req, res) => {
        try {
            const notification = await NotificationService.sendNotification(req.user.member_id, {
                type: 'message',
                title: 'Notification de test',
                message: 'Ceci est une notification de test générée à votre demande.',
                priority: 'low',
                category: 'info',
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000)
            });
            
            res.status(201).json({
                success: true,
                message: 'Test notification sent',
                data: notification
            });
            
        } catch (error) {
            logger.error('Error sending test notification', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Error sending test notification',
                error: error.message
            });
        }
    }
);

module.exports = router;
