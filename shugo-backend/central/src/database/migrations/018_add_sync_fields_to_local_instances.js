'use strict';

/**
 * Migration: Ajouter les champs de synchronisation à local_instances
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // Ajouter shared_secret (chiffré)
    await queryInterface.addColumn('local_instances', 'shared_secret', {
      type: Sequelize.STRING(255),
      allowNull: true,
      comment: 'Shared secret for HMAC authentication (encrypted)'
    });

    // Ajouter last_heartbeat
    await queryInterface.addColumn('local_instances', 'last_heartbeat', {
      type: Sequelize.DATE,
      allowNull: true
    });

    // Ajouter last_full_sync
    await queryInterface.addColumn('local_instances', 'last_full_sync', {
      type: Sequelize.DATE,
      allowNull: true
    });

    // Ajouter last_delta_sync
    await queryInterface.addColumn('local_instances', 'last_delta_sync', {
      type: Sequelize.DATE,
      allowNull: true
    });

    // Ajouter needs_full_sync
    await queryInterface.addColumn('local_instances', 'needs_full_sync', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true
    });

    // Ajouter sync_queue_size
    await queryInterface.addColumn('local_instances', 'sync_queue_size', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0
    });

    // Ajouter metrics (JSONB pour stocker les métriques)
    await queryInterface.addColumn('local_instances', 'metrics', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: {}
    });

    console.log('Migration 018: Champs sync ajoutés à local_instances');
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('local_instances', 'shared_secret');
    await queryInterface.removeColumn('local_instances', 'last_heartbeat');
    await queryInterface.removeColumn('local_instances', 'last_full_sync');
    await queryInterface.removeColumn('local_instances', 'last_delta_sync');
    await queryInterface.removeColumn('local_instances', 'needs_full_sync');
    await queryInterface.removeColumn('local_instances', 'sync_queue_size');
    await queryInterface.removeColumn('local_instances', 'metrics');

    console.log('Migration 018: Champs sync supprimés');
  }
};
