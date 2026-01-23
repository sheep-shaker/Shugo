'use strict';

/**
 * SHUGO v7.0 - Export centralisé des services
 *
 * Fournit une instance unique de chaque service avec injection des modèles.
 * @see Document Technique V7.0
 */

// === Services de base ===
const AuthService = require('./AuthService');
const UserService = require('./UserService');
const GuardService = require('./GuardService');
const VaultService = require('./VaultService');
const NotificationService = require('./NotificationService');
const MaintenanceService = require('./MaintenanceService');
const BackupService = require('./BackupService');

// === Services additionnels ===
const AuditService = require('./AuditService');
const EmailService = require('./EmailService');
const HealthService = require('./HealthService');
const LocalServerService = require('./LocalServerService');
const MatrixService = require('./MatrixService');
const MessageService = require('./MessageService');
const MissionService = require('./MissionService');
const PluginService = require('./PluginService');
const ScenarioService = require('./ScenarioService');
const SupportService = require('./SupportService');
const SyncService = require('./SyncService');
const WaitingListService = require('./WaitingListService');

// === Services de rotation ===
const KeyRotationService = require('./KeyRotationService');
const SecretRotationService = require('./SecretRotationService');
const EmergencyCodeService = require('./EmergencyCodeService');

// === Service d'orchestration protocoles ===
const ProtocolService = require('./ProtocolService');

// === Protocoles systeme ===
const {
  PorteDeGrangeService,
  CendreBlancheService,
  PapierFroisseService,
  GuiltySparkService,
  CleTotemService,
  UpsideModeService,
  // Constantes
  ISOLATION_STATUS,
  ACTIVATION_CONDITIONS,
  LOCKDOWN_LEVELS,
  TRIGGER_REASONS,
  TOTEM_TYPES,
  TOTEM_ACTIONS,
  DEGRADATION_LEVELS,
  DEGRADABLE_SERVICES,
  LEVEL_CAPABILITIES
} = require('./protocols');

// === Module d'integrite (usage interne) ===
const { DataIntegrityManager } = require('../core/integrity');

/**
 * Factory pour créer les instances de services
 * @param {Object} models - Modèles Sequelize
 * @param {Object} sequelize - Instance Sequelize
 * @param {Object} config - Configuration optionnelle
 * @returns {Object} Services instanciés
 */
function createServices(models, sequelize, config = {}) {
  const services = {};

  // === Services de base (sans dépendances) ===
  services.vault = new VaultService(models, sequelize);
  services.user = new UserService(models);
  services.auth = new AuthService(models);
  services.guard = new GuardService(models, sequelize);
  services.notification = new NotificationService(models);
  services.audit = new AuditService(models);
  services.email = new EmailService(config.email || {});
  services.health = new HealthService(models, sequelize);
  services.matrix = new MatrixService(config.matrix || {});
  services.message = new MessageService(models);
  services.support = new SupportService(models);
  services.waitingList = new WaitingListService(models);
  services.scenario = new ScenarioService(models, sequelize);

  // === Services avec dépendances ===
  services.mission = new MissionService(models, {
    notification: services.notification,
    audit: services.audit
  });

  services.localServer = new LocalServerService(models, sequelize, {
    vault: services.vault
  });

  services.sync = new SyncService(models, sequelize, {
    localServer: services.localServer,
    vault: services.vault
  });

  services.plugin = new PluginService(models, {
    vault: services.vault
  });

  services.backup = new BackupService(models, sequelize, {
    vault: services.vault
  });

  services.maintenance = new MaintenanceService(models, sequelize, {
    vault: services.vault,
    backup: services.backup,
    notification: services.notification
  });

  // === Services de rotation ===
  services.keyRotation = new KeyRotationService(models, sequelize, {
    vault: services.vault,
    notification: services.notification
  });

  services.secretRotation = new SecretRotationService(models, sequelize, {
    vault: services.vault,
    localServer: services.localServer,
    notification: services.notification
  });

  services.emergencyCode = new EmergencyCodeService(models, {
    vault: services.vault
  });

  // === Module d'integrite (interne) ===
  services._dim = new DataIntegrityManager({
    sequelize,
    models,
    notifier: services.notification
  });

  // === Protocoles systeme ===
  services.porteDeGrange = new PorteDeGrangeService(models, sequelize, {
    notification: services.notification,
    localServer: services.localServer
  });

  services.cendreBlanche = new CendreBlancheService(models, sequelize, {
    notification: services.notification,
    vault: services.vault
  });

  services.papierFroisse = new PapierFroisseService(models, sequelize, {
    notification: services.notification,
    audit: services.audit
  });

  services.guiltySpark = new GuiltySparkService(models, sequelize, {
    notification: services.notification,
    vault: services.vault,
    localServer: services.localServer
  });

  services.cleTotem = new CleTotemService(models, sequelize, {
    vault: services.vault,
    audit: services.audit
  });

  services.upsideMode = new UpsideModeService(models, sequelize, {
    notification: services.notification,
    health: services.health
  });

  return services;
}

/**
 * Crée une instance unique d'un service spécifique
 * @param {string} serviceName - Nom du service
 * @param {Object} models - Modèles Sequelize
 * @param {Object} deps - Dépendances
 * @returns {Object} Instance du service
 */
function createService(serviceName, models, deps = {}) {
  const ServiceClasses = {
    auth: AuthService,
    user: UserService,
    guard: GuardService,
    vault: VaultService,
    notification: NotificationService,
    maintenance: MaintenanceService,
    backup: BackupService,
    audit: AuditService,
    email: EmailService,
    health: HealthService,
    localServer: LocalServerService,
    matrix: MatrixService,
    message: MessageService,
    mission: MissionService,
    plugin: PluginService,
    scenario: ScenarioService,
    support: SupportService,
    sync: SyncService,
    waitingList: WaitingListService,
    keyRotation: KeyRotationService,
    secretRotation: SecretRotationService,
    emergencyCode: EmergencyCodeService,
    porteDeGrange: PorteDeGrangeService,
    cendreBlanche: CendreBlancheService,
    papierFroisse: PapierFroisseService,
    guiltySpark: GuiltySparkService,
    cleTotem: CleTotemService,
    upsideMode: UpsideModeService
  };

  const ServiceClass = ServiceClasses[serviceName];
  if (!ServiceClass) {
    throw new Error(`Service inconnu: ${serviceName}`);
  }

  return new ServiceClass(models, deps);
}

module.exports = {
  // Factory
  createServices,
  createService,

  // === Services de base ===
  AuthService,
  UserService,
  GuardService,
  VaultService,
  NotificationService,
  MaintenanceService,
  BackupService,

  // === Services additionnels ===
  AuditService,
  EmailService,
  HealthService,
  LocalServerService,
  MatrixService,
  MessageService,
  MissionService,
  PluginService,
  ScenarioService,
  SupportService,
  SyncService,
  WaitingListService,

  // === Services de rotation ===
  KeyRotationService,
  SecretRotationService,
  EmergencyCodeService,

  // === Orchestration protocoles ===
  ProtocolService,

  // === Protocoles ===
  PorteDeGrangeService,
  CendreBlancheService,
  PapierFroisseService,
  GuiltySparkService,
  CleTotemService,
  UpsideModeService,

  // === Constantes des protocoles ===
  ISOLATION_STATUS,
  ACTIVATION_CONDITIONS,
  LOCKDOWN_LEVELS,
  TRIGGER_REASONS,
  TOTEM_TYPES,
  TOTEM_ACTIONS,
  DEGRADATION_LEVELS,
  DEGRADABLE_SERVICES,
  LEVEL_CAPABILITIES
};
