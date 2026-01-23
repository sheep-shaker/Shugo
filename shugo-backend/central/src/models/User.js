// src/models/User.js
// Modèle utilisateur principal

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');
const cryptoManager = require('../utils/crypto');
const logger = require('../utils/logger');

const User = sequelize.define('User', {
    member_id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: false, // Assigned by system
        validate: {
            min: 1,
            max: 9999999999
        }
    },
    
    // Encrypted fields
    email_encrypted: {
        type: DataTypes.TEXT,
        allowNull: false,
        set(value) {
            if (value) {
                this.setDataValue('email_encrypted', cryptoManager.encryptField(value));
                this.setDataValue('email_hash', cryptoManager.hashForSearch(value));
            }
        },
        get() {
            const encrypted = this.getDataValue('email_encrypted');
            return encrypted ? cryptoManager.decryptField(encrypted) : null;
        }
    },
    
    email_hash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true
    },
    
    password_hash: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    
    first_name_encrypted: {
        type: DataTypes.TEXT,
        allowNull: false,
        set(value) {
            if (value) {
                this.setDataValue('first_name_encrypted', cryptoManager.encryptField(value));
                this.setDataValue('first_name_hash', cryptoManager.hashForSearch(value));
                this.setDataValue('first_name_phonetic', cryptoManager.generatePhoneticHash(value));
            }
        },
        get() {
            const encrypted = this.getDataValue('first_name_encrypted');
            return encrypted ? cryptoManager.decryptField(encrypted) : null;
        }
    },
    
    last_name_encrypted: {
        type: DataTypes.TEXT,
        allowNull: false,
        set(value) {
            if (value) {
                this.setDataValue('last_name_encrypted', cryptoManager.encryptField(value));
                this.setDataValue('last_name_hash', cryptoManager.hashForSearch(value));
                this.setDataValue('last_name_phonetic', cryptoManager.generatePhoneticHash(value));
            }
        },
        get() {
            const encrypted = this.getDataValue('last_name_encrypted');
            return encrypted ? cryptoManager.decryptField(encrypted) : null;
        }
    },
    
    // Search hashes
    first_name_hash: {
        type: DataTypes.STRING(64),
        allowNull: true
    },
    
    last_name_hash: {
        type: DataTypes.STRING(64),
        allowNull: true
    },
    
    first_name_phonetic: {
        type: DataTypes.STRING(64),
        allowNull: true
    },
    
    last_name_phonetic: {
        type: DataTypes.STRING(64),
        allowNull: true
    },
    
    phonetic_algo: {
        type: DataTypes.STRING(16),
        defaultValue: 'soundex'
    },
    
    enc_key_id: {
        type: DataTypes.SMALLINT,
        defaultValue: 1
    },
    
    phone_encrypted: {
        type: DataTypes.TEXT,
        allowNull: true,
        set(value) {
            if (value) {
                this.setDataValue('phone_encrypted', cryptoManager.encryptField(value));
            }
        },
        get() {
            const encrypted = this.getDataValue('phone_encrypted');
            return encrypted ? cryptoManager.decryptField(encrypted) : null;
        }
    },
    
    // Role and permissions
    role: {
        type: DataTypes.ENUM('Silver', 'Gold', 'Platinum', 'Admin', 'Admin_N1'),
        allowNull: false,
        defaultValue: 'Silver'
    },
    
    geo_id: {
        type: DataTypes.STRING(16),
        allowNull: false,
        validate: {
            is: /^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/
        }
    },
    
    group_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    
    scope: {
        type: DataTypes.STRING(64),
        allowNull: true
    },
    
    // Status
    status: {
        type: DataTypes.ENUM('active', 'inactive', 'suspended', 'deleted'),
        defaultValue: 'active'
    },
    
    // Preferences
    preferred_language: {
        type: DataTypes.ENUM('fr', 'en', 'it', 'es', 'pt'),
        defaultValue: 'fr'
    },
    
    notification_channel: {
        type: DataTypes.ENUM('email', 'matrix', 'both'),
        defaultValue: 'email'
    },
    
    matrix_id: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    
    // 2FA
    totp_secret_encrypted: {
        type: DataTypes.TEXT,
        allowNull: true,
        set(value) {
            if (value) {
                this.setDataValue('totp_secret_encrypted', cryptoManager.encryptField(value));
            }
        },
        get() {
            const encrypted = this.getDataValue('totp_secret_encrypted');
            return encrypted ? cryptoManager.decryptField(encrypted) : null;
        }
    },
    
    totp_enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    
    totp_verified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    
    totp_backup_codes: {
        type: DataTypes.TEXT,
        allowNull: true,
        set(value) {
            if (value) {
                this.setDataValue('totp_backup_codes', cryptoManager.encryptField(JSON.stringify(value)));
            }
        },
        get() {
            const encrypted = this.getDataValue('totp_backup_codes');
            if (encrypted) {
                const decrypted = cryptoManager.decryptField(encrypted);
                return decrypted ? JSON.parse(decrypted) : null;
            }
            return null;
        }
    },
    
    // Security
    last_login: {
        type: DataTypes.DATE,
        allowNull: true
    },
    
    last_ip: {
        type: DataTypes.INET,
        allowNull: true
    },
    
    failed_login_attempts: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    
    locked_until: {
        type: DataTypes.DATE,
        allowNull: true
    },
    
    password_changed_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },

    // Skills and availability
    skills_summary: {
        type: DataTypes.JSON,
        defaultValue: [],
        comment: 'Résumé des compétences pour matching rapide'
    },

    availability_preferences: {
        type: DataTypes.JSON,
        defaultValue: {},
        comment: 'Préférences de disponibilité globales'
    },

    sync_status: {
        type: DataTypes.ENUM('synced', 'pending', 'conflict'),
        defaultValue: 'synced'
    },

    last_sync_at: {
        type: DataTypes.DATE,
        allowNull: true
    },

    skill_level: {
        type: DataTypes.ENUM('novice', 'intermediate', 'advanced', 'expert'),
        defaultValue: 'novice'
    },

    availability_score: {
        type: DataTypes.FLOAT,
        defaultValue: 0.0
    },

    // Soft delete
    deleted_at: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'users',
    timestamps: true,
    underscored: true,
    paranoid: true,
    deletedAt: 'deleted_at',
    indexes: [
        { fields: ['email_hash'], unique: true },
        { fields: ['geo_id'] },
        { fields: ['group_id'] },
        { fields: ['status'] },
        { fields: ['role'] },
        { fields: ['first_name_hash'] },
        { fields: ['last_name_hash'] },
        { fields: ['first_name_phonetic'] },
        { fields: ['last_name_phonetic'] }
    ],
    hooks: {
        beforeValidate: async (user) => {
            // Set scope based on geo_id if not set
            if (!user.scope && user.geo_id) {
                user.scope = 'local:' + user.geo_id;
            }
        },
        
        beforeCreate: async (user) => {
            // Generate member_id if not set
            if (!user.member_id) {
                const maxId = await User.max('member_id') || 0;
                user.member_id = maxId + 1;
            }
        },
        
        afterCreate: async (user) => {
            logger.info('New user created', {
                member_id: user.member_id,
                role: user.role,
                geo_id: user.geo_id
            });
        },
        
        beforeUpdate: async (user) => {
            // Track password changes
            if (user.changed('password_hash')) {
                user.password_changed_at = new Date();
            }
        }
    }
});

