// routes/protocols/porteDeGrange.js
// Route: /api/v1/protocols/porte-de-grange/*
// Description: Protocole Porte de Grange - Isolation réseau d'urgence

const express = require('express');
const router = express.Router();
const { authorize } = require('../../middleware/authorize');
const { validateRequest } = require('../../middleware/validateRequest');
const { rateLimiter } = require('../../middleware/rateLimiter');
const { auditLog } = require('../../middleware/audit');
const { require2FA } = require('../../middleware/auth2FA');
const PorteDeGrangeService = require('../../services/protocols/PorteDeGrangeService');
const Joi = require('joi');

const schemas = {
  isolate: Joi.object({
    target_type: Joi.string().valid('user', 'server', 'subnet', 'region').required(),
    target_id: Joi.string().required(),
    isolation_level: Joi.string().valid('partial', 'complete', 'emergency').required(),
    duration_minutes: Joi.number().integer().min(1).max(10080),
    reason: Joi.string().required().min(10),
    auto_restore: Joi.boolean().default(false)
  })
};

// POST /isolate - Active l'isolation
router.post('/isolate',
  authorize(['admin', 'security']),
  require2FA,
  validateRequest(schemas.isolate),
  rateLimiter('porteDeGrange:isolate'),
  auditLog('porteDeGrange.isolate'),
  async (req, res, next) => {
    try {
      const isolation = await PorteDeGrangeService.activateIsolation({
        ...req.body,
        activated_by: req.user.member_id
      });
      res.json({
        success: true,
        data: isolation,
        message: 'Isolation réseau activée'
      });
    } catch (error) {
      next(error);
    }
});

// GET /status - État des isolations
router.get('/status',
  authorize(['admin', 'security', 'operator']),
  rateLimiter('porteDeGrange:status'),
  async (req, res, next) => {
    try {
      const status = await PorteDeGrangeService.getIsolationStatus();
      res.json({ success: true, data: status });
    } catch (error) {
      next(error);
    }
});

// POST /restore/:id - Restaure la connectivité
router.post('/restore/:id',
  authorize(['admin', 'security']),
  require2FA,
  rateLimiter('porteDeGrange:restore'),
  auditLog('porteDeGrange.restore'),
  async (req, res, next) => {
    try {
      const result = await PorteDeGrangeService.restoreConnectivity({
        isolation_id: req.params.id,
        reason: req.body.reason,
        restored_by: req.user.member_id
      });
      res.json({
        success: true,
        data: result,
        message: 'Connectivité restaurée'
      });
    } catch (error) {
      next(error);
    }
});

module.exports = router;
