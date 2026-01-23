// middleware/errorHandler.js
// Middleware global de gestion des erreurs

// Note: AuditLog is loaded lazily to avoid circular dependency issues
// The '../models' export is a function, not an object with models
let AuditLog = null;
function getAuditLog() {
  if (!AuditLog) {
    try {
      AuditLog = require('../models/AuditLog');
    } catch (e) {
      // Model not available
    }
  }
  return AuditLog;
}

/**
 * Custom Application Error class
 */
class AppError extends Error {
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Async handler wrapper to catch errors in async route handlers
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

async function errorHandler(err, req, res, next) {
  // Log l'erreur
  console.error('Error:', err);

  // Log critique dans l'audit
  if (err.severity === 'critical' || res.statusCode >= 500) {
    try {
      const AuditLogModel = getAuditLog();
      if (AuditLogModel) {
        await AuditLogModel.create({
          action_type: 'error.critical',
          member_id: req.user?.member_id,
          entity_type: 'system',
          severity: 'critical',
          details: {
            error: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
            endpoint: req.originalUrl,
            method: req.method
          }
        });
      }
    } catch (auditError) {
      console.error('Failed to log error to audit:', auditError.message);
    }
  }

  // Réponse par défaut
  const status = err.statusCode || res.statusCode || 500;
  const message = err.message || 'Erreur serveur';
  const code = err.code || 'SHUGO-ERROR-500';

  res.status(status).json({
    success: false,
    error: {
      code,
      message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  });
}

module.exports = {
    errorHandler,
    AppError,
    asyncHandler
};