// Instance methods
User.prototype.checkPassword = async function(password) {
    return await cryptoManager.verifyPassword(this.password_hash, password);
};

User.prototype.setPassword = async function(password) {
    this.password_hash = await cryptoManager.hashPassword(password);
    this.password_changed_at = new Date();
};

User.prototype.incrementFailedAttempts = async function() {
    this.failed_login_attempts += 1;
    
    if (this.failed_login_attempts >= 5) {
        this.locked_until = new Date(Date.now() + 15 * 60 * 1000); // Lock for 15 minutes
    }
    
    await this.save();
};

User.prototype.resetFailedAttempts = async function() {
    this.failed_login_attempts = 0;
    this.locked_until = null;
    await this.save();
};

User.prototype.isLocked = function() {
    return this.locked_until && this.locked_until > new Date();
};

User.prototype.getPublicProfile = function() {
    return {
        member_id: this.member_id,
        first_name: this.first_name_encrypted,
        last_name: this.last_name_encrypted,
        role: this.role,
        geo_id: this.geo_id,
        status: this.status
    };
};

// Class methods
User.findByEmail = async function(email) {
    const emailHash = cryptoManager.hashForSearch(email);
    return await this.findOne({ 
        where: { 
            email_hash: emailHash,
            status: 'active'
        } 
    });
};

User.findByPhonetic = async function(firstName, lastName) {
    const firstPhonetic = cryptoManager.generatePhoneticHash(firstName);
    const lastPhonetic = cryptoManager.generatePhoneticHash(lastName);
    
    return await this.findAll({
        where: {
            first_name_phonetic: firstPhonetic,
            last_name_phonetic: lastPhonetic,
            status: 'active'
        }
    });
};

User.getNextAvailableId = async function() {
    const maxId = await this.max('member_id') || 0;
    return maxId + 1;
};

// Associations
User.associate = function(models) {
    User.hasMany(models.UserSkill, {
        foreignKey: 'member_id',
        as: 'skills'
    });

    User.hasMany(models.UserAvailability, {
        foreignKey: 'member_id',
        as: 'availabilities'
    });

    User.hasMany(models.GuardSlot, {
        foreignKey: 'assigned_member_id',
        as: 'PrimarySlots'
    });

    User.hasMany(models.GuardSlot, {
        foreignKey: 'backup_member_id',
        as: 'BackupSlots'
    });
};

module.exports = User;
