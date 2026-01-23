// routes/protocols/upsideMode.js
// Route: /api/v1/protocols/upside-mode/*
// Description: Protocole Upside Mode - Environnement de test miroir

const express = require('express');
const router = express.Router();
const { authorize } = require('../../middleware/authorize');
const { validateRequest } = require('../../middleware/validateRequest');
const { rateLimiter } = require('../../middleware/rateLimiter');
const { auditLog } = require('../../middleware/audit');
const UpsideModeService = require('../../services/protocols/UpsideModeService');
const Joi = require('joi');

const schemas = {
  enable: Joi.object({
    environment_name: Joi.string().required(),
    clone_data: Joi.boolean().default(true),
    data_scope: Joi.string().valid('minimal', 'standard', 'complete').default('standard'),
    duration_hours: Joi.number().integer().min(1).max(168).default(24),
    auto_destroy: Joi.boolean().default(true)
  })
};

// POST /enable - Active le mode Upside
router.post('/enable',
  authorize(['admin', 'developer']),
  validateRequest(schemas.enable),
  rateLimiter('upsideMode:enable'),
  auditLog('upsideMode.enable'),
  async (req, res, next) => {
    try {
      const environment = await UpsideModeService.enableUpsideMode({
        ...req.body,
        enabled_by: req.user.member_id
      });
      res.json({
        success: true,
        data: environment,
        message: 'Environnement Upside créé'
      });
    } catch (error) {
      next(error);
    }
});

// POST /disable/:id - Désactive le mode Upside
router.post('/disable/:id',
  authorize(['admin', 'developer']),
  rateLimiter('upsideMode:disable'),
  auditLog('upsideMode.disable'),
  async (req, res, next) => {
    try {
      const result = await UpsideModeService.disableUpsideMode({
        environment_id: req.params.id,
        preserve_data: req.body.preserve_data || false,
        disabled_by: req.user.member_id
      });
      res.json({
        success: true,
        data: result,
        message: 'Environnement Upside désactivé'
      });
    } catch (error) {
      next(error);
    }
});

// POST /sync/:id - Synchronise avec production
router.post('/sync/:id',
  authorize(['admin', 'developer']),
  rateLimiter('upsideMode:sync'),
  auditLog('upsideMode.sync'),
  async (req, res, next) => {
    try {
      const sync = await UpsideModeService.syncWithProduction({
        environment_id: req.params.id,
        sync_direction: req.body.direction || 'from_production',
        components: req.body.components || ['all']
      });
      res.json({
        success: true,
        data: sync,
        message: 'Synchronisation effectuée'
      });
    } catch (error) {
      next(error);
    }
});

// GET /environments - Liste les environnements Upside
router.get('/environments',
  authorize(['admin', 'developer', 'tester']),
  rateLimiter('upsideMode:list'),
  async (req, res, next) => {
    try {
      const environments = await UpsideModeService.listEnvironments();
      res.json({ success: true, data: environments });
    } catch (error) {
      next(error);
    }
});

module.exports = router;
