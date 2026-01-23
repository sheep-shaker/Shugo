// packages/local/src/models/LocalConfig.js
// Local configuration storage

const { DataTypes } = require('sequelize');
const BaseModel = require('@shugo/core/models/BaseModel');

class LocalConfig extends BaseModel {
    static init(sequelize) {
        return super.initBase(sequelize, 'LocalConfig', {
            key: {
                type: DataTypes.STRING(100),
                primaryKey: true
            },
            
            value: {
                type: DataTypes.JSON,
                allowNull: false
            },
            
            category: {
                type: DataTypes.STRING(50),
                defaultValue: 'general'
            },
            
            description: {
                type: DataTypes.TEXT,
                allowNull: true
            }
        }, {
            tableName: 'local_config',
            indexes: [
                { fields: ['category'] }
            ]
        });
    }
}

module.exports = LocalConfig;
