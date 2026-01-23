'use strict';

/**
 * Migration 006 - Tables guards et guard_scenarios
 * 
 * Cœur du système de planning SHUGO:
 * - guards: Créneaux de garde (48 créneaux de 30 min par jour)
 * - guard_scenarios: Scénarios et semaines-types
 * 
 * @see Document Technique V7.0 - Section 4.1, Annexe A.2.5 et A.2.8
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // ===========================================
    // TABLE: guard_scenarios
    // ===========================================
    await queryInterface.createTable('guard_scenarios', {
      scenario_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique du scénario'
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        comment: 'Nom du scénario'
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Description du scénario'
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
        comment: 'Local associé au scénario'
      },
      code: {
        type: Sequelize.STRING(32),
        allowNull: false,
        unique: true,
        comment: 'Code unique du scénario (NORMAL, EARLY, LATE, CUSTOM)'
      },
      scenario_type: {
        type: Sequelize.ENUM('daily', 'weekly', 'monthly', 'special'),
        allowNull: false,
        defaultValue: 'daily',
        comment: 'Type de récurrence'
      },
      template_data: {
        type: Sequelize.JSONB,
        allowNull: false,
        comment: 'Configuration des créneaux {slots: [{start, end, type}]}'
      },
      cancellation_window_hours: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 72,
        comment: 'Fenêtre d\'annulation en heures'
      },
      is_default: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Scénario par défaut pour le local'
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Scénario actif'
      },
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
      color_code: {
        type: Sequelize.STRING(7),
        allowNull: true,
        comment: 'Code couleur pour affichage'
      },
      created_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: {
          model: 'users',
          key: 'member_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
        comment: 'Créateur du scénario'
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

    // Index guard_scenarios
    await queryInterface.addIndex('guard_scenarios', ['geo_id'], {
      name: 'idx_guard_scenarios_geo_id'
    });

    await queryInterface.addIndex('guard_scenarios', ['scenario_type'], {
      name: 'idx_guard_scenarios_type'
    });

    await queryInterface.addIndex('guard_scenarios', ['is_active'], {
      name: 'idx_guard_scenarios_active'
    });

    await queryInterface.addIndex('guard_scenarios', ['code'], {
      name: 'idx_guard_scenarios_code',
      unique: true
    });

    // ===========================================
    // TABLE: guards
    // ===========================================
    await queryInterface.createTable('guards', {
      guard_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique du créneau de garde'
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
        comment: 'Local de la garde'
      },
      guard_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
        comment: 'Date de la garde'
      },
      start_time: {
        type: Sequelize.TIME,
        allowNull: false,
        comment: 'Heure de début'
      },
      end_time: {
        type: Sequelize.TIME,
        allowNull: false,
        comment: 'Heure de fin'
      },
      slot_duration: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 30,
        comment: 'Durée du créneau en minutes'
      },
      
      // === PARTICIPANTS ===
      min_participants: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: 'Nombre minimum requis'
      },
      max_participants: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: 'Nombre maximum de participants'
      },
      current_participants: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Nombre actuel de participants'
      },
      
      // === TYPE ET STATUT ===
      guard_type: {
        type: Sequelize.ENUM('standard', 'preparation', 'closure', 'special', 'maintenance'),
        allowNull: false,
        defaultValue: 'standard',
        comment: 'Type de garde'
      },
      status: {
        type: Sequelize.ENUM('open', 'full', 'closed', 'cancelled'),
        allowNull: false,
        defaultValue: 'open',
        comment: 'Statut du créneau'
      },
      priority: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: 'Priorité (1=normal, 2=important, 3=urgent)'
      },
      
      // === DESCRIPTION ET PRÉREQUIS ===
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Description du créneau'
      },
      requirements: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Prérequis particuliers'
      },
      required_skills: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        allowNull: true,
        defaultValue: [],
        comment: 'Compétences requises'
      },
      
      // === RÉCURRENCE ET SCÉNARIO ===
      scenario_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'guard_scenarios',
          key: 'scenario_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Scénario associé'
      },
      is_recurring: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Créneau récurrent'
      },
      recurrence_rule: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Règle RRULE pour récurrence'
      },
      parent_guard_id: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: 'Garde parent (pour créneaux fusionnés)'
      },
      
      // === GÉNÉRATION ===
      auto_generated: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Généré automatiquement par scénario'
      },
      created_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: {
          model: 'users',
          key: 'member_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
        comment: 'Créateur du créneau'
      },
      
      // === COULEUR AFFICHAGE ===
      color_code: {
        type: Sequelize.STRING(7),
        allowNull: true,
        comment: 'Couleur personnalisée'
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
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Soft delete'
      }
    });

    // Index guards
    await queryInterface.addIndex('guards', ['geo_id'], {
      name: 'idx_guards_geo_id'
    });

    await queryInterface.addIndex('guards', ['guard_date'], {
      name: 'idx_guards_date'
    });

    await queryInterface.addIndex('guards', ['guard_date', 'start_time'], {
      name: 'idx_guards_datetime'
    });

    await queryInterface.addIndex('guards', ['status'], {
      name: 'idx_guards_status'
    });

    await queryInterface.addIndex('guards', ['created_by_member_id'], {
      name: 'idx_guards_created_by'
    });

    await queryInterface.addIndex('guards', ['scenario_id'], {
      name: 'idx_guards_scenario'
    });

    await queryInterface.addIndex('guards', ['guard_type'], {
      name: 'idx_guards_type'
    });

    // Contraintes
    await queryInterface.sequelize.query(`
      ALTER TABLE guards 
      ADD CONSTRAINT chk_participants_logic 
      CHECK (max_participants >= min_participants)
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE guards 
      ADD CONSTRAINT chk_time_logic 
      CHECK (end_time > start_time)
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE guards 
      ADD CONSTRAINT chk_priority_range 
      CHECK (priority BETWEEN 1 AND 3)
    `);

    // FK vers guards pour parent_guard_id
    await queryInterface.addConstraint('guards', {
      fields: ['parent_guard_id'],
      type: 'foreign key',
      name: 'fk_guards_parent',
      references: {
        table: 'guards',
        field: 'guard_id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    console.log('✅ Migration 006: Tables guard_scenarios et guards créées');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('guards');
    await queryInterface.dropTable('guard_scenarios');
    console.log('⬇️ Migration 006: Tables guard_scenarios et guards supprimées');
  }
};
