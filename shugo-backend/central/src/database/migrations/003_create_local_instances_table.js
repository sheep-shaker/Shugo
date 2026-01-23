'use strict';

/**
 * Migration 003 - Table local_instances
 * 
 * Registre des serveurs locaux (Raspberry Pi) connectés au central.
 * Chaque serveur local est identifié par un server_id unique et rattaché à un geo_id.
 * 
 * Fonctionnalités:
 * - Heartbeat monitoring (last_seen)
 * - Gestion des statuts (active, inactive, maintenance, spare)
 * - Hiérarchie parent/enfant via parent_geo_id
 * - Tracking des versions et maintenances
 * 
 * @see Document Technique V7.0 - Section 2.1.2, Annexe A.1.2
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('local_instances', {
      instance_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique de l\'instance'
      },
      geo_id: {
        type: Sequelize.STRING(16),
        allowNull: false,
        references: {
          model: 'locations',
          key: 'geo_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
        comment: 'Rattachement géographique'
      },
      parent_geo_id: {
        type: Sequelize.STRING(16),
        allowNull: true,
        references: {
          model: 'locations',
          key: 'geo_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Référence hiérarchique vers local parent'
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
        comment: 'Nom du serveur local'
      },
      server_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true,
        comment: 'Identifiant unique du serveur (UUID + empreinte matérielle)'
      },
      ip_address: {
        type: Sequelize.INET,
        allowNull: true,
        comment: 'Adresse IP du serveur local'
      },
      port: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 443,
        comment: 'Port de communication HTTPS'
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive', 'maintenance', 'spare', 'error'),
        allowNull: false,
        defaultValue: 'inactive',
        comment: 'Statut opérationnel du serveur'
      },
      version: {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: 'Version SHUGO installée'
      },
      last_seen: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Dernière communication (heartbeat)'
      },
      last_maintenance: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Dernière maintenance nocturne réussie'
      },
      heartbeat_interval: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 300,
        comment: 'Intervalle heartbeat en secondes (défaut 5 min)'
      },
      
      // === CONFIGURATION SYNC ===
      sync_enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Synchronisation activée'
      },
      sync_interval: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 3600,
        comment: 'Intervalle de sync en secondes (défaut 1h)'
      },
      last_sync_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Dernière synchronisation réussie'
      },
      sync_status: {
        type: Sequelize.ENUM('idle', 'syncing', 'error', 'pending'),
        allowNull: false,
        defaultValue: 'idle',
        comment: 'Statut de synchronisation'
      },
      
      // === MÉTRIQUES ===
      cpu_usage: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
        comment: 'Utilisation CPU (%)'
      },
      memory_usage: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
        comment: 'Utilisation mémoire (%)'
      },
      disk_usage: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
        comment: 'Utilisation disque (%)'
      },
      
      // === TIMESTAMPS ===
      registered_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: 'Date d\'enregistrement'
      },
      activated_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'activation'
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

    // === INDEX ===
    await queryInterface.addIndex('local_instances', ['geo_id'], {
      name: 'idx_local_instances_geo_id'
    });

    await queryInterface.addIndex('local_instances', ['parent_geo_id'], {
      name: 'idx_local_instances_parent'
    });

    await queryInterface.addIndex('local_instances', ['status'], {
      name: 'idx_local_instances_status'
    });

    await queryInterface.addIndex('local_instances', ['last_seen'], {
      name: 'idx_local_instances_last_seen'
    });

    await queryInterface.addIndex('local_instances', ['server_id'], {
      name: 'idx_local_instances_server_id',
      unique: true
    });

    // === CONTRAINTES ===
    await queryInterface.sequelize.query(`
      ALTER TABLE local_instances 
      ADD CONSTRAINT chk_port_range 
      CHECK (port BETWEEN 1 AND 65535)
    `);

    console.log('✅ Migration 003: Table local_instances créée avec succès');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('local_instances');
    console.log('⬇️ Migration 003: Table local_instances supprimée');
  }
};
