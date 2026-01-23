'use strict';

/**
 * Migration 013 - Tables de maintenance et monitoring
 * 
 * Tables pour la maintenance autonome et l'auto-diagnostic:
 * - maintenance_runs: Historique des maintenances nocturnes
 * - health_checks: Résultats des contrôles de santé
 * - system_metrics: Métriques système (CPU, RAM, disque)
 * - error_codes_registry: Registre des codes erreur SHUGO-*
 * - error_occurrences: Occurrences d'erreurs
 * 
 * @see Document Technique V7.0 - Section 11, Annexe A.4
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // ===========================================
    // TABLE: maintenance_runs
    // ===========================================
    await queryInterface.createTable('maintenance_runs', {
      run_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      run_type: {
        type: Sequelize.ENUM('daily', 'weekly', 'monthly', 'emergency', 'manual'),
        allowNull: false,
        comment: 'Type de maintenance'
      },
      geo_id: {
        type: Sequelize.STRING(16),
        allowNull: true,
        comment: 'Local concerné (NULL pour central)'
      },
      server_id: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Serveur concerné'
      },
      scheduled_at: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: 'Date prévue'
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Début d\'exécution'
      },
      completed_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Fin d\'exécution'
      },
      status: {
        type: Sequelize.ENUM('scheduled', 'running', 'completed', 'failed', 'cancelled', 'partial'),
        allowNull: false,
        defaultValue: 'scheduled',
        comment: 'Statut de la maintenance'
      },
      steps_total: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Nombre total d\'étapes'
      },
      steps_completed: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Étapes complétées'
      },
      steps_details: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
        comment: 'Détails des étapes [{name, status, duration}]'
      },
      errors_encountered: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
        comment: 'Erreurs rencontrées'
      },
      metrics: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {},
        comment: 'Métriques de performance'
      },
      duration_seconds: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Durée totale en secondes'
      },
      triggered_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Déclencheur manuel'
      },
      next_run_scheduled: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Prochaine exécution prévue'
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Notes'
      }
    });

    // Index maintenance_runs
    await queryInterface.addIndex('maintenance_runs', ['run_type'], { name: 'idx_maintenance_runs_type' });
    await queryInterface.addIndex('maintenance_runs', ['status'], { name: 'idx_maintenance_runs_status' });
    await queryInterface.addIndex('maintenance_runs', ['scheduled_at'], { name: 'idx_maintenance_runs_scheduled' });
    await queryInterface.addIndex('maintenance_runs', ['geo_id'], { name: 'idx_maintenance_runs_geo' });

    // ===========================================
    // TABLE: health_checks
    // ===========================================
    await queryInterface.createTable('health_checks', {
      check_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      check_type: {
        type: Sequelize.STRING(50),
        allowNull: false,
        comment: 'Type (system, database, vault, network, security, service)'
      },
      component_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        comment: 'Composant vérifié'
      },
      check_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        comment: 'Nom du contrôle'
      },
      status: {
        type: Sequelize.ENUM('healthy', 'warning', 'critical', 'unknown'),
        allowNull: false,
        comment: 'Statut résultant'
      },
      response_time_ms: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Temps de réponse en ms'
      },
      geo_id: {
        type: Sequelize.STRING(16),
        allowNull: true,
        comment: 'Local concerné'
      },
      server_id: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Serveur concerné'
      },
      details: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Détails du contrôle'
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Message d\'erreur si problème'
      },
      threshold_value: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: true,
        comment: 'Seuil configuré'
      },
      actual_value: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: true,
        comment: 'Valeur mesurée'
      },
      checked_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: 'Date du contrôle'
      }
    });

    // Index health_checks
    await queryInterface.addIndex('health_checks', ['check_type'], { name: 'idx_health_checks_type' });
    await queryInterface.addIndex('health_checks', ['component_name'], { name: 'idx_health_checks_component' });
    await queryInterface.addIndex('health_checks', ['status'], { name: 'idx_health_checks_status' });
    await queryInterface.addIndex('health_checks', ['checked_at'], { name: 'idx_health_checks_checked' });
    await queryInterface.addIndex('health_checks', ['geo_id'], { name: 'idx_health_checks_geo' });

    // ===========================================
    // TABLE: system_metrics
    // ===========================================
    await queryInterface.createTable('system_metrics', {
      metric_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      metric_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        comment: 'Nom de la métrique'
      },
      metric_category: {
        type: Sequelize.ENUM('performance', 'security', 'usage', 'error', 'business'),
        allowNull: false,
        comment: 'Catégorie'
      },
      metric_value: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: false,
        comment: 'Valeur mesurée'
      },
      metric_unit: {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: 'Unité (percent, bytes, seconds, count)'
      },
      geo_id: {
        type: Sequelize.STRING(16),
        allowNull: true,
        comment: 'Local source'
      },
      server_id: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Serveur source'
      },
      tags: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {},
        comment: 'Tags additionnels'
      },
      collected_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: 'Date de collecte'
      }
    });

    // Index system_metrics
    await queryInterface.addIndex('system_metrics', ['metric_name'], { name: 'idx_system_metrics_name' });
    await queryInterface.addIndex('system_metrics', ['metric_category'], { name: 'idx_system_metrics_category' });
    await queryInterface.addIndex('system_metrics', ['collected_at'], { name: 'idx_system_metrics_collected' });
    await queryInterface.addIndex('system_metrics', ['geo_id'], { name: 'idx_system_metrics_geo' });

    // ===========================================
    // TABLE: error_codes_registry
    // ===========================================
    await queryInterface.createTable('error_codes_registry', {
      error_code: {
        type: Sequelize.STRING(50),
        primaryKey: true,
        comment: 'Code erreur (SHUGO-{CATEGORY}-{SEVERITY}-{NUMBER})'
      },
      category: {
        type: Sequelize.ENUM('SYS', 'AUTH', 'GUARD', 'VAULT', 'NET', 'DATA', 'PLUGIN'),
        allowNull: false,
        comment: 'Catégorie du code'
      },
      severity: {
        type: Sequelize.ENUM('INFO', 'WARN', 'ERROR', 'CRITICAL'),
        allowNull: false,
        comment: 'Niveau de gravité'
      },
      title: {
        type: Sequelize.STRING(200),
        allowNull: false,
        comment: 'Titre court'
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: 'Description détaillée'
      },
      resolution_steps: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Étapes de résolution'
      },
      auto_resolution_available: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Résolution automatique disponible'
      },
      auto_resolution_action: {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: 'Action de résolution automatique'
      },
      documentation_url: {
        type: Sequelize.STRING(255),
        allowNull: true,
        comment: 'URL de la documentation'
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Code actif'
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

    // Index error_codes_registry
    await queryInterface.addIndex('error_codes_registry', ['category'], { name: 'idx_error_codes_category' });
    await queryInterface.addIndex('error_codes_registry', ['severity'], { name: 'idx_error_codes_severity' });

    // ===========================================
    // TABLE: error_occurrences
    // ===========================================
    await queryInterface.createTable('error_occurrences', {
      occurrence_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      error_code: {
        type: Sequelize.STRING(50),
        allowNull: false,
        references: {
          model: 'error_codes_registry',
          key: 'error_code'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Code erreur'
      },
      occurred_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: 'Date d\'occurrence'
      },
      geo_id: {
        type: Sequelize.STRING(16),
        allowNull: true,
        comment: 'Local concerné'
      },
      server_id: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Serveur concerné'
      },
      member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Utilisateur concerné'
      },
      context: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Contexte de l\'erreur'
      },
      stack_trace: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Stack trace'
      },
      resolution_attempted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Résolution tentée'
      },
      resolution_successful: {
        type: Sequelize.BOOLEAN,
        allowNull: true,
        comment: 'Résolution réussie'
      },
      resolution_details: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Détails de résolution'
      },
      resolved_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date de résolution'
      },
      resolved_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Qui a résolu'
      }
    });

    // Index error_occurrences
    await queryInterface.addIndex('error_occurrences', ['error_code'], { name: 'idx_error_occurrences_code' });
    await queryInterface.addIndex('error_occurrences', ['occurred_at'], { name: 'idx_error_occurrences_occurred' });
    await queryInterface.addIndex('error_occurrences', ['member_id'], { name: 'idx_error_occurrences_member' });
    await queryInterface.addIndex('error_occurrences', ['geo_id'], { name: 'idx_error_occurrences_geo' });

    console.log('✅ Migration 013: Tables maintenance, health, metrics, errors créées');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('error_occurrences');
    await queryInterface.dropTable('error_codes_registry');
    await queryInterface.dropTable('system_metrics');
    await queryInterface.dropTable('health_checks');
    await queryInterface.dropTable('maintenance_runs');
    console.log('⬇️ Migration 013: Tables maintenance, health, metrics, errors supprimées');
  }
};
