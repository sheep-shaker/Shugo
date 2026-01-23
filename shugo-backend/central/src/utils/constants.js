'use strict';

/**
 * SHUGO v7.0 - Constantes globales
 *
 * Définitions centralisées des constantes système.
 *
 * @see Document Technique V7.0
 */

// ============================================
// RÔLES ET HIÉRARCHIE
// ============================================

/**
 * Rôles utilisateurs
 */
const ROLES = {
  SILVER: 'Silver',
  GOLD: 'Gold',
  PLATINUM: 'Platinum',
  ADMIN: 'Admin',
  ADMIN_N1: 'Admin_N1'
};

/**
 * Hiérarchie des rôles (niveau numérique)
 */
const ROLE_HIERARCHY = {
  [ROLES.SILVER]: 1,
  [ROLES.GOLD]: 2,
  [ROLES.PLATINUM]: 3,
  [ROLES.ADMIN]: 4,
  [ROLES.ADMIN_N1]: 5
};

/**
 * Permissions par rôle
 */
const ROLE_PERMISSIONS = {
  [ROLES.SILVER]: [
    'guard.view',
    'guard.enroll',
    'guard.cancel_self',
    'notification.view',
    'message.view',
    'profile.edit'
  ],
  [ROLES.GOLD]: [
    'guard.view',
    'guard.enroll',
    'guard.cancel_self',
    'guard.cancel_other',
    'notification.view',
    'message.view',
    'message.send_local',
    'profile.edit',
    'user.view_local'
  ],
  [ROLES.PLATINUM]: [
    'guard.view',
    'guard.enroll',
    'guard.cancel_self',
    'guard.cancel_other',
    'guard.create',
    'guard.edit',
    'notification.view',
    'notification.send_local',
    'message.view',
    'message.send_local',
    'message.send_regional',
    'profile.edit',
    'user.view_local',
    'user.edit_local',
    'scenario.view',
    'scenario.apply'
  ],
  [ROLES.ADMIN]: [
    '*' // Toutes les permissions sur le périmètre
  ],
  [ROLES.ADMIN_N1]: [
    '*' // Super admin global
  ]
};

// ============================================
// STATUTS
// ============================================

/**
 * Statuts utilisateur
 */
const USER_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
  DELETED: 'deleted',
  PENDING_2FA: 'pending_2fa',
  BLOCKED: 'blocked'
};

/**
 * Statuts de garde
 */
const GUARD_STATUS = {
  OPEN: 'open',
  FULL: 'full',
  CLOSED: 'closed',
  CANCELLED: 'cancelled'
};

/**
 * Statuts d'inscription
 */
const ENROLLMENT_STATUS = {
  CONFIRMED: 'confirmed',
  PENDING: 'pending',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show'
};

/**
 * Statuts de ticket support
 */
const SUPPORT_STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  WAITING_USER: 'waiting_user',
  RESOLVED: 'resolved',
  CLOSED: 'closed'
};

/**
 * Statuts de session
 */
const SESSION_STATUS = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  REVOKED: 'revoked'
};

// ============================================
// TYPES
// ============================================

/**
 * Types de garde
 */
const GUARD_TYPES = {
  STANDARD: 'standard',
  PREPARATION: 'preparation',
  CLOSURE: 'closure',
  SPECIAL: 'special',
  MAINTENANCE: 'maintenance'
};

/**
 * Types de notification
 */
const NOTIFICATION_TYPES = {
  // Gardes
  GUARD_REMINDER: 'guard_reminder',
  GUARD_CREATED: 'guard_created',
  GUARD_CANCELLED: 'guard_cancelled',
  GUARD_UPDATED: 'guard_updated',
  GUARD_ENROLLMENT: 'guard_enrollment',
  GUARD_CONFIRMATION: 'guard_confirmation',

  // Utilisateurs
  USER_WELCOME: 'user_welcome',
  USER_SUSPENDED: 'user_suspended',
  USER_REACTIVATED: 'user_reactivated',

  // Missions
  MISSION_GRANTED: 'mission_granted',
  MISSION_REVOKED: 'mission_revoked',
  MISSION_EXPIRING: 'mission_expiring',
  MISSION_PENDING: 'mission_pending',
  MISSION_APPROVED: 'mission_approved',

  // Système
  SYSTEM_ALERT: 'system_alert',
  SYSTEM_MAINTENANCE: 'system_maintenance',
  SECURITY_ALERT: 'security_alert',

  // Support
  SUPPORT_REPLY: 'support_reply',
  SUPPORT_RESOLVED: 'support_resolved'
};

