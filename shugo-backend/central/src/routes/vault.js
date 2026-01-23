// routes/vault.js
// Route: /api/v1/vault/*
// Description: Gestion du Vault central, rotation des clés

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validateRequest } = require('../middleware/validateRequest');
const { rateLimiter } = require('../middleware/rateLimiter');
const { auditLog } = require('../middleware/audit');
const { require2FA } = require('../middleware/auth2FA');
const VaultService = require('../services/VaultService');
const Joi = require('joi');

// Validation schemas
const schemas = {
  storeSecret: Joi.object({
    secret_type: Joi.string().valid('api_key', 'certificate', 'password', 'token', 'other').required(),
    secret_name: Joi.string().required().max(100),
    secret_value: Joi.string().required(),
    encrypted: Joi.boolean().default(true),
    metadata: Joi.object({
      service: Joi.string(),
      environment: Joi.string().valid('development', 'staging', 'production'),
      expires_at: Joi.date().iso(),
      rotation_policy: Joi.string().valid('manual', 'daily', 'weekly', 'monthly', 'yearly'),
      tags: Joi.array().items(Joi.string())
    }),
    access_control: Joi.object({
      allowed_roles: Joi.array().items(Joi.string()),
      allowed_members: Joi.array().items(Joi.number().integer()),
      require_2fa: Joi.boolean().default(true),
      audit_access: Joi.boolean().default(true)
    })
  }),

  rotateKey: Joi.object({
    rotation_type: Joi.string().valid('aes', 'shared_secret', 'api_key').required(),
    target_id: Joi.string(),
    force: Joi.boolean().default(false),
    notify_affected: Joi.boolean().default(true),
    schedule_for: Joi.date().iso()
  }),

  updateSecret: Joi.object({
    secret_value: Joi.string(),
    metadata: Joi.object(),
    access_control: Joi.object(),
    extend_expiry: Joi.date().iso()
  }).min(1)
};

