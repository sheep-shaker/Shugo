'use strict';

/**
 * Migration: Table local_changes
 * Historique des changements locaux pour sync différentielle
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('local_changes', {
      change_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4
      },
      table_name: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      record_id: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      operation: {
        type: Sequelize.STRING(20),
        allowNull: false
      },
      old_data: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'JSON des anciennes valeurs'
      },
      new_data: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'JSON des nouvelles valeurs'
      },
      changed_by_member_id: {
        type: Sequelize.STRING(10),
        allowNull: true
      },
      synced: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      synced_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('local_changes', ['synced']);
    await queryInterface.addIndex('local_changes', ['table_name', 'record_id']);
    await queryInterface.addIndex('local_changes', ['created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('local_changes');
  }
};
