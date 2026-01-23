// middleware/audit.js
// Middleware d'audit et de traçabilité des actions

const { AuditLog, User } = require('../models');
const crypto = require('crypto');
const config = require('../config');

// Actions sensibles nécessitant un audit obligatoire
const SENSITIVE_ACTIONS = [
  'user.delete',
  'user.role_change',
  'vault.access',
  'vault.decrypt',
  'backup.restore',
  'protocol.execute',
  'system.config_change',
  'security.key_rotation',
  'auth.password_reset',
  'auth.2fa_disable'
];

// Niveaux de sévérité
const SEVERITY_LEVELS = {
  DEBUG: 'debug',
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical'
};

/**
 * Middleware d'audit automatique
 * @param {Object} options - Options de configuration
 * @param {string} options.action - Type d'action à auditer
 * @param {string} options.entity_type - Type d'entité concernée
 * @param {string} options.severity - Niveau de sévérité
 * @param {Function} options.detailsExtractor - Fonction pour extraire les détails
 * @param {boolean} options.includeRequestBody - Inclure le body de la requête
 * @param {boolean} options.includeResponseData - Inclure la réponse
 * @param {boolean} options.maskSensitiveData - Masquer les données sensibles
 */
function auditLog(options = {}) {
  const {
    action = null,
    entity_type = 'api',
    severity = SEVERITY_LEVELS.INFO,
    detailsExtractor = null,
    includeRequestBody = true,
    includeResponseData = false,
    maskSensitiveData = true,
    skipOnError = false
  } = options;

  return async (req, res, next) => {
    // Capturer le timestamp de début
    const startTime = Date.now();
    
    // Générer un ID de trace unique
    const traceId = generateTraceId();
    req.auditTraceId = traceId;
    
    // Préparer les données d'audit
    const auditData = {
      trace_id: traceId,
      action_type: action || `${req.method.toLowerCase()}.${req.route?.path || req.path}`,
      entity_type,
      member_id: req.user?.member_id || null,
      ip_address: getClientIp(req),
      user_agent: req.headers['user-agent'],
      request_method: req.method,
      request_path: req.originalUrl,
      timestamp: new Date()
    };

    // Capturer les détails de la requête
    const requestDetails = {
      params: req.params,
      query: req.query
    };

    if (includeRequestBody && req.body) {
      requestDetails.body = maskSensitiveData ? 
        maskSensitiveFields(req.body) : 
        req.body;
    }

    // Hook pour capturer la réponse
    const originalSend = res.send;
    const originalJson = res.json;
    let responseData = null;
    let responseStatus = null;

    // Intercepter res.json
    res.json = function(data) {
      responseData = data;
      responseStatus = res.statusCode;
      return originalJson.call(this, data);
    };

    // Intercepter res.send
    res.send = function(data) {
      if (typeof data === 'string') {
        try {
          responseData = JSON.parse(data);
        } catch {
          responseData = { body: data };
        }
      } else {
        responseData = data;
      }
      responseStatus = res.statusCode;
      return originalSend.call(this, data);
    };

    // Fonction pour enregistrer l'audit
    const logAudit = async () => {
      try {
        const duration = Date.now() - startTime;
        
        // Déterminer la sévérité selon le status
        let finalSeverity = severity;
        if (responseStatus >= 500) {
          finalSeverity = SEVERITY_LEVELS.ERROR;
        } else if (responseStatus >= 400) {
          finalSeverity = SEVERITY_LEVELS.WARNING;
        }

        // Extraire les détails personnalisés
        let customDetails = {};
        if (detailsExtractor) {
          customDetails = await detailsExtractor(req, res);
        }

        // Compiler tous les détails
        const details = {
          ...requestDetails,
          ...customDetails,
          duration_ms: duration,
          response_status: responseStatus
        };

        // Inclure les données de réponse si demandé
        if (includeResponseData && responseData) {
          details.response = maskSensitiveData ? 
            maskSensitiveFields(responseData) : 
            responseData;
        }

        // Vérifier si c'est une action sensible
        const isSensitive = SENSITIVE_ACTIONS.includes(auditData.action_type);
        
        // Créer l'entrée d'audit
        await AuditLog.create({
          ...auditData,
          severity: finalSeverity,
          details,
          response_status: responseStatus,
          duration_ms: duration,
          is_sensitive: isSensitive,
          hash: generateAuditHash(auditData, details)
        });

        // Si action critique, notifier les admins
        if (finalSeverity === SEVERITY_LEVELS.CRITICAL) {
          await notifyCriticalAction(auditData, details);
        }

      } catch (error) {
        console.error('Audit logging error:', error);
        console.error('Failed audit data:', {
          trace_id: traceId,
          action: auditData.action_type,
          error: error.message
        });
      }
    };

    // Intercepter la fin de la requête
    res.on('finish', async () => {
      if (!skipOnError || responseStatus < 500) {
        await logAudit();
      }
    });

    next();
  };
}

