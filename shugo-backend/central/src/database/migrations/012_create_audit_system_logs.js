'use strict';

/**
 * Migration 012 - Tables d'audit et journalisation
 * 
 * Tables pour la traçabilité complète:
 * - audit_logs: Actions utilisateurs et administratives
 * - system_logs: Logs système et techniques
 * - guard_logs: Logs spécifiques aux gardes
 * 
 * @see Document Technique V7.0 - Section 10, Annexe A.6
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // ===========================================
    // TABLE: audit_logs
    // ===========================================
    await queryInterface.createTable('audit_logs', {
      log_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      timestamp: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: 'Horodatage UTC'
      },
      member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Utilisateur concerné'
      },
      session_id: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: 'Session active'
      },
      action: {
        type: Sequelize.STRING(100),
        allowNull: false,
        comment: 'Action effectuée'
      },
      action_category: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'Catégorie d\'action (auth, guard, admin, etc.)'
      },
      resource_type: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'Type de ressource (user, guard, group, etc.)'
      },
      resource_id: {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: 'ID de la ressource concernée'
      },
      old_values: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Valeurs avant modification'
      },
      new_values: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Valeurs après modification'
      },
      ip_address: {
        type: Sequelize.INET,
        allowNull: true,
        comment: 'Adresse IP'
      },
      user_agent: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'User-Agent'
      },
      geo_id: {
        type: Sequelize.STRING(16),
        allowNull: true,
        comment: 'Local concerné'
      },
      result: {
        type: Sequelize.ENUM('success', 'failure', 'partial'),
        allowNull: false,
        comment: 'Résultat de l\'action'
      },
      error_code: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'Code erreur si applicable'
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Message d\'erreur'
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Notes additionnelles'
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {},
        comment: 'Données additionnelles'
      },
      is_sensitive: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Action sensible (sécurité)'
      },
      retention_until: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date de rétention'
      }
    });

    // Index audit_logs
    await queryInterface.addIndex('audit_logs', ['timestamp'], { name: 'idx_audit_logs_timestamp' });
    await queryInterface.addIndex('audit_logs', ['member_id'], { name: 'idx_audit_logs_member' });
    await queryInterface.addIndex('audit_logs', ['action'], { name: 'idx_audit_logs_action' });
    await queryInterface.addIndex('audit_logs', ['resource_type', 'resource_id'], { name: 'idx_audit_logs_resource' });
    await queryInterface.addIndex('audit_logs', ['result'], { name: 'idx_audit_logs_result' });
    await queryInterface.addIndex('audit_logs', ['geo_id'], { name: 'idx_audit_logs_geo' });
    await queryInterface.addIndex('audit_logs', ['ip_address'], { name: 'idx_audit_logs_ip' });
    await queryInterface.addIndex('audit_logs', ['is_sensitive'], { name: 'idx_audit_logs_sensitive' });

    // ===========================================
    // TABLE: system_logs
    // ===========================================
    await queryInterface.createTable('system_logs', {
      log_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      timestamp: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: 'Horodatage UTC'
      },
      level: {
        type: Sequelize.ENUM('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'),
        allowNull: false,
        comment: 'Niveau de log'
      },
      module: {
        type: Sequelize.STRING(50),
        allowNull: false,
        comment: 'Module source (auth, guard, vault, maintenance, etc.)'
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: 'Message de log'
      },
      context: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Contexte supplémentaire'
      },
      error_code: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'Code erreur SHUGO-*'
      },
      stack_trace: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Stack trace si erreur'
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
      process_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'PID du processus'
      },
      thread_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'ID du thread'
      },
      request_id: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: 'ID de requête pour traçage'
      },
      duration_ms: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Durée en millisecondes'
      }
    });

    // Index system_logs
    await queryInterface.addIndex('system_logs', ['timestamp'], { name: 'idx_system_logs_timestamp' });
    await queryInterface.addIndex('system_logs', ['level'], { name: 'idx_system_logs_level' });
    await queryInterface.addIndex('system_logs', ['module'], { name: 'idx_system_logs_module' });
    await queryInterface.addIndex('system_logs', ['error_code'], { name: 'idx_system_logs_error_code' });
    await queryInterface.addIndex('system_logs', ['geo_id'], { name: 'idx_system_logs_geo' });
    await queryInterface.addIndex('system_logs', ['request_id'], { name: 'idx_system_logs_request' });

    // ===========================================
    // TABLE: guard_logs
    // ===========================================
    await queryInterface.createTable('guard_logs', {
      log_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      timestamp: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: 'Horodatage'
      },
      guard_id: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: 'Garde concernée'
      },
      member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Membre concerné'
      },
      action: {
        type: Sequelize.ENUM('register', 'cancel', 'modify', 'auto_assign', 'reject', 'accept', 'complete', 'no_show'),
        allowNull: false,
        comment: 'Type d\'action'
      },
      old_status: {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: 'Statut avant'
      },
      new_status: {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: 'Statut après'
      },
      cancellation_type: {
        type: Sequelize.ENUM('normal', 'anticipated', 'late'),
        allowNull: true,
        comment: 'Type d\'annulation'
      },
      replacement_proposed: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Remplacement proposé'
      },
      replacement_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Remplaçant proposé'
      },
      notification_sent: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Notification envoyée'
      },
      automated_action: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Action automatique'
      },
      geo_id: {
        type: Sequelize.STRING(16),
        allowNull: true,
        comment: 'Local concerné'
      },
      performed_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Qui a effectué l\'action'
      },
      ip_address: {
        type: Sequelize.INET,
        allowNull: true,
        comment: 'Adresse IP'
      },
      details: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Détails supplémentaires'
      }
    });

    // Index guard_logs
    await queryInterface.addIndex('guard_logs', ['timestamp'], { name: 'idx_guard_logs_timestamp' });
    await queryInterface.addIndex('guard_logs', ['guard_id'], { name: 'idx_guard_logs_guard' });
    await queryInterface.addIndex('guard_logs', ['member_id'], { name: 'idx_guard_logs_member' });
    await queryInterface.addIndex('guard_logs', ['action'], { name: 'idx_guard_logs_action' });
    await queryInterface.addIndex('guard_logs', ['geo_id'], { name: 'idx_guard_logs_geo' });

    console.log('✅ Migration 012: Tables audit_logs, system_logs, guard_logs créées');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('guard_logs');
    await queryInterface.dropTable('system_logs');
    await queryInterface.dropTable('audit_logs');
    console.log('⬇️ Migration 012: Tables audit_logs, system_logs, guard_logs supprimées');
  }
};
