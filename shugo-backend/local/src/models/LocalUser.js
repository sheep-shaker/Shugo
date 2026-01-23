// packages/local/src/models/LocalUser.js
// Local user model - Cached from central server

const { DataTypes } = require('sequelize');
const BaseModel = require('@shugo/core/models/BaseModel');
const crypto = require('crypto');

class LocalUser extends BaseModel {
    static init(sequelize) {
        return super.initBase(sequelize, 'LocalUser', {
            member_id: {
                type: DataTypes.BIGINT,
                primaryKey: true,
                allowNull: false
            },
            
            // Basic info (cached from central)
            email_hash: {
                type: DataTypes.STRING(64),
                allowNull: false,
                unique: true
            },
            
            first_name: {
                type: DataTypes.STRING(100),
                allowNull: false
            },
            
            last_name: {
                type: DataTypes.STRING(100),
                allowNull: false
            },
            
            display_name: {
                type: DataTypes.VIRTUAL,
                get() {
                    return `${this.first_name} ${this.last_name}`;
                }
            },
            
            role: {
                type: DataTypes.ENUM('Silver', 'Gold', 'Platinum', 'Admin'),
                defaultValue: 'Silver',
                allowNull: false
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
            
            status: {
                type: DataTypes.ENUM('active', 'inactive', 'suspended'),
                defaultValue: 'active'
            },
            
            // Sync info
            last_sync_at: {
                type: DataTypes.DATE,
                allowNull: true
            },
            
            sync_version: {
                type: DataTypes.INTEGER,
                defaultValue: 0
            },
            
            // Local preferences
            preferred_language: {
                type: DataTypes.STRING(5),
                defaultValue: 'fr'
            },
            
            notification_channel: {
                type: DataTypes.ENUM('email', 'matrix', 'both'),
                defaultValue: 'email'
            },
            
            // Local statistics
            total_guards: {
                type: DataTypes.INTEGER,
                defaultValue: 0
            },
            
            completed_guards: {
                type: DataTypes.INTEGER,
                defaultValue: 0
            },
            
            last_activity: {
                type: DataTypes.DATE,
                allowNull: true
            }
        }, {
            tableName: 'local_users',
            indexes: [
                { fields: ['email_hash'] },
                { fields: ['geo_id'] },
                { fields: ['role'] },
                { fields: ['status'] },
                { fields: ['group_id'] },
                { fields: ['last_sync_at'] }
            ]
        });
    }
    
    /**
     * Find user by email hash
     */
    static async findByEmailHash(emailHash) {
        return await this.findOne({
            where: { email_hash: emailHash }
        });
    }
    
    /**
     * Find users by geo_id
     */
    static async findByGeoId(geoId) {
        return await this.findAll({
            where: { 
                geo_id: geoId,
                status: 'active'
            }
        });
    }
    
    /**
     * Find users by role
     */
    static async findByRole(role) {
        return await this.findAll({
            where: { 
                role: role,
                status: 'active'
            }
        });
    }
    
    /**
     * Update from central sync
     */
    async updateFromSync(data) {
        this.first_name = data.first_name || this.first_name;
        this.last_name = data.last_name || this.last_name;
        this.role = data.role || this.role;
        this.status = data.status || this.status;
        this.group_id = data.group_id || this.group_id;
        this.last_sync_at = new Date();
        this.sync_version = (this.sync_version || 0) + 1;
        
        await this.save();
    }
    
    /**
     * Check if user needs sync
     */
    needsSync(threshold = 3600000) { // 1 hour default
        if (!this.last_sync_at) return true;
        
        const timeSinceSync = Date.now() - new Date(this.last_sync_at).getTime();
        return timeSinceSync > threshold;
    }
    
    /**
     * Can user perform action
     */
    can(action, resource = null) {
        const permissions = {
            'Silver': ['view_guards', 'join_guards', 'view_profile'],
            'Gold': ['view_guards', 'join_guards', 'view_profile', 'manage_group', 'invite_members'],
            'Platinum': ['view_guards', 'join_guards', 'view_profile', 'manage_group', 'invite_members', 'create_guards', 'modify_guards'],
            'Admin': ['*'] // All permissions
        };
        
        const userPermissions = permissions[this.role] || [];
        
        if (userPermissions.includes('*')) return true;
        return userPermissions.includes(action);
    }
    
    /**
     * Get user statistics
     */
    async getStatistics() {
        const LocalAssignment = require('./LocalAssignment');
        
        const stats = await LocalAssignment.findAll({
            where: { member_id: this.member_id },
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('*')), 'total'],
                [sequelize.fn('COUNT', sequelize.literal(`CASE WHEN status = 'completed' THEN 1 END`)), 'completed'],
                [sequelize.fn('COUNT', sequelize.literal(`CASE WHEN status = 'cancelled' THEN 1 END`)), 'cancelled']
            ],
            raw: true
        });
        
        return stats[0] || { total: 0, completed: 0, cancelled: 0 };
    }
    
    /**
     * Associate method
     */
    static associate(models) {
        // Associations are defined in models/index.js
    }
}

module.exports = LocalUser;
