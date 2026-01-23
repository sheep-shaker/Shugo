// src/routes/users.js
// Routes pour la gestion des utilisateurs

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');

const logger = require('../utils/logger');
const cryptoManager = require('../utils/crypto');
const { sequelize } = require('../database/connection');

// Models
const User = require('../models/User');
const Session = require('../models/Session');
const Group = require('../models/Group');
const GroupMembership = require('../models/GroupMembership');
const AuditLog = require('../models/AuditLog');

// Middleware
const { authenticateToken, checkRole, checkScope } = require('../middleware/auth');
const { validationRules } = require('../middleware/validation');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

/**
 * GET /api/v1/users
 * Get all users (admin only)
 */
router.get('/',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1']),
    asyncHandler(async (req, res) => {
        const { 
            page = 1, 
            limit = 50, 
            role, 
            status, 
            geo_id,
            search 
        } = req.query;
        
        const offset = (page - 1) * limit;
        const where = {};
        
        // Apply filters
        if (role) where.role = role;
        if (status) where.status = status;
        if (geo_id) where.geo_id = geo_id;
        
        // Search by name or email
        if (search) {
            const searchHash = cryptoManager.hashForSearch(search);
            const searchPhonetic = cryptoManager.generatePhoneticHash(search);
            
            where[Op.or] = [
                { first_name_hash: searchHash },
                { last_name_hash: searchHash },
                { email_hash: searchHash },
                { first_name_phonetic: searchPhonetic },
                { last_name_phonetic: searchPhonetic }
            ];
        }
        
        const { count, rows: users } = await User.findAndCountAll({
            where,
            attributes: {
                exclude: ['password_hash', 'totp_secret_encrypted', 'totp_backup_codes']
            },
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['created_at', 'DESC']]
        });
        
        res.json({
            success: true,
            data: {
                users: users.map(u => ({
                    member_id: u.member_id,
                    email: u.email_encrypted,
                    first_name: u.first_name_encrypted,
                    last_name: u.last_name_encrypted,
                    role: u.role,
                    geo_id: u.geo_id,
                    status: u.status,
                    created_at: u.created_at
                })),
                pagination: {
                    total: count,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    pages: Math.ceil(count / limit)
                }
            }
        });
    })
);

/**
 * GET /api/v1/users/:id
 * Get user by ID
 */
router.get('/:id',
    authenticateToken,
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        
        // Check permissions
        if (req.user.member_id != id && 
            !['Admin', 'Admin_N1', 'Platinum'].includes(req.user.role)) {
            throw new AppError('Insufficient permissions', 403);
        }
        
        const user = await User.findByPk(id, {
            attributes: {
                exclude: ['password_hash', 'totp_secret_encrypted', 'totp_backup_codes']
            },
            include: [
                {
                    model: GroupMembership,
                    as: 'groupMemberships',
                    include: [{
                        model: Group,
                        as: 'group',
                        attributes: ['group_id', 'name']
                    }]
                }
            ]
        });
        
        if (!user) {
            throw new AppError('User not found', 404);
        }
        
        res.json({
            success: true,
            data: {
                member_id: user.member_id,
                email: user.email_encrypted,
                first_name: user.first_name_encrypted,
                last_name: user.last_name_encrypted,
                phone: user.phone_encrypted,
                role: user.role,
                geo_id: user.geo_id,
                scope: user.scope,
                status: user.status,
                preferred_language: user.preferred_language,
                notification_channel: user.notification_channel,
                groups: user.groupMemberships?.map(gm => ({
                    group_id: gm.group?.group_id,
                    name: gm.group?.name,
                    role: gm.role_in_group
                })) || [],
                totp_enabled: user.totp_enabled,
                last_login: user.last_login,
                created_at: user.created_at,
                updated_at: user.updated_at
            }
        });
    })
);

/**
 * PUT /api/v1/users/:id
 * Update user
 */