/**
 * Canaux de notification
 */
const NOTIFICATION_CHANNELS = {
  EMAIL: 'email',
  MATRIX: 'matrix',
  BOTH: 'both',
  SMS: 'sms',
  PUSH: 'push'
};

/**
 * Types de protocoles système
 */
const PROTOCOL_TYPES = {
  SYS_INT_001: 'SYS-INT-001',
  SYS_INT_002: 'SYS-INT-002',
  SYS_INT_003: 'SYS-INT-003',
  GUILTY_SPARK: 'guilty_spark',
  CENDRE_BLANCHE: 'cendre_blanche',
  PAPIER_FROISSE: 'papier_froisse',
  PORTE_DE_GRANGE: 'porte_de_grange',
  UPSIDE_MODE: 'upside_mode',
  CLE_TOTEM: 'cle_totem'
};

/**
 * Types de log d'audit
 */
const AUDIT_TYPES = {
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_FAILED: 'auth.failed',
  AUTH_2FA: 'auth.2fa',

  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_DELETE: 'user.delete',
  USER_SUSPEND: 'user.suspend',

  GUARD_CREATE: 'guard.create',
  GUARD_UPDATE: 'guard.update',
  GUARD_DELETE: 'guard.delete',
  GUARD_ENROLL: 'guard.enroll',
  GUARD_CANCEL: 'guard.cancel',

  MISSION_CREATE: 'mission.create',
  MISSION_UPDATE: 'mission.update',
  MISSION_REVOKE: 'mission.revoke',
  MISSION_APPROVE: 'mission.approve',

  PROTOCOL_ACTIVATE: 'protocol.activate',
  PROTOCOL_DEACTIVATE: 'protocol.deactivate',

  VAULT_ACCESS: 'vault.access',
  VAULT_MODIFY: 'vault.modify',

  BACKUP_CREATE: 'backup.create',
  BACKUP_RESTORE: 'backup.restore',

  ADMIN_ACTION: 'admin.action'
};

// ============================================
// CODES ERREUR
// ============================================

/**
 * Codes d'erreur SHUGO
 */
const ERROR_CODES = {
  // Authentification (1xxx)
  AUTH_INVALID_CREDENTIALS: 'SHUGO-1001',
  AUTH_TOKEN_EXPIRED: 'SHUGO-1002',
  AUTH_TOKEN_INVALID: 'SHUGO-1003',
  AUTH_2FA_REQUIRED: 'SHUGO-1004',
  AUTH_2FA_INVALID: 'SHUGO-1005',
  AUTH_ACCOUNT_LOCKED: 'SHUGO-1006',
  AUTH_ACCOUNT_SUSPENDED: 'SHUGO-1007',
  AUTH_SESSION_EXPIRED: 'SHUGO-1008',

  // Autorisation (2xxx)
  AUTHZ_FORBIDDEN: 'SHUGO-2001',
  AUTHZ_INSUFFICIENT_ROLE: 'SHUGO-2002',
  AUTHZ_SCOPE_VIOLATION: 'SHUGO-2003',
  AUTHZ_MISSION_REQUIRED: 'SHUGO-2004',

  // Validation (3xxx)
  VALIDATION_FAILED: 'SHUGO-3001',
  VALIDATION_MISSING_FIELD: 'SHUGO-3002',
  VALIDATION_INVALID_FORMAT: 'SHUGO-3003',

  // Ressources (4xxx)
  RESOURCE_NOT_FOUND: 'SHUGO-4001',
  RESOURCE_ALREADY_EXISTS: 'SHUGO-4002',
  RESOURCE_CONFLICT: 'SHUGO-4003',

  // Gardes (5xxx)
  GUARD_NOT_FOUND: 'SHUGO-5001',
  GUARD_FULL: 'SHUGO-5002',
  GUARD_CLOSED: 'SHUGO-5003',
  GUARD_ALREADY_ENROLLED: 'SHUGO-5004',
  GUARD_NOT_ENROLLED: 'SHUGO-5005',
  GUARD_PAST_DATE: 'SHUGO-5006',

  // Utilisateurs (6xxx)
  USER_NOT_FOUND: 'SHUGO-6001',
  USER_ALREADY_EXISTS: 'SHUGO-6002',
  USER_SUSPENDED: 'SHUGO-6003',
  USER_DELETED: 'SHUGO-6004',

  // Protocoles (7xxx)
  PROTOCOL_ALREADY_ACTIVE: 'SHUGO-7001',
  PROTOCOL_NOT_ACTIVE: 'SHUGO-7002',
  PROTOCOL_FORBIDDEN: 'SHUGO-7003',

  // Système (8xxx)
  SYSTEM_ERROR: 'SHUGO-8001',
  SYSTEM_MAINTENANCE: 'SHUGO-8002',
  SYSTEM_OVERLOAD: 'SHUGO-8003',
  SYSTEM_DATABASE_ERROR: 'SHUGO-8004',

  // Sécurité (9xxx)
  SECURITY_BREACH_DETECTED: 'SHUGO-9001',
  SECURITY_RATE_LIMITED: 'SHUGO-9002',
  SECURITY_IP_BLOCKED: 'SHUGO-9003',
  SECURITY_VAULT_LOCKED: 'SHUGO-9004'
};

