'use strict';

/**
 * Migration 002 - Table users
 * 
 * Table principale des utilisateurs SHUGO avec:
 * - Chiffrement AES-256-GCM pour données sensibles (email, téléphone, noms)
 * - Hachage Argon2id pour mot de passe
 * - Support recherche phonétique pour noms
 * - Système de rôles hiérarchiques (Silver, Gold, Platinum, Admin, Admin_N1)
 * - Gestion du scope opérationnel
 * 
 * @see Document Technique V7.0 - Section 5.5, Annexe A.2.1
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      member_id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        allowNull: false,
        comment: 'Identifiant unique 10 chiffres (0000000001-9999999999)'
      },
      
      // === DONNÉES CHIFFRÉES ===
      email_encrypted: {
        type: Sequelize.BLOB,
        allowNull: false,
        comment: 'Email chiffré AES-256-GCM'
      },
      email_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true,
        comment: 'Hash SHA-256 pour recherche email'
      },
      password_hash: {
        type: Sequelize.STRING(255),
        allowNull: false,
        comment: 'Hash Argon2id du mot de passe'
      },
      first_name_encrypted: {
        type: Sequelize.BLOB,
        allowNull: false,
        comment: 'Prénom chiffré AES-256-GCM'
      },
      last_name_encrypted: {
        type: Sequelize.BLOB,
        allowNull: false,
        comment: 'Nom chiffré AES-256-GCM'
      },
      
      // === HASHES POUR RECHERCHE ===
      first_name_hash: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Hash SHA-256 pour recherche exacte prénom'
      },
      last_name_hash: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Hash SHA-256 pour recherche exacte nom'
      },
      
      // === RECHERCHE PHONÉTIQUE ===
      first_name_phonetic: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Hash phonétique pour recherche approximative prénom'
      },
      last_name_phonetic: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Hash phonétique pour recherche approximative nom'
      },
      phonetic_algo: {
        type: Sequelize.STRING(16),
        allowNull: true,
        comment: 'Algorithme phonétique utilisé (dm_fr, dm, cologne)'
      },
      
      // === CLÉS DE CHIFFREMENT ===
      enc_key_id: {
        type: Sequelize.SMALLINT,
        allowNull: true,
        comment: 'Version de clé AES pour rotation'
      },
      
      // === TÉLÉPHONE (OPTIONNEL) ===
      phone_encrypted: {
        type: Sequelize.BLOB,
        allowNull: true,
        comment: 'Numéro de téléphone chiffré (optionnel)'
      },
      
      // === RÔLE ET HIÉRARCHIE ===
      role: {
        type: Sequelize.ENUM('Silver', 'Gold', 'Platinum', 'Admin', 'Admin_N1'),
        allowNull: false,
        defaultValue: 'Silver',
        comment: 'Rôle hiérarchique de l\'utilisateur'
      },
      geo_id: {
        type: Sequelize.STRING(16),
        allowNull: false,
        comment: 'Localisation géographique (FK vers locations)'
      },
      group_id: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: 'Groupe d\'appartenance (FK vers groups)'
      },
      scope: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Périmètre opérationnel (central, local:geo_id, group:id)'
      },
      
      // === STATUT ===
      status: {
        type: Sequelize.ENUM('active', 'inactive', 'suspended', 'deleted'),
        allowNull: false,
        defaultValue: 'active',
        comment: 'Statut du compte utilisateur'
      },
      
      // === PRÉFÉRENCES ===
      preferred_language: {
        type: Sequelize.STRING(5),
        allowNull: false,
        defaultValue: 'fr',
        comment: 'Langue préférée (fr, en, it, es, pt)'
      },
      notification_channel: {
        type: Sequelize.ENUM('email', 'matrix', 'both'),
        allowNull: false,
        defaultValue: 'email',
        comment: 'Canal de notification préféré'
      },
      matrix_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
        comment: 'Identifiant Matrix/Element'
      },
      
      // === AUTHENTIFICATION 2FA ===
      totp_secret_encrypted: {
        type: Sequelize.BLOB,
        allowNull: true,
        comment: 'Secret TOTP chiffré AES-256-GCM'
      },
      totp_backup_codes: {
        type: Sequelize.BLOB,
        allowNull: true,
        comment: 'Codes de secours TOTP chiffrés'
      },
      totp_enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: '2FA activé ou non'
      },
      
      // === TRACKING CONNEXION ===
      last_login: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Dernière connexion'
      },
      last_ip: {
        type: Sequelize.INET,
        allowNull: true,
        comment: 'Dernière adresse IP'
      },
      failed_login_attempts: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Compteur échecs connexion'
      },
      locked_until: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Verrouillage temporaire jusqu\'à'
      },
      password_changed_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: 'Dernier changement mot de passe'
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
        comment: 'Soft delete timestamp'
      }
    });

    // === INDEX ===
    await queryInterface.addIndex('users', ['email_hash'], {
      name: 'idx_users_email_hash',
      unique: true
    });

    await queryInterface.addIndex('users', ['geo_id'], {
      name: 'idx_users_geo_id'
    });

    await queryInterface.addIndex('users', ['group_id'], {
      name: 'idx_users_group_id'
    });

    await queryInterface.addIndex('users', ['scope'], {
      name: 'idx_users_scope'
    });

    await queryInterface.addIndex('users', ['status'], {
      name: 'idx_users_status'
    });

    await queryInterface.addIndex('users', ['role'], {
      name: 'idx_users_role'
    });

    await queryInterface.addIndex('users', ['last_login'], {
      name: 'idx_users_last_login'
    });

    await queryInterface.addIndex('users', ['first_name_hash'], {
      name: 'idx_users_first_name_hash'
    });

    await queryInterface.addIndex('users', ['last_name_hash'], {
      name: 'idx_users_last_name_hash'
    });

    await queryInterface.addIndex('users', ['first_name_phonetic'], {
      name: 'idx_users_first_name_phonetic'
    });

    await queryInterface.addIndex('users', ['last_name_phonetic'], {
      name: 'idx_users_last_name_phonetic'
    });

    // === CONTRAINTES ===
    await queryInterface.sequelize.query(`
      ALTER TABLE users 
      ADD CONSTRAINT chk_member_id_range 
      CHECK (member_id BETWEEN 1 AND 9999999999)
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE users 
      ADD CONSTRAINT chk_language 
      CHECK (preferred_language IN ('fr','en','it','es','pt'))
    `);

    console.log('✅ Migration 002: Table users créée avec succès');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('users');
    console.log('⬇️ Migration 002: Table users supprimée');
  }
};