router.put('/:id',
    authenticateToken,
    validationRules.user.update,
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        const updates = req.body;
        
        // Check permissions
        const canEditSelf = req.user.member_id == id && 
            ['email', 'phone', 'preferred_language', 'notification_channel'].every(
                field => !(field in updates) || updates[field] !== undefined
            );
        
        const canEditOthers = ['Admin', 'Admin_N1'].includes(req.user.role) ||
            (req.user.role === 'Platinum' && updates.role !== 'Admin' && updates.role !== 'Admin_N1');
        
        if (!canEditSelf && !canEditOthers) {
            throw new AppError('Insufficient permissions', 403);
        }
        
        const user = await User.findByPk(id);
        
        if (!user) {
            throw new AppError('User not found', 404);
        }
        
        // Store old values for audit
        const oldValues = user.toJSON();
        
        // Update allowed fields
        const allowedFields = canEditOthers ? 
            ['email', 'first_name', 'last_name', 'phone', 'role', 'geo_id', 'status', 'preferred_language', 'notification_channel'] :
            ['phone', 'preferred_language', 'notification_channel'];
        
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                if (field === 'email') {
                    user.email_encrypted = updates[field];
                } else if (field === 'first_name') {
                    user.first_name_encrypted = updates[field];
                } else if (field === 'last_name') {
                    user.last_name_encrypted = updates[field];
                } else if (field === 'phone') {
                    user.phone_encrypted = updates[field];
                } else {
                    user[field] = updates[field];
                }
            }
        }
        
        await user.save();
        
        // Log the update
        await AuditLog.logAction({
            member_id: req.user.member_id,
            action: 'UPDATE',
            resource_type: 'user',
            resource_id: id,
            old_values: oldValues,
            new_values: user.toJSON(),
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            result: 'success',
            category: 'data'
        });
        
        res.json({
            success: true,
            message: 'User updated successfully',
            data: user.getPublicProfile()
        });
    })
);

/**
 * POST /api/v1/users/:id/change-password
 * Change user password
 */
router.post('/:id/change-password',
    authenticateToken,
    validationRules.auth.changePassword,
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { current_password, password } = req.body;
        
        // Users can only change their own password
        if (req.user.member_id != id) {
            throw new AppError('You can only change your own password', 403);
        }
        
        const user = await User.findByPk(id);
        
        if (!user) {
            throw new AppError('User not found', 404);
        }
        
        // Verify current password
        const isValid = await user.checkPassword(current_password);
        if (!isValid) {
            throw new AppError('Current password is incorrect', 401);
        }
        
        // Set new password
        await user.setPassword(password);
        await user.save();
        
        // Invalidate all sessions
        await Session.invalidateAllForUser(id, 'password_changed');
        
        // Log password change
        await AuditLog.logAction({
            member_id: req.user.member_id,
            action: 'CHANGE_PASSWORD',
            resource_type: 'user',
            resource_id: id,
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            result: 'success',
            category: 'security'
        });
        
        res.json({
            success: true,
            message: 'Password changed successfully. Please login again.'
        });
    })
);

/**
 * DELETE /api/v1/users/:id
 * Delete user (soft delete)
 */
router.delete('/:id',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1']),
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { permanent = false } = req.query;
        
        const user = await User.findByPk(id);
        
        if (!user) {
            throw new AppError('User not found', 404);
        }
        
        // Prevent deleting Admin_N1 users unless you are one
        if (user.role === 'Admin_N1' && req.user.role !== 'Admin_N1') {
            throw new AppError('Cannot delete Admin_N1 users', 403);
        }
        
        if (permanent && req.user.role === 'Admin_N1') {
            // Permanent deletion (Protocole Cendre Blanche)
            await user.destroy({ force: true });
            
            await AuditLog.logAction({
                member_id: req.user.member_id,
                action: 'DELETE_PERMANENT',
                resource_type: 'user',
                resource_id: id,
                ip_address: req.ip,
                user_agent: req.get('user-agent'),
                result: 'success',
                category: 'admin',
                severity: 'WARN'
            });
            
            res.json({
                success: true,
                message: 'User permanently deleted'
            });
        } else {
            // Soft delete
            user.status = 'deleted';
            await user.save();
            await user.destroy(); // Soft delete with paranoid
            
            await AuditLog.logAction({
                member_id: req.user.member_id,
                action: 'DELETE_SOFT',
                resource_type: 'user',
                resource_id: id,
                ip_address: req.ip,
                user_agent: req.get('user-agent'),
                result: 'success',
                category: 'admin'
            });
            
            res.json({
                success: true,
                message: 'User deactivated'
            });
        }
    })
);

