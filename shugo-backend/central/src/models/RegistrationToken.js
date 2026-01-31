// src/models/RegistrationToken.js
// Modèle pour les jetons d'inscription

const { DataTypes, Op } = require('sequelize');
const { sequelize } = require('../database/connection');
const crypto = require('crypto');

/**
 * Modèle RegistrationToken - Jetons d'inscription et réinitialisation
 */
const RegistrationToken = sequelize.define('RegistrationToken', {
    token_id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    
    token_code: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        comment: 'Code du jeton'
    },
    
    token_hash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        comment: 'Hash SHA256 du token'
    },
    
    token_type: {
        type: DataTypes.ENUM('registration', 'password_reset', 'email_verification', 'totp_reset'),
        allowNull: false,
        defaultValue: 'registration',
        comment: 'Type de jeton'
    },
    
    geo_id: {
        type: DataTypes.STRING(16),
        allowNull: false,
        validate: {
            is: /^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/
        },
        comment: 'Localisation'
    },
    
    created_by_member_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: {
            model: 'users',
            key: 'member_id'
        },
        comment: 'Créateur du jeton'
    },
    
    target_email: {
        type: DataTypes.STRING,
        comment: 'Email cible (pour reset)'
    },
    
    target_member_id: {
        type: DataTypes.BIGINT,
        references: {
            model: 'users',
            key: 'member_id'
        },
        comment: 'Membre cible (pour reset)'
    },
    
    target_first_name: {
        type: DataTypes.STRING(100),
        comment: 'Prénom cible (pour inscription)'
    },
    
    target_last_name: {
        type: DataTypes.STRING(100),
        comment: 'Nom cible (pour inscription)'
    },
    
    target_role: {
        type: DataTypes.ENUM('Silver', 'Gold', 'Platinum', 'Admin'),
        defaultValue: 'Silver',
        comment: 'Rôle cible'
    },
    
    target_group_id: {
        type: DataTypes.UUID,
        references: {
            model: 'groups',
            key: 'group_id'
        },
        comment: 'Groupe cible'
    },
    
    expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: 'Date d\'expiration'
    },
    
    used_at: {
        type: DataTypes.DATE,
        comment: 'Date d\'utilisation'
    },
    
    used_by_member_id: {
        type: DataTypes.BIGINT,
        references: {
            model: 'users',
            key: 'member_id'
        },
        comment: 'Utilisé par'
    },
    
    used_ip: {
        type: DataTypes.INET,
        comment: 'IP d\'utilisation'
    },
    
    status: {
        type: DataTypes.ENUM('active', 'used', 'expired', 'revoked'),
        defaultValue: 'active',
        comment: 'Statut'
    },
    
    metadata: {
        type: DataTypes.JSON,
        defaultValue: {},
        comment: 'Métadonnées additionnelles'
    },
    
    max_uses: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        comment: 'Nombre maximum d\'utilisations'
    },
    
    use_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: 'Nombre d\'utilisations'
    },
    
    notes: {
        type: DataTypes.TEXT,
        comment: 'Notes'
    }
}, {
    tableName: 'registration_tokens',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        { fields: ['token_hash'] },
        { fields: ['token_type'] },
        { fields: ['geo_id'] },
        { fields: ['status'] },
        { fields: ['expires_at'] },
        { fields: ['created_by_member_id'] }
    ]
});

// Hooks
RegistrationToken.beforeCreate(async (token) => {
    // Générer le code si non fourni
    if (!token.token_code) {
        token.token_code = crypto.randomBytes(32).toString('hex');
    }
    
    // Hasher le token
    token.token_hash = crypto.createHash('sha256').update(token.token_code).digest('hex');
    
    // Définir l'expiration par défaut
    if (!token.expires_at) {
        const expirationDays = {
            registration: 7,
            password_reset: 1,
            email_verification: 3,
            totp_reset: 1
        };
        
        const days = expirationDays[token.token_type] || 7;
        token.expires_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }
});

