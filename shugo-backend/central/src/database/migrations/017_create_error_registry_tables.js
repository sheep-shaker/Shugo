'use strict';

/**
 * SHUGO v7.0 - Migration: Tables de registre d'erreurs
 *
 * Crée les tables pour le suivi centralisé des codes d'erreurs
 * et l'enregistrement des occurrences d'erreurs.
 *
 * @see Document Technique V7.0 - Chapitre 9
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // ============================================
    // Table: error_codes_registry
    // Registre centralisé des codes d'erreurs système
    // ============================================
    await queryInterface.createTable('error_codes_registry', {
      error_code: {
        type: Sequelize.STRING(20),
        primaryKey: true,
        allowNull: false,
        comment: 'Code unique de l\'erreur (ex: AUTH_001, GUARD_002)'
      },
      category: {
        type: Sequelize.ENUM(
          'auth',           // Authentification
          'user',           // Gestion utilisateurs
          'guard',          // Gestion gardes
          'group',          // Gestion groupes
          'notification',   // Notifications
          'sync',           // Synchronisation
          'vault',          // Coffre-fort
          'protocol',       // Protocoles système
          'backup',         // Sauvegardes
          'maintenance',    // Maintenance
          'plugin',         // Plugins
          'system',         // Système général
          'validation',     // Validation données
          'network',        // Réseau
          'database'        // Base de données
        ),
        allowNull: false,
        comment: 'Catégorie de l\'erreur'
      },
      severity: {
        type: Sequelize.ENUM('info', 'warning', 'error', 'critical', 'emergency'),
        allowNull: false,
        defaultValue: 'error',
        comment: 'Niveau de sévérité'
      },
      http_status: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Code HTTP associé si applicable'
      },
      message_fr: {
        type: Sequelize.STRING(500),
        allowNull: false,
        comment: 'Message d\'erreur en français'
      },
      message_en: {
        type: Sequelize.STRING(500),
        allowNull: true,
        comment: 'Message d\'erreur en anglais'
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Description détaillée de l\'erreur'
      },
      resolution_hint: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Suggestion de résolution'
      },
      is_user_facing: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Si true, le message peut être affiché à l\'utilisateur'
      },
      is_retryable: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Si true, l\'opération peut être réessayée'
      },
      requires_notification: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Si true, déclenche une notification admin'
      },
      related_protocol: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'Protocole système associé si applicable'
      },
      active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Si le code d\'erreur est actif'
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

    // Index sur error_codes_registry
    await queryInterface.addIndex('error_codes_registry', ['category'], {
      name: 'idx_error_codes_category'
    });
    await queryInterface.addIndex('error_codes_registry', ['severity'], {
      name: 'idx_error_codes_severity'
    });
    await queryInterface.addIndex('error_codes_registry', ['active'], {
      name: 'idx_error_codes_active'
    });

    // ============================================
    // Table: error_occurrences
    // Log des occurrences d'erreurs
    // ============================================
    await queryInterface.createTable('error_occurrences', {
      occurrence_id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      error_code: {
        type: Sequelize.STRING(20),
        allowNull: false,
        references: {
          model: 'error_codes_registry',
          key: 'error_code'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
        comment: 'Code d\'erreur référencé'
      },
      member_id: {
        type: Sequelize.STRING(10),
        allowNull: true,
        references: {
          model: 'users',
          key: 'member_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Utilisateur concerné si applicable'
      },
      session_id: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: 'Session concernée si applicable'
      },
      request_id: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: 'ID de la requête HTTP'
      },
      local_instance_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'local_instances',
          key: 'instance_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Instance locale concernée si applicable'
      },
      source: {
        type: Sequelize.ENUM('central', 'local', 'api', 'job', 'sync', 'plugin'),
        allowNull: false,
        defaultValue: 'central',
        comment: 'Source de l\'erreur'
      },
      endpoint: {
        type: Sequelize.STRING(200),
        allowNull: true,
        comment: 'Endpoint API concerné'
      },
      method: {
        type: Sequelize.STRING(10),
        allowNull: true,
        comment: 'Méthode HTTP (GET, POST, etc.)'
      },
      ip_address: {
        type: Sequelize.STRING(45),
        allowNull: true,
        comment: 'Adresse IP de la requête'
      },
      user_agent: {
        type: Sequelize.STRING(500),
        allowNull: true,
        comment: 'User agent du client'
      },
      stack_trace: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Stack trace complète'
      },
      context: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Contexte additionnel (params, body, etc.)'
      },
      resolved: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Si l\'erreur a été résolue'
      },
      resolved_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date de résolution'
      },
      resolved_by_member_id: {
        type: Sequelize.STRING(10),
        allowNull: true,
        references: {
          model: 'users',
          key: 'member_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Membre ayant résolu l\'erreur'
      },
      resolution_notes: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Notes de résolution'
      },
      notification_sent: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Si une notification a été envoyée'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Index sur error_occurrences
    await queryInterface.addIndex('error_occurrences', ['error_code'], {
      name: 'idx_error_occurrences_code'
    });
    await queryInterface.addIndex('error_occurrences', ['member_id'], {
      name: 'idx_error_occurrences_member'
    });
    await queryInterface.addIndex('error_occurrences', ['local_instance_id'], {
      name: 'idx_error_occurrences_instance'
    });
    await queryInterface.addIndex('error_occurrences', ['source'], {
      name: 'idx_error_occurrences_source'
    });
    await queryInterface.addIndex('error_occurrences', ['created_at'], {
      name: 'idx_error_occurrences_created'
    });
    await queryInterface.addIndex('error_occurrences', ['resolved'], {
      name: 'idx_error_occurrences_resolved'
    });
    await queryInterface.addIndex('error_occurrences', ['error_code', 'created_at'], {
      name: 'idx_error_occurrences_code_date'
    });

    // ============================================
    // Table: error_aggregates
    // Agrégats d'erreurs pour reporting
    // ============================================
    await queryInterface.createTable('error_aggregates', {
      aggregate_id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      error_code: {
        type: Sequelize.STRING(20),
        allowNull: false,
        references: {
          model: 'error_codes_registry',
          key: 'error_code'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      period_type: {
        type: Sequelize.ENUM('hourly', 'daily', 'weekly', 'monthly'),
        allowNull: false,
        comment: 'Type de période d\'agrégation'
      },
      period_start: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: 'Début de la période'
      },
      period_end: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: 'Fin de la période'
      },
      occurrence_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Nombre d\'occurrences'
      },
      unique_users: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Nombre d\'utilisateurs uniques'
      },
      unique_instances: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Nombre d\'instances locales uniques'
      },
      resolved_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Nombre d\'erreurs résolues'
      },
      avg_resolution_time_minutes: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        comment: 'Temps moyen de résolution en minutes'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Index sur error_aggregates
    await queryInterface.addIndex('error_aggregates', ['error_code', 'period_type', 'period_start'], {
      name: 'idx_error_aggregates_lookup',
      unique: true
    });
    await queryInterface.addIndex('error_aggregates', ['period_start'], {
      name: 'idx_error_aggregates_period'
    });

    console.log('Migration 017: Tables error_codes_registry, error_occurrences, error_aggregates créées');
  },

  async down(queryInterface, Sequelize) {
    // Supprimer les tables dans l'ordre inverse (dépendances)
    await queryInterface.dropTable('error_aggregates');
    await queryInterface.dropTable('error_occurrences');
    await queryInterface.dropTable('error_codes_registry');

    console.log('Migration 017: Tables d\'erreurs supprimées');
  }
};
