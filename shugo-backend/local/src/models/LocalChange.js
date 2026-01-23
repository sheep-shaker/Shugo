// packages/local/src/models/LocalChange.js
// Track local changes for sync

const { DataTypes } = require('sequelize');
const BaseModel = require('@shugo/core/models/BaseModel');

class LocalChange extends BaseModel {
    static init(sequelize) {
        return super.initBase(sequelize, 'LocalChange', {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true
            },
            
            entity: {
                type: DataTypes.STRING(50),
                allowNull: false
            },
            
            entity_id: {
                type: DataTypes.STRING(100),
                allowNull: false
            },
            
            operation: {
                type: DataTypes.ENUM('create', 'update', 'delete'),
                allowNull: false
            },
            
            data: {
                type: DataTypes.JSON,
                allowNull: false
            },
            
            pushed: {
                type: DataTypes.BOOLEAN,
                defaultValue: false
            },
            
            pushed_at: {
                type: DataTypes.DATE,
                allowNull: true
            }
        }, {
            tableName: 'local_changes',
            indexes: [
                { fields: ['entity', 'entity_id'] },
                { fields: ['pushed'] },
                { fields: ['created_at'] }
            ]
        });
    }
}

module.exports = LocalChange;