// ============================================
// GÉOGRAPHIE
// ============================================

/**
 * Codes continents
 */
const CONTINENT_CODES = {
  '01': 'Asie & Océanie',
  '02': 'Europe',
  '03': 'Afrique',
  '04': 'Amérique du Nord',
  '05': 'Amérique du Sud',
  '06': 'Russie'
};

/**
 * Langues supportées
 */
const SUPPORTED_LANGUAGES = ['fr', 'en', 'it', 'es', 'pt'];

/**
 * Langue par défaut
 */
const DEFAULT_LANGUAGE = 'fr';

// ============================================
// LIMITES ET SEUILS
// ============================================

/**
 * Limites système
 */
const LIMITS = {
  // Pagination
  MAX_PAGE_SIZE: 100,
  DEFAULT_PAGE_SIZE: 20,

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: 100,
  RATE_LIMIT_AUTH_MAX: 5,

  // Sessions
  SESSION_DURATION_HOURS: 24,
  REFRESH_TOKEN_DURATION_DAYS: 30,
  MAX_ACTIVE_SESSIONS: 5,

  // Sécurité
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION_MINUTES: 30,
  PASSWORD_MIN_LENGTH: 12,

  // Fichiers
  MAX_FILE_SIZE_MB: 10,
  MAX_UPLOAD_FILES: 5,

  // Contenu
  MAX_MESSAGE_LENGTH: 10000,
  MAX_NOTE_LENGTH: 500,
  MAX_SEARCH_QUERY: 100
};

/**
 * Durées de rétention (jours)
 */
const RETENTION_DAYS = {
  AUDIT_LOGS: 365,
  SYSTEM_LOGS: 90,
  SESSIONS: 30,
  NOTIFICATIONS: 90,
  MESSAGES: 365,
  BACKUPS_DAILY: 30,
  BACKUPS_WEEKLY: 90,
  DELETED_USERS: 180
};

// ============================================
// EXPRESSIONS RÉGULIÈRES
// ============================================

/**
 * Patterns de validation
 */
const REGEX = {
  MEMBER_ID: /^\d{10}$/,
  GEO_ID: /^\d{2}-\d{1,3}-\d{2}-\d{2}-\d{2}$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE: /^\+?[\d\s-]{8,20}$/,
  PASSWORD_STRONG: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{12,}$/,
  CODE_2FA: /^\d{6}$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  DATE: /^\d{4}-\d{2}-\d{2}$/,
  TIME: /^([01]\d|2[0-3]):([0-5]\d)$/
};

// ============================================
// HTTP
// ============================================

/**
 * Codes HTTP courants
 */
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
};

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Rôles
  ROLES,
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,

  // Statuts
  USER_STATUS,
  GUARD_STATUS,
  ENROLLMENT_STATUS,
  SUPPORT_STATUS,
  SESSION_STATUS,

  // Types
  GUARD_TYPES,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  PROTOCOL_TYPES,
  AUDIT_TYPES,

  // Erreurs
  ERROR_CODES,

  // Géographie
  CONTINENT_CODES,
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,

  // Limites
  LIMITS,
  RETENTION_DAYS,

  // Validation
  REGEX,

  // HTTP
  HTTP_STATUS
};
