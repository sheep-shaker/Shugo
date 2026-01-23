/**
 * SHUGO v7.0 - Index des Modèles
 * 
 * Export centralisé de tous les modèles Sequelize.
 * Définit les associations entre les modèles.
 * 
 * Ce fichier doit être complété avec les modèles existants lors de l'intégration.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');

const basename = path.basename(__filename);
const db = {};

/**
 * Initialise tous les modèles avec une instance Sequelize
 * @param {Sequelize} sequelize - Instance Sequelize configurée
 * @returns {Object} Objet contenant tous les modèles
 */
function initializeModels(sequelize) {
  // Charger tous les fichiers de modèles
  fs
    .readdirSync(__dirname)
    .filter(file => {
      return (
        file.indexOf('.') !== 0 &&
        file !== basename &&
        file.slice(-3) === '.js'
      );
    })
    .forEach(file => {
      const model = require(path.join(__dirname, file))(sequelize);
      db[model.name] = model;
    });

  // Définir les associations
  Object.keys(db).forEach(modelName => {
    if (db[modelName].associate) {
      db[modelName].associate(db);
    }
  });

  db.sequelize = sequelize;
  db.Sequelize = Sequelize;

  return db;
}

/**
 * Liste des nouveaux modèles créés :
 *
 * === SESSION PRÉCÉDENTE (14+1 modèles) ===
 * 1.  GuardScenario       - Scénarios et semaines-types pour les gardes
 * 2.  UserMission         - Missions temporaires/permanentes attribuées aux utilisateurs
 * 3.  MessagesCenter      - Centre de messages hiérarchisé
 * 4.  MessageReadStatus   - Statut de lecture des messages
 * 5.  SupportRequest      - Demandes de support utilisateur
 * 6.  MaintenanceRun      - Historique des maintenances nocturnes
 * 7.  HealthCheck         - Résultats des contrôles de santé système
 * 8.  SystemMetric        - Métriques système (CPU, RAM, disque)
 * 9.  ErrorCodeRegistry   - Registre des codes d'erreur SHUGO-*
 * 10. ErrorOccurrence     - Occurrences des erreurs
 * 11. BackupJob           - Jobs de sauvegarde
 * 12. BackupFile          - Fichiers de backup individuels
 * 13. RestoreOperation    - Opérations de restauration
 * 14. PluginRegistry      - Registre des plugins installés
 * 15. PluginConfiguration - Configuration des plugins (bonus)
 *
 * === SESSION ACTUELLE (6 nouveaux modèles) ===
 * 16. GuardSlot           - Créneaux de garde avec affectations
 * 17. UserSkill           - Compétences et certifications des utilisateurs
 * 18. UserAvailability    - Disponibilités temporelles des utilisateurs
 * 19. LocalSyncQueue      - Queue de synchronisation multi-sites
 * 20. PluginConfig        - Configuration dynamique des plugins
 * 21. PluginEvent         - Événements et hooks des plugins
 */

