// src/middleware/auth.js
// Middleware d'authentification JWT et vérification des permissions

const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');
const User = require('../models/User');
const Session = require('../models/Session');

/**
 * Verify JWT token
 */
const authenticateToken = async (req, res, next) => {
    try {
        // Get token from header
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
        
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Authentication token required'
            });
        }
        
        // Verify token
        jwt.verify(token, config.security.jwtSecret, async (err, decoded) => {
            if (err) {
                logger.warn('Invalid token attempt', {
                    ip: req.ip,
                    error: err.message
                });
                
                return res.status(403).json({
                    success: false,
                    message: 'Invalid or expired token'
                });
            }
            
            try {
                // Check if session exists and is active
                const session = await Session.findOne({
                    where: {
                        member_id: decoded.member_id,
                        is_active: true
                    }
                });
                
                if (!session) {
                    return res.status(403).json({
                        success: false,
                        message: 'Session expired or invalid'
                    });
                }
                
                // Get user details
                const user = await User.findByPk(decoded.member_id, {
                    attributes: [
                        'member_id', 
                        'email_hash', 
                        'role', 
                        'geo_id', 
                        'status',
                        'scope',
                        'locked_until'
                    ]
                });
                
                if (!user) {
                    return res.status(404).json({
                        success: false,
                        message: 'User not found'
                    });
                }
                
                // Check if user is active
                if (user.status !== 'active') {
                    return res.status(403).json({
                        success: false,
                        message: `Account is ${user.status}`
                    });
                }
                
                // Check if user is locked
                if (user.locked_until && user.locked_until > new Date()) {
                    return res.status(403).json({
                        success: false,
                        message: 'Account is temporarily locked',
                        locked_until: user.locked_until
                    });
                }
                
                // Update session last activity
                session.last_activity = new Date();
                await session.save();
                
                // Attach user to request
                req.user = {
                    member_id: user.member_id,
                    role: user.role,
                    geo_id: user.geo_id,
                    scope: user.scope,
                    session_id: session.session_id
                };
                
                // Log successful authentication
                logger.debug('User authenticated', {
                    member_id: user.member_id,
                    role: user.role,
                    ip: req.ip
                });
                
                next();
                
            } catch (error) {
                logger.error('Authentication error:', error);
                return res.status(500).json({
                    success: false,
                    message: 'Authentication failed'
                });
            }
        });
        
    } catch (error) {
        logger.error('Authentication middleware error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

/**
 * Check if user has required role
 */
const checkRole = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        // Define role hierarchy
        const roleHierarchy = {
            'Silver': 1,
            'Gold': 2,
            'Platinum': 3,
            'Admin': 4,
            'Admin_N1': 5
        };
        
        const userRoleLevel = roleHierarchy[req.user.role] || 0;
        
        // Check if user has any of the allowed roles
        const hasPermission = allowedRoles.some(role => {
            const requiredLevel = roleHierarchy[role] || 0;
            return userRoleLevel >= requiredLevel;
        });
        
        if (!hasPermission) {
            logger.warn('Insufficient permissions', {
                member_id: req.user.member_id,
                user_role: req.user.role,
                required_roles: allowedRoles,
                path: req.path
            });
            
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions',
                required_roles: allowedRoles
            });
        }
        
        next();
    };
};

/**
 * Check if user has required scope
 */
const checkScope = (requiredScope) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        const userScope = req.user.scope || 'local:' + req.user.geo_id;
        
        // Admin can access everything
        if (req.user.role === 'Admin' || req.user.role === 'Admin_N1') {
            return next();
        }
        
        // Check scope match
        if (requiredScope === 'central' && userScope !== 'central') {
            return res.status(403).json({
                success: false,
                message: 'Central scope required'
            });
        }
        
        if (requiredScope.startsWith('local:')) {
            const requiredGeoId = requiredScope.replace('local:', '');
            const userGeoId = userScope.replace('local:', '');
            
            // Check if user's geo_id matches or is parent of required
            if (!userGeoId.startsWith(requiredGeoId.substring(0, 8))) {
                return res.status(403).json({
                    success: false,
                    message: 'Insufficient scope',
                    required: requiredScope,
                    current: userScope
                });
            }
        }
        
        next();
    };
};

/**
 * Optional authentication - doesn't fail if no token
 */
const optionalAuth = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        req.user = null;
        return next();
    }
    
    // Try to authenticate but don't fail if it doesn't work
    try {
        const decoded = jwt.verify(token, config.security.jwtSecret);
        
        const user = await User.findByPk(decoded.member_id, {
            attributes: ['member_id', 'role', 'geo_id', 'status', 'scope']
        });
        
        if (user && user.status === 'active') {
            req.user = {
                member_id: user.member_id,
                role: user.role,
                geo_id: user.geo_id,
                scope: user.scope
            };
        } else {
            req.user = null;
        }
    } catch (error) {
        req.user = null;
    }
    
    next();
};

/**
 * Rate limit by user
 */
const rateLimitByUser = (maxRequests = 100, windowMs = 60000) => {
    const userRequests = new Map();
    
    return (req, res, next) => {
        if (!req.user) {
            return next();
        }
        
        const userId = req.user.member_id;
        const now = Date.now();
        
        // Get user's request history
        let requests = userRequests.get(userId) || [];
        
        // Remove old requests outside the window
        requests = requests.filter(timestamp => now - timestamp < windowMs);
        
        if (requests.length >= maxRequests) {
            logger.warn('Rate limit exceeded', {
                member_id: userId,
                requests: requests.length,
                window: windowMs
            });
            
            return res.status(429).json({
                success: false,
                message: 'Too many requests, please slow down'
            });
        }
        
        // Add current request
        requests.push(now);
        userRequests.set(userId, requests);
        
        // Clean up old entries periodically
        if (Math.random() < 0.01) { // 1% chance
            for (const [key, value] of userRequests) {
                const filtered = value.filter(t => now - t < windowMs);
                if (filtered.length === 0) {
                    userRequests.delete(key);
                } else {
                    userRequests.set(key, filtered);
                }
            }
        }
        
        next();
    };
};

/**
 * Verify 2FA if enabled
 */
const verify2FA = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
    }
    
    // Check if 2FA is required
    if (!config.security.require2FA) {
        return next();
    }
    
    // Check if user has 2FA enabled
    const user = await User.findByPk(req.user.member_id, {
        attributes: ['totp_enabled', 'totp_verified']
    });
    
    if (!user.totp_enabled || !user.totp_verified) {
        // 2FA not set up for this user
        return next();
    }
    
    // Check if 2FA token was provided
    const totpToken = req.headers['x-totp-token'];
    
    if (!totpToken) {
        return res.status(403).json({
            success: false,
            message: '2FA token required',
            require_2fa: true
        });
    }
    
    // Verify TOTP token
    const speakeasy = require('speakeasy');
    const cryptoManager = require('../utils/crypto');
    
    const secret = cryptoManager.decryptField(user.totp_secret_encrypted);
    
    const verified = speakeasy.totp.verify({
        secret: secret,
        encoding: 'base32',
        token: totpToken,
        window: 2
    });
    
    if (!verified) {
        logger.warn('Invalid 2FA token', {
            member_id: req.user.member_id,
            ip: req.ip
        });
        
        return res.status(403).json({
            success: false,
            message: 'Invalid 2FA token'
        });
    }
    
    next();
};

module.exports = {
    authenticateToken,
    checkRole,
    checkScope,
    optionalAuth,
    rateLimitByUser,
    verify2FA
};
