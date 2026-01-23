// packages/local/src/models/LocalGroupMembership.js
// Local group membership model

const { DataTypes } = require('sequelize');
const BaseModel = require('@shugo/core/models/BaseModel');

class LocalGroupMembership extends BaseModel {
    static init(sequelize) {
        return super.initBase(sequelize, 'LocalGroupMembership', {
            membership_id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true
            },
            
            group_id: {
                type: DataTypes.UUID,
                allowNull: false
            },
            
            member_id: {
                type: DataTypes.BIGINT,
                allowNull: false
            },
            
            role_in_group: {
                type: DataTypes.ENUM('member', 'deputy', 'leader'),
                defaultValue: 'member'
            },
            
            joined_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW
            },
            
            left_at: {
                type: DataTypes.DATE,
                allowNull: true
            },
            
            is_active: {
                type: DataTypes.BOOLEAN,
                defaultValue: true
            }
        }, {
            tableName: 'local_group_memberships',
            indexes: [
                { fields: ['group_id'] },
                { fields: ['member_id'] },
                { fields: ['is_active'] },
                { 
                    fields: ['group_id', 'member_id'],
                    unique: true,
                    where: { is_active: true }
                }
            ]
        });
    }
    
    static associate(models) {
        // Defined in models/index.js
    }
}

module.exports = LocalGroupMembership;
