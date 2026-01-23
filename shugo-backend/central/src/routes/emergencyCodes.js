// routes/emergencyCodes.js  
// Route: /api/v1/emergency/*
// Description: Gestion des tableaux de secours d'urgence

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validateRequest } = require('../middleware/validateRequest');
const { rateLimiter } = require('../middleware/rateLimiter');
const { auditLog } = require('../middleware/audit');
const { require2FA } = require('../middleware/auth2FA');
const EmergencyCodeService = require('../services/EmergencyCodeService');
const Joi = require('joi');

// Validation schemas
const schemas = {
  generateTable: Joi.object({
    table_size: Joi.number().integer().valid(16, 25, 36, 49, 64, 100).default(36),
    code_length: Joi.number().integer().min(6).max(12).default(8),
    include_symbols: Joi.boolean().default(false),
    validity_days: Joi.number().integer().min(1).max(365).default(90),
    geo_scope: Joi.string().pattern(/^[A-Z]{2}-\d{2}-[A-Z0-9]+$/),
    delivery_method: Joi.string().valid('download', 'email', 'print', 'secure_message').required(),
    recipient_email: Joi.string().email().when('delivery_method', {
      is: 'email',
      then: Joi.required()
    }),
    encryption_password: Joi.string().min(12).when('delivery_method', {
      is: Joi.valid('download', 'email'),
      then: Joi.required()
    })
  }),

  validateCode: Joi.object({
    table_id: Joi.string().uuid().required(),
    position: Joi.string().pattern(/^[A-Z]\d+$/).required(), // Ex: C4, B7
    code: Joi.string().required(),
    action: Joi.string().valid('authenticate', 'unlock', 'reset').required(),
    target_member_id: Joi.number().integer().when('action', {
      is: Joi.valid('unlock', 'reset'),
      then: Joi.required()
    })
  }),

  revokeTable: Joi.object({
    reason: Joi.string().required().max(500),
    notify_owner: Joi.boolean().default(true),
    immediate: Joi.boolean().default(false)
  })
};

