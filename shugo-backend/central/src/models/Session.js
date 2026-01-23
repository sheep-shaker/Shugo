// src/models/Session.js
// Modèle pour les sessions utilisateur

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');
const cryptoManager = require('../utils/crypto');

const Session = sequelize.define('Session', {
    session_id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    
    member_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: {
            model: 'users',
            key: 'member_id'
        }
    },
    
    jwt_token_hash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        comment: 'Hash of JWT token for validation'
    },
    
    refresh_token_hash: {
        type: DataTypes.STRING(64),
        allowNull: true,
        unique: true,
        comment: 'Hash of refresh token'
    },
    
    ip_address: {
        type: DataTypes.INET,
        allowNull: false
    },
    
    user_agent: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    
    geo_location: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {},
        comment: 'Geographic location data'
    },
    
    device_info: {
        type: DataTypes.JSON,
        defaultValue: {},
        comment: 'Device information (browser, OS, etc.)'
    },
    
    expires_at: {
        type: DataTypes.DATE,
        allowNull: false
    },
    
    refresh_expires_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    
    last_activity: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    
    logout_reason: {
        type: DataTypes.ENUM('manual', 'timeout', 'maintenance', 'security', 'expired'),
        allowNull: true
    },
    
    security_flags: {
        type: DataTypes.JSON,
        defaultValue: {
            suspicious_activity: false,
            verified_2fa: false,
            elevated_privileges: false
        }
    },
    
    activity_count: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        comment: 'Number of activities in this session'
    },
    
    metadata: {
        type: DataTypes.JSON,
        defaultValue: {}
    }
}, {
    tableName: 'sessions',
    timestamps: true,
    underscored: true,
    indexes: [
        { fields: ['member_id'] },
        { fields: ['jwt_token_hash'], unique: true },
        { fields: ['refresh_token_hash'], unique: true, where: { refresh_token_hash: { [sequelize.Sequelize.Op.ne]: null } } },
        { fields: ['expires_at'] },
        { fields: ['is_active'] },
        { fields: ['ip_address'] },
        { fields: ['last_activity'] }
    ]
});

// Instance methods
Session.prototype.isExpired = function() {
    return this.expires_at < new Date();
};

Session.prototype.isRefreshExpired = function() {
    if (!this.refresh_expires_at) return true;
    return this.refresh_expires_at < new Date();
};

Session.prototype.updateActivity = async function() {
    this.last_activity = new Date();
    this.activity_count += 1;
    await this.save();
};

Session.prototype.invalidate = async function(reason = 'manual') {
    this.is_active = false;
    this.logout_reason = reason;
    await this.save();
};

Session.prototype.extendSession = async function(minutes = 60) {
    const now = new Date();
    this.expires_at = new Date(now.getTime() + minutes * 60 * 1000);
    this.last_activity = now;
    await this.save();
};

Session.prototype.setToken = function(token) {
    this.jwt_token_hash = cryptoManager.hashSHA256(token);
};

Session.prototype.setRefreshToken = function(refreshToken, expiresIn = 7 * 24 * 60) {
    this.refresh_token_hash = cryptoManager.hashSHA256(refreshToken);
    this.refresh_expires_at = new Date(Date.now() + expiresIn * 60 * 1000);
};

Session.prototype.verifyToken = function(token) {
    const hash = cryptoManager.hashSHA256(token);
    return cryptoManager.constantTimeCompare(hash, this.jwt_token_hash);
};

Session.prototype.verifyRefreshToken = function(refreshToken) {
    if (!this.refresh_token_hash) return false;
    const hash = cryptoManager.hashSHA256(refreshToken);
    return cryptoManager.constantTimeCompare(hash, this.refresh_token_hash);
};

Session.prototype.markSuspicious = async function(reason = null) {
    if (!this.security_flags) this.security_flags = {};
    this.security_flags.suspicious_activity = true;
    if (reason) {
        this.security_flags.suspicious_reason = reason;
        this.security_flags.marked_at = new Date();
    }
    await this.save();
};

// Class methods
Session.findActiveByUser = async function(memberId) {
    return await this.findAll({
        where: {
            member_id: memberId,
            is_active: true,
            expires_at: {
                [sequelize.Sequelize.Op.gt]: new Date()
            }
        },
        order: [['last_activity', 'DESC']]
    });
};

Session.findByToken = async function(token) {
    const tokenHash = cryptoManager.hashSHA256(token);
    return await this.findOne({
        where: {
            jwt_token_hash: tokenHash,
            is_active: true,
            expires_at: {
                [sequelize.Sequelize.Op.gt]: new Date()
            }
        }
    });
};

Session.findByRefreshToken = async function(refreshToken) {
    const tokenHash = cryptoManager.hashSHA256(refreshToken);
    return await this.findOne({
        where: {
            refresh_token_hash: tokenHash,
            is_active: true,
            refresh_expires_at: {
                [sequelize.Sequelize.Op.gt]: new Date()
            }
        }
    });
};

Session.invalidateAllForUser = async function(memberId, reason = 'security') {
    return await this.update(
        { 
            is_active: false, 
            logout_reason: reason 
        },
        { 
            where: { 
                member_id: memberId,
                is_active: true
            } 
        }
    );
};

Session.cleanupExpired = async function() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    return await this.destroy({
        where: {
            [sequelize.Sequelize.Op.or]: [
                {
                    is_active: false,
                    updated_at: {
                        [sequelize.Sequelize.Op.lt]: oneDayAgo
                    }
                },
                {
                    expires_at: {
                        [sequelize.Sequelize.Op.lt]: oneDayAgo
                    }
                }
            ]
        }
    });
};

Session.getActiveSessionsCount = async function() {
    return await this.count({
        where: {
            is_active: true,
            expires_at: {
                [sequelize.Sequelize.Op.gt]: new Date()
            }
        }
    });
};

module.exports = Session;
