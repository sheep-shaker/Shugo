// routes/protocols/papierFroisse.js
// Route: /api/v1/protocols/papier-froisse/*
// Description: Protocole Papier Froissé - Réactivation de comptes supprimés

const express = require('express');
const router = express.Router();
const { authorize } = require('../../middleware/authorize');
const { validateRequest } = require('../../middleware/validateRequest');
const { rateLimiter } = require('../../middleware/rateLimiter');
const { auditLog } = require('../../middleware/audit');
const { require2FA } = require('../../middleware/auth2FA');
const PapierFroisseService = require('../../services/protocols/PapierFroisseService');
const Joi = require('joi');

const schemas = {
  search: Joi.object({
    member_id: Joi.number().integer(),
    email: Joi.string().email(),
    name: Joi.string(),
    deletion_date_from: Joi.date().iso(),
    deletion_date_to: Joi.date().iso()
  }).or('member_id', 'email', 'name'),
  
  restore: Joi.object({
    deletion_record_id: Joi.string().uuid().required(),
    restore_type: Joi.string().valid('full', 'partial', 'data_only').default('full'),
    new_member_id: Joi.number().integer(),
    reason: Joi.string().required().min(20),
    legal_authorization: Joi.string().required()
  })
};

// POST /search - Recherche des comptes supprimés
router.post('/search',
  authorize(['admin']),
  require2FA,
  validateRequest(schemas.search),
  rateLimiter('papierFroisse:search'),
  auditLog('papierFroisse.search'),
  async (req, res, next) => {
    try {
      const records = await PapierFroisseService.searchDeletedAccounts({
        ...req.body,
        searched_by: req.user.member_id
      });
      res.json({
        success: true,
        data: records,
        message: `${records.length} compte(s) trouvé(s)`
      });
    } catch (error) {
      next(error);
    }
});

// POST /restore - Restaure un compte
router.post('/restore',
  authorize(['admin']),
  require2FA,
  validateRequest(schemas.restore),
  rateLimiter('papierFroisse:restore'),
  auditLog('papierFroisse.restore'),
  async (req, res, next) => {
    try {
      const restoration = await PapierFroisseService.restoreAccount({
        ...req.body,
        restored_by: req.user.member_id
      });
      res.json({
        success: true,
        data: restoration,
        message: 'Compte restauré avec succès'
      });
    } catch (error) {
      next(error);
    }
});

// GET /archive - Liste l'archive des suppressions
router.get('/archive',
  authorize(['admin', 'auditor']),
  rateLimiter('papierFroisse:archive'),
  async (req, res, next) => {
    try {
      const archive = await PapierFroisseService.getDeletionArchive({
        page: parseInt(req.query.page || 1),
        limit: parseInt(req.query.limit || 50)
      });
      res.json({ success: true, data: archive });
    } catch (error) {
      next(error);
    }
});

module.exports = router;
