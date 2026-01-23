// packages/core/models/BaseModel.js
// Classe de base pour tous les modèles SHUGO

const { Model, DataTypes } = require('sequelize');
const crypto = require('crypto');

class BaseModel extends Model {
    /**
     * Initialize the model with common fields and options
     */
    static initBase(sequelize, modelName, attributes = {}, options = {}) {
        // Add common fields
        const commonAttributes = {
            ...attributes,
            created_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
                allowNull: false
            },
            updated_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
                allowNull: false
            },
            metadata: {
                type: DataTypes.JSONB,
                defaultValue: {}
            }
        };
        
        // Common options
        const commonOptions = {
            sequelize,
            modelName,
            tableName: options.tableName || modelName.toLowerCase() + 's',
            timestamps: true,
            underscored: true,
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            hooks: {
                beforeUpdate: (instance) => {
                    instance.updated_at = new Date();
                },
                ...options.hooks
            },
            ...options
        };
        
        return super.init(commonAttributes, commonOptions);
    }
    
    /**
     * Generate a unique ID
     */
    static generateId(prefix = '') {
        const timestamp = Date.now().toString(36);
        const random = crypto.randomBytes(4).toString('hex');
        return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
    }
    
    /**
     * Safe JSON serialization (removes sensitive fields)
     */
    toSafeJSON(excludeFields = []) {
        const json = this.toJSON();
        const sensitiveFields = [
            'password_hash',
            'totp_secret',
            'totp_secret_encrypted',
            'totp_backup_codes',
            'api_key',
            'private_key',
            ...excludeFields
        ];
        
        sensitiveFields.forEach(field => {
            delete json[field];
        });
        
        return json;
    }
    
    /**
     * Check if record is expired based on a field
     */
    isExpired(field = 'expires_at') {
        if (!this[field]) return false;
        return new Date(this[field]) < new Date();
    }
    
    /**
     * Check if record was created within a time window
     */
    isRecent(minutes = 60) {
        const createdAt = new Date(this.created_at);
        const now = new Date();
        const diffMinutes = (now - createdAt) / (1000 * 60);
        return diffMinutes <= minutes;
    }
    
    /**
     * Update metadata field
     */
    async updateMetadata(key, value) {
        if (!this.metadata) this.metadata = {};
        this.metadata[key] = value;
        this.metadata.last_metadata_update = new Date();
        await this.save();
    }
    
    /**
     * Add to array field (JSONB)
     */
    async addToArray(field, value) {
        if (!this[field]) this[field] = [];
        if (!Array.isArray(this[field])) {
            throw new Error(`Field ${field} is not an array`);
        }
        this[field].push(value);
        await this.save();
    }
    
    /**
     * Remove from array field (JSONB)
     */
    async removeFromArray(field, value) {
        if (!this[field] || !Array.isArray(this[field])) return;
        const index = this[field].indexOf(value);
        if (index > -1) {
            this[field].splice(index, 1);
            await this.save();
        }
    }
    
    /**
     * Increment a numeric field
     */
    async incrementField(field, amount = 1) {
        this[field] = (this[field] || 0) + amount;
        await this.save();
    }
    
    /**
     * Soft delete (if paranoid is enabled)
     */
    async softDelete() {
        if (this.constructor.options.paranoid) {
            await this.destroy();
        } else {
            this.status = 'deleted';
            this.deleted_at = new Date();
            await this.save();
        }
    }
    
    /**
     * Common validation methods
     */
    static validators = {
        isEmail(value) {
            const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return re.test(value);
        },
        
        isPhoneNumber(value) {
            const re = /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/;
            return re.test(value);
        },
        
        isGeoId(value) {
            const re = /^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/;
            return re.test(value);
        },
        
        isStrongPassword(value) {
            // At least 8 chars, 1 upper, 1 lower, 1 number
            const re = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/;
            return re.test(value);
        }
    };
}

module.exports = BaseModel;
