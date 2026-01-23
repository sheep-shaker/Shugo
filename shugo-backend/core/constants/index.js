// packages/core/constants/index.js
// Shared constants across the platform

const ROLES = {
    SILVER: 'Silver',
    GOLD: 'Gold',
    PLATINUM: 'Platinum',
    ADMIN: 'Admin',
    ADMIN_N1: 'Admin_N1'
};

const USER_STATUS = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    SUSPENDED: 'suspended',
    DELETED: 'deleted'
};

const GUARD_STATUS = {
    OPEN: 'open',
    FULL: 'full',
    CLOSED: 'closed',
    CANCELLED: 'cancelled'
};

const GUARD_TYPES = {
    STANDARD: 'standard',
    PREPARATION: 'preparation',
    CLOSURE: 'closure',
    SPECIAL: 'special',
    MAINTENANCE: 'maintenance'
};

const SYNC_STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    DEAD: 'dead'
};

const NOTIFICATION_PRIORITY = {
    LOW: 'low',
    NORMAL: 'normal',
    HIGH: 'high',
    URGENT: 'urgent'
};

const ERROR_CODES = {
    // Auth errors
    UNAUTHORIZED: 'UNAUTHORIZED',
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    INVALID_TOKEN: 'INVALID_TOKEN',
    FORBIDDEN: 'FORBIDDEN',
    
    // Validation errors
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INVALID_INPUT: 'INVALID_INPUT',
    MISSING_FIELD: 'MISSING_FIELD',
    
    // Database errors
    NOT_FOUND: 'NOT_FOUND',
    DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
    DATABASE_ERROR: 'DATABASE_ERROR',
    
    // System errors
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED'
};

const LANGUAGES = ['fr', 'en', 'es', 'it', 'pt'];

const GEO_ID_PATTERN = /^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/;

module.exports = {
    ROLES,
    USER_STATUS,
    GUARD_STATUS,
    GUARD_TYPES,
    SYNC_STATUS,
    NOTIFICATION_PRIORITY,
    ERROR_CODES,
    LANGUAGES,
    GEO_ID_PATTERN
};
