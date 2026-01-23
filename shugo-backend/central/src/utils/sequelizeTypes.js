/**
 * SHUGO v7.0 - Sequelize Types Helper
 *
 * Provides dialect-aware type mappings for Sequelize models.
 * Handles differences between PostgreSQL and SQLite.
 */

'use strict';

const { DataTypes } = require('sequelize');
const config = require('../config');

// Detect dialect
const isSQLite = config.database.dialect === 'sqlite';

/**
 * Get the appropriate JSON type for the current dialect
 * PostgreSQL: JSONB (binary JSON, faster queries)
 * SQLite: TEXT (stored as string, parsed on access)
 */
function getJsonType() {
    return isSQLite ? DataTypes.TEXT : DataTypes.JSONB;
}

/**
 * Get JSON field definition with getter/setter for SQLite compatibility
 */
function jsonField(defaultValue = {}) {
    if (isSQLite) {
        return {
            type: DataTypes.TEXT,
            defaultValue: JSON.stringify(defaultValue),
            get() {
                const value = this.getDataValue(this.constructor.name);
                if (!value) return defaultValue;
                try {
                    return typeof value === 'string' ? JSON.parse(value) : value;
                } catch {
                    return defaultValue;
                }
            },
            set(value) {
                this.setDataValue(this.constructor.name, JSON.stringify(value));
            }
        };
    }
    return {
        type: DataTypes.JSONB,
        defaultValue
    };
}

/**
 * Get array field definition
 * PostgreSQL: Native ARRAY type
 * SQLite: TEXT with JSON serialization
 */
function arrayField(itemType = DataTypes.STRING, defaultValue = []) {
    if (isSQLite) {
        return {
            type: DataTypes.TEXT,
            defaultValue: JSON.stringify(defaultValue),
            get() {
                const rawValue = this.getDataValue(this.constructor.name);
                if (!rawValue) return defaultValue;
                try {
                    return typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
                } catch {
                    return defaultValue;
                }
            },
            set(value) {
                this.setDataValue(this.constructor.name, JSON.stringify(Array.isArray(value) ? value : []));
            }
        };
    }
    return {
        type: DataTypes.ARRAY(itemType),
        defaultValue
    };
}

/**
 * Export dialect info and type helpers
 */
module.exports = {
    isSQLite,
    isPostgres: !isSQLite,
    getJsonType,
    jsonField,
    arrayField,

    // Convenience: common types that work across dialects
    JSON_TYPE: isSQLite ? DataTypes.TEXT : DataTypes.JSONB,
    UUID_TYPE: DataTypes.UUID,

    // Helper to create JSON default value string for SQLite
    jsonDefault: (obj) => isSQLite ? JSON.stringify(obj) : obj
};
