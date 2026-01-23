'use strict';

/**
 * Migration 010 - Table support_requests
 * 
 * Système de support utilisateur intégré (Assist'SHUGO).
 * Gestion des tickets de support avec routage hiérarchique.
 * 
 * @see Document Technique V7.0 - Section 4.3, Annexe A.2.12
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('support_requests', {
      request_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique du ticket'
      },
      
      // === DEMANDEUR ===
      requester_member_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: {
          model: 'users',
          key: 'member_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Utilisateur qui a créé le ticket'
      },
      
      // === ASSIGNATION ===
      assigned_to_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        references: {
          model: 'users',
          key: 'member_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Responsable assigné'
      },
      
      // === CATÉGORIE ET PRIORITÉ ===
      category: {
        type: Sequelize.ENUM('technical', 'guard', 'account', 'bug', 'feature', 'other'),
        allowNull: false,
        comment: 'Catégorie du ticket'
      },
      priority: {
        type: Sequelize.ENUM('low', 'normal', 'high', 'urgent'),
        allowNull: false,
        defaultValue: 'normal',
        comment: 'Priorité du ticket'
      },
      
      // === CONTENU ===
      subject: {
        type: Sequelize.STRING(200),
        allowNull: false,
        comment: 'Sujet du ticket'
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: 'Description détaillée'
      },
      
      // === STATUT ===
      status: {
        type: Sequelize.ENUM('open', 'in_progress', 'waiting_response', 'resolved', 'closed'),
        allowNull: false,
        defaultValue: 'open',
        comment: 'Statut du ticket'
      },
      
      // === RÉSOLUTION ===
      resolution: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Description de la résolution'
      },
      resolved_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date de résolution'
      },
      resolved_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Qui a résolu le ticket'
      },
      
      // === ESCALADE ===
      escalation_level: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: 'Niveau d\'escalade (1=Gold, 2=Platinum, 3=Admin)'
      },
      escalated_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'escalade'
      },
      escalated_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Qui a escaladé'
      },
      escalation_reason: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Motif d\'escalade'
      },
      
      // === MÉTADONNÉES ===
      geo_id: {
        type: Sequelize.STRING(16),
        allowNull: true,
        comment: 'Local concerné'
      },
      attachments: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
        comment: 'Pièces jointes [{name, url, type}]'
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {},
        comment: 'Données additionnelles'
      },
      
      // === TAGS ===
      tags: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        allowNull: true,
        defaultValue: [],
        comment: 'Tags pour classification'
      },
      
      // === SATISFACTION ===
      satisfaction_rating: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Note de satisfaction (1-5)'
      },
      satisfaction_comment: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Commentaire de satisfaction'
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
      },
      closed_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date de fermeture'
      }
    });

    // === INDEX ===
    await queryInterface.addIndex('support_requests', ['requester_member_id'], {
      name: 'idx_support_requester'
    });

    await queryInterface.addIndex('support_requests', ['assigned_to_member_id'], {
      name: 'idx_support_assigned'
    });

    await queryInterface.addIndex('support_requests', ['status'], {
      name: 'idx_support_status'
    });

    await queryInterface.addIndex('support_requests', ['priority'], {
      name: 'idx_support_priority'
    });

    await queryInterface.addIndex('support_requests', ['category'], {
      name: 'idx_support_category'
    });

    await queryInterface.addIndex('support_requests', ['created_at'], {
      name: 'idx_support_created'
    });

    await queryInterface.addIndex('support_requests', ['geo_id'], {
      name: 'idx_support_geo_id'
    });

    await queryInterface.addIndex('support_requests', ['escalation_level'], {
      name: 'idx_support_escalation'
    });

    // === CONTRAINTES ===
    await queryInterface.sequelize.query(`
      ALTER TABLE support_requests 
      ADD CONSTRAINT chk_escalation_level 
      CHECK (escalation_level BETWEEN 1 AND 3)
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE support_requests 
      ADD CONSTRAINT chk_satisfaction_rating 
      CHECK (satisfaction_rating IS NULL OR satisfaction_rating BETWEEN 1 AND 5)
    `);

    // ===========================================
    // TABLE: support_request_comments
    // ===========================================
    await queryInterface.createTable('support_request_comments', {
      comment_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      request_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'support_requests',
          key: 'request_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Ticket parent'
      },
      author_member_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: {
          model: 'users',
          key: 'member_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Auteur du commentaire'
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: 'Contenu du commentaire'
      },
      is_internal: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Commentaire interne (non visible par le demandeur)'
      },
      attachments: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
        comment: 'Pièces jointes'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('support_request_comments', ['request_id'], {
      name: 'idx_support_comments_request'
    });

    await queryInterface.addIndex('support_request_comments', ['author_member_id'], {
      name: 'idx_support_comments_author'
    });

    console.log('✅ Migration 010: Tables support_requests et support_request_comments créées');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('support_request_comments');
    await queryInterface.dropTable('support_requests');
    console.log('⬇️ Migration 010: Tables support_requests et support_request_comments supprimées');
  }
};