// Méthodes d'instance
RegistrationToken.prototype.use = async function(memberId, ip) {
    if (this.status !== 'active') {
        throw new Error('Token is not active');
    }
    
    if (this.expires_at < new Date()) {
        this.status = 'expired';
        await this.save();
        throw new Error('Token has expired');
    }
    
    if (this.use_count >= this.max_uses) {
        this.status = 'used';
        await this.save();
        throw new Error('Token has been used');
    }
    
    this.use_count += 1;
    this.used_at = new Date();
    this.used_by_member_id = memberId;
    this.used_ip = ip;
    
    if (this.use_count >= this.max_uses) {
        this.status = 'used';
    }
    
    return this.save();
};

RegistrationToken.prototype.revoke = async function(reason = null) {
    this.status = 'revoked';
    if (reason) {
        this.notes = (this.notes ? this.notes + '\n' : '') + `Revoked: ${reason}`;
    }
    return this.save();
};

RegistrationToken.prototype.extend = async function(days = 7) {
    const newExpiry = new Date(this.expires_at);
    newExpiry.setDate(newExpiry.getDate() + days);
    this.expires_at = newExpiry;
    return this.save();
};

RegistrationToken.prototype.isValid = function() {
    return this.status === 'active' && 
           this.expires_at > new Date() && 
           this.use_count < this.max_uses;
};

// Méthodes statiques
RegistrationToken.generateCode = function(length = 16) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz';
    const crypto = require('crypto');
    let code = '';

    // Utiliser crypto.randomBytes pour une génération sécurisée
    const randomBytes = crypto.randomBytes(length);

    for (let i = 0; i < length; i++) {
        if (i > 0 && i % 4 === 0) code += '-';
        code += chars[randomBytes[i] % chars.length];
    }

    return code;
};

RegistrationToken.findByCode = async function(code) {
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    
    return this.findOne({
        where: {
            token_hash: hash,
            status: 'active',
            expires_at: { [Op.gt]: new Date() }
        }
    });
};

RegistrationToken.createRegistration = async function(data) {
    const code = this.generateCode();
    
    return this.create({
        token_code: code,
        token_type: 'registration',
        geo_id: data.geo_id,
        created_by_member_id: data.created_by,
        target_first_name: data.first_name,
        target_last_name: data.last_name,
        target_role: data.role || 'Silver',
        target_group_id: data.group_id,
        metadata: data.metadata || {}
    });
};

RegistrationToken.createPasswordReset = async function(memberId, email, createdBy) {
    const code = crypto.randomBytes(32).toString('hex');
    
    // Invalider les anciens tokens
    await this.update(
        { status: 'revoked' },
        {
            where: {
                target_member_id: memberId,
                token_type: 'password_reset',
                status: 'active'
            }
        }
    );
    
    return this.create({
        token_code: code,
        token_type: 'password_reset',
        geo_id: 'central',
        created_by_member_id: createdBy || memberId,
        target_member_id: memberId,
        target_email: email,
        expires_at: new Date(Date.now() + 60 * 60 * 1000) // 1 heure
    });
};

RegistrationToken.cleanExpired = async function() {
    const result = await this.update(
        { status: 'expired' },
        {
            where: {
                expires_at: { [Op.lt]: new Date() },
                status: 'active'
            }
        }
    );
    
    return result[0];
};

RegistrationToken.getStatistics = async function(geoId = null) {
    const where = {};
    if (geoId) {
        where.geo_id = geoId;
    }
    
    const [total, active, used, expired] = await Promise.all([
        this.count({ where }),
        this.count({ where: { ...where, status: 'active' } }),
        this.count({ where: { ...where, status: 'used' } }),
        this.count({ where: { ...where, status: 'expired' } })
    ]);
    
    return {
        total,
        active,
        used,
        expired,
        revoked: total - active - used - expired
    };
};

module.exports = RegistrationToken;
