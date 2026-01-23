// packages/local/src/routes/auth.js
// Authentication routes for local server

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { LocalUser } = require('../models');
const config = require('../config');
const logger = require('../utils/logger');
const { validateAuth } = require('../utils/validator');
const { authMiddleware } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

/**
 * POST /api/local/auth/login
 * Login with cached credentials
 */
router.post('/login', rateLimit.auth, async (req, res, next) => {
    try {
        const { error, value } = validateAuth.login(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: error.details[0].message
            });
        }
        
        const { email, password } = value;
        
        // Hash email for lookup
        const emailHash = crypto.createHash('sha256').update(email.toLowerCase()).digest('hex');
        
        // Find user by email hash
        const user = await LocalUser.findByEmailHash(emailHash);
        
        if (!user) {
            logger.warn('Login attempt for unknown user', { emailHash });
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }
        
        // Check if user is active
        if (user.status !== 'active') {
            return res.status(403).json({
                success: false,
                error: 'Account is not active'
            });
        }
        
        // For local server, we don't store passwords
        // We need to verify with central server or use cached token
        // This is a simplified version - in production, implement proper auth
        
        // Generate JWT token
        const token = jwt.sign(
            {
                member_id: user.member_id,
                email_hash: user.email_hash,
                role: user.role,
                geo_id: user.geo_id,
                server_type: 'local'
            },
            config.security.jwtSecret || 'local-secret-key',
            {
                expiresIn: config.security.jwtExpiresIn,
                issuer: config.server.id
            }
        );
        
        // Generate refresh token
        const refreshToken = jwt.sign(
            { member_id: user.member_id, type: 'refresh' },
            config.security.jwtRefreshSecret || 'local-refresh-secret',
            { expiresIn: config.security.jwtRefreshExpiresIn }
        );
        
        // Update last activity
        user.last_activity = new Date();
        await user.save();
        
        // Log successful login
        logger.info('User logged in', {
            member_id: user.member_id,
            role: user.role,
            geo_id: user.geo_id
        });
        
        res.json({
            success: true,
            data: {
                token,
                refreshToken,
                user: user.toSafeJSON(),
                expiresIn: 86400 // 24 hours
            }
        });
        
    } catch (error) {
        logger.error('Login error:', error);
        next(error);
    }
});

/**
 * POST /api/local/auth/refresh
 * Refresh JWT token
 */
router.post('/refresh', async (req, res, next) => {
    try {
        const { refreshToken } = req.body;
        
        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                error: 'Refresh token required'
            });
        }
        
        // Verify refresh token
        const decoded = jwt.verify(
            refreshToken,
            config.security.jwtRefreshSecret || 'local-refresh-secret'
        );
        
        // Find user
        const user = await LocalUser.findByPk(decoded.member_id);
        
        if (!user || user.status !== 'active') {
            return res.status(401).json({
                success: false,
                error: 'Invalid refresh token'
            });
        }
        
        // Generate new tokens
        const token = jwt.sign(
            {
                member_id: user.member_id,
                email_hash: user.email_hash,
                role: user.role,
                geo_id: user.geo_id,
                server_type: 'local'
            },
            config.security.jwtSecret || 'local-secret-key',
            { expiresIn: config.security.jwtExpiresIn }
        );
        
        const newRefreshToken = jwt.sign(
            { member_id: user.member_id, type: 'refresh' },
            config.security.jwtRefreshSecret || 'local-refresh-secret',
            { expiresIn: config.security.jwtRefreshExpiresIn }
        );
        
        res.json({
            success: true,
            data: {
                token,
                refreshToken: newRefreshToken,
                expiresIn: 86400
            }
        });
        
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: 'Refresh token expired'
            });
        }
        logger.error('Refresh token error:', error);
        next(error);
    }
});

/**
 * POST /api/local/auth/verify
 * Verify token with central server
 */
