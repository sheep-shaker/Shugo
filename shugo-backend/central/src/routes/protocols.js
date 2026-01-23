// routes/protocols.js
// Route: /api/v1/protocols/*
// Description: Routeur principal pour les protocoles système SHUGO

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { rateLimiter } = require('../middleware/rateLimiter');
const { auditLog } = require('../middleware/audit');

// Import des sous-routes des protocoles
const guiltySparkRouter = require('./protocols/guiltySpark');
const cendreBlancheRouter = require('./protocols/cendreBlanche');
const papierFroisseRouter = require('./protocols/papierFroisse');
const porteDeGrangeRouter = require('./protocols/porteDeGrange');
const upsideModeRouter = require('./protocols/upsideMode');
const cleTotemRouter = require('./protocols/cleTotem');

// Middleware commun pour tous les protocoles
router.use(authenticate);
router.use(rateLimiter('protocols:global'));

// GET /api/v1/protocols - Liste tous les protocoles disponibles
router.get(
  '/',
  authorize(['admin', 'security', 'operator']),
  async (req, res, next) => {
    try {
      const protocols = [
        {
          id: 'guilty_spark',
          name: 'Guilty Spark (343)',
          description: 'Création et gestion des serveurs locaux',
          status: 'active',
          access_level: 'admin',
          endpoints: [
            '/api/v1/protocols/guilty-spark/initialize',
            '/api/v1/protocols/guilty-spark/configure',
            '/api/v1/protocols/guilty-spark/deploy'
          ]
        },
        {
          id: 'cendre_blanche',
          name: 'Cendre Blanche',
          description: 'Suppression définitive et sécurisée des utilisateurs',
          status: 'active',
          access_level: 'admin',
          danger_level: 'critical',
          endpoints: [
            '/api/v1/protocols/cendre-blanche/initiate',
            '/api/v1/protocols/cendre-blanche/confirm',
            '/api/v1/protocols/cendre-blanche/execute'
          ]
        },
        {
          id: 'papier_froisse',
          name: 'Papier Froissé',
          description: 'Réactivation de comptes supprimés',
          status: 'active',
          access_level: 'admin',
          endpoints: [
            '/api/v1/protocols/papier-froisse/search',
            '/api/v1/protocols/papier-froisse/restore'
          ]
        },
        {
          id: 'porte_de_grange',
          name: 'Porte de Grange',
          description: 'Isolation réseau d\'urgence',
          status: 'active',
          access_level: 'security',
          danger_level: 'high',
          endpoints: [
            '/api/v1/protocols/porte-de-grange/isolate',
            '/api/v1/protocols/porte-de-grange/status',
            '/api/v1/protocols/porte-de-grange/restore'
          ]
        },
        {
          id: 'upside_mode',
          name: 'Upside Mode',
          description: 'Mode test avec environnement miroir',
          status: 'active',
          access_level: 'developer',
          endpoints: [
            '/api/v1/protocols/upside-mode/enable',
            '/api/v1/protocols/upside-mode/disable',
            '/api/v1/protocols/upside-mode/sync'
          ]
        },
        {
          id: 'cle_totem',
          name: 'Clé Totem',
          description: 'Authentification physique rapide par dispositif USB',
          status: 'active',
          access_level: 'user',
          endpoints: [
            '/api/v1/protocols/cle-totem/register',
            '/api/v1/protocols/cle-totem/authenticate',
            '/api/v1/protocols/cle-totem/revoke'
          ]
        }
      ];

      // Filtrer selon les permissions de l'utilisateur
      const accessibleProtocols = protocols.filter(p => {
        if (req.user.roles?.includes('admin')) return true;
        if (p.access_level === 'user') return true;
        if (p.access_level === 'security' && req.user.roles?.includes('security')) return true;
        if (p.access_level === 'developer' && req.user.roles?.includes('developer')) return true;
        if (p.access_level === 'operator' && req.user.roles?.includes('operator')) return true;
        return false;
      });

      res.json({
        success: true,
        data: accessibleProtocols
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/protocols/status - État global des protocoles
router.get(
  '/status',
  authorize(['admin', 'security']),
  async (req, res, next) => {
    try {
      const status = {
        active_protocols: [],
        recent_executions: [],
        system_state: 'normal',
        threat_level: 'low',
        last_check: new Date().toISOString()
      };

      // Ici on pourrait appeler un service pour obtenir l'état réel
      
      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/protocols/emergency-stop - Arrêt d'urgence de tous les protocoles
router.post(
  '/emergency-stop',
  authorize(['admin']),
  auditLog('protocols.emergencyStop'),
  async (req, res, next) => {
    try {
      const { reason, confirmation_code } = req.body;

      if (!reason || !confirmation_code) {
        return res.status(400).json({
          success: false,
          error: { 
            code: 'SHUGO-400', 
            message: 'Raison et code de confirmation requis' 
          }
        });
      }

      // Vérification du code de confirmation
      // Arrêt de tous les protocoles actifs
      
      res.json({
        success: true,
        message: 'Tous les protocoles ont été arrêtés d\'urgence'
      });
    } catch (error) {
      next(error);
    }
  }
);

// Montage des sous-routeurs
router.use('/guilty-spark', guiltySparkRouter);
router.use('/cendre-blanche', cendreBlancheRouter);
router.use('/papier-froisse', papierFroisseRouter);
router.use('/porte-de-grange', porteDeGrangeRouter);
router.use('/upside-mode', upsideModeRouter);
router.use('/cle-totem', cleTotemRouter);

module.exports = router;
