// middleware/permissions.js (suite)

// Middlewares pré-configurés (suite)
const permissions = {
  // Users
  viewUsers: requirePermissions('user.view'),
  createUser: requirePermissions('user.create'),
  updateUser: requirePermissions('user.update'),
  deleteUser: requirePermissions('user.delete'),
  
  // Guards
  viewGuards: requirePermissions('guard.view'),
  createGuard: requirePermissions('guard.create'),
  assignGuard: requirePermissions('guard.assign'),
  manageGuards: requirePermissions('guard.manage'),
  
  // Missions
  viewMissions: requirePermissions('mission.view'),
  createMission: requirePermissions('mission.create'),
  assignMission: requirePermissions('mission.assign'),
  revokeMission: requirePermissions('mission.revoke'),
  
  // Vault
  accessVault: requirePermissions('vault.access'),
  decryptVault: requirePermissions('vault.decrypt'),
  
  // System
  systemBackup: requirePermissions('system.backup'),
  systemRestore: requirePermissions('system.restore'),
  
  // Admin
  adminOnly: requireRole(['admin', 'super_admin']),
  superAdminOnly: requireRole('super_admin'),
  coordinatorUp: requireRole(['coordinator', 'admin', 'super_admin'])
};

// Export
module.exports = {
  // Fonction principale
  requirePermissions,
  require: requirePermissions, // Alias
  
  // Middlewares spécialisés
  requireDynamicPermission,
  requireRole,
  requirePermissionInScope,
  conditionalPermission,
  
  // Middlewares pré-configurés
  ...permissions,
  
  // Utilitaires
  checkUserPermission,
  grantTemporaryPermission,
  getUserPermissions,
  
  // Constantes
  PERMISSIONS,
  ROLE_PERMISSIONS
};
