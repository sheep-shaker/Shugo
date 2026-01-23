// packages/local/src/middleware/auth.js
// Authentication middleware for local server

const jwt = require('jsonwebtoken');
const { LocalUser } = require('../models');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Main authentication middleware
 */
const authMiddleware = async (req, res, next) => {
    try {
        // Get token from header
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({
                success: false,
                error: 'No token provided'
            });
        }
        
        // Extract token
        const token = authHeader.startsWith('Bearer ') 
            ? authHeader.slice(7) 
            : authHeader;
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Invalid token format'
            });
        }
        
        // Verify token
        const decoded = jwt.verify(
            token,
            config.security.jwtSecret || 'local-secret-key'
        );
        
        // Check if token is for local server
        if (decoded.server_type && decoded.server_type !== 'local' && decoded.issuer !== config.server.id) {
            logger.warn('Token from different server', {
                expected: 'local',
                received: decoded.server_type,
                issuer: decoded.issuer
            });
        }
        
        // Find user in local cache
        const user = await LocalUser.findByPk(decoded.member_id);
        
        if (!user) {
            // Try to sync user from central if online
            const syncManager = req.app.locals.syncManager;
            if (syncManager && syncManager.isOnline) {
                try {
                    await syncManager.syncUser(decoded.member_id);
                    user = await LocalUser.findByPk(decoded.member_id);
                } catch (error) {
                    logger.error('Failed to sync user from central:', error);
                }
            }
            
            if (!user) {
                return res.status(401).json({
                    success: false,
                    error: 'User not found'
                });
            }
        }
        
        // Check if user is active
        if (user.status !== 'active') {
            return res.status(403).json({
                success: false,
                error: 'Account is not active'
            });
        }
        
        // Update last activity
        user.last_activity = new Date();
        await user.save();
        
        // Attach user to request
        req.user = {
            member_id: user.member_id,
            email_hash: user.email_hash,
            role: user.role,
            geo_id: user.geo_id,
            group_id: user.group_id,
            first_name: user.first_name,
            last_name: user.last_name
        };
        
        // Attach token for potential refresh
        req.token = token;
        
        next();
        
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: 'Token expired',
                code: 'TOKEN_EXPIRED'
            });
        }
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                error: 'Invalid token',
                code: 'INVALID_TOKEN'
            });
        }
        
        logger.error('Auth middleware error:', error);
        return res.status(500).json({
            success: false,
            error: 'Authentication error'
        });
    }
};

/**
 * Optional authentication middleware (doesn't fail if no token)
 */
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return next();
        }
        
        const token = authHeader.startsWith('Bearer ') 
            ? authHeader.slice(7) 
            : authHeader;
        
        if (!token) {
            return next();
        }
        
        const decoded = jwt.verify(
            token,
            config.security.jwtSecret || 'local-secret-key'
        );
        
        const user = await LocalUser.findByPk(decoded.member_id);
        
        if (user && user.status === 'active') {
            req.user = {
                member_id: user.member_id,
                email_hash: user.email_hash,
                role: user.role,
                geo_id: user.geo_id,
                group_id: user.group_id,
                first_name: user.first_name,
                last_name: user.last_name
            };
        }
        
        next();
        
    } catch (error) {
        // Don't fail, just continue without user
        next();
    }
};

/**
 * Role-based access control middleware
 */
const requireRole = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        
        if (!roles.includes(req.user.role)) {
            logger.warn('Access denied - insufficient role', {
                required: roles,
                user_role: req.user.role,
                member_id: req.user.member_id
            });
            
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions',
                required_role: roles
            });
        }
        
        next();
    };
};

/**
 * Check if user owns the resource
 */
const requireOwnership = (getResourceOwnerId) => {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        
        try {
            const ownerId = await getResourceOwnerId(req);
            
            if (ownerId !== req.user.member_id) {
                // Allow admins to bypass ownership check
                if (!['Admin', 'Platinum'].includes(req.user.role)) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not own this resource'
                    });
                }
            }
            
            next();
            
        } catch (error) {
            logger.error('Ownership check error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to verify ownership'
            });
        }
    };
};

/**
 * Check if user belongs to the same geo_id
 */
const requireSameGeoId = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }
    
    const targetGeoId = req.params.geoId || req.body.geo_id || req.query.geo_id;
    
    if (targetGeoId && targetGeoId !== req.user.geo_id) {
        // Allow admins to access other geo_ids
        if (req.user.role !== 'Admin') {
            return res.status(403).json({
                success: false,
                error: 'Access denied to this geo_id'
            });
        }
    }
    
    next();
};

module.exports = {
    authenticate: authMiddleware,
    authorize: requireRole,
    authMiddleware,
    optionalAuth,
    requireRole,
    requireOwnership,
    requireSameGeoId
};
