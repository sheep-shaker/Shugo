'use strict';

/**
 * SHUGO v7.0 - Schémas de validation
 *
 * Validation des entrées API avec Joi.
 *
 * @see Document Technique V7.0 - Section sécurité
 */

const Joi = require('joi');

// ============================================
// PATTERNS REGEX
// ============================================

const PATTERNS = {
  // member_id: 10 chiffres
  MEMBER_ID: /^\d{10}$/,

  // geo_id: CC-PPP-ZZ-JJ-NN
  GEO_ID: /^\d{2}-\d{1,3}-\d{2}-\d{2}-\d{2}$/,

  // Mot de passe fort: 12+ caractères, majuscule, minuscule, chiffre, spécial
  PASSWORD_STRONG: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{12,}$/,

  // Email
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,

  // Téléphone (format international)
  PHONE: /^\+?[\d\s-]{8,20}$/,

  // Code 2FA (6 chiffres)
  CODE_2FA: /^\d{6}$/,

  // Token JWT
  JWT: /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/,

  // UUID v4
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,

  // Heure HH:mm
  TIME: /^([01]\d|2[0-3]):([0-5]\d)$/,

  // Date YYYY-MM-DD
  DATE: /^\d{4}-\d{2}-\d{2}$/
};

// ============================================
// SCHÉMAS DE BASE
// ============================================

const baseSchemas = {
  // Identifiants
  memberId: Joi.string().pattern(PATTERNS.MEMBER_ID).required(),
  memberIdOptional: Joi.string().pattern(PATTERNS.MEMBER_ID),
  geoId: Joi.string().pattern(PATTERNS.GEO_ID).required(),
  geoIdOptional: Joi.string().pattern(PATTERNS.GEO_ID),
  uuid: Joi.string().pattern(PATTERNS.UUID),

  // Authentification
  email: Joi.string().email().max(255).lowercase().trim(),
  password: Joi.string().min(12).max(128),
  passwordStrong: Joi.string().pattern(PATTERNS.PASSWORD_STRONG)
    .message('Le mot de passe doit contenir au moins 12 caractères, une majuscule, une minuscule, un chiffre et un caractère spécial'),
  code2FA: Joi.string().pattern(PATTERNS.CODE_2FA),
  token: Joi.string().pattern(PATTERNS.JWT),

  // Données personnelles
  firstName: Joi.string().min(2).max(100).trim(),
  lastName: Joi.string().min(2).max(100).trim(),
  phone: Joi.string().pattern(PATTERNS.PHONE),

  // Date/Heure
  date: Joi.date().iso(),
  dateString: Joi.string().pattern(PATTERNS.DATE),
  time: Joi.string().pattern(PATTERNS.TIME),

  // Pagination
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0),

  // Tri
  sortBy: Joi.string().max(50),
  sortOrder: Joi.string().valid('asc', 'desc', 'ASC', 'DESC').default('asc')
};

// ============================================
// SCHÉMAS AUTHENTIFICATION
// ============================================

const authSchemas = {
  // Login
  login: Joi.object({
    email: baseSchemas.email.required(),
    password: Joi.string().required(),
    code_2fa: baseSchemas.code2FA,
    remember_me: Joi.boolean().default(false)
  }),

  // Inscription
  register: Joi.object({
    email: baseSchemas.email.required(),
    password: baseSchemas.passwordStrong.required(),
    password_confirm: Joi.string().valid(Joi.ref('password')).required()
      .messages({ 'any.only': 'Les mots de passe ne correspondent pas' }),
    first_name: baseSchemas.firstName.required(),
    last_name: baseSchemas.lastName.required(),
    phone: baseSchemas.phone,
    geo_id: baseSchemas.geoId,
    invitation_token: Joi.string()
  }),

  // Changement de mot de passe
  changePassword: Joi.object({
    current_password: Joi.string().required(),
    new_password: baseSchemas.passwordStrong.required(),
    new_password_confirm: Joi.string().valid(Joi.ref('new_password')).required()
  }),

  // Reset de mot de passe
  resetPassword: Joi.object({
    token: Joi.string().required(),
    password: baseSchemas.passwordStrong.required(),
    password_confirm: Joi.string().valid(Joi.ref('password')).required()
  }),

  // Configuration 2FA
  setup2FA: Joi.object({
    method: Joi.string().valid('totp', 'email', 'sms').required()
  }),

  verify2FA: Joi.object({
    code: baseSchemas.code2FA.required()
  })
};