/**
 * Associations principales entre les modèles (à compléter avec les modèles existants)
 *
 * === GARDES ET PLANNING ===
 * Guard.belongsTo(GuardScenario, { foreignKey: 'scenario_id' })
 * GuardScenario.hasMany(Guard, { foreignKey: 'scenario_id' })
 * GuardScenario.belongsTo(User, { foreignKey: 'created_by_member_id' })
 * GuardScenario.hasMany(GuardSlot, { foreignKey: 'scenario_id' })
 *
 * GuardSlot.belongsTo(GuardScenario, { foreignKey: 'scenario_id' })
 * GuardSlot.belongsTo(User, { as: 'PrimaryMember', foreignKey: 'assigned_member_id' })
 * GuardSlot.belongsTo(User, { as: 'BackupMember', foreignKey: 'backup_member_id' })
 * GuardSlot.belongsTo(User, { as: 'Validator', foreignKey: 'validated_by_member_id' })
 * User.hasMany(GuardSlot, { as: 'PrimarySlots', foreignKey: 'assigned_member_id' })
 * User.hasMany(GuardSlot, { as: 'BackupSlots', foreignKey: 'backup_member_id' })
 *
 * === MISSIONS ===
 * UserMission.belongsTo(User, { foreignKey: 'member_id' })
 * UserMission.belongsTo(User, { foreignKey: 'created_by_member_id' })
 * UserMission.belongsTo(User, { foreignKey: 'revoked_by_member_id' })
 * UserMission.belongsTo(Group, { foreignKey: 'scope_group_id' })
 * User.hasMany(UserMission, { foreignKey: 'member_id' })
 *
 * === COMPÉTENCES ET DISPONIBILITÉS ===
 * UserSkill.belongsTo(User, { foreignKey: 'member_id' })
 * UserSkill.belongsTo(User, { as: 'Certifier', foreignKey: 'certified_by_member_id' })
 * User.hasMany(UserSkill, { foreignKey: 'member_id' })
 *
 * UserAvailability.belongsTo(User, { foreignKey: 'member_id' })
 * User.hasMany(UserAvailability, { foreignKey: 'member_id' })
 *
 * === MESSAGES ===
 * MessagesCenter.belongsTo(User, { foreignKey: 'sender_member_id' })
 * MessagesCenter.hasMany(MessageReadStatus, { foreignKey: 'message_id' })
 * MessageReadStatus.belongsTo(MessagesCenter, { foreignKey: 'message_id' })
 * MessageReadStatus.belongsTo(User, { foreignKey: 'member_id' })
 *
 * === SUPPORT ===
 * SupportRequest.belongsTo(User, { foreignKey: 'requester_member_id' })
 * SupportRequest.belongsTo(User, { foreignKey: 'assigned_to_member_id' })
 *
 * === ERREURS ===
 * ErrorOccurrence.belongsTo(ErrorCodeRegistry, { foreignKey: 'error_code' })
 * ErrorOccurrence.belongsTo(User, { foreignKey: 'member_id' })
 * ErrorCodeRegistry.hasMany(ErrorOccurrence, { foreignKey: 'error_code' })
 *
 * === BACKUP ===
 * BackupJob.hasMany(BackupFile, { foreignKey: 'job_id' })
 * BackupJob.belongsTo(AesKeyRotation, { foreignKey: 'encryption_key_id' })
 * BackupFile.belongsTo(BackupJob, { foreignKey: 'job_id' })
 * RestoreOperation.belongsTo(BackupJob, { foreignKey: 'source_backup_job_id' })
 * RestoreOperation.belongsTo(User, { foreignKey: 'requested_by_member_id' })
 * RestoreOperation.belongsTo(User, { foreignKey: 'approved_by_member_id' })
 *
 * === PLUGINS ===
 * PluginRegistry.hasMany(PluginConfiguration, { foreignKey: 'plugin_id' })
 * PluginConfiguration.belongsTo(PluginRegistry, { foreignKey: 'plugin_id' })
 * PluginConfiguration.belongsTo(User, { foreignKey: 'configured_by_member_id' })
 *
 * PluginRegistry.hasMany(PluginConfig, { foreignKey: 'plugin_id' })
 * PluginConfig.belongsTo(PluginRegistry, { foreignKey: 'plugin_id' })
 * PluginConfig.belongsTo(User, { foreignKey: 'configured_by_member_id' })
 *
 * PluginRegistry.hasMany(PluginEvent, { foreignKey: 'plugin_id' })
 * PluginEvent.belongsTo(PluginRegistry, { foreignKey: 'plugin_id' })
 *
 * === SYNCHRONISATION MULTI-SITES ===
 * LocalSyncQueue.belongsTo(User, { foreignKey: 'member_id' })
 *
 * === SÉCURITÉ ET CRYPTOGRAPHIE (SESSION 3) ===
 * 22. AesKeyRotation       - Rotation des clés AES-256-GCM
 * 23. SharedSecret         - Secrets partagés central/local
 * 24. EmergencyCode        - Tableau de secours (100 codes)
 * 25. VaultItem            - Éléments stockés dans le Vault
 * 26. SecurityProtocolLog  - Logs des protocoles de sécurité
 * 27. WaitingList          - Liste d'attente J-3 pour les gardes
 *
 * === ASSOCIATIONS SÉCURITÉ ===
 * AesKeyRotation.belongsTo(AesKeyRotation, { as: 'PreviousKey', foreignKey: 'previous_key_id' })
 * AesKeyRotation.belongsTo(User, { as: 'RotatedByUser', foreignKey: 'rotated_by' })
 * AesKeyRotation.hasMany(BackupJob, { foreignKey: 'encryption_key_id' })
 * AesKeyRotation.hasMany(VaultItem, { foreignKey: 'encryption_key_id' })
 *
 * SharedSecret.belongsTo(AesKeyRotation, { foreignKey: 'encryption_key_id' })
 * SharedSecret.belongsTo(User, { as: 'RotatedByUser', foreignKey: 'rotated_by' })
 * SharedSecret.belongsTo(LocalInstance, { foreignKey: 'local_server_id' })
 *
 * VaultItem.belongsTo(AesKeyRotation, { foreignKey: 'encryption_key_id' })
 * VaultItem.belongsTo(User, { as: 'Creator', foreignKey: 'created_by' })
 * VaultItem.belongsTo(User, { as: 'LastAccessedByUser', foreignKey: 'last_accessed_by' })
 * VaultItem.belongsTo(LocalInstance, { foreignKey: 'local_server_id' })
 *
 * EmergencyCode.belongsTo(User, { as: 'UsedByUser', foreignKey: 'used_by_member_id' })
 *
 * SecurityProtocolLog.belongsTo(User, { as: 'InitiatedByUser', foreignKey: 'member_id' })
 * SecurityProtocolLog.belongsTo(User, { as: 'AcknowledgedByUser', foreignKey: 'acknowledged_by' })
 * SecurityProtocolLog.belongsTo(LocalInstance, { foreignKey: 'local_server_id' })
 *
 * WaitingList.belongsTo(Guard, { foreignKey: 'guard_id' })
 * WaitingList.belongsTo(User, { foreignKey: 'member_id' })
 */

module.exports = initializeModels;
module.exports.initializeModels = initializeModels;
