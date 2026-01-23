// packages/local/src/utils/validator.js
// Input validation schemas for local server

const Joi = require('joi');

// Custom validators
const geoIdPattern = /^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/;
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Auth validation schemas
const validateAuth = {
    login: (data) => {
        const schema = Joi.object({
            email: Joi.string().email().required(),
            password: Joi.string().min(8).required()
        });
        return schema.validate(data);
    },
    
    updateProfile: (data) => {
        const schema = Joi.object({
            preferred_language: Joi.string().valid('fr', 'en', 'es', 'it', 'pt'),
            notification_channel: Joi.string().valid('email', 'matrix', 'both')
        });
        return schema.validate(data);
    }
};

// Guard validation schemas
const validateGuard = {
    create: (data) => {
        const schema = Joi.object({
            guard_date: Joi.date().iso().required(),
            start_time: Joi.string().pattern(timePattern).required(),
            end_time: Joi.string().pattern(timePattern).required(),
            guard_type: Joi.string()
                .valid('standard', 'preparation', 'closure', 'special', 'maintenance')
                .default('standard'),
            max_participants: Joi.number().min(1).max(20).default(1),
            min_participants: Joi.number().min(0).default(1),
            priority: Joi.number().min(1).max(3).default(1),
            description: Joi.string().max(1000).allow('', null),
            requirements: Joi.string().max(500).allow('', null),
            is_recurring: Joi.boolean().default(false),
            recurrence_rule: Joi.when('is_recurring', {
                is: true,
                then: Joi.string().required(),
                otherwise: Joi.string().allow('', null)
            })
        }).custom((value, helpers) => {
            // Validate that end_time is after start_time
            if (value.start_time && value.end_time) {
                const [startHour, startMin] = value.start_time.split(':').map(Number);
                const [endHour, endMin] = value.end_time.split(':').map(Number);
                const startMinutes = startHour * 60 + startMin;
                const endMinutes = endHour * 60 + endMin;
                
                if (endMinutes <= startMinutes) {
                    return helpers.error('End time must be after start time');
                }
            }
            
            // Validate min/max participants
            if (value.min_participants > value.max_participants) {
                return helpers.error('Min participants cannot exceed max participants');
            }
            
            return value;
        });
        
        return schema.validate(data);
    },
    
    update: (data) => {
        const schema = Joi.object({
            guard_date: Joi.date().iso(),
            start_time: Joi.string().pattern(timePattern),
            end_time: Joi.string().pattern(timePattern),
            guard_type: Joi.string()
                .valid('standard', 'preparation', 'closure', 'special', 'maintenance'),
            max_participants: Joi.number().min(1).max(20),
            min_participants: Joi.number().min(0),
            priority: Joi.number().min(1).max(3),
            description: Joi.string().max(1000).allow('', null),
            requirements: Joi.string().max(500).allow('', null),
            status: Joi.string().valid('open', 'full', 'closed', 'cancelled')
        });
        
        return schema.validate(data);
    }
};

// User validation schemas
const validateUser = {
    create: (data) => {
        const schema = Joi.object({
            member_id: Joi.number().required(),
            email: Joi.string().email().required(),
            first_name: Joi.string().min(2).max(100).required(),
            last_name: Joi.string().min(2).max(100).required(),
            role: Joi.string().valid('Silver', 'Gold', 'Platinum', 'Admin').default('Silver'),
            geo_id: Joi.string().pattern(geoIdPattern).required(),
            group_id: Joi.string().uuid().allow(null),
            preferred_language: Joi.string().valid('fr', 'en', 'es', 'it', 'pt').default('fr'),
            notification_channel: Joi.string().valid('email', 'matrix', 'both').default('email')
        });
        
        return schema.validate(data);
    },
    
    update: (data) => {
        const schema = Joi.object({
            first_name: Joi.string().min(2).max(100),
            last_name: Joi.string().min(2).max(100),
            role: Joi.string().valid('Silver', 'Gold', 'Platinum', 'Admin'),
            group_id: Joi.string().uuid().allow(null),
            status: Joi.string().valid('active', 'inactive', 'suspended'),
            preferred_language: Joi.string().valid('fr', 'en', 'es', 'it', 'pt'),
            notification_channel: Joi.string().valid('email', 'matrix', 'both')
        });
        
        return schema.validate(data);
    }
};

