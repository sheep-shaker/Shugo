'use strict';

/**
 * Migration 007 - Tables guard_assignments et waiting_list
 * 
 * Gestion des inscriptions aux gardes et liste d'attente intelligente.
 * 
 * guard_assignments: Inscriptions confirmées/annulées
 * waiting_list: Liste d'attente avec activation automatique J-3
 * 
 * @see Document Technique V7.0 - Section 4.1.3, 4.1.4, Annexe A.2.6 et A.2.7
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // ===========================================
    // TABLE: guard_assignments
    // ===========================================
    await queryInterface.createTable('guard_assignments', {
      assignment_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique de l\'inscription'
      },
      guard_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'guards',
          key: 'guard_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Créneau de garde'
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
        comment: 'Membre inscrit'
      },
      assigned_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: {
          model: 'users',
          key: 'member_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
        comment: 'Qui a effectué l\'inscription'
      },
      
      // === TYPE D'INSCRIPTION ===
      assignment_type: {
        type: Sequelize.ENUM('voluntary', 'assigned', 'automatic'),
        allowNull: false,
        defaultValue: 'voluntary',
        comment: 'Type: volontaire, assigné, automatique (liste attente)'
      },
      
      // === STATUT ===
      status: {
        type: Sequelize.ENUM('confirmed', 'pending', 'cancelled', 'completed', 'no_show'),
        allowNull: false,
        defaultValue: 'confirmed',
        comment: 'Statut de l\'inscription'
      },
      
      // === DATES ===
      assigned_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: 'Date d\'inscription'
      },
      confirmed_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date de confirmation'
      },
      cancelled_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'annulation'
      },
      completed_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date de complétion (fin de garde)'
      },
      
      // === ANNULATION ===
      cancellation_type: {
        type: Sequelize.ENUM('normal', 'anticipated', 'late'),
        allowNull: true,
        comment: 'Type d\'annulation (normale >7j, anticipée 72h-7j, tardive <72h)'
      },
      cancellation_reason: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Motif d\'annulation'
      },
      cancelled_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Qui a annulé'
      },
      
      // === REMPLACEMENT ===
      replacement_requested: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Remplacement demandé'
      },
      replacement_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Remplaçant proposé'
      },
      replacement_status: {
        type: Sequelize.ENUM('pending', 'accepted', 'refused', 'expired'),
        allowNull: true,
        comment: 'Statut de la demande de remplacement'
      },
      replacement_deadline: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Délai de réponse (4h ou 1h si <12h avant garde)'
      },
      
      // === MATCHING (pour auto-assign) ===
      skill_match_score: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
        comment: 'Score de correspondance compétences (0-100)'
      },
      availability_score: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
        comment: 'Score de disponibilité (0-100)'
      },
      
      // === NOTES ===
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Notes sur l\'inscription'
      },
      
      // === TIMESTAMPS ===
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

    // Index guard_assignments
    await queryInterface.addIndex('guard_assignments', ['guard_id'], {
      name: 'idx_guard_assignments_guard'
    });

    await queryInterface.addIndex('guard_assignments', ['member_id'], {
      name: 'idx_guard_assignments_member'
    });

    await queryInterface.addIndex('guard_assignments', ['status'], {
      name: 'idx_guard_assignments_status'
    });

    await queryInterface.addIndex('guard_assignments', ['assigned_by_member_id'], {
      name: 'idx_guard_assignments_assigned_by'
    });

    await queryInterface.addIndex('guard_assignments', ['assignment_type'], {
      name: 'idx_guard_assignments_type'
    });

    // Contrainte unicité: un membre ne peut avoir qu'une inscription active par garde
    await queryInterface.addIndex('guard_assignments', ['guard_id', 'member_id', 'status'], {
      name: 'idx_guard_assignments_unique',
      unique: true,
      where: { status: 'confirmed' }
    });

    // ===========================================
    // TABLE: waiting_list
    // ===========================================
    await queryInterface.createTable('waiting_list', {
      waiting_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      guard_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'guards',
          key: 'guard_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Créneau concerné'
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
        comment: 'Membre en attente'
      },
      
      // === PRIORITÉ ET SCORES ===
      priority_score: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Score de priorité pour activation'
      },
      position: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Position dans la file d\'attente'
      },
      skill_match_score: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
        comment: 'Score correspondance compétences'
      },
      availability_score: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
        comment: 'Score disponibilité'
      },
      
      // === STATUT ===
      status: {
        type: Sequelize.ENUM('waiting', 'assigned', 'expired', 'cancelled'),
        allowNull: false,
        defaultValue: 'waiting',
        comment: 'Statut dans la liste'
      },
      auto_assigned: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Assigné automatiquement à J-3'
      },
      
      // === DATES ===
      added_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: 'Date d\'ajout à la liste'
      },
      assigned_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'assignation'
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'expiration de la demande'
      },
      
      // === NOTIFICATIONS ===
      notification_sent: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Notification envoyée lors de l\'assignation'
      },
      last_notified_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Dernière notification'
      },
      notification_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Nombre de notifications envoyées'
      },
      
      // === MÉTADONNÉES ===
      source: {
        type: Sequelize.ENUM('voluntary', 'suggested', 'overflow'),
        allowNull: false,
        defaultValue: 'voluntary',
        comment: 'Source de l\'inscription en liste d\'attente'
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Notes'
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

    // Index waiting_list
    await queryInterface.addIndex('waiting_list', ['guard_id'], {
      name: 'idx_waiting_list_guard'
    });

    await queryInterface.addIndex('waiting_list', ['member_id'], {
      name: 'idx_waiting_list_member'
    });

    await queryInterface.addIndex('waiting_list', ['status'], {
      name: 'idx_waiting_list_status'
    });

    await queryInterface.addIndex('waiting_list', ['priority_score'], {
      name: 'idx_waiting_list_priority',
      order: [['priority_score', 'DESC']]
    });

    await queryInterface.addIndex('waiting_list', ['expires_at'], {
      name: 'idx_waiting_list_expires'
    });

    // Contrainte unicité: un membre ne peut être qu'une fois en attente par garde
    await queryInterface.addIndex('waiting_list', ['guard_id', 'member_id', 'status'], {
      name: 'idx_waiting_list_unique',
      unique: true,
      where: { status: 'waiting' }
    });

    console.log('✅ Migration 007: Tables guard_assignments et waiting_list créées');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('waiting_list');
    await queryInterface.dropTable('guard_assignments');
    console.log('⬇️ Migration 007: Tables guard_assignments et waiting_list supprimées');
  }
};
