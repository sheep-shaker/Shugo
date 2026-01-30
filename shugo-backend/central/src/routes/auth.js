// src/routes/auth.js
// Routes pour l'authentification et la gestion des sessions

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { Op } = require('sequelize');

const config = require('../config');
const logger = require('../utils/logger');
const cryptoManager = require('../utils/crypto');
const { sequelize } = require('../database/connection');

// Models
const User = require('../models/User');
const Session = require('../models/Session');
const RegistrationToken = require('../models/RegistrationToken');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');

// Services
const NotificationService = require('../services/NotificationService');

// Middleware
const { authenticateToken, checkRole, verify2FA } = require('../middleware/auth');
const { validationRules } = require('../middleware/validation');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

/**
 * POST /api/v1/auth/register
 * Register a new user with token
 */
router.post('/register', 
    validationRules.auth.register,
    asyncHandler(async (req, res) => {
        const { token, email, password, first_name, last_name, phone } = req.body;
        
        // Start transaction
        const transaction = await sequelize.transaction();
        
        try {
            // Verify registration token
            const regToken = await RegistrationToken.findOne({
                where: { 
                    token_code: token,
                    status: 'active',
                    expires_at: { [Op.gt]: new Date() }
                },
                transaction
            });
            
            if (!regToken) {
                await transaction.rollback();
                throw new AppError('Invalid or expired registration token', 400);
            }
            
            // Check if email already exists
            const existingUser = await User.findByEmail(email);
            if (existingUser) {
                await transaction.rollback();
                throw new AppError('Email already registered', 409);
            }
            
            // Get next available member_id
            const member_id = await User.getNextAvailableId();
            
            // Create user
            const user = await User.create({
                member_id,
                email_encrypted: email,
                password_hash: await cryptoManager.hashPassword(password),
                first_name_encrypted: first_name,
                last_name_encrypted: last_name,
                phone_encrypted: phone || null,
                role: regToken.target_role || 'Silver',
                geo_id: regToken.geo_id,
                group_id: regToken.target_group_id || null,
                status: 'active'
            }, { transaction });
            
            // Generate 2FA secret
            const secret = speakeasy.generateSecret({
                name: `SHUGO (${email})`,
                issuer: 'SHUGO System'
            });
            
            user.totp_secret_encrypted = secret.base32;
            await user.save({ transaction });
            
            // Generate QR code
            const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);
            
            // Mark token as used
            regToken.status = 'used';
            regToken.used_at = new Date();
            regToken.used_by_member_id = member_id;
            await regToken.save({ transaction });
            
            await transaction.commit();

            // Log registration (non-blocking to avoid SQLITE_BUSY)
            AuditLog.logAction({
                member_id,
                action: 'REGISTER',
                resource_type: 'user',
                resource_id: member_id.toString(),
                ip_address: req.ip,
                user_agent: req.get('user-agent'),
                result: 'success',
                category: 'auth'
            }).catch(err => logger.warn('Failed to log registration:', err.message));
            
            res.status(201).json({
                success: true,
                message: 'Registration successful. Please set up 2FA.',
                data: {
                    member_id,
                    qr_code: qrCodeUrl,
                    secret: secret.base32,
                    backup_codes: await generateBackupCodes(user)
                }
            });
            
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    })
);

/**
 * POST /api/v1/auth/login
 * Login user
 */