/**
 * Middleware pour auditer les accès aux données sensibles
 */
function auditSensitiveAccess(resource_type) {
  return async (req, res, next) => {
    const auditEntry = {
      action_type: `sensitive.access.${resource_type}`,
      entity_type: 'sensitive_data',
      member_id: req.user?.member_id,
      severity: SEVERITY_LEVELS.WARNING,
      details: {
        resource_type,
        resource_id: req.params.id || req.params[`${resource_type}_id`],
        access_reason: req.body?.reason || req.query.reason,
        ip_address: getClientIp(req),
        timestamp: new Date()
      }
    };

    try {
      await AuditLog.create(auditEntry);
      
      // Ajouter l'ID d'audit à la requête
      req.auditId = auditEntry.audit_id;
      
    } catch (error) {
      console.error('Sensitive access audit error:', error);
      
      // Pour les accès sensibles, bloquer si l'audit échoue
      return res.status(503).json({
        success: false,
        error: {
          code: 'SHUGO-AUDIT-001',
          message: 'Impossible d\'auditer l\'accès, opération annulée'
        }
      });
    }

    next();
  };
}

/**
 * Middleware pour auditer les modifications de configuration
 */
function auditConfigChange() {
  return auditLog({
    action: 'system.config_change',
    entity_type: 'configuration',
    severity: SEVERITY_LEVELS.CRITICAL,
    detailsExtractor: (req) => ({
      config_section: req.params.section,
      previous_values: req.body.previous,
      new_values: req.body.values,
      changed_by: req.user?.email
    })
  });
}

/**
 * Middleware pour auditer les opérations batch
 */
function auditBatchOperation(operation_type) {
  return auditLog({
    action: `batch.${operation_type}`,
    entity_type: 'batch',
    severity: SEVERITY_LEVELS.WARNING,
    detailsExtractor: (req, res) => ({
      operation: operation_type,
      items_count: req.body?.items?.length || 0,
      success_count: res.locals?.successCount || 0,
      failure_count: res.locals?.failureCount || 0
    })
  });
}

/**
 * Middleware pour la conformité RGPD
 */
function auditGDPR(action_type) {
  return auditLog({
    action: `gdpr.${action_type}`,
    entity_type: 'personal_data',
    severity: SEVERITY_LEVELS.CRITICAL,
    includeResponseData: true,
    detailsExtractor: (req) => ({
      data_subject: req.params.member_id || req.user?.member_id,
      action: action_type,
      legal_basis: req.body?.legal_basis,
      consent_id: req.body?.consent_id,
      retention_period: req.body?.retention_period
    })
  });
}

/**
 * Middleware pour tracer les requêtes cross-service
 */
function auditCrossService(service_name) {
  return async (req, res, next) => {
    // Propager ou créer le trace ID
    const traceId = req.headers['x-trace-id'] || generateTraceId();
    req.traceId = traceId;
    
    // Ajouter le trace ID aux headers de réponse
    res.setHeader('X-Trace-Id', traceId);
    
    const audit = auditLog({
      action: `cross_service.${service_name}`,
      entity_type: 'service',
      detailsExtractor: () => ({
        source_service: req.headers['x-source-service'] || 'unknown',
        target_service: service_name,
        trace_id: traceId,
        correlation_id: req.headers['x-correlation-id']
      })
    });
    
    return audit(req, res, next);
  };
}

/**
 * Middleware pour auditer les exports de données
 */
function auditDataExport(export_type) {
  return auditLog({
    action: `export.${export_type}`,
    entity_type: 'data_export',
    severity: SEVERITY_LEVELS.WARNING,
    detailsExtractor: (req, res) => ({
      export_type,
      format: req.query.format || 'json',
      filters: req.query,
      records_count: res.locals?.recordsCount || 0,
      file_size: res.locals?.fileSize || 0,
      export_reason: req.body?.reason
    })
  });
}

// Fonctions utilitaires

function generateTraceId() {
  return crypto.randomBytes(16).toString('hex');
}

