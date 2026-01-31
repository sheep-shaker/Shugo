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
const RegistrationToken = require('../models/RegistrationToken');

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

        // Map users with decrypted data
        const mappedUsers = users.map(u => ({
            member_id: u.member_id,
            email: u.email_encrypted,
            first_name: u.first_name_encrypted,
            last_name: u.last_name_encrypted,
            role: u.role,
            geo_id: u.geo_id,
            status: u.status,
            created_at: u.created_at
        }));

        logger.debug('Users fetched', {
            count,
            returned: mappedUsers.length,
            sample: mappedUsers.length > 0 ? {
                member_id: mappedUsers[0].member_id,
                email: mappedUsers[0].email ? '***' : null,
                first_name: mappedUsers[0].first_name || null
            } : null
        });

        res.json({
            success: true,
            data: {
                users: mappedUsers,
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
 * POST /api/v1/users
 * Create a new user (admin only)
 */
router.post('/',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1']),
    asyncHandler(async (req, res) => {
        const {
            email,
            password,
            first_name,
            last_name,
            role = 'Silver',
            geo_id,
            phone,
            preferred_language = 'fr',
            notification_channel = 'email'
        } = req.body;

        // Validate required fields
        if (!email || !password || !first_name || !last_name || !geo_id) {
            throw new AppError('Missing required fields: email, password, first_name, last_name, geo_id', 400);
        }

        // Check if email already exists
        const existingUser = await User.findByEmail(email);
        if (existingUser) {
            throw new AppError('Email already registered', 409);
        }

        // Validate role permissions
        if (role === 'Admin_N1' && req.user.role !== 'Admin_N1') {
            throw new AppError('Only Admin_N1 can create Admin_N1 users', 403);
        }

        // Generate member_id
        const memberId = await User.getNextAvailableId();

        // Hash password
        const passwordHash = await cryptoManager.hashPassword(password);

        // Create user
        const user = await User.create({
            member_id: memberId,
            email_encrypted: email,
            password_hash: passwordHash,
            first_name_encrypted: first_name,
            last_name_encrypted: last_name,
            phone_encrypted: phone || null,
            role,
            geo_id,
            scope: 'local:' + geo_id,
            status: 'active',
            preferred_language,
            notification_channel,
            totp_enabled: false
        });

        // Log the creation
        await AuditLog.logAction({
            member_id: req.user.member_id,
            action: 'CREATE',
            resource_type: 'user',
            resource_id: user.member_id.toString(),
            new_values: { email, first_name, last_name, role, geo_id },
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            result: 'success',
            category: 'admin'
        });

        logger.info('New user created by admin', {
            newUserId: user.member_id,
            createdBy: req.user.member_id,
            role: role
        });

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: {
                member_id: user.member_id,
                email: email,
                first_name: first_name,
                last_name: last_name,
                role: user.role,
                geo_id: user.geo_id,
                status: user.status
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
 * PATCH /api/v1/users/:id/status
 * Update user status (admin only)
 * Supports: active, inactive, suspended
 */
router.patch('/:id/status',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1']),
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;

        // Validate status
        const validStatuses = ['active', 'inactive', 'suspended'];
        if (!validStatuses.includes(status)) {
            throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
        }

        const user = await User.findByPk(id);
        if (!user) {
            throw new AppError('User not found', 404);
        }

        // Prevent self-suspension
        if (req.user.member_id == id && status === 'suspended') {
            throw new AppError('Cannot suspend your own account', 400);
        }

        // Prevent non-Admin_N1 from modifying Admin_N1 users
        if (user.role === 'Admin_N1' && req.user.role !== 'Admin_N1') {
            throw new AppError('Only Admin_N1 can modify other Admin_N1 users', 403);
        }

        const oldStatus = user.status;
        user.status = status;
        await user.save();

        // Log the action
        await AuditLog.logAction({
            member_id: req.user.member_id,
            action: 'UPDATE_STATUS',
            resource_type: 'user',
            resource_id: id,
            old_values: { status: oldStatus },
            new_values: { status },
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            result: 'success',
            category: 'admin'
        });

        logger.info('User status updated', {
            targetUserId: id,
            oldStatus,
            newStatus: status,
            updatedBy: req.user.member_id
        });

        res.json({
            success: true,
            message: `User status updated to ${status}`,
            data: {
                member_id: user.member_id,
                status: user.status
            }
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

// ==========================================
// REGISTRATION TOKENS MANAGEMENT
// ==========================================

/**
 * POST /api/v1/users/registration-tokens
 * Create a registration token for a new user (admin only)
 */
router.post('/registration-tokens',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1', 'Platinum']),
    asyncHandler(async (req, res) => {
        const {
            first_name,
            last_name,
            role = 'Silver',
            geo_id,
            group_id,
            expires_days = 7,
            notes
        } = req.body;

        // Validate required fields
        if (!first_name || !last_name || !geo_id) {
            throw new AppError('Missing required fields: first_name, last_name, geo_id', 400);
        }

        // Validate role permissions
        if (role === 'Admin_N1' && req.user.role !== 'Admin_N1') {
            throw new AppError('Only Admin_N1 can create Admin_N1 tokens', 403);
        }
        if (role === 'Admin' && !['Admin', 'Admin_N1'].includes(req.user.role)) {
            throw new AppError('Only Admin or Admin_N1 can create Admin tokens', 403);
        }

        // Generate token code and hash (16 caractères alphanumériques pour la sécurité)
        const crypto = require('crypto');
        const tokenCode = RegistrationToken.generateCode(16);
        const tokenHash = crypto.createHash('sha256').update(tokenCode).digest('hex');

        // Create registration token
        const token = await RegistrationToken.create({
            token_code: tokenCode,
            token_hash: tokenHash,
            token_type: 'registration',
            geo_id,
            created_by_member_id: req.user.member_id,
            target_first_name: first_name,
            target_last_name: last_name,
            target_role: role,
            target_group_id: group_id || null,
            expires_at: new Date(Date.now() + expires_days * 24 * 60 * 60 * 1000),
            notes: notes || null
        });

        // Log the creation
        await AuditLog.logAction({
            member_id: req.user.member_id,
            action: 'CREATE_REGISTRATION_TOKEN',
            resource_type: 'registration_token',
            resource_id: token.token_id,
            new_values: { first_name, last_name, role, geo_id },
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            result: 'success',
            category: 'admin'
        });

        logger.info('Registration token created', {
            tokenId: token.token_id,
            createdBy: req.user.member_id,
            targetName: `${first_name} ${last_name}`,
            role
        });

        res.status(201).json({
            success: true,
            message: 'Registration token created successfully',
            data: {
                token_id: token.token_id,
                token_code: token.token_code,
                first_name: token.target_first_name,
                last_name: token.target_last_name,
                role: token.target_role,
                geo_id: token.geo_id,
                expires_at: token.expires_at,
                status: token.status
            }
        });
    })
);

/**
 * GET /api/v1/users/registration-tokens
 * Get all registration tokens (admin only)
 */
router.get('/registration-tokens',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1', 'Platinum']),
    asyncHandler(async (req, res) => {
        const { status, geo_id, page = 1, limit = 50 } = req.query;
        const offset = (page - 1) * limit;

        const where = { token_type: 'registration' };
        if (status) where.status = status;
        if (geo_id) where.geo_id = geo_id;

        // Non-Admin_N1 can only see tokens they created or for their geo_id
        if (req.user.role !== 'Admin_N1') {
            where[Op.or] = [
                { created_by_member_id: req.user.member_id },
                { geo_id: req.user.geo_id }
            ];
        }

        const { count, rows: tokens } = await RegistrationToken.findAndCountAll({
            where,
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['created_at', 'DESC']],
            include: [{
                model: User,
                as: 'creator',
                attributes: ['member_id', 'first_name_encrypted', 'last_name_encrypted']
            }]
        });

        res.json({
            success: true,
            data: {
                tokens: tokens.map(t => ({
                    token_id: t.token_id,
                    token_code: t.token_code,
                    first_name: t.target_first_name,
                    last_name: t.target_last_name,
                    role: t.target_role,
                    geo_id: t.geo_id,
                    status: t.status,
                    expires_at: t.expires_at,
                    used_at: t.used_at,
                    created_at: t.created_at,
                    created_by: t.creator ? {
                        member_id: t.creator.member_id,
                        name: `${t.creator.first_name_encrypted} ${t.creator.last_name_encrypted}`
                    } : null
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
 * GET /api/v1/users/registration-tokens/:id
 * Get a specific registration token
 */
router.get('/registration-tokens/:id',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1', 'Platinum']),
    asyncHandler(async (req, res) => {
        const { id } = req.params;

        const token = await RegistrationToken.findByPk(id);

        if (!token) {
            throw new AppError('Registration token not found', 404);
        }

        res.json({
            success: true,
            data: {
                token_id: token.token_id,
                token_code: token.token_code,
                first_name: token.target_first_name,
                last_name: token.target_last_name,
                role: token.target_role,
                geo_id: token.geo_id,
                status: token.status,
                expires_at: token.expires_at,
                used_at: token.used_at,
                used_by_member_id: token.used_by_member_id,
                created_at: token.created_at,
                notes: token.notes
            }
        });
    })
);

/**
 * DELETE /api/v1/users/registration-tokens/:id
 * Revoke a registration token
 */
router.delete('/registration-tokens/:id',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1', 'Platinum']),
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { reason } = req.body;

        const token = await RegistrationToken.findByPk(id);

        if (!token) {
            throw new AppError('Registration token not found', 404);
        }

        if (token.status !== 'active') {
            throw new AppError('Token is not active and cannot be revoked', 400);
        }

        // Revoke the token
        await token.revoke(reason || 'Revoked by admin');

        // Log the revocation
        await AuditLog.logAction({
            member_id: req.user.member_id,
            action: 'REVOKE_REGISTRATION_TOKEN',
            resource_type: 'registration_token',
            resource_id: token.token_id,
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            result: 'success',
            category: 'admin'
        });

        res.json({
            success: true,
            message: 'Registration token revoked successfully'
        });
    })
);

/**
 * POST /api/v1/users/:id/reset-2fa
 * Reset 2FA for a user (admin only)
 */
router.post('/:id/reset-2fa',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1']),
    asyncHandler(async (req, res) => {
        const { id } = req.params;

        const user = await User.findByPk(id);

        if (!user) {
            throw new AppError('User not found', 404);
        }

        // Reset 2FA
        const speakeasy = require('speakeasy');
        const qrcode = require('qrcode');

        const secret = speakeasy.generateSecret({
            name: `SHUGO (${user.email_encrypted})`,
            issuer: 'SHUGO System'
        });

        user.totp_secret_encrypted = secret.base32;
        user.totp_enabled = false;
        user.totp_verified = false;
        user.totp_backup_codes = [];
        await user.save();

        // Generate QR code
        const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

        // Create a token for the user to complete 2FA setup
        const resetToken = await RegistrationToken.create({
            token_code: RegistrationToken.generateCode(16),
            token_type: 'totp_reset',
            geo_id: user.geo_id,
            created_by_member_id: req.user.member_id,
            target_member_id: user.member_id,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
        });

        // Log the reset
        await AuditLog.logAction({
            member_id: req.user.member_id,
            action: 'RESET_2FA',
            resource_type: 'user',
            resource_id: id,
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            result: 'success',
            category: 'security'
        });

        logger.info('2FA reset for user', {
            userId: id,
            resetBy: req.user.member_id
        });

        res.json({
            success: true,
            message: '2FA has been reset. User must reconfigure their authenticator.',
            data: {
                qr_code: qrCodeUrl,
                secret: secret.base32,
                reset_token: resetToken.token_code
            }
        });
    })
);

/**
 * POST /api/v1/users/:id/reset-password-admin
 * Admin reset password - generates a token for the user
 */
router.post('/:id/reset-password-admin',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1']),
    asyncHandler(async (req, res) => {
        const { id } = req.params;

        const user = await User.findByPk(id);

        if (!user) {
            throw new AppError('User not found', 404);
        }

        // Create password reset token
        const resetToken = await RegistrationToken.createPasswordReset(
            user.member_id,
            user.email_encrypted,
            req.user.member_id
        );

        // Log the reset
        await AuditLog.logAction({
            member_id: req.user.member_id,
            action: 'ADMIN_PASSWORD_RESET',
            resource_type: 'user',
            resource_id: id,
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            result: 'success',
            category: 'security'
        });

        logger.info('Password reset initiated by admin', {
            userId: id,
            resetBy: req.user.member_id
        });

        res.json({
            success: true,
            message: 'Password reset token generated',
            data: {
                reset_token: resetToken.token_code,
                expires_at: resetToken.expires_at
            }
        });
    })
);

module.exports = router;
