// packages/local/src/middleware/requestLogger.js
// Request logging middleware

const logger = require('../utils/logger');

/**
 * Request logger middleware
 */
function requestLogger(req, res, next) {
    const start = Date.now();
    
    // Store original end function
    const originalEnd = res.end;
    
    // Override end to log response
    res.end = function(...args) {
        // Calculate response time
        const responseTime = Date.now() - start;
        
        // Log request
        logger.logRequest(req, res, responseTime);
        
        // Call original end
        originalEnd.apply(res, args);
    };
    
    next();
}

module.exports = requestLogger;