/**
 * POST /api/v1/users/:id/restore
 * Restore soft-deleted user (Protocole Papier Froissé)
 */
router.post('/:id/restore',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1']),
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        
        const user = await User.findByPk(id, {
            paranoid: false
        });
        
        if (!user) {
            throw new AppError('User not found', 404);
        }
        
        if (!user.deleted_at) {
            throw new AppError('User is not deleted', 400);
        }
        
        // Restore user
        await user.restore();
        user.status = 'active';
        await user.save();
        
        await AuditLog.logAction({
            member_id: req.user.member_id,
            action: 'RESTORE',
            resource_type: 'user',
            resource_id: id,
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            result: 'success',
            category: 'admin'
        });
        
        res.json({
            success: true,
            message: 'User restored successfully',
            data: user.getPublicProfile()
        });
    })
);

/**
 * GET /api/v1/users/:id/sessions
 * Get user's active sessions
 */
router.get('/:id/sessions',
    authenticateToken,
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        
        // Check permissions
        if (req.user.member_id != id && !['Admin', 'Admin_N1'].includes(req.user.role)) {
            throw new AppError('Insufficient permissions', 403);
        }
        
        const sessions = await Session.findActiveByUser(id);
        
        res.json({
            success: true,
            data: sessions.map(s => ({
                session_id: s.session_id,
                ip_address: s.ip_address,
                user_agent: s.user_agent,
                created_at: s.created_at,
                last_activity: s.last_activity,
                expires_at: s.expires_at,
                is_current: s.session_id === req.user.session_id
            }))
        });
    })
);

/**
 * POST /api/v1/users/:id/invalidate-sessions
 * Invalidate all user sessions
 */
router.post('/:id/invalidate-sessions',
    authenticateToken,
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        
        // Check permissions
        if (req.user.member_id != id && !['Admin', 'Admin_N1'].includes(req.user.role)) {
            throw new AppError('Insufficient permissions', 403);
        }
        
        const count = await Session.invalidateAllForUser(id, 'manual');
        
        await AuditLog.logAction({
            member_id: req.user.member_id,
            action: 'INVALIDATE_SESSIONS',
            resource_type: 'user',
            resource_id: id,
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            result: 'success',
            category: 'security',
            metadata: { sessions_invalidated: count }
        });
        
        res.json({
            success: true,
            message: `${count} sessions invalidated`
        });
    })
);

/**
 * PUT /api/v1/users/:id/notification-settings
 * Update notification settings (channel, language, matrix_id)
 */
router.put('/:id/notification-settings',
    authenticateToken,
    validationRules.user.updateNotificationSettings,
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { notification_channel, matrix_id, preferred_language } = req.body;

        // Users can only update their own settings
        if (req.user.member_id != id) {
            throw new AppError('You can only update your own notification settings', 403);
        }

        const user = await User.findByPk(id);

        if (!user) {
            throw new AppError('User not found', 404);
        }

        const oldValues = {
            notification_channel: user.notification_channel,
            matrix_id: user.matrix_id,
            preferred_language: user.preferred_language
        };

        // Update fields if provided
        if (notification_channel !== undefined) {
            // If switching to matrix, verify matrix_id exists
            if (notification_channel === 'matrix' && !user.matrix_id && !matrix_id) {
                throw new AppError('Matrix ID is required to use Matrix notifications', 400);
            }
            user.notification_channel = notification_channel;
        }

        if (matrix_id !== undefined) {
            user.matrix_id = matrix_id;
        }

        if (preferred_language !== undefined) {
            user.preferred_language = preferred_language;
        }

        await user.save();

        // Log the change
        await AuditLog.logAction({
            member_id: req.user.member_id,
            action: 'UPDATE_NOTIFICATION_SETTINGS',
            resource_type: 'user',
            resource_id: id,
            old_values: oldValues,
            new_values: {
                notification_channel: user.notification_channel,
                matrix_id: user.matrix_id,
                preferred_language: user.preferred_language
            },
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            result: 'success',
            category: 'settings'
        });

        res.json({
            success: true,
            message: 'Notification settings updated',
            data: {
                notification_channel: user.notification_channel,
                matrix_id: user.matrix_id,
                preferred_language: user.preferred_language
            }
        });
    })
);