// GET /api/v1/emergency/tables - Liste les tableaux d'urgence
router.get(
  '/tables',
  authenticate,
  authorize(['admin', 'security']),
  require2FA,
  rateLimiter('emergency:list'),
  async (req, res, next) => {
    try {
      const {
        status,
        member_id,
        geo_id,
        include_expired = 'false',
        page = 1,
        limit = 20
      } = req.query;

      const tables = await EmergencyCodeService.listTables({
        filters: {
          status,
          member_id: member_id ? parseInt(member_id) : undefined,
          geo_id,
          include_expired: include_expired === 'true'
        },
        page: parseInt(page),
        limit: parseInt(limit),
        user: req.user
      });

      res.json({
        success: true,
        data: tables.data,
        meta: {
          total: tables.total,
          active: tables.active_count,
          page: tables.page,
          pages: tables.pages,
          limit: tables.limit
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/emergency/my-table - Tableau de l'utilisateur connecté
router.get(
  '/my-table',
  authenticate,
  rateLimiter('emergency:myTable'),
  async (req, res, next) => {
    try {
      const table = await EmergencyCodeService.getUserTable({
        member_id: req.user.member_id,
        include_usage_stats: true
      });

      if (!table) {
        return res.status(404).json({
          success: false,
          error: { code: 'SHUGO-404', message: 'Aucun tableau d\'urgence actif' }
        });
      }

      res.json({
        success: true,
        data: {
          table_id: table.table_id,
          created_at: table.created_at,
          expires_at: table.expires_at,
          table_size: table.table_size,
          usage_count: table.usage_count,
          remaining_codes: table.remaining_codes,
          last_used: table.last_used
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/emergency/generate - Génère un nouveau tableau
router.post(
  '/generate',
  authenticate,
  require2FA,
  validateRequest(schemas.generateTable),
  rateLimiter('emergency:generate'),
  auditLog('emergency.generate'),
  async (req, res, next) => {
    try {
      const table = await EmergencyCodeService.generateTable({
        ...req.body,
        member_id: req.user.member_id,
        generated_by: req.user.member_id
      });

      const message = req.body.delivery_method === 'email' 
        ? 'Tableau généré et envoyé par email sécurisé'
        : 'Tableau généré avec succès';

      res.status(201).json({
        success: true,
        data: table,
        message
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/emergency/validate - Valide un code d'urgence
router.post(
  '/validate',
  validateRequest(schemas.validateCode),
  rateLimiter('emergency:validate', { max: 5, window: '15m' }),
  auditLog('emergency.validate'),
  async (req, res, next) => {
    try {
      const result = await EmergencyCodeService.validateCode({
        ...req.body,
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      });

      if (!result.valid) {
        return res.status(401).json({
          success: false,
          error: { 
            code: 'SHUGO-401', 
            message: 'Code invalide ou position incorrecte' 
          }
        });
      }

      res.json({
        success: true,
        data: result,
        message: 'Code validé avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/emergency/tables/:id/revoke - Révoque un tableau
router.post(
  '/tables/:id/revoke',
  authenticate,
  authorize(['admin', 'security']),
  require2FA,
  validateRequest(schemas.revokeTable),
  rateLimiter('emergency:revoke'),
  auditLog('emergency.revoke'),
  async (req, res, next) => {
    try {
      await EmergencyCodeService.revokeTable({
        table_id: req.params.id,
        ...req.body,
        revoked_by: req.user.member_id
      });

      res.json({
        success: true,
        message: 'Tableau révoqué avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/emergency/tables/:id/usage - Historique d'utilisation
router.get(
  '/tables/:id/usage',
  authenticate,
  authorize(['admin', 'security', 'auditor']),
  require2FA,
  rateLimiter('emergency:usage'),
  async (req, res, next) => {
    try {
      const usage = await EmergencyCodeService.getTableUsage({
        table_id: req.params.id,
        include_details: req.query.detailed === 'true'
      });

      res.json({
        success: true,
        data: usage
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/emergency/request-new - Demande un nouveau tableau
router.post(
  '/request-new',
  authenticate,
  rateLimiter('emergency:request'),
  auditLog('emergency.request'),
  async (req, res, next) => {
    try {
      const request = await EmergencyCodeService.requestNewTable({
        member_id: req.user.member_id,
        reason: req.body.reason,
        urgency: req.body.urgency || 'normal'
      });

      res.json({
        success: true,
        data: request,
        message: 'Demande enregistrée. Un administrateur la traitera rapidement.'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/emergency/unlock-account - Déblocage d'urgence
router.post(
  '/unlock-account',
  rateLimiter('emergency:unlock', { max: 3, window: '1h' }),
  auditLog('emergency.unlock'),
  async (req, res, next) => {
    try {
      const {
        member_id,
        table_id,
        position,
        code
      } = req.body;

      const result = await EmergencyCodeService.unlockAccount({
        member_id: parseInt(member_id),
        table_id,
        position,
        code,
        ip_address: req.ip
      });

      if (!result.success) {
        return res.status(401).json({
          success: false,
          error: { 
            code: 'SHUGO-401',
            message: 'Déblocage impossible. Vérifiez vos informations.'
          }
        });
      }

      res.json({
        success: true,
        data: result,
        message: 'Compte débloqué. Un email de réinitialisation a été envoyé.'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/emergency/statistics - Statistiques d'utilisation
router.get(
  '/statistics',
  authenticate,
  authorize(['admin', 'security']),
  rateLimiter('emergency:stats'),
  async (req, res, next) => {
    try {
      const stats = await EmergencyCodeService.getStatistics({
        geo_id: req.query.geo_id,
        date_from: req.query.date_from,
        date_to: req.query.date_to
      });

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/emergency/test-delivery - Test de livraison
router.post(
  '/test-delivery',
  authenticate,
  authorize(['admin']),
  rateLimiter('emergency:test'),
  async (req, res, next) => {
    try {
      const result = await EmergencyCodeService.testDelivery({
        delivery_method: req.body.delivery_method,
        recipient_email: req.body.recipient_email || req.user.email
      });

      res.json({
        success: true,
        data: result,
        message: 'Test de livraison effectué'
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
