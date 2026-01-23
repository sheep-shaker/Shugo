'use strict';

/**
 * Migration: Table local_config
 * Configuration persistante du serveur local
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('local_config', {
      key: {
        type: Sequelize.STRING(100),
        primaryKey: true
      },
      value: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      value_type: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'string',
        comment: 'string, number, boolean, json'
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      encrypted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      synced_from_central: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Insérer la configuration par défaut
    await queryInterface.bulkInsert('local_config', [
      { key: 'instance_id', value: null, value_type: 'string', description: 'ID unique de l\'instance' },
      { key: 'geo_id', value: null, value_type: 'string', description: 'Zone géographique' },
      { key: 'last_full_sync', value: null, value_type: 'string', description: 'Date dernière sync complète' },
      { key: 'last_delta_sync', value: null, value_type: 'string', description: 'Date dernière sync delta' },
      { key: 'sync_version', value: '0', value_type: 'number', description: 'Version de sync' },
      { key: 'offline_since', value: null, value_type: 'string', description: 'Date début mode offline' },
      { key: 'maintenance_mode', value: 'false', value_type: 'boolean', description: 'Mode maintenance' }
    ]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('local_config');
  }
};
