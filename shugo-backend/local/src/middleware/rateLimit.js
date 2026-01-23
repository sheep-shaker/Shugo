// packages/local/src/middleware/rateLimit.js
// Rate limiting middleware for local server

const rateLimit = require('express-rate-limit');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Create rate limiter with config
 */
function createRateLimiter(options = {}) {
    return rateLimit({
        windowMs: options.windowMs || config.rateLimit.windowMs,
        max: options.max || config.rateLimit.max,
        message: options.message || config.rateLimit.message,
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: options.skipSuccessfulRequests !== false,
        handler: (req, res) => {
            logger.warn('Rate limit exceeded', {
                ip: req.ip,
                url: req.originalUrl,
                user: req.user?.member_id
            });
            
            res.status(429).json({
                success: false,
                error: {
                    code: 'RATE_LIMIT_EXCEEDED',
                    message: options.message || 'Too many requests, please try again later',
                    retryAfter: req.rateLimit.resetTime
                }
            });
        }
    });
}

// Default rate limiter
const defaultLimiter = createRateLimiter();

// Auth endpoints limiter (stricter)
const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 requests per window
    message: 'Too many authentication attempts',
    skipSuccessfulRequests: false
});

// API limiter
const apiLimiter = createRateLimiter({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30 // 30 requests per minute
});

module.exports = defaultLimiter;
module.exports.auth = authLimiter;
module.exports.api = apiLimiter;
module.exports.create = createRateLimiter;
