'use strict';

/**
 * Migration 005 - Tables groups et group_membership
 * 
 * Gestion des groupes d'utilisateurs et de leur appartenance.
 * Un groupe est lié à un geo_id et peut avoir un leader (Gold).
 * 
 * @see Document Technique V7.0 - Section 2.7, Annexe A.2.3 et A.2.4
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // ===========================================
    // TABLE: groups
    // ===========================================
    await queryInterface.createTable('groups', {
      group_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique du groupe'
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        comment: 'Nom du groupe'
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Description du groupe'
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
        comment: 'Rattachement géographique du groupe'
      },
      parent_group_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'groups',
          key: 'group_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Groupe parent (hiérarchie)'
      },
      leader_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Chef de groupe (Gold) - FK ajoutée après création users'
      },
      max_members: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 50,
        comment: 'Nombre maximum de membres'
      },
      color_code: {
        type: Sequelize.STRING(7),
        allowNull: true,
        comment: 'Code couleur hexadécimal (#RRGGBB)'
      },
      icon: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'Icône du groupe (emoji ou nom d\'icône)'
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive', 'archived'),
        allowNull: false,
        defaultValue: 'active',
        comment: 'Statut du groupe'
      },
      settings: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {},
        comment: 'Paramètres additionnels du groupe'
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

    // Index groups
    await queryInterface.addIndex('groups', ['geo_id'], {
      name: 'idx_groups_geo_id'
    });

    await queryInterface.addIndex('groups', ['parent_group_id'], {
      name: 'idx_groups_parent'
    });

    await queryInterface.addIndex('groups', ['leader_member_id'], {
      name: 'idx_groups_leader'
    });

    await queryInterface.addIndex('groups', ['status'], {
      name: 'idx_groups_status'
    });

    // Contrainte couleur hexadécimale
    await queryInterface.sequelize.query(`
      ALTER TABLE groups 
      ADD CONSTRAINT chk_color_code 
      CHECK (color_code IS NULL OR color_code ~ '^#[0-9A-Fa-f]{6}$')
    `);

    // ===========================================
    // TABLE: group_membership
    // ===========================================
    await queryInterface.createTable('group_memberships', {
      membership_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique de l\'appartenance'
      },
      group_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'groups',
          key: 'group_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Groupe concerné'
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
        comment: 'Membre du groupe'
      },
      role_in_group: {
        type: Sequelize.ENUM('member', 'deputy', 'leader'),
        allowNull: false,
        defaultValue: 'member',
        comment: 'Rôle dans le groupe'
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Appartenance active'
      },
      joined_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: 'Date d\'entrée dans le groupe'
      },
      left_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date de sortie (soft delete)'
      },
      added_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Qui a ajouté ce membre'
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Notes sur l\'appartenance'
      }
    });

    // Index group_membership
    await queryInterface.addIndex('group_memberships', ['group_id'], {
      name: 'idx_group_membership_group'
    });

    await queryInterface.addIndex('group_memberships', ['member_id'], {
      name: 'idx_group_membership_member'
    });

    await queryInterface.addIndex('group_memberships', ['is_active'], {
      name: 'idx_group_membership_active'
    });

    await queryInterface.addIndex('group_memberships', ['role_in_group'], {
      name: 'idx_group_membership_role'
    });

    // Contrainte d'unicité: un membre ne peut être actif qu'une fois dans un groupe
    await queryInterface.addIndex('group_memberships', ['group_id', 'member_id'], {
      name: 'idx_group_membership_unique_active',
      unique: true,
      where: { is_active: true }
    });

    console.log('✅ Migration 005: Tables groups et group_memberships créées');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('group_memberships');
    await queryInterface.dropTable('groups');
    console.log('⬇️ Migration 005: Tables groups et group_memberships supprimées');
  }
};