function generateAuditHash(auditData, details) {
  const data = JSON.stringify({ ...auditData, ...details });
  return crypto.createHash('sha256').update(data).digest('hex');
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
         req.headers['x-real-ip'] ||
         req.connection.remoteAddress ||
         req.ip;
}

function maskSensitiveFields(data, depth = 0) {
  if (depth > 5) return data; // Limite de profondeur
  
  const sensitiveFields = [
    'password', 'token', 'secret', 'api_key', 'private_key',
    'credit_card', 'cvv', 'ssn', 'pin', 'totp_code',
    'backup_code', 'recovery_code', 'encryption_key'
  ];
  
  if (typeof data !== 'object' || data === null) {
    return data;
  }
  
  const masked = Array.isArray(data) ? [] : {};
  
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    
    if (sensitiveFields.some(field => lowerKey.includes(field))) {
      masked[key] = '***MASKED***';
    } else if (typeof value === 'object') {
      masked[key] = maskSensitiveFields(value, depth + 1);
    } else {
      masked[key] = value;
    }
  }
  
  return masked;
}

async function notifyCriticalAction(auditData, details) {
  try {
    const NotificationService = require('../services/NotificationService');
    
    await NotificationService.broadcastToAdmins({
      type: 'critical_action',
      title: 'Action critique détectée',
      message: `Action: ${auditData.action_type}\nUtilisateur: ${auditData.member_id}\nIP: ${auditData.ip_address}`,
      priority: 'critical',
      data: {
        audit_trace_id: auditData.trace_id,
        action: auditData.action_type,
        details
      }
    });
    
  } catch (error) {
    console.error('Failed to notify critical action:', error);
  }
}

/**
 * Fonction pour rechercher dans les logs d'audit
 */
async function searchAuditLogs({
  member_id,
  action_type,
  entity_type,
  severity,
  date_from,
  date_to,
  ip_address,
  limit = 100
}) {
  try {
    const where = {};
    
    if (member_id) where.member_id = member_id;
    if (action_type) where.action_type = action_type;
    if (entity_type) where.entity_type = entity_type;
    if (severity) where.severity = severity;
    if (ip_address) where.ip_address = ip_address;
    
    if (date_from || date_to) {
      where.timestamp = {};
      if (date_from) where.timestamp[Op.gte] = new Date(date_from);
      if (date_to) where.timestamp[Op.lte] = new Date(date_to);
    }
    
    const logs = await AuditLog.findAll({
      where,
      order: [['timestamp', 'DESC']],
      limit,
      include: [{
        model: User,
        as: 'user',
        attributes: ['member_id', 'email', 'first_name', 'last_name']
      }]
    });
    
    return logs;
    
  } catch (error) {
    console.error('Search audit logs error:', error);
    throw error;
  }
}

/**
 * Fonction pour vérifier l'intégrité des logs
 */
async function verifyAuditIntegrity(audit_id) {
  try {
    const audit = await AuditLog.findByPk(audit_id);
    
    if (!audit) {
      return { valid: false, error: 'Audit log not found' };
    }
    
    const expectedHash = generateAuditHash(
      {
        trace_id: audit.trace_id,
        action_type: audit.action_type,
        entity_type: audit.entity_type,
        member_id: audit.member_id,
        ip_address: audit.ip_address,
        user_agent: audit.user_agent,
        request_method: audit.request_method,
        request_path: audit.request_path,
        timestamp: audit.timestamp
      },
      audit.details
    );
    
    const valid = audit.hash === expectedHash;
    
    return {
      valid,
      error: valid ? null : 'Hash mismatch - log may have been tampered'
    };
    
  } catch (error) {
    console.error('Verify audit integrity error:', error);
    return { valid: false, error: error.message };
  }
}

/**
 * Middleware combiné pour les routes critiques
 */
const criticalAudit = (action, entity) => {
  return [
    auditSensitiveAccess(entity),
    auditLog({
      action,
      entity_type: entity,
      severity: SEVERITY_LEVELS.CRITICAL,
      includeRequestBody: true,
      includeResponseData: true
    })
  ];
};

// Export
module.exports = {
  // Middleware principal
  auditLog,
  audit: auditLog, // Alias
  
  // Middlewares spécialisés
  auditSensitiveAccess,
  auditConfigChange,
  auditBatchOperation,
  auditGDPR,
  auditCrossService,
  auditDataExport,
  criticalAudit,
  
  // Utilitaires
  searchAuditLogs,
  verifyAuditIntegrity,
  
  // Constantes
  SEVERITY_LEVELS,
  SENSITIVE_ACTIONS
};
