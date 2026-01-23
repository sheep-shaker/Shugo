// packages/core/index.js
// Main entry point for @shugo/core package

module.exports = {
    // Models
    BaseModel: require('./models/BaseModel'),
    
    // Services
    BaseService: require('./services/BaseService'),
    
    // Events
    EventBus: require('./events/EventBus'),
    
    // Utils
    logger: require('./utils/logger'),
    crypto: require('./utils/crypto'),
    helpers: require('./utils/helpers'),
    
    // Constants
    constants: require('./constants'),
    
    // Re-export specific constants for convenience
    ROLES: require('./constants').ROLES,
    USER_STATUS: require('./constants').USER_STATUS,
    GUARD_STATUS: require('./constants').GUARD_STATUS,
    ERROR_CODES: require('./constants').ERROR_CODES
};
