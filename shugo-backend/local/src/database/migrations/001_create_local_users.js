'use strict';

/**
 * Migration: Table local_users
 * Copie locale des utilisateurs pour le mode offline
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('local_users', {
      member_id: {
        type: Sequelize.STRING(10),
        primaryKey: true
      },
      phonetic_id: {
        type: Sequelize.STRING(20),
        allowNull: false,
        unique: true
      },
      geo_id: {
        type: Sequelize.STRING(20),
        allowNull: false
      },
      pin_hash: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      role: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: 'user'
      },
      permissions: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'JSON des permissions'
      },
      last_sync_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      sync_version: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true
      }
    });

    await queryInterface.addIndex('local_users', ['phonetic_id']);
    await queryInterface.addIndex('local_users', ['geo_id']);
    await queryInterface.addIndex('local_users', ['role']);
    await queryInterface.addIndex('local_users', ['is_active']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('local_users');
  }
};