// Group validation schemas
const validateGroup = {
    create: (data) => {
        const schema = Joi.object({
            name: Joi.string().min(3).max(100).required(),
            description: Joi.string().max(500).allow('', null),
            geo_id: Joi.string().pattern(geoIdPattern).required(),
            leader_member_id: Joi.number().allow(null),
            max_members: Joi.number().min(1).max(100).default(50),
            color_code: Joi.string().pattern(/^[0-9A-Fa-f]{6}$/).allow(null)
        });
        
        return schema.validate(data);
    },
    
    update: (data) => {
        const schema = Joi.object({
            name: Joi.string().min(3).max(100),
            description: Joi.string().max(500).allow('', null),
            leader_member_id: Joi.number().allow(null),
            max_members: Joi.number().min(1).max(100),
            color_code: Joi.string().pattern(/^[0-9A-Fa-f]{6}$/).allow(null),
            status: Joi.string().valid('active', 'inactive', 'archived')
        });
        
        return schema.validate(data);
    }
};

// Assignment validation schemas
const validateAssignment = {
    create: (data) => {
        const schema = Joi.object({
            guard_id: Joi.string().uuid().required(),
            member_id: Joi.number().required(),
            assigned_by_member_id: Joi.number().required(),
            assignment_type: Joi.string()
                .valid('voluntary', 'assigned', 'automatic')
                .default('voluntary'),
            notes: Joi.string().max(500).allow('', null)
        });
        
        return schema.validate(data);
    },
    
    update: (data) => {
        const schema = Joi.object({
            status: Joi.string().valid('confirmed', 'pending', 'cancelled'),
            notes: Joi.string().max(500).allow('', null),
            replacement_member_id: Joi.number().allow(null),
            replacement_deadline: Joi.date().iso().allow(null)
        });
        
        return schema.validate(data);
    }
};

// Sync validation schemas
const validateSync = {
    pull: (data) => {
        const schema = Joi.object({
            since: Joi.date().iso(),
            entities: Joi.array().items(
                Joi.string().valid('users', 'guards', 'assignments', 'groups')
            ),
            force: Joi.boolean().default(false)
        });
        
        return schema.validate(data);
    },
    
    push: (data) => {
        const schema = Joi.object({
            entity: Joi.string().required(),
            operation: Joi.string().valid('create', 'update', 'delete').required(),
            data: Joi.object().required(),
            priority: Joi.number().min(1).max(10).default(5)
        });
        
        return schema.validate(data);
    }
};

// Plugin validation schemas
const validatePlugin = {
    manifest: (data) => {
        const schema = Joi.object({
            id: Joi.string().pattern(/^[a-z0-9-]+$/).required(),
            name: Joi.string().min(3).max(100).required(),
            version: Joi.string().pattern(/^\d+\.\d+\.\d+/).required(),
            description: Joi.string().max(500),
            author: Joi.string().max(100),
            license: Joi.string().default('MIT'),
            dependencies: Joi.array().items(Joi.string()),
            permissions: Joi.array().items(Joi.string()),
            config: Joi.object()
        });
        
        return schema.validate(data);
    },
    
    config: (data) => {
        const schema = Joi.object().pattern(
            Joi.string(),
            Joi.alternatives().try(
                Joi.string(),
                Joi.number(),
                Joi.boolean(),
                Joi.array(),
                Joi.object()
            )
        );
        
        return schema.validate(data);
    }
};

// Query validation schemas
const validateQuery = {
    pagination: (data) => {
        const schema = Joi.object({
            page: Joi.number().min(1).default(1),
            limit: Joi.number().min(1).max(100).default(50),
            sort: Joi.string(),
            order: Joi.string().valid('ASC', 'DESC').default('ASC')
        });
        
        return schema.validate(data);
    },
    
    dateRange: (data) => {
        const schema = Joi.object({
            start_date: Joi.date().iso(),
            end_date: Joi.date().iso().min(Joi.ref('start_date'))
        });
        
        return schema.validate(data);
    }
};

module.exports = {
    validateAuth,
    validateGuard,
    validateUser,
    validateGroup,
    validateAssignment,
    validateSync,
    validatePlugin,
    validateQuery,
    
    // Export patterns for reuse
    patterns: {
        geoId: geoIdPattern,
        time: timePattern
    }
};
