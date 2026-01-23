// routes/protocols/cleTotem.js
// Route: /api/v1/protocols/cle-totem/*
// Description: Protocole Clé Totem - Authentification physique USB

const express = require('express');
const router = express.Router();
const { authorize } = require('../../middleware/authorize');
const { validateRequest } = require('../../middleware/validateRequest');
const { rateLimiter } = require('../../middleware/rateLimiter');
const { auditLog } = require('../../middleware/audit');
const CleTotemService = require('../../services/protocols/CleTotemService');
const Joi = require('joi');

const schemas = {
  register: Joi.object({
    device_name: Joi.string().required().max(100),
    device_signature: Joi.string().required(),
    pin_code: Joi.string().min(6).max(12),
    backup_methods: Joi.array().items(Joi.string().valid('sms', 'email', 'emergency_codes'))
  }),
  
  authenticate: Joi.object({
    device_signature: Joi.string().required(),
    challenge_response: Joi.string().required(),
    pin_code: Joi.string().when('requires_pin', { is: true, then: Joi.required() })
  })
};

// POST /register - Enregistre une clé Totem
router.post('/register',
  authorize(['user']),
  validateRequest(schemas.register),
  rateLimiter('cleTotem:register'),
  auditLog('cleTotem.register'),
  async (req, res, next) => {
    try {
      const totem = await CleTotemService.registerTotem({
        ...req.body,
        member_id: req.user.member_id
      });
      res.json({
        success: true,
        data: totem,
        message: 'Clé Totem enregistrée avec succès'
      });
    } catch (error) {
      next(error);
    }
});

// POST /authenticate - Authentification par clé Totem
router.post('/authenticate',
  validateRequest(schemas.authenticate),
  rateLimiter('cleTotem:auth', { max: 5, window: '5m' }),
  async (req, res, next) => {
    try {
      const auth = await CleTotemService.authenticateWithTotem({
        ...req.body,
        ip_address: req.ip
      });
      
      if (!auth.success) {
        return res.status(401).json({
          success: false,
          error: { code: 'SHUGO-401', message: 'Authentification échouée' }
        });
      }
      
      res.json({
        success: true,
        data: auth,
        message: 'Authentification réussie'
      });
    } catch (error) {
      next(error);
    }
});

// POST /revoke/:id - Révoque une clé Totem
router.post('/revoke/:id',
  authorize(['user']),
  rateLimiter('cleTotem:revoke'),
  auditLog('cleTotem.revoke'),
  async (req, res, next) => {
    try {
      const result = await CleTotemService.revokeTotem({
        totem_id: req.params.id,
        member_id: req.user.member_id,
        reason: req.body.reason
      });
      res.json({
        success: true,
        data: result,
        message: 'Clé Totem révoquée'
      });
    } catch (error) {
      next(error);
    }
});

// GET /my-totems - Liste les clés de l'utilisateur
router.get('/my-totems',
  authorize(['user']),
  rateLimiter('cleTotem:list'),
  async (req, res, next) => {
    try {
      const totems = await CleTotemService.getUserTotems({
        member_id: req.user.member_id
      });
      res.json({ success: true, data: totems });
    } catch (error) {
      next(error);
    }
});

// POST /challenge - Génère un challenge d'authentification
router.post('/challenge',
  rateLimiter('cleTotem:challenge', { max: 10, window: '1m' }),
  async (req, res, next) => {
    try {
      const challenge = await CleTotemService.generateChallenge({
        device_signature: req.body.device_signature
      });
      res.json({
        success: true,
        data: challenge
      });
    } catch (error) {
      next(error);
    }
});

module.exports = router;
