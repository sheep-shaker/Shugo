// packages/local/src/models/LocalNotification.js
// Local notifications model

const { DataTypes } = require('sequelize');
const BaseModel = require('@shugo/core/models/BaseModel');

class LocalNotification extends BaseModel {
    static init(sequelize) {
        return super.initBase(sequelize, 'LocalNotification', {
            notification_id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true
            },
            
            member_id: {
                type: DataTypes.BIGINT,
                allowNull: false
            },
            
            type: {
                type: DataTypes.STRING(50),
                allowNull: false
            },
            
            title: {
                type: DataTypes.STRING(200),
                allowNull: false
            },
            
            message: {
                type: DataTypes.TEXT,
                allowNull: false
            },
            
            priority: {
                type: DataTypes.ENUM('low', 'normal', 'high', 'urgent'),
                defaultValue: 'normal'
            },
            
            status: {
                type: DataTypes.ENUM('pending', 'sent', 'read', 'failed'),
                defaultValue: 'pending'
            },
            
            sent_at: {
                type: DataTypes.DATE,
                allowNull: true
            },
            
            read_at: {
                type: DataTypes.DATE,
                allowNull: true
            },
            
            data: {
                type: DataTypes.JSON,
                allowNull: true
            }
        }, {
            tableName: 'local_notifications',
            indexes: [
                { fields: ['member_id'] },
                { fields: ['status'] },
                { fields: ['priority'] }
            ]
        });
    }
    
    static associate(models) {
        // Defined in models/index.js
    }
}

module.exports = LocalNotification;