// ============================================
// SCHÉMAS UTILISATEURS
// ============================================

const userSchemas = {
  // Création utilisateur
  create: Joi.object({
    email: baseSchemas.email.required(),
    first_name: baseSchemas.firstName.required(),
    last_name: baseSchemas.lastName.required(),
    phone: baseSchemas.phone,
    geo_id: baseSchemas.geoId,
    role: Joi.string().valid('Silver', 'Gold', 'Platinum', 'Admin', 'Admin_N1').default('Silver'),
    notification_channel: Joi.string().valid('email', 'matrix', 'both').default('email'),
    language: Joi.string().valid('fr', 'en', 'it', 'es', 'pt').default('fr')
  }),

  // Mise à jour utilisateur
  update: Joi.object({
    first_name: baseSchemas.firstName,
    last_name: baseSchemas.lastName,
    phone: baseSchemas.phone,
    notification_channel: Joi.string().valid('email', 'matrix', 'both'),
    language: Joi.string().valid('fr', 'en', 'it', 'es', 'pt')
  }),

  // Recherche utilisateurs
  search: Joi.object({
    query: Joi.string().min(2).max(100),
    geo_id: baseSchemas.geoIdOptional,
    role: Joi.string().valid('Silver', 'Gold', 'Platinum', 'Admin', 'Admin_N1'),
    status: Joi.string().valid('active', 'inactive', 'suspended', 'deleted'),
    page: baseSchemas.page,
    limit: baseSchemas.limit
  })
};

// ============================================
// SCHÉMAS GARDES
// ============================================

const guardSchemas = {
  // Création garde
  create: Joi.object({
    guard_date: baseSchemas.date.required(),
    start_time: baseSchemas.time.required(),
    end_time: baseSchemas.time.required(),
    guard_type: Joi.string().valid('standard', 'preparation', 'closure', 'special', 'maintenance').default('standard'),
    location_id: Joi.number().integer().positive(),
    min_participants: Joi.number().integer().min(1).default(2),
    max_participants: Joi.number().integer().min(1).default(4),
    required_role: Joi.string().valid('Silver', 'Gold', 'Platinum'),
    notes: Joi.string().max(500)
  }),

  // Inscription à une garde
  enroll: Joi.object({
    guard_id: Joi.number().integer().positive().required(),
    notes: Joi.string().max(200)
  }),

  // Annulation inscription
  cancel: Joi.object({
    guard_id: Joi.number().integer().positive().required(),
    reason: Joi.string().max(500)
  }),

  // Recherche gardes
  search: Joi.object({
    from_date: baseSchemas.date,
    to_date: baseSchemas.date,
    geo_id: baseSchemas.geoIdOptional,
    guard_type: Joi.string().valid('standard', 'preparation', 'closure', 'special', 'maintenance'),
    status: Joi.string().valid('open', 'full', 'closed', 'cancelled'),
    available_only: Joi.boolean().default(false),
    page: baseSchemas.page,
    limit: baseSchemas.limit
  })
};

// ============================================
// SCHÉMAS NOTIFICATIONS
// ============================================

const notificationSchemas = {
  // Création notification
  create: Joi.object({
    user_id: baseSchemas.memberId,
    type: Joi.string().required().max(50),
    title: Joi.string().required().max(200),
    message: Joi.string().required().max(2000),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent').default('medium'),
    channel: Joi.string().valid('email', 'matrix', 'both', 'push'),
    data: Joi.object()
  }),

  // Liste notifications
  list: Joi.object({
    unread_only: Joi.boolean().default(false),
    type: Joi.string().max(50),
    from_date: baseSchemas.date,
    page: baseSchemas.page,
    limit: baseSchemas.limit
  })
};

