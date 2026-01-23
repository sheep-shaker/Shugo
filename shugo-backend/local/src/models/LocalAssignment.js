// packages/local/src/models/LocalAssignment.js
// Local assignment model - Guard assignments

const { DataTypes } = require('sequelize');
const BaseModel = require('@shugo/core/models/BaseModel');

class LocalAssignment extends BaseModel {
    static init(sequelize) {
        return super.initBase(sequelize, 'LocalAssignment', {
            assignment_id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true
            },
            
            guard_id: {
                type: DataTypes.UUID,
                allowNull: false
            },
            
            member_id: {
                type: DataTypes.BIGINT,
                allowNull: false
            },
            
            assigned_by_member_id: {
                type: DataTypes.BIGINT,
                allowNull: false
            },
            
            assignment_type: {
                type: DataTypes.ENUM('voluntary', 'assigned', 'automatic'),
                defaultValue: 'voluntary'
            },
            
            status: {
                type: DataTypes.ENUM('confirmed', 'pending', 'cancelled'),
                defaultValue: 'confirmed'
            },
            
            assigned_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW
            },
            
            confirmed_at: {
                type: DataTypes.DATE,
                allowNull: true
            },
            
            cancelled_at: {
                type: DataTypes.DATE,
                allowNull: true
            },
            
            cancellation_reason: {
                type: DataTypes.TEXT,
                allowNull: true
            },
            
            replacement_requested: {
                type: DataTypes.BOOLEAN,
                defaultValue: false
            },
            
            replacement_member_id: {
                type: DataTypes.BIGINT,
                allowNull: true
            },
            
            replacement_deadline: {
                type: DataTypes.DATE,
                allowNull: true
            },
            
            notes: {
                type: DataTypes.TEXT,
                allowNull: true
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
            tableName: 'local_assignments',
            indexes: [
                { fields: ['guard_id'] },
                { fields: ['member_id'] },
                { fields: ['assigned_by_member_id'] },
                { fields: ['status'] },
                { fields: ['synced'] },
                { 
                    fields: ['guard_id', 'member_id'],
                    unique: true,
                    where: {
                        status: ['confirmed', 'pending']
                    }
                }
            ]
        });
    }
    
    static associate(models) {
        // Defined in models/index.js
    }
}

module.exports = LocalAssignment;
