'use strict';

/**
 * Migration 004 - Tables sessions et registration_tokens
 * 
 * Sessions: Gestion des connexions JWT actives avec tracking comportemental
 * Registration Tokens: Jetons d'inscription à validité limitée (7 jours)
 * 
 * @see Document Technique V7.0 - Section 6, Annexe A.2.2 et A.1.5
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // ===========================================
    // TABLE: sessions
    // ===========================================
    await queryInterface.createTable('sessions', {
      session_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique de la session'
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
        comment: 'Utilisateur propriétaire de la session'
      },
      jwt_token_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
        comment: 'Hash SHA-256 du token JWT'
      },
      refresh_token_hash: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Hash du refresh token'
      },
      ip_address: {
        type: Sequelize.INET,
        allowNull: false,
        comment: 'Adresse IP de connexion'
      },
      user_agent: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'User-Agent du navigateur/client'
      },
      geo_location: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Géolocalisation optionnelle {city, country, lat, lon}'
      },
      device_info: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Informations sur le device {type, os, browser}'
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Session active ou non'
      },
      logout_reason: {
        type: Sequelize.ENUM('manual', 'timeout', 'maintenance', 'security', 'forced'),
        allowNull: true,
        comment: 'Raison de déconnexion'
      },
      last_activity: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: 'Dernière activité'
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: 'Date d\'expiration de la session'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Index sessions
    await queryInterface.addIndex('sessions', ['member_id'], {
      name: 'idx_sessions_member_id'
    });

    await queryInterface.addIndex('sessions', ['expires_at'], {
      name: 'idx_sessions_expires_at'
    });

    await queryInterface.addIndex('sessions', ['is_active'], {
      name: 'idx_sessions_active'
    });

    await queryInterface.addIndex('sessions', ['ip_address'], {
      name: 'idx_sessions_ip'
    });

    await queryInterface.addIndex('sessions', ['jwt_token_hash'], {
      name: 'idx_sessions_token_hash'
    });

    // ===========================================
    // TABLE: registration_tokens
    // ===========================================
    await queryInterface.createTable('registration_tokens', {
      token_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique du jeton'
      },
      token_code: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true,
        comment: 'Code du jeton d\'inscription'
      },
      token_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
        comment: 'Hash du token pour validation'
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
        comment: 'Local d\'inscription'
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
        comment: 'Administrateur qui a créé le jeton'
      },
      
      // === DONNÉES PRÉ-REMPLIES ===
      target_first_name: {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: 'Prénom attendu du nouvel utilisateur'
      },
      target_last_name: {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: 'Nom attendu du nouvel utilisateur'
      },
      target_role: {
        type: Sequelize.ENUM('Silver', 'Gold', 'Platinum', 'Admin'),
        allowNull: false,
        defaultValue: 'Silver',
        comment: 'Rôle attribué à l\'inscription'
      },
      target_group_id: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: 'Groupe d\'affectation (optionnel)'
      },
      
      // === STATUT ET VALIDITÉ ===
      status: {
        type: Sequelize.ENUM('active', 'used', 'expired', 'revoked'),
        allowNull: false,
        defaultValue: 'active',
        comment: 'Statut du jeton'
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: 'Date d\'expiration (7 jours par défaut)'
      },
      used_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'utilisation'
      },
      used_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Member_id créé avec ce jeton'
      },
      
      // === MÉTADONNÉES ===
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Notes administratives'
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

    // Index registration_tokens
    await queryInterface.addIndex('registration_tokens', ['geo_id'], {
      name: 'idx_registration_tokens_geo_id'
    });

    await queryInterface.addIndex('registration_tokens', ['expires_at'], {
      name: 'idx_registration_tokens_expires'
    });

    await queryInterface.addIndex('registration_tokens', ['status'], {
      name: 'idx_registration_tokens_status'
    });

    await queryInterface.addIndex('registration_tokens', ['token_code'], {
      name: 'idx_registration_tokens_code',
      unique: true
    });

    await queryInterface.addIndex('registration_tokens', ['created_by_member_id'], {
      name: 'idx_registration_tokens_created_by'
    });

    console.log('✅ Migration 004: Tables sessions et registration_tokens créées');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('registration_tokens');
    await queryInterface.dropTable('sessions');
    console.log('⬇️ Migration 004: Tables sessions et registration_tokens supprimées');
  }
};