router.post('/verify', authMiddleware, async (req, res, next) => {
    try {
        const { token } = req.body;
        
        // Verify with central if online
        const syncManager = req.app.locals.syncManager;
        if (syncManager && syncManager.isOnline) {
            try {
                const response = await syncManager.api.post('/auth/verify', { token });
                return res.json({
                    success: true,
                    valid: response.data.valid,
                    user: response.data.user
                });
            } catch (error) {
                logger.warn('Central verification failed, using local cache');
            }
        }
        
        // Fallback to local verification
        try {
            const decoded = jwt.verify(
                token,
                config.security.jwtSecret || 'local-secret-key'
            );
            
            const user = await LocalUser.findByPk(decoded.member_id);
            
            res.json({
                success: true,
                valid: !!user,
                user: user ? user.toSafeJSON() : null
            });
            
        } catch (error) {
            res.json({
                success: true,
                valid: false,
                user: null
            });
        }
        
    } catch (error) {
        logger.error('Token verification error:', error);
        next(error);
    }
});

/**
 * GET /api/local/auth/me
 * Get current user profile
 */
router.get('/me', authMiddleware, async (req, res, next) => {
    try {
        const user = await LocalUser.findByPk(req.user.member_id, {
            include: [
                {
                    association: 'groups',
                    through: { attributes: [] }
                }
            ]
        });
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        res.json({
            success: true,
            data: user.toSafeJSON()
        });
        
    } catch (error) {
        logger.error('Get profile error:', error);
        next(error);
    }
});

/**
 * PUT /api/local/auth/me
 * Update current user profile
 */
router.put('/me', authMiddleware, async (req, res, next) => {
    try {
        const { error, value } = validateAuth.updateProfile(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                error: error.details[0].message
            });
        }
        
        const user = await LocalUser.findByPk(req.user.member_id);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Update allowed fields
        const allowedFields = ['preferred_language', 'notification_channel'];
        for (const field of allowedFields) {
            if (value[field] !== undefined) {
                user[field] = value[field];
            }
        }
        
        await user.save();
        
        // Add to sync queue
        const { SyncQueue } = require('../models');
        await SyncQueue.enqueue('update', 'user_preferences', {
            member_id: user.member_id,
            preferences: value
        });
        
        res.json({
            success: true,
            data: user.toSafeJSON()
        });
        
    } catch (error) {
        logger.error('Update profile error:', error);
        next(error);
    }
});

/**
 * POST /api/local/auth/logout
 * Logout current user
 */
router.post('/logout', authMiddleware, async (req, res, next) => {
    try {
        // In a real implementation, you would invalidate the token
        // For now, just log the logout
        logger.info('User logged out', {
            member_id: req.user.member_id
        });
        
        res.json({
            success: true,
            message: 'Logged out successfully'
        });
        
    } catch (error) {
        logger.error('Logout error:', error);
        next(error);
    }
});

/**
 * POST /api/local/auth/sync-user
 * Sync user data from central (admin only)
 */
router.post('/sync-user/:memberId', authMiddleware, async (req, res, next) => {
    try {
        // Check admin permission
        if (!['Admin', 'Platinum'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Permission denied'
            });
        }
        
        const { memberId } = req.params;
        const syncManager = req.app.locals.syncManager;
        
        if (!syncManager || !syncManager.isOnline) {
            return res.status(503).json({
                success: false,
                error: 'Sync service unavailable'
            });
        }
        
        // Request user data from central
        const response = await syncManager.api.get(`/users/${memberId}`);
        const userData = response.data;
        
        // Update or create user
        const [user, created] = await LocalUser.upsert({
            member_id: userData.member_id,
            email_hash: userData.email_hash,
            first_name: userData.first_name,
            last_name: userData.last_name,
            role: userData.role,
            geo_id: userData.geo_id,
            group_id: userData.group_id,
            status: userData.status,
            last_sync_at: new Date()
        });
        
        logger.info(`User ${created ? 'created' : 'updated'} from sync`, {
            member_id: memberId
        });
        
        res.json({
            success: true,
            data: user.toSafeJSON(),
            created
        });
        
    } catch (error) {
        logger.error('Sync user error:', error);
        next(error);
    }
});

module.exports = router;