router.post('/login',
    validationRules.auth.login,
    asyncHandler(async (req, res) => {
        const { email, password, totp_token } = req.body;
        
        // Find user by email
        const user = await User.findByEmail(email);
        
        if (!user) {
            // Log failed attempt
            await AuditLog.logAction({
                action: 'LOGIN_FAILED',
                resource_type: 'user',
                ip_address: req.ip,
                user_agent: req.get('user-agent'),
                result: 'failure',
                error_message: 'Invalid credentials',
                category: 'auth'
            });
            
            throw new AppError('Invalid email or password', 401);
        }
        
        // Check if account is locked
        if (user.isLocked()) {
            throw new AppError('Account is temporarily locked', 423);
        }
        
        // Verify password
        const isValidPassword = await user.checkPassword(password);
        
        if (!isValidPassword) {
            await user.incrementFailedAttempts();
            
            await AuditLog.logAction({
                member_id: user.member_id,
                action: 'LOGIN_FAILED',
                resource_type: 'user',
                resource_id: user.member_id.toString(),
                ip_address: req.ip,
                user_agent: req.get('user-agent'),
                result: 'failure',
                error_message: 'Invalid password',
                category: 'auth'
            });
            
            throw new AppError('Invalid email or password', 401);
        }
        
        // Verify 2FA if enabled
        if (user.totp_enabled && user.totp_verified) {
            if (!totp_token) {
                return res.status(200).json({
                    success: false,
                    message: '2FA token required',
                    require_2fa: true
                });
            }
            
            const secret = user.totp_secret_encrypted;
            const verified = speakeasy.totp.verify({
                secret,
                encoding: 'base32',
                token: totp_token,
                window: 2
            });
            
            if (!verified) {
                // Check backup codes
                const backupCodes = user.totp_backup_codes || [];
                const codeIndex = backupCodes.indexOf(totp_token);
                
                if (codeIndex === -1) {
                    throw new AppError('Invalid 2FA token', 401);
                }
                
                // Remove used backup code
                backupCodes.splice(codeIndex, 1);
                user.totp_backup_codes = backupCodes;
                await user.save();
            }
        }
        
        // Reset failed attempts
        await user.resetFailedAttempts();
        
        // Update last login
        user.last_login = new Date();
        user.last_ip = req.ip;
        await user.save();
        
        // Create JWT tokens
        const accessToken = jwt.sign(
            {
                member_id: user.member_id,
                role: user.role,
                geo_id: user.geo_id
            },
            config.jwt.secret,
            { expiresIn: config.jwt.accessExpiresIn }
        );
        
        const refreshToken = jwt.sign(
            { member_id: user.member_id },
            config.jwt.refreshSecret,
            { expiresIn: config.jwt.refreshExpiresIn }
        );
        
        // Create session
        const session = await Session.create({
            member_id: user.member_id,
            jwt_token_hash: cryptoManager.hashSHA256(accessToken),
            refresh_token_hash: cryptoManager.hashSHA256(refreshToken),
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
            refresh_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        });
        
        // Log successful login
        await AuditLog.logAction({
            member_id: user.member_id,
            session_id: session.session_id,
            action: 'LOGIN',
            resource_type: 'user',
            resource_id: user.member_id.toString(),
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            result: 'success',
            category: 'auth'
        });
        
        res.json({
            success: true,
            message: 'Login successful',
            data: {
                access_token: accessToken,
                refresh_token: refreshToken,
                expires_in: config.jwt.accessExpiresIn,
                user: {
                    member_id: user.member_id,
                    first_name: user.first_name_encrypted,
                    last_name: user.last_name_encrypted,
                    role: user.role,
                    geo_id: user.geo_id
                }
            }
        });
    })
);

/**
 * POST /api/v1/auth/logout
 * Logout user
 */
router.post('/logout',
    authenticateToken,
    asyncHandler(async (req, res) => {
        const session = await Session.findByPk(req.user.session_id);
        
        if (session) {
            await session.invalidate('manual');
            
            // Log logout
            await AuditLog.logAction({
                member_id: req.user.member_id,
                session_id: req.user.session_id,
                action: 'LOGOUT',
                resource_type: 'user',
                resource_id: req.user.member_id.toString(),
                ip_address: req.ip,
                user_agent: req.get('user-agent'),
                result: 'success',
                category: 'auth'
            });
        }
        
        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    })
);

/**
 * POST /api/v1/auth/refresh
 * Refresh access token
 */
