'use strict';

/**
 * Bootstrap du module d'integrite
 *
 * Initialise les composants de verification de coherence des donnees
 * au demarrage de l'application.
 */

const DataIntegrityManager = require('./DataIntegrityManager');

let _instance = null;

/**
 * Initialise le gestionnaire d'integrite
 * @param {Object} app - Instance Express
 * @param {Object} dependencies - Dependances (sequelize, models, etc.)
 */
async function initializeIntegrity(app, dependencies = {}) {
  if (_instance) {
    return _instance;
  }

  // Creer l'instance
  _instance = new DataIntegrityManager({
    sequelize: dependencies.sequelize,
    models: dependencies.models,
    cache: dependencies.cache,
    notifier: dependencies.notifier
  });

  // Demarrer la surveillance
  await _instance.initialize();

  // Attacher a l'application pour acces interne
  app.set('_dim', _instance);

  // Enregistrer le shutdown
  process.on('SIGTERM', () => _instance.shutdown());
  process.on('SIGINT', () => _instance.shutdown());

  return _instance;
}

/**
 * Obtient l'instance du gestionnaire
 */
function getIntegrityManager() {
  return _instance;
}

/**
 * API interne pour activation manuelle (usage admin uniquement)
 */
function createAdminAPI(router) {
  const express = require('express');
  const adminRouter = express.Router();

  // Route cachee pour statut
  adminRouter.get('/health/detailed', async (req, res) => {
    if (!req.user || !['Admin', 'Admin_N1'].includes(req.user.role)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const manager = getIntegrityManager();
    if (!manager) {
      return res.json({ status: 'not_initialized' });
    }

    res.json(manager.getStatus());
  });

  // Route cachee pour intervention
  adminRouter.post('/maintenance/integrity', async (req, res) => {
    if (!req.user || req.user.role !== 'Admin_N1') {
      return res.status(404).json({ error: 'Not found' });
    }

    const { level, reason, physicalKey } = req.body;
    const manager = getIntegrityManager();

    if (!manager) {
      return res.status(500).json({ error: 'Service unavailable' });
    }

    try {
      const result = await manager.activateLevel(level, req.user.member_id, {
        reason,
        physicalKey,
        password: req.body.password,
        totpCode: req.body.totpCode
      });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Route cachee pour restauration
  adminRouter.post('/maintenance/restore', async (req, res) => {
    if (!req.user || req.user.role !== 'Admin_N1') {
      return res.status(404).json({ error: 'Not found' });
    }

    const manager = getIntegrityManager();
    if (!manager) {
      return res.status(500).json({ error: 'Service unavailable' });
    }

    try {
      const result = await manager.restore(req.user.member_id, req.body);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  return adminRouter;
}

module.exports = {
  initializeIntegrity,
  getIntegrityManager,
  createAdminAPI
};
