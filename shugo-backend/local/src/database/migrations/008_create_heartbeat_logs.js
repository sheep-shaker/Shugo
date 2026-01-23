'use strict';

/**
 * Migration: Table heartbeat_logs
 * Historique des heartbeats vers le central
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('heartbeat_logs', {
      log_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4
      },
      status: {
        type: Sequelize.STRING(20),
        allowNull: false,
        comment: 'success, failed, timeout'
      },
      response_time_ms: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      central_response: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'JSON de la réponse du central'
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      metrics: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'JSON des métriques envoyées'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('heartbeat_logs', ['status']);
    await queryInterface.addIndex('heartbeat_logs', ['created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('heartbeat_logs');
  }
};
