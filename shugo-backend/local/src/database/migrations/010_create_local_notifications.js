'use strict';

/**
 * Migration: Table local_notifications
 * Notifications locales
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('local_notifications', {
      notification_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4
      },
      member_id: {
        type: Sequelize.STRING(10),
        allowNull: false,
        references: {
          model: 'local_users',
          key: 'member_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      type: {
        type: Sequelize.STRING(50),
        allowNull: false,
        comment: 'guard_reminder, assignment, system, etc.'
      },
      title: {
        type: Sequelize.STRING(200),
        allowNull: false
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      priority: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'normal',
        comment: 'low, normal, high, urgent'
      },
      data: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'JSON des données additionnelles'
      },
      read_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      dismissed_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: true
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
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('local_notifications', ['member_id']);
    await queryInterface.addIndex('local_notifications', ['type']);
    await queryInterface.addIndex('local_notifications', ['read_at']);
    await queryInterface.addIndex('local_notifications', ['created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('local_notifications');
  }
};
