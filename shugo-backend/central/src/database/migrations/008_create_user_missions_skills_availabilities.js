'use strict';

/**
 * Migration 008 - Tables user_missions, user_skills, user_availabilities
 * 
 * Système de missions spéciales et gestion des compétences/disponibilités.
 * 
 * user_missions: Attribution de privilèges temporaires (ex: Responsable Tableau Cryptage)
 * user_skills: Compétences des utilisateurs
 * user_availabilities: Disponibilités récurrentes
 * 
 * @see Document Technique V7.0 - Section 2.7.2, Annexe A.2.13
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // ===========================================
    // TABLE: user_missions
    // ===========================================
    await queryInterface.createTable('user_missions', {
      mission_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique de la mission'
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
        comment: 'Utilisateur qui reçoit la mission'
      },
      
      // === DÉFINITION DE LA MISSION ===
      mission_type: {
        type: Sequelize.STRING(50),
        allowNull: false,
        comment: 'Type (Responsable_Tableau_Cryptage, Coordinateur_Planning, etc.)'
      },
      mission_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        comment: 'Nom de la mission'
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Description de la mission'
      },
      
      // === PRIVILÈGES ===
      privileges_granted: {
        type: Sequelize.JSONB,
        allowNull: false,
        comment: 'Liste des privilèges accordés {actions: [], resources: []}'
      },
      
      // === SCOPE ===
      scope_geo_id: {
        type: Sequelize.STRING(16),
        allowNull: true,
        comment: 'Portée géographique (optionnel)'
      },
      scope_group_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'groups',
          key: 'group_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Portée de groupe (optionnel)'
      },
      
      // === ATTRIBUTION ===
      created_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: {
          model: 'users',
          key: 'member_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
        comment: 'Qui a attribué la mission'
      },
      justification: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: 'Justification obligatoire'
      },
      
      // === VALIDITÉ ===
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Mission active'
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'expiration (NULL = permanente)'
      },
      
      // === RÉVOCATION ===
      revoked_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date de révocation'
      },
      revoked_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Qui a révoqué'
      },
      revocation_reason: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Motif de révocation'
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

    // Index user_missions
    await queryInterface.addIndex('user_missions', ['member_id'], {
      name: 'idx_user_missions_member'
    });

    await queryInterface.addIndex('user_missions', ['mission_type'], {
      name: 'idx_user_missions_type'
    });

    await queryInterface.addIndex('user_missions', ['is_active'], {
      name: 'idx_user_missions_active'
    });

    await queryInterface.addIndex('user_missions', ['expires_at'], {
      name: 'idx_user_missions_expires'
    });

    await queryInterface.addIndex('user_missions', ['scope_geo_id'], {
      name: 'idx_user_missions_scope_geo'
    });

    // ===========================================
    // TABLE: user_skills
    // ===========================================
    await queryInterface.createTable('user_skills', {
      skill_id: {
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
        comment: 'Utilisateur'
      },
      skill_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        comment: 'Nom de la compétence'
      },
      skill_category: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'Catégorie (technique, relationnel, administratif)'
      },
      level: {
        type: Sequelize.ENUM('beginner', 'intermediate', 'advanced', 'expert'),
        allowNull: false,
        defaultValue: 'intermediate',
        comment: 'Niveau de maîtrise'
      },
      verified: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Vérifié par un admin'
      },
      verified_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Qui a vérifié'
      },
      verified_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date de vérification'
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Notes sur la compétence'
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Compétence active'
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

    // Index user_skills
    await queryInterface.addIndex('user_skills', ['member_id'], {
      name: 'idx_user_skills_member'
    });

    await queryInterface.addIndex('user_skills', ['skill_name'], {
      name: 'idx_user_skills_name'
    });

    await queryInterface.addIndex('user_skills', ['skill_category'], {
      name: 'idx_user_skills_category'
    });

    await queryInterface.addIndex('user_skills', ['is_active'], {
      name: 'idx_user_skills_active'
    });

    // Contrainte unicité: un skill par membre
    await queryInterface.addIndex('user_skills', ['member_id', 'skill_name'], {
      name: 'idx_user_skills_unique',
      unique: true
    });

    // ===========================================
    // TABLE: user_availabilities
    // ===========================================
    await queryInterface.createTable('user_availabilities', {
      availability_id: {
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
        comment: 'Utilisateur'
      },
      
      // === RÉCURRENCE ===
      day_of_week: {
        type: Sequelize.INTEGER,
        allowNull: false,
        comment: 'Jour de la semaine (0=Dimanche, 1=Lundi, ...)'
      },
      start_time: {
        type: Sequelize.TIME,
        allowNull: false,
        comment: 'Heure de début de disponibilité'
      },
      end_time: {
        type: Sequelize.TIME,
        allowNull: false,
        comment: 'Heure de fin de disponibilité'
      },
      
      // === VALIDITÉ ===
      valid_from: {
        type: Sequelize.DATEONLY,
        allowNull: true,
        comment: 'Date de début de validité'
      },
      valid_until: {
        type: Sequelize.DATEONLY,
        allowNull: true,
        comment: 'Date de fin de validité'
      },
      
      // === TYPE ===
      availability_type: {
        type: Sequelize.ENUM('available', 'preferred', 'unavailable', 'conditional'),
        allowNull: false,
        defaultValue: 'available',
        comment: 'Type de disponibilité'
      },
      preference_score: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 50,
        comment: 'Score de préférence (0-100)'
      },
      
      // === MÉTADONNÉES ===
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Notes sur la disponibilité'
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Disponibilité active'
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

    // Index user_availabilities
    await queryInterface.addIndex('user_availabilities', ['member_id'], {
      name: 'idx_user_availabilities_member'
    });

    await queryInterface.addIndex('user_availabilities', ['day_of_week'], {
      name: 'idx_user_availabilities_day'
    });

    await queryInterface.addIndex('user_availabilities', ['availability_type'], {
      name: 'idx_user_availabilities_type'
    });

    await queryInterface.addIndex('user_availabilities', ['is_active'], {
      name: 'idx_user_availabilities_active'
    });

    // Contraintes
    await queryInterface.sequelize.query(`
      ALTER TABLE user_availabilities 
      ADD CONSTRAINT chk_day_of_week 
      CHECK (day_of_week BETWEEN 0 AND 6)
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE user_availabilities 
      ADD CONSTRAINT chk_availability_time 
      CHECK (end_time > start_time)
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE user_availabilities 
      ADD CONSTRAINT chk_preference_score 
      CHECK (preference_score BETWEEN 0 AND 100)
    `);

    console.log('✅ Migration 008: Tables user_missions, user_skills, user_availabilities créées');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('user_availabilities');
    await queryInterface.dropTable('user_skills');
    await queryInterface.dropTable('user_missions');
    console.log('⬇️ Migration 008: Tables user_missions, user_skills, user_availabilities supprimées');
  }
};
