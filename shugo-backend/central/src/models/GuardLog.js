// models/GuardLog.js
// Model for guard action logging

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

const GuardLog = sequelize.define('GuardLog', {
    log_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    guard_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    member_id: {
        type: DataTypes.BIGINT,
        allowNull: false
    },
    action: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
            isIn: [[
                'create',
                'update',
                'cancel',
                'cancel_guard',
                'register',
                'waiting_list_add',
                'waiting_list_remove',
                'auto_assign',
                'replacement_request',
                'replacement_accept',
                'replacement_reject'
            ]]
        }
    },
    details: {
        type: DataTypes.JSON,
        defaultValue: {}
    },
    notification_sent: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
}, {
    tableName: 'guard_logs',
    timestamps: true,
    underscored: true,
    indexes: [
        {
            fields: ['guard_id', 'created_at'],
            name: 'idx_guard_log_time'
        },
        {
            fields: ['member_id', 'action'],
            name: 'idx_member_action'
        }
    ]
});

module.exports = GuardLog;
