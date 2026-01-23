'use strict';

/**
 * Migration 015 - Tables de gestion des plugins
 * 
 * Tables pour le système modulaire de plugins:
 * - plugin_registry: Registre des plugins installés
 * - plugin_configurations: Configuration des plugins
 * - plugin_events: Événements des plugins
 * 
 * @see Document Technique V7.0 - Section 7, Annexe A.7
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // ===========================================
    // TABLE: plugin_registry
    // ===========================================
    await queryInterface.createTable('plugin_registry', {
      plugin_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      plugin_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true,
        comment: 'Nom technique du plugin'
      },
      plugin_version: {
        type: Sequelize.STRING(20),
        allowNull: false,
        comment: 'Version installée'
      },
      display_name: {
        type: Sequelize.STRING(200),
        allowNull: false,
        comment: 'Nom d\'affichage'
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Description du plugin'
      },
      author: {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: 'Auteur'
      },
      category: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'Catégorie (calendar, messaging, reporting, security)'
      },
      status: {
        type: Sequelize.ENUM('available', 'installed', 'active', 'disabled', 'deprecated', 'error'),
        allowNull: false,
        defaultValue: 'available',
        comment: 'Statut du plugin'
      },
      installation_path: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Chemin d\'installation'
      },
      manifest_data: {
        type: Sequelize.JSONB,
        allowNull: false,
        comment: 'Contenu du manifest.json'
      },
      permissions_required: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
        comment: 'Permissions nécessaires'
      },
      dependencies: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
        comment: 'Dépendances vers autres plugins'
      },
      signature_hash: {
        type: Sequelize.STRING(128),
        allowNull: false,
        comment: 'Signature SHA-256 pour authentification'
      },
      download_url: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'URL de téléchargement'
      },
      file_size_bytes: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Taille du plugin'
      },
      min_shugo_version: {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: 'Version SHUGO minimum requise'
      },
      max_shugo_version: {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: 'Version SHUGO maximum supportée'
      },
      installed_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'installation'
      },
      installed_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Installateur'
      },
      activated_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'activation'
      },
      last_updated_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Dernière mise à jour'
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Message d\'erreur si status=error'
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

    // Index plugin_registry
    await queryInterface.addIndex('plugin_registry', ['plugin_name'], { 
      name: 'idx_plugin_registry_name',
      unique: true 
    });
    await queryInterface.addIndex('plugin_registry', ['status'], { name: 'idx_plugin_registry_status' });
    await queryInterface.addIndex('plugin_registry', ['category'], { name: 'idx_plugin_registry_category' });

    // ===========================================
    // TABLE: plugin_configurations
    // ===========================================
    await queryInterface.createTable('plugin_configurations', {
      config_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      plugin_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'plugin_registry',
          key: 'plugin_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Plugin associé'
      },
      config_key: {
        type: Sequelize.STRING(100),
        allowNull: false,
        comment: 'Clé de configuration'
      },
      config_value: {
        type: Sequelize.JSONB,
        allowNull: false,
        comment: 'Valeur de configuration'
      },
      config_type: {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: 'Type de valeur (string, number, boolean, object, array)'
      },
      is_encrypted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Valeur chiffrée'
      },
      is_system_config: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Configuration système (non modifiable par utilisateur)'
      },
      geo_id: {
        type: Sequelize.STRING(16),
        allowNull: true,
        comment: 'Configuration spécifique à un local'
      },
      configured_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Configurateur'
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Description de la configuration'
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

    // Index plugin_configurations
    await queryInterface.addIndex('plugin_configurations', ['plugin_id'], { name: 'idx_plugin_configs_plugin' });
    await queryInterface.addIndex('plugin_configurations', ['config_key'], { name: 'idx_plugin_configs_key' });
    await queryInterface.addIndex('plugin_configurations', ['geo_id'], { name: 'idx_plugin_configs_geo' });

    // Contrainte unicité plugin + key + geo_id
    await queryInterface.addIndex('plugin_configurations', ['plugin_id', 'config_key', 'geo_id'], {
      name: 'idx_plugin_configs_unique',
      unique: true
    });

    // ===========================================
    // TABLE: plugin_events
    // ===========================================
    await queryInterface.createTable('plugin_events', {
      event_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      plugin_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'plugin_registry',
          key: 'plugin_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Plugin source'
      },
      event_type: {
        type: Sequelize.STRING(50),
        allowNull: false,
        comment: 'Type d\'événement (install, activate, deactivate, update, error, etc.)'
      },
      event_data: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Données de l\'événement'
      },
      triggered_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Déclencheur'
      },
      geo_id: {
        type: Sequelize.STRING(16),
        allowNull: true,
        comment: 'Local concerné'
      },
      result: {
        type: Sequelize.ENUM('success', 'failure', 'partial'),
        allowNull: true,
        comment: 'Résultat de l\'événement'
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Message d\'erreur'
      },
      occurred_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: 'Date de l\'événement'
      }
    });

    // Index plugin_events
    await queryInterface.addIndex('plugin_events', ['plugin_id'], { name: 'idx_plugin_events_plugin' });
    await queryInterface.addIndex('plugin_events', ['event_type'], { name: 'idx_plugin_events_type' });
    await queryInterface.addIndex('plugin_events', ['occurred_at'], { name: 'idx_plugin_events_occurred' });

    // ===========================================
    // TABLE: plugin_permissions
    // ===========================================
    await queryInterface.createTable('plugin_permissions', {
      permission_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      plugin_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'plugin_registry',
          key: 'plugin_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Plugin concerné'
      },
      permission_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        comment: 'Nom de la permission'
      },
      permission_scope: {
        type: Sequelize.ENUM('read', 'write', 'admin', 'system'),
        allowNull: false,
        comment: 'Portée de la permission'
      },
      resource_type: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'Type de ressource concernée'
      },
      is_granted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Permission accordée'
      },
      granted_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Qui a accordé la permission'
      },
      granted_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'accord'
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'expiration'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Index plugin_permissions
    await queryInterface.addIndex('plugin_permissions', ['plugin_id'], { name: 'idx_plugin_permissions_plugin' });
    await queryInterface.addIndex('plugin_permissions', ['is_granted'], { name: 'idx_plugin_permissions_granted' });

    console.log('✅ Migration 015: Tables plugin_registry, plugin_configurations, plugin_events, plugin_permissions créées');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('plugin_permissions');
    await queryInterface.dropTable('plugin_events');
    await queryInterface.dropTable('plugin_configurations');
    await queryInterface.dropTable('plugin_registry');
    console.log('⬇️ Migration 015: Tables plugins supprimées');
  }
};
