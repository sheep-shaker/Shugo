// routes/protocols/cendreBlanche.js
// Route: /api/v1/protocols/cendre-blanche/*
// Description: Protocole Cendre Blanche - Suppression définitive et sécurisée

const express = require('express');
const router = express.Router();
const { authorize } = require('../../middleware/authorize');
const { validateRequest } = require('../../middleware/validateRequest');
const { rateLimiter } = require('../../middleware/rateLimiter');
const { auditLog } = require('../../middleware/audit');
const { require2FA } = require('../../middleware/auth2FA');
const CendreBlancheService = require('../../services/protocols/CendreBlancheService');
const Joi = require('joi');

const schemas = {
  initiate: Joi.object({
    member_id: Joi.number().integer().min(1).max(9999999999).required(),
    reason: Joi.string().required().min(50).max(1000),
    data_retention: Joi.string().valid('none', 'anonymized', 'archived').default('anonymized'),
    notification_contacts: Joi.array().items(Joi.string().email()),
    legal_basis: Joi.string().required()
  }),
  
  confirm: Joi.object({
    deletion_id: Joi.string().uuid().required(),
    confirmation_code: Joi.string().required(),
    secondary_auth: Joi.string().required(),
    acknowledge_irreversible: Joi.boolean().valid(true).required()
  })
};

// POST /initiate - Initie la suppression
router.post('/initiate', 
  authorize(['admin']), 
  require2FA,
  validateRequest(schemas.initiate),
  rateLimiter('cendreBlanche:initiate'),
  auditLog('cendreBlanche.initiate'),
  async (req, res, next) => {
    try {
      const deletion = await CendreBlancheService.initiateDeletion({
        ...req.body,
        initiated_by: req.user.member_id
      });
      res.json({
        success: true,
        data: deletion,
        message: 'Processus de suppression initié. Confirmation requise dans 24h.'
      });
    } catch (error) {
      next(error);
    }
});

// POST /confirm - Confirme la suppression
router.post('/confirm',
  authorize(['admin']),
  require2FA,
  validateRequest(schemas.confirm),
  rateLimiter('cendreBlanche:confirm', { max: 3, window: '1h' }),
  auditLog('cendreBlanche.confirm'),
  async (req, res, next) => {
    try {
      const result = await CendreBlancheService.confirmDeletion({
        ...req.body,
        confirmed_by: req.user.member_id
      });
      res.json({
        success: true,
        data: result,
        message: 'Suppression confirmée et programmée'
      });
    } catch (error) {
      next(error);
    }
});

// POST /execute - Exécute la suppression
router.post('/execute/:id',
  authorize(['admin']),
  require2FA,
  rateLimiter('cendreBlanche:execute'),
  auditLog('cendreBlanche.execute'),
  async (req, res, next) => {
    try {
      const result = await CendreBlancheService.executeDeletion({
        deletion_id: req.params.id,
        final_confirmation: req.body.final_confirmation,
        executed_by: req.user.member_id
      });
      res.json({
        success: true,
        data: result,
        message: 'Suppression définitive exécutée'
      });
    } catch (error) {
      next(error);
    }
});

// GET /status/:id - Statut d'une suppression
router.get('/status/:id',
  authorize(['admin', 'auditor']),
  rateLimiter('cendreBlanche:status'),
  async (req, res, next) => {
    try {
      const status = await CendreBlancheService.getDeletionStatus({
        deletion_id: req.params.id
      });
      res.json({ success: true, data: status });
    } catch (error) {
      next(error);
    }
});

module.exports = router;
