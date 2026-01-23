// packages/local/src/middleware/errorHandler.js
// Global error handler middleware

const logger = require('../utils/logger');
const config = require('../config');

/**
 * Global error handler middleware
 */
function errorHandler(err, req, res, next) {
    // Log error
    logger.error('Request error:', {
        error: err.message,
        stack: err.stack,
        method: req.method,
        url: req.originalUrl,
        user: req.user?.member_id,
        ip: req.ip
    });
    
    // Default error values
    let status = err.status || err.statusCode || 500;
    let message = err.message || 'Internal server error';
    let code = err.code || 'INTERNAL_ERROR';
    
    // Handle specific error types
    if (err.name === 'ValidationError') {
        status = 400;
        code = 'VALIDATION_ERROR';
        message = 'Validation failed';
        
        // Extract validation errors
        if (err.details) {
            message = err.details.map(d => d.message).join(', ');
        }
    }
    
    if (err.name === 'SequelizeValidationError') {
        status = 400;
        code = 'DATABASE_VALIDATION_ERROR';
        message = err.errors?.map(e => e.message).join(', ') || 'Database validation failed';
    }
    
    if (err.name === 'SequelizeUniqueConstraintError') {
        status = 409;
        code = 'DUPLICATE_ENTRY';
        message = 'Duplicate entry';
    }
    
    if (err.name === 'SequelizeForeignKeyConstraintError') {
        status = 400;
        code = 'FOREIGN_KEY_ERROR';
        message = 'Referenced resource does not exist';
    }
    
    if (err.name === 'UnauthorizedError' || err.name === 'JsonWebTokenError') {
        status = 401;
        code = 'UNAUTHORIZED';
        message = 'Unauthorized';
    }
    
    if (err.name === 'TokenExpiredError') {
        status = 401;
        code = 'TOKEN_EXPIRED';
        message = 'Token expired';
    }
    
    if (err.name === 'ForbiddenError') {
        status = 403;
        code = 'FORBIDDEN';
        message = 'Forbidden';
    }
    
    if (err.name === 'NotFoundError') {
        status = 404;
        code = 'NOT_FOUND';
        message = 'Resource not found';
    }
    
    // Prepare response
    const response = {
        success: false,
        error: {
            code,
            message,
            status
        }
    };
    
    // Add debug info in development
    if (config.isDevelopment) {
        response.error.stack = err.stack;
        response.error.details = err;
    }
    
    // Send response
    res.status(status).json(response);
}

/**
 * Not found handler (404)
 */
function notFoundHandler(req, res) {
    res.status(404).json({
        success: false,
        error: {
            code: 'NOT_FOUND',
            message: `Route ${req.method} ${req.originalUrl} not found`,
            status: 404
        }
    });
}

/**
 * Async error wrapper
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

module.exports = errorHandler;
module.exports.notFound = notFoundHandler;
module.exports.asyncHandler = asyncHandler;
