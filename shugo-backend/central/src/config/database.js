'use strict';

/**
 * Configuration Sequelize pour PostgreSQL
 * 
 * Utilisé par sequelize-cli et l'application.
 * 
 * @see Document Technique V7.0 - Section 2.3, 2.8
 */

require('dotenv').config();

const config = require('./index');

/**
 * Configuration Sequelize par environnement
 */
module.exports = {
  development: {
    username: config.database.user,
    password: config.database.password,
    database: config.database.name,
    host: config.database.host,
    port: config.database.port,
    dialect: 'postgres',
    logging: console.log,
    pool: config.database.pool,
    timezone: config.database.timezone,
    define: {
      timestamps: true,
      underscored: true, // snake_case pour les colonnes
      freezeTableName: true,
      paranoid: false // Pas de soft delete global, géré par table
    },
    dialectOptions: {
      useUTC: true,
      dateStrings: true,
      typeCast: true
    }
  },

  test: {
    username: process.env.TEST_DB_USER || config.database.user,
    password: process.env.TEST_DB_PASSWORD || config.database.password,
    database: process.env.TEST_DB_NAME || 'shugo_test',
    host: process.env.TEST_DB_HOST || config.database.host,
    port: parseInt(process.env.TEST_DB_PORT, 10) || config.database.port,
    dialect: 'postgres',
    logging: false,
    pool: {
      max: 5,
      min: 1,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true
    }
  },

  production: {
    username: config.database.user,
    password: config.database.password,
    database: config.database.name,
    host: config.database.host,
    port: config.database.port,
    dialect: 'postgres',
    logging: false,
    pool: config.database.pool,
    timezone: config.database.timezone,
    dialectOptions: {
      ssl: config.database.ssl,
      useUTC: true,
      dateStrings: true,
      typeCast: true,
      // Paramètres de connexion
      connectTimeout: 60000,
      statement_timeout: 30000,
      idle_in_transaction_session_timeout: 60000
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true,
      paranoid: false
    },
    // Réplication (si configurée)
    ...(process.env.DB_REPLICA_HOST && {
      replication: {
        read: [
          {
            host: process.env.DB_REPLICA_HOST,
            username: process.env.DB_REPLICA_USER || config.database.user,
            password: process.env.DB_REPLICA_PASSWORD || config.database.password
          }
        ],
        write: {
          host: config.database.host,
          username: config.database.user,
          password: config.database.password
        }
      }
    })
  }
};
