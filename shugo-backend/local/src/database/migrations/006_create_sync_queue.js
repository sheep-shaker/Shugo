'use strict';

/**
 * Migration: Table sync_queue
 * File d'attente de synchronisation avec le central
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('sync_queue', {
      queue_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4
      },
      operation: {
        type: Sequelize.STRING(20),
        allowNull: false,
        comment: 'create, update, delete'
      },
      table_name: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      record_id: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      data: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'JSON des données à synchroniser'
      },
      priority: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 5,
        comment: '1=haute, 10=basse'
      },
      status: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'pending',
        comment: 'pending, processing, completed, failed'
      },
      attempts: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      max_attempts: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 5
      },
      last_error: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      last_attempt_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      completed_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('sync_queue', ['status', 'priority']);
    await queryInterface.addIndex('sync_queue', ['table_name', 'record_id']);
    await queryInterface.addIndex('sync_queue', ['created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('sync_queue');
  }
};
