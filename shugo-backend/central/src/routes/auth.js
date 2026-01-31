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
 * POST /api/v1/auth/validate-token
 * Validate registration token and get pre-filled data
 */
router.post('/validate-token',
    asyncHandler(async (req, res) => {
        const { token } = req.body;

        if (!token) {
            throw new AppError('Token required', 400);
        }

        // Find token
        const regToken = await RegistrationToken.findOne({
            where: {
                token_code: token,
                status: 'active',
                token_type: 'registration',
                expires_at: { [Op.gt]: new Date() }
            }
        });

        if (!regToken) {
            throw new AppError('Invalid or expired registration token', 400);
        }

        res.json({
            success: true,
            data: {
                first_name: regToken.target_first_name || '',
                last_name: regToken.target_last_name || '',
                role: regToken.target_role || 'Silver',
                geo_id: regToken.geo_id,
                expires_at: regToken.expires_at
            }
        });
    })
);

/**
 * POST /api/v1/auth/register
 * Register a new user with token - Step 1: Create user and send verification email
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

            // Check if email already exists (including pending users)
            const emailHash = cryptoManager.hashForSearch(email);
            const existingUser = await User.findOne({
                where: { email_hash: emailHash },
                paranoid: false,
                transaction
            });

            if (existingUser) {
                await transaction.rollback();
                throw new AppError('Email already registered', 409);
            }

            // Get next available member_id
            const member_id = await User.getNextAvailableId();

            // Generate 6-digit verification code
            const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

            // Create user with pending status
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
                status: 'pending_verification',
                email_verified: false,
                email_verification_code: verificationCode,
                email_verification_expires: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
            }, { transaction });

            // Mark token as used
            regToken.status = 'used';
            regToken.used_at = new Date();
            regToken.used_by_member_id = member_id;
            await regToken.save({ transaction });

            await transaction.commit();

            // Send verification email (non-blocking)
            try {
                const notificationService = new NotificationService({
                    Notification,
                    User,
                    AuditLog
                });
                await notificationService.initialize();

                await notificationService.send(
                    member_id,
                    'account_email_verification',
                    {
                        verificationCode,
                        firstName: first_name
                    },
                    { channel: 'email', immediate: true }
                );

                logger.info('Verification email sent', { member_id, email });
            } catch (emailError) {
                logger.error('Failed to send verification email', {
                    member_id,
                    error: emailError.message
                });
            }

            // Log registration start
            AuditLog.logAction({
                member_id,
                action: 'REGISTER_START',
                resource_type: 'user',
                resource_id: member_id.toString(),
                ip_address: req.ip,
                user_agent: req.get('user-agent'),
                result: 'success',
                category: 'auth'
            }).catch(err => logger.warn('Failed to log registration:', err.message));

            res.status(201).json({
                success: true,
                message: 'Compte créé. Vérifiez votre email pour le code de confirmation.',
                data: {
                    member_id,
                    email,
                    requires_email_verification: true
                }
            });

        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    })
);

/**
 * POST /api/v1/auth/verify-email
 * Verify email with 6-digit code - Step 2
 */
router.post('/verify-email',
    asyncHandler(async (req, res) => {
        const { member_id, code } = req.body;

        if (!member_id || !code) {
            throw new AppError('Member ID and verification code are required', 400);
        }

        const user = await User.findByPk(member_id);

        if (!user) {
            throw new AppError('Utilisateur non trouvé', 404);
        }

        if (user.email_verified) {
            throw new AppError('Email déjà vérifié', 400);
        }

        if (user.email_verification_expires && new Date() > new Date(user.email_verification_expires)) {
            throw new AppError('Code expiré. Veuillez demander un nouveau code.', 400);
        }

        if (user.email_verification_code !== code) {
            throw new AppError('Code de vérification incorrect', 400);
        }

        // Email verified - generate 2FA secret
        const email = user.email_encrypted;
        const secret = speakeasy.generateSecret({
            name: `SHUGO (${email})`,
            issuer: 'SHUGO System'
        });

        user.email_verified = true;
        user.email_verification_code = null;
        user.email_verification_expires = null;
        user.totp_secret_encrypted = secret.base32;
        await user.save();

        // Generate QR code
        const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

        // Generate backup codes
        const backupCodes = await generateBackupCodes(user);

        logger.info('Email verified, 2FA setup started', { member_id });

        res.json({
            success: true,
            message: 'Email vérifié. Configurez maintenant votre 2FA.',
            data: {
                qr_code: qrCodeUrl,
                secret: secret.base32,
                backup_codes: backupCodes
            }
        });
    })
);

/**
 * POST /api/v1/auth/resend-verification
 * Resend email verification code
 */