router.post('/refresh',
    asyncHandler(async (req, res) => {
        const { refresh_token } = req.body;
        
        if (!refresh_token) {
            throw new AppError('Refresh token required', 400);
        }
        
        // Find session by refresh token
        const session = await Session.findByRefreshToken(refresh_token);
        
        if (!session || !session.is_active || session.isRefreshExpired()) {
            throw new AppError('Invalid or expired refresh token', 401);
        }
        
        // Get user
        const user = await User.findByPk(session.member_id);
        
        if (!user || user.status !== 'active') {
            throw new AppError('User not found or inactive', 404);
        }
        
        // Generate new access token
        const accessToken = jwt.sign(
            {
                member_id: user.member_id,
                role: user.role,
                geo_id: user.geo_id
            },
            config.jwt.secret,
            { expiresIn: config.jwt.accessExpiresIn }
        );
        
        // Update session
        session.jwt_token_hash = cryptoManager.hashSHA256(accessToken);
        session.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await session.save();
        
        res.json({
            success: true,
            data: {
                access_token: accessToken,
                expires_in: config.jwt.accessExpiresIn
            }
        });
    })
);

/**
 * POST /api/v1/auth/verify-2fa
 * Verify and enable 2FA
 */
router.post('/verify-2fa',
    authenticateToken,
    asyncHandler(async (req, res) => {
        const { totp_token } = req.body;
        
        if (!totp_token) {
            throw new AppError('TOTP token required', 400);
        }
        
        const user = await User.findByPk(req.user.member_id);
        
        const secret = user.totp_secret_encrypted;
        const verified = speakeasy.totp.verify({
            secret,
            encoding: 'base32',
            token: totp_token,
            window: 2
        });
        
        if (!verified) {
            throw new AppError('Invalid TOTP token', 400);
        }
        
        // Enable and verify 2FA
        user.totp_enabled = true;
        user.totp_verified = true;
        await user.save();
        
        res.json({
            success: true,
            message: '2FA enabled successfully'
        });
    })
);

/**
 * POST /api/v1/auth/reset-password
 * Request password reset
 */
router.post('/reset-password',
    validationRules.auth.resetPassword,
    asyncHandler(async (req, res) => {
        const { email } = req.body;
        
        const user = await User.findByEmail(email);
        
        // Don't reveal if user exists
        if (!user) {
            return res.json({
                success: true,
                message: 'If the email exists, a reset link has been sent'
            });
        }
        
        // Generate reset token
        const resetToken = cryptoManager.generateToken();
        
        // Create registration token for reset
        await RegistrationToken.create({
            token_code: resetToken,
            geo_id: user.geo_id,
            created_by_member_id: user.member_id,
            target_member_id: user.member_id,
            token_type: 'password_reset',
            expires_at: new Date(Date.now() + 60 * 60 * 1000) // 1 hour
        });
        
        // Send email with reset link
        try {
            const notificationService = new NotificationService({
                Notification,
                User,
                AuditLog
            });
            await notificationService.initialize();

            const resetLink = `${config.app.frontendUrl}/auth/reset-password?token=${resetToken}`;

            await notificationService.send(
                user.member_id,
                'account_password_reset',
                { resetLink },
                { channel: 'email', immediate: true }
            );

            logger.info('Password reset email sent', { member_id: user.member_id });
        } catch (emailError) {
            logger.error('Failed to send reset email', {
                member_id: user.member_id,
                error: emailError.message
            });
        }
        
        res.json({
            success: true,
            message: 'If the email exists, a reset link has been sent'
        });
    })
);

/**
 * GET /api/v1/auth/me
 * Get current user profile
 */
router.get('/me',
    authenticateToken,
    asyncHandler(async (req, res) => {
        const user = await User.findByPk(req.user.member_id, {
            attributes: {
                exclude: ['password_hash', 'totp_secret_encrypted', 'totp_backup_codes']
            }
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
                role: user.role,
                geo_id: user.geo_id,
                group_id: user.group_id,
                status: user.status,
                preferred_language: user.preferred_language,
                notification_channel: user.notification_channel,
                totp_enabled: user.totp_enabled,
                last_login: user.last_login
            }
        });
    })
);

// Helper function to generate backup codes
async function generateBackupCodes(user) {
    const codes = [];
    for (let i = 0; i < 10; i++) {
        codes.push(cryptoManager.generateToken(4).toUpperCase());
    }
    user.totp_backup_codes = codes;
    await user.save();
    return codes;
}

module.exports = router;
