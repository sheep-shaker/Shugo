'use strict';

/**
 * Migration: Table local_groups
 * Groupes locaux
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('local_groups', {
      group_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      group_type: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: 'standard'
      },
      leader_member_id: {
        type: Sequelize.STRING(10),
        allowNull: true,
        references: {
          model: 'local_users',
          key: 'member_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      capacity: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      member_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      metadata: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'JSON des métadonnées'
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

    await queryInterface.addIndex('local_groups', ['name']);
    await queryInterface.addIndex('local_groups', ['group_type']);
    await queryInterface.addIndex('local_groups', ['is_active']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('local_groups');
  }
};
