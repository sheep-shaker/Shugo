'use strict';

/**
 * Migration: Table local_assignments
 * Assignations locales de gardes
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('local_assignments', {
      assignment_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4
      },
      guard_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'local_guards',
          key: 'guard_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
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
      slot_number: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1
      },
      status: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'confirmed',
        comment: 'confirmed, pending, cancelled, completed'
      },
      assigned_by_member_id: {
        type: Sequelize.STRING(10),
        allowNull: true
      },
      assigned_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      confirmed_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      check_in_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      check_out_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      notes: {
        type: Sequelize.TEXT,
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

    await queryInterface.addIndex('local_assignments', ['guard_id']);
    await queryInterface.addIndex('local_assignments', ['member_id']);
    await queryInterface.addIndex('local_assignments', ['status']);
    await queryInterface.addIndex('local_assignments', ['guard_id', 'member_id'], { unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('local_assignments');
  }
};
