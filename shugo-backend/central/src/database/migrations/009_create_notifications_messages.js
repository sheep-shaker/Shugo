'use strict';

/**
 * Migration 009 - Tables notifications, messages_center, message_read_status
 * 
 * Système de notifications multi-canal et centre de messages hiérarchiques.
 * 
 * @see Document Technique V7.0 - Section 4.2, Annexe A.2.9, A.2.10, A.2.11
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // ===========================================
    // TABLE: notifications
    // ===========================================
    await queryInterface.createTable('notifications', {
      notification_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      member_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: {
          model: 'users',
          key: 'member_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Destinataire'
      },
      type: {
        type: Sequelize.STRING(50),
        allowNull: false,
        comment: 'Type (guard_reminder, cancellation, system_alert, etc.)'
      },
      category: {
        type: Sequelize.ENUM('system', 'guard', 'admin', 'security', 'support'),
        allowNull: false,
        defaultValue: 'system',
        comment: 'Catégorie de notification'
      },
      title: {
        type: Sequelize.STRING(200),
        allowNull: false,
        comment: 'Titre de la notification'
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: 'Contenu du message'
      },
      priority: {
        type: Sequelize.ENUM('low', 'normal', 'high', 'urgent'),
        allowNull: false,
        defaultValue: 'normal',
        comment: 'Niveau de priorité'
      },
      channel: {
        type: Sequelize.ENUM('email', 'matrix', 'push', 'sms', 'in_app'),
        allowNull: false,
        defaultValue: 'email',
        comment: 'Canal d\'envoi'
      },
      status: {
        type: Sequelize.ENUM('pending', 'sent', 'delivered', 'failed', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending',
        comment: 'Statut d\'envoi'
      },
      sent_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'envoi'
      },
      delivered_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date de délivrance'
      },
      read_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date de lecture'
      },
      retry_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Nombre de tentatives'
      },
      max_retries: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 3,
        comment: 'Maximum de tentatives'
      },
      last_error: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Dernière erreur'
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'expiration'
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {},
        comment: 'Données additionnelles'
      },
      reference_type: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'Type de ressource liée'
      },
      reference_id: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: 'ID de la ressource liée'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Index notifications
    await queryInterface.addIndex('notifications', ['member_id'], { name: 'idx_notifications_member' });
    await queryInterface.addIndex('notifications', ['status'], { name: 'idx_notifications_status' });
    await queryInterface.addIndex('notifications', ['type'], { name: 'idx_notifications_type' });
    await queryInterface.addIndex('notifications', ['created_at'], { name: 'idx_notifications_created' });
    await queryInterface.addIndex('notifications', ['priority'], { name: 'idx_notifications_priority' });
    await queryInterface.addIndex('notifications', ['channel'], { name: 'idx_notifications_channel' });

    // ===========================================
    // TABLE: messages_center
    // ===========================================
    await queryInterface.createTable('messages_center', {
      message_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique du message'
      },
      type: {
        type: Sequelize.ENUM('system', 'hierarchical'),
        allowNull: false,
        comment: 'Type: système (auto) ou hiérarchique (manuel)'
      },
      sender_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        references: {
          model: 'users',
          key: 'member_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Émetteur (NULL pour messages système)'
      },
      target_scope: {
        type: Sequelize.ENUM('global', 'geo_id', 'group', 'individual'),
        allowNull: false,
        comment: 'Portée du message'
      },
      target_identifier: {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: 'Identifiant cible'
      },
      title: {
        type: Sequelize.STRING(200),
        allowNull: false,
        comment: 'Titre du message'
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: 'Contenu du message'
      },
      priority: {
        type: Sequelize.ENUM('low', 'normal', 'high', 'urgent'),
        allowNull: false,
        defaultValue: 'normal',
        comment: 'Priorité d\'affichage'
      },
      message_category: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'Catégorie (relance, urgence, etc.)'
      },
      icon: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'Icône du message'
      },
      is_pinned: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Message épinglé'
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Message actif'
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'expiration'
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {},
        comment: 'Données additionnelles'
      },
      relayed_from_message_id: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: 'Message source si relayé'
      },
      relay_note: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Note ajoutée lors du relai'
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

    // Index messages_center
    await queryInterface.addIndex('messages_center', ['type'], { name: 'idx_messages_type' });
    await queryInterface.addIndex('messages_center', ['target_scope'], { name: 'idx_messages_scope' });
    await queryInterface.addIndex('messages_center', ['sender_member_id'], { name: 'idx_messages_sender' });
    await queryInterface.addIndex('messages_center', ['created_at'], { name: 'idx_messages_created' });
    await queryInterface.addIndex('messages_center', ['expires_at'], { name: 'idx_messages_expires' });
    await queryInterface.addIndex('messages_center', ['is_active'], { name: 'idx_messages_active' });

    // ===========================================
    // TABLE: message_read_status
    // ===========================================
    await queryInterface.createTable('message_read_status', {
      read_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      message_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'messages_center',
          key: 'message_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Message concerné'
      },
      member_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: {
          model: 'users',
          key: 'member_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Utilisateur'
      },
      read_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: 'Date de lecture'
      },
      is_ignored: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Message ignoré/masqué'
      }
    });

    // Index message_read_status
    await queryInterface.addIndex('message_read_status', ['message_id'], { name: 'idx_message_read_message' });
    await queryInterface.addIndex('message_read_status', ['member_id'], { name: 'idx_message_read_member' });
    await queryInterface.addIndex('message_read_status', ['message_id', 'member_id'], {
      name: 'idx_message_read_unique',
      unique: true
    });

    console.log('✅ Migration 009: Tables notifications, messages_center, message_read_status créées');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('message_read_status');
    await queryInterface.dropTable('messages_center');
    await queryInterface.dropTable('notifications');
    console.log('⬇️ Migration 009: Tables notifications, messages_center, message_read_status supprimées');
  }
};