router.post('/resend-verification',
    asyncHandler(async (req, res) => {
        const { member_id } = req.body;

        if (!member_id) {
            throw new AppError('Member ID required', 400);
        }

        const user = await User.findByPk(member_id);

        if (!user) {
            throw new AppError('Utilisateur non trouvé', 404);
        }

        if (user.email_verified) {
            throw new AppError('Email déjà vérifié', 400);
        }

        // Generate new code
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        user.email_verification_code = verificationCode;
        user.email_verification_expires = new Date(Date.now() + 30 * 60 * 1000);
        await user.save();

        // Send verification email
        try {
            const notificationService = new NotificationService({
                Notification,
                User,
                AuditLog
            });
            await notificationService.initialize();

            await notificationService.send(
                member_id,
                'account_email_verification',
                {
                    verificationCode,
                    firstName: user.first_name_encrypted
                },
                { channel: 'email', immediate: true }
            );

            logger.info('Verification email resent', { member_id });
        } catch (emailError) {
            logger.error('Failed to resend verification email', {
                member_id,
                error: emailError.message
            });
            throw new AppError('Échec de l\'envoi de l\'email', 500);
        }

        res.json({
            success: true,
            message: 'Nouveau code envoyé par email'
        });
    })
);

/**
 * POST /api/v1/auth/complete-registration
 * Complete registration by verifying 2FA setup - Step 3 (final)
 */