/**
 * POST /api/v1/users/:id/link-matrix
 * Link Matrix account to user
 */
router.post('/:id/link-matrix',
    authenticateToken,
    validationRules.user.linkMatrix,
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { matrix_id } = req.body;

        // Users can only link their own account
        if (req.user.member_id != id) {
            throw new AppError('You can only link your own Matrix account', 403);
        }

        const user = await User.findByPk(id);

        if (!user) {
            throw new AppError('User not found', 404);
        }

        // Check if Matrix ID is already used by another user
        const existingUser = await User.findOne({
            where: {
                matrix_id,
                member_id: { [Op.ne]: id }
            }
        });

        if (existingUser) {
            throw new AppError('This Matrix ID is already linked to another account', 409);
        }

        const oldMatrixId = user.matrix_id;
        user.matrix_id = matrix_id;
        await user.save();

        // Log the link
        await AuditLog.logAction({
            member_id: req.user.member_id,
            action: 'LINK_MATRIX',
            resource_type: 'user',
            resource_id: id,
            old_values: { matrix_id: oldMatrixId },
            new_values: { matrix_id },
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            result: 'success',
            category: 'settings'
        });

        res.json({
            success: true,
            message: 'Matrix account linked successfully',
            data: {
                matrix_id: user.matrix_id
            }
        });
    })
);

/**
 * DELETE /api/v1/users/:id/unlink-matrix
 * Unlink Matrix account from user
 */
router.delete('/:id/unlink-matrix',
    authenticateToken,
    asyncHandler(async (req, res) => {
        const { id } = req.params;

        // Users can only unlink their own account
        if (req.user.member_id != id) {
            throw new AppError('You can only unlink your own Matrix account', 403);
        }

        const user = await User.findByPk(id);

        if (!user) {
            throw new AppError('User not found', 404);
        }

        if (!user.matrix_id) {
            throw new AppError('No Matrix account linked', 400);
        }

        // If using matrix as notification channel, switch to email
        const oldChannel = user.notification_channel;
        if (user.notification_channel === 'matrix') {
            user.notification_channel = 'email';
        }

        const oldMatrixId = user.matrix_id;
        user.matrix_id = null;
        await user.save();

        // Log the unlink
        await AuditLog.logAction({
            member_id: req.user.member_id,
            action: 'UNLINK_MATRIX',
            resource_type: 'user',
            resource_id: id,
            old_values: { matrix_id: oldMatrixId, notification_channel: oldChannel },
            new_values: { matrix_id: null, notification_channel: user.notification_channel },
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            result: 'success',
            category: 'settings'
        });

        res.json({
            success: true,
            message: 'Matrix account unlinked',
            data: {
                notification_channel: user.notification_channel
            }
        });
    })
);

/**
 * POST /api/v1/users/:id/test-notification
 * Send a test notification to user
 */
router.post('/:id/test-notification',
    authenticateToken,
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { channel } = req.body; // optional, defaults to user preference

        // Users can only test their own notifications
        if (req.user.member_id != id && !['Admin', 'Admin_N1'].includes(req.user.role)) {
            throw new AppError('Insufficient permissions', 403);
        }

        const user = await User.findByPk(id);

        if (!user) {
            throw new AppError('User not found', 404);
        }

        const targetChannel = channel || user.notification_channel || 'email';

        // Check if channel is available
        if (targetChannel === 'matrix' && !user.matrix_id) {
            throw new AppError('No Matrix ID configured. Please link your Matrix account first.', 400);
        }

        // Get NotificationService
        const NotificationService = require('../services/NotificationService');
        const notificationService = new NotificationService({
            Notification: require('../models/Notification'),
            User,
            AuditLog
        });

        await notificationService.initialize();

        // Send test notification
        const notification = await notificationService.send(
            user.member_id,
            'system_alert',
            {
                details: 'Ceci est une notification de test SHUGO. Si vous recevez ce message, vos notifications fonctionnent correctement.'
            },
            {
                channel: targetChannel,
                immediate: true
            }
        );

        res.json({
            success: true,
            message: `Test notification sent via ${targetChannel}`,
            data: {
                notification_id: notification.notification_id,
                channel: targetChannel,
                status: notification.status
            }
        });
    })
);

module.exports = router;
