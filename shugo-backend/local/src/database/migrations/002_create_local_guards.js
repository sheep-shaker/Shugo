'use strict';

/**
 * Migration: Table local_guards
 * Gardes disponibles localement
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('local_guards', {
      guard_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4
      },
      guard_type: {
        type: Sequelize.STRING(30),
        allowNull: false
      },
      title: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      location: {
        type: Sequelize.STRING(200),
        allowNull: true
      },
      start_date: {
        type: Sequelize.DATE,
        allowNull: false
      },
      end_date: {
        type: Sequelize.DATE,
        allowNull: false
      },
      slots_required: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1
      },
      slots_filled: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      status: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'pending'
      },
      priority: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 5
      },
      visibility: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'public'
      },
      requirements: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'JSON des pré-requis'
      },
      metadata: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'JSON des métadonnées'
      },
      created_by_member_id: {
        type: Sequelize.STRING(10),
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
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true
      }
    });

    await queryInterface.addIndex('local_guards', ['guard_type']);
    await queryInterface.addIndex('local_guards', ['status']);
    await queryInterface.addIndex('local_guards', ['start_date', 'end_date']);
    await queryInterface.addIndex('local_guards', ['visibility']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('local_guards');
  }
};
