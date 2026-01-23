// src/middleware/validation.js
// Middleware de validation des données avec express-validator

const { validationResult, body, param, query } = require('express-validator');
const logger = require('../utils/logger');

/**
 * Handle validation errors
 */
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
        logger.warn('Validation failed', {
            path: req.path,
            errors: errors.array(),
            user: req.user?.member_id || null
        });
        
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors.array().map(err => ({
                field: err.path || err.param,
                message: err.msg,
                value: err.value
            }))
        });
    }
    
    next();
};

/**
 * Common validation rules
 */
const commonValidations = {
    // Email validation
    email: () => 
        body('email')
            .isEmail()
            .normalizeEmail()
            .withMessage('Please provide a valid email'),
    
    // Password validation
    password: () => 
        body('password')
            .isLength({ min: 8 })
            .withMessage('Password must be at least 8 characters long')
            .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
            .withMessage('Password must contain uppercase, lowercase, number and special character'),
    
    // Member ID validation
    memberId: (field = 'member_id') => 
        body(field)
            .isInt({ min: 1, max: 9999999999 })
            .withMessage('Invalid member ID'),
    
    // UUID validation
    uuid: (field) => 
        param(field)
            .isUUID()
            .withMessage(`Invalid UUID for ${field}`),
    
    // Geo ID validation
    geoId: (field = 'geo_id') => 
        body(field)
            .matches(/^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/)
            .withMessage('Invalid geo ID format (XX-XXX-XX-XX-XX)'),
    
    // Role validation
    role: () => 
        body('role')
            .isIn(['Silver', 'Gold', 'Platinum', 'Admin', 'Admin_N1'])
            .withMessage('Invalid role'),
    
    // Date validation
    date: (field) => 
        body(field)
            .isISO8601()
            .toDate()
            .withMessage(`Invalid date format for ${field}`),
    
    // Time validation
    time: (field) => 
        body(field)
            .matches(/^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/)
            .withMessage(`Invalid time format for ${field} (HH:MM or HH:MM:SS)`),
    
    // Phone validation
    phone: () => 
        body('phone')
            .optional()
            .isMobilePhone()
            .withMessage('Invalid phone number'),
    
    // Pagination validation
    pagination: () => [
        query('page')
            .optional()
            .isInt({ min: 1 })
            .withMessage('Page must be a positive integer'),
        query('limit')
            .optional()
            .isInt({ min: 1, max: 100 })
            .withMessage('Limit must be between 1 and 100')
    ],
    
    // Status validation
    status: (allowedValues) => 
        body('status')
            .isIn(allowedValues)
            .withMessage(`Status must be one of: ${allowedValues.join(', ')}`),
    
    // Language validation
    language: () => 
        body('language')
            .isIn(['fr', 'en', 'it', 'es', 'pt'])
            .withMessage('Invalid language code'),
    
    // TOTP token validation
    totpToken: () => 
        body('totp_token')
            .isLength({ min: 6, max: 6 })
            .isNumeric()
            .withMessage('TOTP token must be 6 digits'),
    
    // Strong text validation (no XSS)
    safeText: (field, maxLength = 1000) => 
        body(field)
            .trim()
            .isLength({ min: 1, max: maxLength })
            .withMessage(`${field} must be between 1 and ${maxLength} characters`)
            .escape(),
    
    // URL validation
    url: (field) =>
        body(field)
            .optional()
            .isURL()
            .withMessage(`Invalid URL for ${field}`),

    // Matrix ID validation (@user:server.com)
    matrixId: () =>
        body('matrix_id')
            .optional()
            .matches(/^@[a-zA-Z0-9._=-]+:[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
            .withMessage('Invalid Matrix ID format (@username:server.com)'),

    // Notification channel validation
    notificationChannel: () =>
        body('notification_channel')
            .optional()
            .isIn(['email', 'matrix', 'push', 'both'])
            .withMessage('Invalid notification channel (email, matrix, push, both)')
};

/**
 * Sanitization helpers
 */
const sanitizers = {
    // Sanitize HTML to prevent XSS
    sanitizeHtml: (field) => 
        body(field).customSanitizer(value => {
            if (!value) return value;
            // Remove script tags and dangerous attributes
            return value
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
                .replace(/javascript:/gi, '');
        }),
    
    // Normalize whitespace
    normalizeWhitespace: (field) => 
        body(field).customSanitizer(value => {
            if (!value) return value;
            return value.replace(/\s+/g, ' ').trim();
        }),
    
    // Convert to boolean
    toBoolean: (field) => 
        body(field).customSanitizer(value => {
            return value === true || value === 'true' || value === 1 || value === '1';
        }),
    
    // Lowercase email
    lowercaseEmail: () => 
        body('email').customSanitizer(value => {
            return value ? value.toLowerCase() : value;
        })
};

/**
 * Validation rule sets for different routes
 */
const validationRules = {
    // Authentication validations
    auth: {
        register: [
            commonValidations.email(),
            commonValidations.password(),
            body('first_name').notEmpty().trim().isLength({ max: 100 }),
            body('last_name').notEmpty().trim().isLength({ max: 100 }),
            commonValidations.geoId(),
            commonValidations.role(),
            body('token').notEmpty().withMessage('Registration token required'),
            handleValidationErrors
        ],
        
        login: [
            commonValidations.email(),
            body('password').notEmpty(),
            commonValidations.totpToken().optional(),
            handleValidationErrors
        ],
        
        resetPassword: [
            commonValidations.email(),
            handleValidationErrors
        ],
        
        changePassword: [
            body('current_password').notEmpty(),
            commonValidations.password().withMessage('New password is required'),
            body('confirm_password')
                .custom((value, { req }) => value === req.body.password)
                .withMessage('Passwords do not match'),
            handleValidationErrors
        ]
    },
    
    // User validations
    user: {
        create: [
            commonValidations.email(),
            body('first_name').notEmpty().trim(),
            body('last_name').notEmpty().trim(),
            commonValidations.role(),
            commonValidations.geoId(),
            handleValidationErrors
        ],
        
        update: [
            commonValidations.uuid('id'),
            body('email').optional().isEmail().normalizeEmail(),
            body('first_name').optional().trim(),
            body('last_name').optional().trim(),
            commonValidations.role().optional(),
            handleValidationErrors
        ],
        
        updateStatus: [
            commonValidations.uuid('id'),
            commonValidations.status(['active', 'inactive', 'suspended']),
            body('reason').optional().trim(),
            handleValidationErrors
        ],

        linkMatrix: [
            body('matrix_id')
                .notEmpty()
                .matches(/^@[a-zA-Z0-9._=-]+:[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
                .withMessage('Invalid Matrix ID format (@username:server.com)'),
            handleValidationErrors
        ],

        updateNotificationSettings: [
            commonValidations.notificationChannel(),
            commonValidations.matrixId(),
            body('preferred_language')
                .optional()
                .isIn(['fr', 'en', 'it', 'es', 'pt'])
                .withMessage('Invalid language'),
            handleValidationErrors
        ]
    },
    
    // Guard validations
    guard: {
        create: [
            commonValidations.geoId(),
            commonValidations.date('guard_date'),
            commonValidations.time('start_time'),
            commonValidations.time('end_time'),
            body('max_participants').optional().isInt({ min: 1, max: 100 }),
            body('guard_type')
                .optional()
                .isIn(['standard', 'preparation', 'closure', 'special', 'maintenance']),
            handleValidationErrors
        ],
        
        assign: [
            commonValidations.uuid('id'),
            commonValidations.memberId().optional(),
            body('notes').optional().trim().isLength({ max: 500 }),
            handleValidationErrors
        ],
        
        cancel: [
            commonValidations.uuid('id'),
            body('reason').notEmpty().trim(),
            commonValidations.memberId('replacement_member_id').optional(),
            handleValidationErrors
        ]
    },
    
    // Group validations
    group: {
        create: [
            body('name').notEmpty().trim().isLength({ min: 3, max: 100 }),
            body('description').optional().trim().isLength({ max: 1000 }),
            commonValidations.geoId(),
            body('max_members').optional().isInt({ min: 1, max: 500 }),
            body('color_code')
                .optional()
                .matches(/^#[0-9A-Fa-f]{6}$/)
                .withMessage('Invalid color code'),
            handleValidationErrors
        ],
        
        addMember: [
            commonValidations.uuid('id'),
            commonValidations.memberId(),
            body('role_in_group')
                .optional()
                .isIn(['member', 'deputy', 'leader']),
            handleValidationErrors
        ]
    },
    
    // Notification validations
    notification: {
        create: [
            body('type').isIn(['message', 'announcement', 'system_alert']),
            body('title').notEmpty().isLength({ max: 200 }),
            body('message').notEmpty(),
            body('priority')
                .optional()
                .isIn(['low', 'normal', 'high', 'urgent']),
            body('target_type').isIn(['individual', 'group', 'geo_id', 'global']),
            body('target_ids').isArray(),
            handleValidationErrors
        ]
    }
};

/**
 * Custom validation middleware factory
 */
const validate = (rules) => {
    return async (req, res, next) => {
        await Promise.all(rules.map(validation => validation.run(req)));
        
        const errors = validationResult(req);
        if (errors.isEmpty()) {
            return next();
        }
        
        const extractedErrors = [];
        errors.array().map(err => extractedErrors.push({ [err.param]: err.msg }));
        
        return res.status(422).json({
            success: false,
            errors: extractedErrors,
        });
    };
};

module.exports = {
    handleValidationErrors,
    commonValidations,
    sanitizers,
    validationRules,
    validate
};
