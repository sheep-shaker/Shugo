'use strict';

/**
 * Index des Services de Protocoles SHUGO
 *
 * Exporte tous les services de protocoles systeme.
 * @see Document Technique V7.0 - Chapitre 8
 */

const PorteDeGrangeService = require('./PorteDeGrangeService');
const CendreBlancheService = require('./CendreBlancheService');
const PapierFroisseService = require('./PapierFroisseService');
const GuiltySparkService = require('./GuiltySparkService');
const CleTotemService = require('./CleTotemService');
const UpsideModeService = require('./UpsideModeService');

module.exports = {
  // Services de protocoles
  PorteDeGrangeService,
  CendreBlancheService,
  PapierFroisseService,
  GuiltySparkService,
  CleTotemService,
  UpsideModeService,

  // Constantes exportees - Porte de Grange
  ISOLATION_STATUS: PorteDeGrangeService.ISOLATION_STATUS,

  // Constantes exportees - Cendre Blanche
  ACTIVATION_CONDITIONS: CendreBlancheService.ACTIVATION_CONDITIONS,

  // Constantes exportees - GuiltySpark
  LOCKDOWN_LEVELS: GuiltySparkService.LOCKDOWN_LEVELS,
  TRIGGER_REASONS: GuiltySparkService.TRIGGER_REASONS,

  // Constantes exportees - Cle Totem
  TOTEM_TYPES: CleTotemService.TOTEM_TYPES,
  TOTEM_ACTIONS: CleTotemService.ALLOWED_ACTIONS,

  // Constantes exportees - Upside Mode
  DEGRADATION_LEVELS: UpsideModeService.DEGRADATION_LEVELS,
  DEGRADABLE_SERVICES: UpsideModeService.DEGRADABLE_SERVICES,
  LEVEL_CAPABILITIES: UpsideModeService.LEVEL_CAPABILITIES
};
