'use strict';

/**
 * Migration: Table local_group_memberships
 * Appartenance aux groupes locaux
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('local_group_memberships', {
      membership_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4
      },
      group_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'local_groups',
          key: 'group_id'
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
      role_in_group: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: 'member',
        comment: 'leader, co-leader, member'
      },
      joined_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
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

    await queryInterface.addIndex('local_group_memberships', ['group_id']);
    await queryInterface.addIndex('local_group_memberships', ['member_id']);
    await queryInterface.addIndex('local_group_memberships', ['group_id', 'member_id'], { unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('local_group_memberships');
  }
};
