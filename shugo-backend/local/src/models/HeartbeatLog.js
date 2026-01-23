// packages/local/src/models/HeartbeatLog.js
// Heartbeat logs for monitoring

const { DataTypes } = require('sequelize');
const BaseModel = require('@shugo/core/models/BaseModel');

class HeartbeatLog extends BaseModel {
    static init(sequelize) {
        return super.initBase(sequelize, 'HeartbeatLog', {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true
            },
            
            server_id: {
                type: DataTypes.STRING(64),
                allowNull: false
            },
            
            status: {
                type: DataTypes.ENUM('success', 'failure'),
                allowNull: false
            },
            
            response_time: {
                type: DataTypes.INTEGER,
                allowNull: true
            },
            
            metrics: {
                type: DataTypes.JSON,
                allowNull: true
            },
            
            error: {
                type: DataTypes.TEXT,
                allowNull: true
            }
        }, {
            tableName: 'heartbeat_logs',
            indexes: [
                { fields: ['server_id'] },
                { fields: ['status'] },
                { fields: ['created_at'] }
            ]
        });
    }
}

module.exports = HeartbeatLog;