// ============================================
// SCHÉMAS MESSAGES
// ============================================

const messageSchemas = {
  // Envoi message
  send: Joi.object({
    scope_type: Joi.string().valid('global', 'regional', 'local', 'group', 'individual').required(),
    scope_id: Joi.string(),
    title: Joi.string().required().max(200),
    content: Joi.string().required().max(10000),
    priority: Joi.string().valid('normal', 'important', 'urgent').default('normal'),
    requires_acknowledgment: Joi.boolean().default(false)
  })
};

// ============================================
// SCHÉMAS MISSIONS
// ============================================

const missionSchemas = {
  // Création mission
  create: Joi.object({
    member_id: baseSchemas.memberId,
    mission_type: Joi.string().required().max(50),
    scope_type: Joi.string().valid('global', 'regional', 'local', 'group').required(),
    scope_geo_id: baseSchemas.geoIdOptional,
    scope_group_id: Joi.number().integer().positive(),
    privileges_granted: Joi.object({
      roles: Joi.array().items(Joi.string()),
      permissions: Joi.array().items(Joi.string())
    }).required(),
    valid_from: baseSchemas.date,
    valid_until: baseSchemas.date,
    requires_validation: Joi.boolean().default(true)
  }),

  // Validation mission
  validate: Joi.object({
    mission_id: Joi.number().integer().positive().required(),
    approved: Joi.boolean().required(),
    validation_notes: Joi.string().max(500)
  })
};

// ============================================
// SCHÉMAS SUPPORT
// ============================================

const supportSchemas = {
  // Création ticket
  create: Joi.object({
    category: Joi.string().valid('technical', 'account', 'planning', 'other').required(),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent').default('medium'),
    subject: Joi.string().required().max(200),
    description: Joi.string().required().max(5000)
  }),

  // Réponse ticket
  reply: Joi.object({
    ticket_id: Joi.number().integer().positive().required(),
    message: Joi.string().required().max(5000)
  })
};

// ============================================
// SCHÉMAS PROTOCOLES
// ============================================

const protocolSchemas = {
  // Guilty Spark
  guiltySpark: Joi.object({
    action: Joi.string().valid('partial', 'full', 'emergency').required(),
    target_geo_id: baseSchemas.geoIdOptional,
    reason: Joi.string().required().max(500)
  }),

  // Cendre Blanche
  cendreBlanche: Joi.object({
    member_id: baseSchemas.memberId,
    reason: Joi.string().required().max(500),
    confirmation_code: Joi.string().required()
  }),

  // Papier Froissé
  papierFroisse: Joi.object({
    member_id: baseSchemas.memberId,
    reason: Joi.string().required().max(500)
  })
};

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

/**
 * Valide des données avec un schéma
 * @param {Object} data
 * @param {Joi.Schema} schema
 * @returns {Object} { value, error }
 */
function validate(data, schema) {
  return schema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
    convert: true
  });
}

/**
 * Crée un middleware Express de validation
 * @param {Joi.Schema} schema
 * @param {string} source - 'body', 'query', 'params'
 * @returns {Function}
 */
function validateMiddleware(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = validate(req[source], schema);

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Données invalides',
        details: error.details.map(d => ({
          field: d.path.join('.'),
          message: d.message
        }))
      });
    }

    req[source] = value;
    next();
  };
}

/**
 * Formate les erreurs Joi
 * @param {Joi.ValidationError} error
 * @returns {Array}
 */
function formatErrors(error) {
  if (!error || !error.details) return [];

  return error.details.map(detail => ({
    field: detail.path.join('.'),
    message: detail.message,
    type: detail.type
  }));
}

module.exports = {
  // Patterns
  PATTERNS,

  // Schémas de base
  base: baseSchemas,

  // Schémas par domaine
  auth: authSchemas,
  user: userSchemas,
  guard: guardSchemas,
  notification: notificationSchemas,
  message: messageSchemas,
  mission: missionSchemas,
  support: supportSchemas,
  protocol: protocolSchemas,

  // Fonctions
  validate,
  validateMiddleware,
  formatErrors,

  // Joi direct access
  Joi
};
