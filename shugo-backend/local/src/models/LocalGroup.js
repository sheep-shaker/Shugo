// packages/local/src/models/LocalGroup.js
// Local group model

const { DataTypes } = require('sequelize');
const BaseModel = require('@shugo/core/models/BaseModel');

class LocalGroup extends BaseModel {
    static init(sequelize) {
        return super.initBase(sequelize, 'LocalGroup', {
            group_id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true
            },
            
            name: {
                type: DataTypes.STRING(100),
                allowNull: false,
                unique: true
            },
            
            description: {
                type: DataTypes.TEXT,
                allowNull: true
            },
            
            geo_id: {
                type: DataTypes.STRING(16),
                allowNull: false
            },
            
            parent_group_id: {
                type: DataTypes.UUID,
                allowNull: true
            },
            
            leader_member_id: {
                type: DataTypes.BIGINT,
                allowNull: true
            },
            
            max_members: {
                type: DataTypes.INTEGER,
                defaultValue: 50
            },
            
            current_members: {
                type: DataTypes.INTEGER,
                defaultValue: 0
            },
            
            color_code: {
                type: DataTypes.STRING(7),
                allowNull: true,
                validate: {
                    is: /^[0-9A-Fa-f]{6}$/
                }
            },
            
            status: {
                type: DataTypes.ENUM('active', 'inactive', 'archived'),
                defaultValue: 'active'
            },
            
            // Sync
            synced: {
                type: DataTypes.BOOLEAN,
                defaultValue: false
            },
            
            last_sync_at: {
                type: DataTypes.DATE,
                allowNull: true
            }
        }, {
            tableName: 'local_groups',
            indexes: [
                { fields: ['geo_id'] },
                { fields: ['leader_member_id'] },
                { fields: ['status'] }
            ]
        });
    }
    
    static associate(models) {
        // Defined in models/index.js
    }
}

module.exports = LocalGroup;