// GET /api/v1/vault/status - État du Vault
router.get(
  '/status',
  authenticate,
  authorize(['admin', 'security']),
  require2FA,
  rateLimiter('vault:status'),
  async (req, res, next) => {
    try {
      const status = await VaultService.getVaultStatus({
        include_health: true,
        include_stats: true
      });

      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/vault/secrets - Liste les secrets (métadonnées uniquement)
router.get(
  '/secrets',
  authenticate,
  authorize(['admin', 'security']),
  require2FA,
  rateLimiter('vault:list'),
  auditLog('vault.list'),
  async (req, res, next) => {
    try {
      const { secret_type, service, environment, page = 1, limit = 20 } = req.query;

      const secrets = await VaultService.listSecrets({
        filters: { secret_type, service, environment },
        page: parseInt(page),
        limit: parseInt(limit),
        user: req.user
      });

      res.json({
        success: true,
        data: secrets.data,
        meta: {
          total: secrets.total,
          page: secrets.page,
          pages: secrets.pages,
          limit: secrets.limit
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/vault/secrets/:id - Récupère un secret
router.get(
  '/secrets/:id',
  authenticate,
  authorize(['admin', 'security']),
  require2FA,
  rateLimiter('vault:retrieve'),
  auditLog('vault.retrieve'),
  async (req, res, next) => {
    try {
      const secret = await VaultService.retrieveSecret({
        secret_id: req.params.id,
        user: req.user,
        reason: req.query.reason
      });

      if (!secret) {
        return res.status(404).json({
          success: false,
          error: { code: 'SHUGO-404', message: 'Secret non trouvé' }
        });
      }

      res.json({
        success: true,
        data: secret,
        warning: 'Secret sensible - Ne pas logger ou exposer'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/vault/secrets - Stocke un nouveau secret
router.post(
  '/secrets',
  authenticate,
  authorize(['admin', 'security']),
  require2FA,
  validateRequest(schemas.storeSecret),
  rateLimiter('vault:store'),
  auditLog('vault.store'),
  async (req, res, next) => {
    try {
      const secret = await VaultService.storeSecret({
        ...req.body,
        stored_by: req.user.member_id
      });

      res.status(201).json({
        success: true,
        data: { id: secret.id, name: secret.secret_name },
        message: 'Secret stocké avec succès dans le Vault'
      });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/v1/vault/secrets/:id - Met à jour un secret
router.patch(
  '/secrets/:id',
  authenticate,
  authorize(['admin', 'security']),
  require2FA,
  validateRequest(schemas.updateSecret),
  rateLimiter('vault:update'),
  auditLog('vault.update'),
  async (req, res, next) => {
    try {
      const secret = await VaultService.updateSecret({
        secret_id: req.params.id,
        updates: req.body,
        updated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: { id: secret.id, name: secret.secret_name },
        message: 'Secret mis à jour avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/vault/secrets/:id - Supprime un secret
router.delete(
  '/secrets/:id',
  authenticate,
  authorize(['admin']),
  require2FA,
  rateLimiter('vault:delete'),
  auditLog('vault.delete'),
  async (req, res, next) => {
    try {
      await VaultService.deleteSecret({
        secret_id: req.params.id,
        deleted_by: req.user.member_id,
        reason: req.body.reason || 'Non spécifié'
      });

      res.json({
        success: true,
        message: 'Secret supprimé définitivement du Vault'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/vault/rotate-keys - Rotation des clés
router.post(
  '/rotate-keys',
  authenticate,
  authorize(['admin', 'security']),
  require2FA,
  validateRequest(schemas.rotateKey),
  rateLimiter('vault:rotate'),
  auditLog('vault.rotate'),
  async (req, res, next) => {
    try {
      const result = await VaultService.rotateKeys({
        ...req.body,
        initiated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: result,
        message: `Rotation initiée. ${result.keys_rotated} clé(s) tournée(s).`
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/vault/rotation-status - État des rotations
router.get(
  '/rotation-status',
  authenticate,
  authorize(['admin', 'security']),
  require2FA,
  rateLimiter('vault:rotationStatus'),
  async (req, res, next) => {
    try {
      const status = await VaultService.getRotationStatus({
        include_pending: true,
        include_history: req.query.include_history === 'true'
      });

      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/vault/verify-integrity - Vérification d'intégrité
router.post(
  '/verify-integrity',
  authenticate,
  authorize(['admin', 'security']),
  require2FA,
  rateLimiter('vault:verify'),
  auditLog('vault.verify'),
  async (req, res, next) => {
    try {
      const result = await VaultService.verifyIntegrity({
        deep_check: req.body.deep_check === true,
        check_backups: req.body.check_backups === true
      });

      res.json({
        success: true,
        data: result,
        message: result.integrity_valid ? 
          'Intégrité du Vault confirmée' : 
          'ALERTE : Problèmes d\'intégrité détectés'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/vault/audit-log - Journal d'audit du Vault
router.get(
  '/audit-log',
  authenticate,
  authorize(['admin', 'security', 'auditor']),
  require2FA,
  rateLimiter('vault:audit'),
  async (req, res, next) => {
    try {
      const {
        action_type,
        member_id,
        date_from,
        date_to,
        page = 1,
        limit = 50
      } = req.query;

      const auditLog = await VaultService.getAuditLog({
        filters: { action_type, member_id, date_from, date_to },
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: auditLog
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/vault/backup - Sauvegarde du Vault
router.post(
  '/backup',
  authenticate,
  authorize(['admin']),
  require2FA,
  rateLimiter('vault:backup'),
  auditLog('vault.backup'),
  async (req, res, next) => {
    try {
      const backup = await VaultService.backupVault({
        backup_type: req.body.backup_type || 'full',
        encryption_key_id: req.body.encryption_key_id,
        initiated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: backup,
        message: 'Sauvegarde du Vault créée avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/vault/restore - Restauration du Vault
router.post(
  '/restore',
  authenticate,
  authorize(['admin']),
  require2FA,
  rateLimiter('vault:restore'),
  auditLog('vault.restore'),
  async (req, res, next) => {
    try {
      const { backup_id, verify_integrity = true, dry_run = false } = req.body;

      const result = await VaultService.restoreVault({
        backup_id,
        verify_integrity,
        dry_run,
        initiated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: result,
        message: dry_run ? 
          'Simulation de restauration réussie' : 
          'Vault restauré avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
