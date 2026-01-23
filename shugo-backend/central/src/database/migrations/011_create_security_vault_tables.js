'use strict';

/**
 * Migration 011 - Tables de sécurité et cryptographie
 * 
 * Tables critiques pour le système de sécurité SHUGO:
 * - aes_keys_rotation: Rotation des clés AES-256-GCM
 * - shared_secrets: Secrets partagés central/local
 * - emergency_codes: Tableaux de secours (100 codes)
 * - vault_items: Éléments du Vault
 * - security_protocols_log: Logs des protocoles système
 * 
 * @see Document Technique V7.0 - Section 5, Annexe A.3
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // ===========================================
    // TABLE: aes_keys_rotation
    // ===========================================
    await queryInterface.createTable('aes_keys_rotation', {
      rotation_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique de la rotation'
      },
      key_type: {
        type: Sequelize.ENUM('vault_local', 'vault_central', 'backup', 'logs'),
        allowNull: false,
        comment: 'Type de clé'
      },
      key_version: {
        type: Sequelize.INTEGER,
        allowNull: false,
        comment: 'Numéro de version de la clé'
      },
      key_encrypted: {
        type: Sequelize.BLOB,
        allowNull: false,
        comment: 'Clé chiffrée avec la clé maître'
      },
      initialization_vector: {
        type: Sequelize.BLOB,
        allowNull: false,
        comment: 'IV unique de 12 octets'
      },
      key_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
        comment: 'Hash SHA-256 pour validation'
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Clé actuellement active'
      },
      previous_key_id: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: 'Référence vers la clé précédente'
      },
      activated_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'activation'
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: 'Date d\'expiration (rotation annuelle)'
      },
      rotated_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Admin qui a effectué la rotation'
      },
      rotation_reason: {
        type: Sequelize.ENUM('scheduled', 'manual', 'compromise', 'initial'),
        allowNull: false,
        defaultValue: 'scheduled',
        comment: 'Raison de la rotation'
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {},
        comment: 'Métadonnées additionnelles'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Index aes_keys_rotation
    await queryInterface.addIndex('aes_keys_rotation', ['key_type'], { name: 'idx_aes_keys_type' });
    await queryInterface.addIndex('aes_keys_rotation', ['is_active'], { name: 'idx_aes_keys_active' });
    await queryInterface.addIndex('aes_keys_rotation', ['expires_at'], { name: 'idx_aes_keys_expires' });

    // FK pour previous_key_id
    await queryInterface.addConstraint('aes_keys_rotation', {
      fields: ['previous_key_id'],
      type: 'foreign key',
      name: 'fk_aes_keys_previous',
      references: {
        table: 'aes_keys_rotation',
        field: 'rotation_id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    // ===========================================
    // TABLE: shared_secrets
    // ===========================================
    await queryInterface.createTable('shared_secrets', {
      secret_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      secret_type: {
        type: Sequelize.ENUM('local_central', 'emergency', 'backup'),
        allowNull: false,
        comment: 'Type de secret'
      },
      geo_id: {
        type: Sequelize.STRING(16),
        allowNull: true,
        comment: 'Local associé (NULL pour secrets globaux)'
      },
      secret_encrypted: {
        type: Sequelize.BLOB,
        allowNull: false,
        comment: 'Secret chiffré'
      },
      secret_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
        comment: 'Hash pour validation croisée'
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Secret actif'
      },
      previous_secret_id: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: 'Secret précédent'
      },
      activated_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'activation'
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: 'Date d\'expiration (rotation annuelle)'
      },
      rotation_reason: {
        type: Sequelize.ENUM('scheduled', 'manual', 'compromise'),
        allowNull: true,
        comment: 'Raison de la rotation'
      },
      rotated_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Admin qui a effectué la rotation'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Index shared_secrets
    await queryInterface.addIndex('shared_secrets', ['secret_type'], { name: 'idx_shared_secrets_type' });
    await queryInterface.addIndex('shared_secrets', ['is_active'], { name: 'idx_shared_secrets_active' });
    await queryInterface.addIndex('shared_secrets', ['expires_at'], { name: 'idx_shared_secrets_expires' });
    await queryInterface.addIndex('shared_secrets', ['geo_id'], { name: 'idx_shared_secrets_geo' });

    // ===========================================
    // TABLE: emergency_codes
    // ===========================================
    await queryInterface.createTable('emergency_codes', {
      code_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      tableau_series: {
        type: Sequelize.STRING(50),
        allowNull: false,
        comment: 'Série du tableau (SECOURS-YYYY-MM-{geo_id})'
      },
      master_code_hash: {
        type: Sequelize.STRING(128),
        allowNull: false,
        comment: 'Hash du code maître'
      },
      series_code_hash: {
        type: Sequelize.STRING(128),
        allowNull: false,
        comment: 'Hash du code série'
      },
      geo_id: {
        type: Sequelize.STRING(16),
        allowNull: false,
        comment: 'Local associé'
      },
      code_position: {
        type: Sequelize.STRING(10),
        allowNull: false,
        comment: 'Position dans le tableau (A01, B15, C33, etc.)'
      },
      code_hash: {
        type: Sequelize.STRING(128),
        allowNull: false,
        comment: 'Hash du code (jamais en clair)'
      },
      total_codes: {
        type: Sequelize.SMALLINT,
        allowNull: false,
        defaultValue: 100,
        comment: 'Nombre total de codes dans le tableau'
      },
      used_count: {
        type: Sequelize.SMALLINT,
        allowNull: false,
        defaultValue: 0,
        comment: 'Nombre de codes utilisés'
      },
      status: {
        type: Sequelize.ENUM('ACTIVE', 'REVOKED', 'EXHAUSTED'),
        allowNull: false,
        defaultValue: 'ACTIVE',
        comment: 'Statut du tableau'
      },
      is_used: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Code individuel utilisé'
      },
      used_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'utilisation'
      },
      used_by_ip: {
        type: Sequelize.INET,
        allowNull: true,
        comment: 'IP lors de l\'utilisation'
      },
      used_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Admin qui a utilisé le code'
      },
      generated_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Admin qui a généré le tableau'
      },
      generated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: 'Date de génération'
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'expiration'
      },
      revoked_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date de révocation'
      },
      revocation_reason: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Motif de révocation'
      }
    });

    // Index emergency_codes
    await queryInterface.addIndex('emergency_codes', ['tableau_series'], { name: 'idx_emergency_codes_series' });
    await queryInterface.addIndex('emergency_codes', ['geo_id'], { name: 'idx_emergency_codes_geo_id' });
    await queryInterface.addIndex('emergency_codes', ['status'], { name: 'idx_emergency_codes_status' });
    await queryInterface.addIndex('emergency_codes', ['is_used'], { name: 'idx_emergency_codes_used' });

    // Contrainte unicité tableau + position
    await queryInterface.addIndex('emergency_codes', ['tableau_series', 'code_position'], {
      name: 'idx_emergency_codes_unique',
      unique: true
    });

    // Contrainte format position
    await queryInterface.sequelize.query(`
      ALTER TABLE emergency_codes 
      ADD CONSTRAINT chk_code_position 
      CHECK (code_position ~ '^[ABC][0-9]{2}$')
    `);

    // ===========================================
    // TABLE: vault_items
    // ===========================================
    await queryInterface.createTable('vault_items', {
      item_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      vault_type: {
        type: Sequelize.ENUM('local', 'central'),
        allowNull: false,
        comment: 'Type de Vault'
      },
      item_type: {
        type: Sequelize.ENUM('aes_key', 'secret', 'certificate', 'backup_key', 'emergency_key'),
        allowNull: false,
        comment: 'Type d\'élément'
      },
      item_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
        comment: 'Nom de l\'élément'
      },
      item_data_encrypted: {
        type: Sequelize.BLOB,
        allowNull: false,
        comment: 'Données chiffrées'
      },
      encryption_key_id: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: 'Clé utilisée pour le chiffrement'
      },
      geo_id: {
        type: Sequelize.STRING(16),
        allowNull: true,
        comment: 'Local associé (NULL pour central)'
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {},
        comment: 'Métadonnées non sensibles'
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Élément actif'
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'expiration'
      },
      access_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Nombre d\'accès'
      },
      last_accessed_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Dernier accès'
      },
      created_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Créateur'
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

    // Index vault_items
    await queryInterface.addIndex('vault_items', ['vault_type'], { name: 'idx_vault_items_type' });
    await queryInterface.addIndex('vault_items', ['item_type'], { name: 'idx_vault_items_item_type' });
    await queryInterface.addIndex('vault_items', ['is_active'], { name: 'idx_vault_items_active' });
    await queryInterface.addIndex('vault_items', ['expires_at'], { name: 'idx_vault_items_expires' });
    await queryInterface.addIndex('vault_items', ['geo_id'], { name: 'idx_vault_items_geo' });

    // ===========================================
    // TABLE: security_protocols_log
    // ===========================================
    await queryInterface.createTable('security_protocols_log', {
      protocol_log_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      protocol_name: {
        type: Sequelize.STRING(50),
        allowNull: false,
        comment: 'Nom du protocole (SYS-INT-001, GuiltySpark, etc.)'
      },
      protocol_code: {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: 'Code interne (POL-2xx, POL-5xx)'
      },
      triggered_by: {
        type: Sequelize.ENUM('automatic', 'manual'),
        allowNull: false,
        comment: 'Mode de déclenchement'
      },
      trigger_source: {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: 'Source du déclenchement'
      },
      member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Admin qui a déclenché (si manuel)'
      },
      scope: {
        type: Sequelize.ENUM('local', 'central', 'global'),
        allowNull: false,
        comment: 'Portée du protocole'
      },
      geo_id: {
        type: Sequelize.STRING(16),
        allowNull: true,
        comment: 'Local concerné'
      },
      reason: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: 'Raison du déclenchement'
      },
      actions_taken: {
        type: Sequelize.JSONB,
        allowNull: false,
        comment: 'Liste des actions exécutées'
      },
      result: {
        type: Sequelize.ENUM('success', 'partial', 'failed'),
        allowNull: false,
        comment: 'Résultat de l\'exécution'
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Message d\'erreur si échec'
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: 'Début d\'exécution'
      },
      completed_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Fin d\'exécution'
      },
      duration_seconds: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Durée en secondes'
      }
    });

    // Index security_protocols_log
    await queryInterface.addIndex('security_protocols_log', ['protocol_name'], { name: 'idx_security_protocols_name' });
    await queryInterface.addIndex('security_protocols_log', ['triggered_by'], { name: 'idx_security_protocols_triggered' });
    await queryInterface.addIndex('security_protocols_log', ['started_at'], { name: 'idx_security_protocols_started' });
    await queryInterface.addIndex('security_protocols_log', ['result'], { name: 'idx_security_protocols_result' });
    await queryInterface.addIndex('security_protocols_log', ['geo_id'], { name: 'idx_security_protocols_geo' });

    console.log('✅ Migration 011: Tables de sécurité et cryptographie créées');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('security_protocols_log');
    await queryInterface.dropTable('vault_items');
    await queryInterface.dropTable('emergency_codes');
    await queryInterface.dropTable('shared_secrets');
    await queryInterface.dropTable('aes_keys_rotation');
    console.log('⬇️ Migration 011: Tables de sécurité et cryptographie supprimées');
  }
};