router.post('/complete-registration',
    asyncHandler(async (req, res) => {
        const { member_id, totp_token } = req.body;

        if (!member_id || !totp_token) {
            throw new AppError('Member ID and TOTP token are required', 400);
        }

        const user = await User.findByPk(member_id);

        if (!user) {
            throw new AppError('Utilisateur non trouvé', 404);
        }

        if (!user.email_verified) {
            throw new AppError('Email non vérifié', 400);
        }

        if (user.status === 'active' && user.totp_verified) {
            throw new AppError('Compte déjà activé', 400);
        }

        // Verify TOTP token
        const secret = user.totp_secret_encrypted;
        const verified = speakeasy.totp.verify({
            secret,
            encoding: 'base32',
            token: totp_token,
            window: 2
        });

        if (!verified) {
            throw new AppError('Code 2FA incorrect. Vérifiez votre application d\'authentification.', 400);
        }

        // Complete registration
        user.status = 'active';
        user.totp_enabled = true;
        user.totp_verified = true;
        await user.save();

        // Log registration complete
        await AuditLog.logAction({
            member_id,
            action: 'REGISTER_COMPLETE',
            resource_type: 'user',
            resource_id: member_id.toString(),
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            result: 'success',
            category: 'auth'
        });

        logger.info('Registration completed', { member_id });

        res.json({
            success: true,
            message: 'Inscription terminée ! Vous pouvez maintenant vous connecter.'
        });
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

        // Find user by email (include inactive to give proper error message)
        const user = await User.findByEmail(email, { includeInactive: true });

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

            throw new AppError('Email ou mot de passe incorrect', 401);
        }

        // Check if registration is complete
        if (user.status === 'pending_verification') {
            throw new AppError('Veuillez terminer votre inscription en vérifiant votre email', 403);
        }

        // Check if account is active
        if (user.status !== 'active') {
            throw new AppError('Ce compte est désactivé ou suspendu', 403);
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
 * Note: Vérifie si l'email existe pour économiser les crédits d'envoi
 */
router.post('/reset-password',
    validationRules.auth.resetPassword,
    asyncHandler(async (req, res) => {
        const { email } = req.body;

        const user = await User.findByEmail(email);

        // Vérifier si l'email existe pour économiser les crédits d'envoi
        if (!user) {
            throw new AppError('Aucun compte n\'est associé à cette adresse email', 404);
        }

        // Vérifier que l'utilisateur est actif
        if (user.status !== 'active') {
            throw new AppError('Ce compte est désactivé', 403);
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
 * POST /api/v1/auth/reset-password-confirm
 * Reset password with token
 */
router.post('/reset-password-confirm',
    asyncHandler(async (req, res) => {
        const { token, password } = req.body;

        if (!token || !password) {
            throw new AppError('Token and password are required', 400);
        }

        // Validate password strength
        if (password.length < 8) {
            throw new AppError('Password must be at least 8 characters', 400);
        }

        // Find reset token
        const resetToken = await RegistrationToken.findOne({
            where: {
                token_code: token,
                token_type: 'password_reset',
                status: 'active',
                expires_at: { [Op.gt]: new Date() }
            }
        });

        if (!resetToken) {
            throw new AppError('Invalid or expired reset token', 400);
        }

        // Get user
        const user = await User.findByPk(resetToken.target_member_id);

        if (!user) {
            throw new AppError('User not found', 404);
        }

        // Update password
        user.password_hash = await cryptoManager.hashPassword(password);
        await user.save();

        // Mark token as used
        resetToken.status = 'used';
        resetToken.used_at = new Date();
        resetToken.used_by_member_id = user.member_id;
        await resetToken.save();

        // Log password reset
        await AuditLog.logAction({
            member_id: user.member_id,
            action: 'PASSWORD_RESET',
            resource_type: 'user',
            resource_id: user.member_id.toString(),
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            result: 'success',
            category: 'auth'
        });

        res.json({
            success: true,
            message: 'Password reset successfully'
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

/**
 * POST /api/v1/auth/request-2fa-reset
 * Request 2FA reset for self (authenticated user)
 */
router.post('/request-2fa-reset',
    authenticateToken,
    asyncHandler(async (req, res) => {
        const user = await User.findByPk(req.user.member_id);

        if (!user) {
            throw new AppError('User not found', 404);
        }

        if (!user.totp_enabled) {
            throw new AppError('2FA is not enabled for this account', 400);
        }

        // Generate reset token
        const resetToken = cryptoManager.generateToken();

        // Create reset token (utiliser 'totp_reset' qui est dans l'ENUM du modèle)
        await RegistrationToken.create({
            token_code: resetToken,
            geo_id: user.geo_id,
            created_by_member_id: user.member_id,
            target_member_id: user.member_id,
            token_type: 'totp_reset',
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

            const resetLink = `${config.app.frontendUrl}/auth/reset-2fa?token=${resetToken}`;

            await notificationService.send(
                user.member_id,
                'account_2fa_reset',
                { resetLink },
                { channel: 'email', immediate: true }
            );

            logger.info('2FA reset email sent', { member_id: user.member_id });
        } catch (emailError) {
            logger.error('Failed to send 2FA reset email', {
                member_id: user.member_id,
                error: emailError.message
            });
        }

        res.json({
            success: true,
            message: '2FA reset request submitted. Check your email for instructions.'
        });
    })
);

/**
 * POST /api/v1/auth/reset-2fa-confirm
 * Confirm 2FA reset with token
 */
router.post('/reset-2fa-confirm',
    asyncHandler(async (req, res) => {
        const { token, password } = req.body;

        if (!token || !password) {
            throw new AppError('Token and password are required', 400);
        }

        // Find reset token (utiliser 'totp_reset' qui est dans l'ENUM du modèle)
        const resetToken = await RegistrationToken.findOne({
            where: {
                token_code: token,
                token_type: 'totp_reset',
                status: 'active',
                expires_at: { [Op.gt]: new Date() }
            }
        });

        if (!resetToken) {
            throw new AppError('Invalid or expired reset token', 400);
        }

        // Get user and verify password
        const user = await User.findByPk(resetToken.target_member_id);

        if (!user) {
            throw new AppError('User not found', 404);
        }

        // Verify password
        const passwordValid = await cryptoManager.verifyPassword(password, user.password_hash);
        if (!passwordValid) {
            throw new AppError('Invalid password', 401);
        }

        // Generate new TOTP secret
        const secret = speakeasy.generateSecret({
            name: `SHUGO:${user.email_encrypted}`,
            length: 32
        });

        // Update user
        user.totp_secret_encrypted = cryptoManager.encrypt(secret.base32);
        user.totp_enabled = true;
        await user.save();

        // Generate new backup codes
        const backupCodes = await generateBackupCodes(user);

        // Mark token as used
        resetToken.status = 'used';
        resetToken.used_at = new Date();
        resetToken.used_by_member_id = user.member_id;
        await resetToken.save();

        // Generate QR code
        const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

        // Log 2FA reset
        await AuditLog.logAction({
            member_id: user.member_id,
            action: '2FA_RESET',
            resource_type: 'user',
            resource_id: user.member_id.toString(),
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            result: 'success',
            category: 'auth'
        });

        res.json({
            success: true,
            message: '2FA reset successfully',
            data: {
                qr_code: qrCodeUrl,
                secret: secret.base32,
                backup_codes: backupCodes
            }
        });
    })
);

/**
 * POST /api/v1/auth/request-password-reset-self
 * Request password reset for authenticated user (self-service)
 */
router.post('/request-password-reset-self',
    authenticateToken,
    asyncHandler(async (req, res) => {
        const user = await User.findByPk(req.user.member_id);

        if (!user) {
            throw new AppError('User not found', 404);
        }

        // Generate reset token
        const resetToken = cryptoManager.generateToken();

        // Create reset token
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

            logger.info('Self password reset email sent', { member_id: user.member_id });
        } catch (emailError) {
            logger.error('Failed to send self password reset email', {
                member_id: user.member_id,
                error: emailError.message
            });
        }

        res.json({
            success: true,
            message: 'Password reset request submitted. Check your email for instructions.'
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
