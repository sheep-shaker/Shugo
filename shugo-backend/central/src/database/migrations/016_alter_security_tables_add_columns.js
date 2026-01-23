'use strict';

/**
 * Migration 016 - Ajout de colonnes aux tables de sécurité
 *
 * Aligne les tables de sécurité avec les modèles améliorés:
 * - aes_keys_rotation: access_count, last_accessed_at, geo_id, rotated_at, updated_at
 * - shared_secrets: local_server_id, secret_version, encryption_key_id, synced_at, access_count, updated_at
 * - vault_items: access_level, local_server_id, tags, deleted_at
 * - security_protocols_log: protocol_level, local_server_id, trigger_details, affected_entities, severity, requires_follow_up, follow_up_notes, acknowledged_at, acknowledged_by, ip_address, user_agent
 * - emergency_codes: access_type, access_duration_minutes, activated_at
 *
 * @see Document Technique V7.0 - Sections 5.3, 5.4, 5.9
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // ===========================================
    // TABLE: aes_keys_rotation - Ajouts
    // ===========================================
    console.log('[Migration 016] Ajout colonnes aes_keys_rotation...');

    await queryInterface.addColumn('aes_keys_rotation', 'access_count', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Nombre d\'accès à cette clé'
    });

    await queryInterface.addColumn('aes_keys_rotation', 'last_accessed_at', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Dernier accès à cette clé'
    });

    await queryInterface.addColumn('aes_keys_rotation', 'geo_id', {
      type: Sequelize.STRING(16),
      allowNull: true,
      comment: 'Scope géographique (null = central)'
    });

    await queryInterface.addColumn('aes_keys_rotation', 'rotated_at', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Date de rotation (quand remplacée)'
    });

    await queryInterface.addColumn('aes_keys_rotation', 'updated_at', {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      comment: 'Date de mise à jour'
    });

    // Renommer rotated_by_member_id en rotated_by pour cohérence
    await queryInterface.renameColumn('aes_keys_rotation', 'rotated_by_member_id', 'rotated_by');

    // Index geo_id
    await queryInterface.addIndex('aes_keys_rotation', ['geo_id'], {
      name: 'idx_aes_keys_geo'
    });

    // ===========================================
    // TABLE: shared_secrets - Ajouts
    // ===========================================
    console.log('[Migration 016] Ajout colonnes shared_secrets...');

    await queryInterface.addColumn('shared_secrets', 'local_server_id', {
      type: Sequelize.UUID,
      allowNull: true,
      comment: 'ID du serveur local associé'
    });

    await queryInterface.addColumn('shared_secrets', 'secret_version', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1,
      comment: 'Version du secret'
    });

    await queryInterface.addColumn('shared_secrets', 'encryption_key_id', {
      type: Sequelize.UUID,
      allowNull: true,
      comment: 'Clé AES utilisée pour chiffrer'
    });

    await queryInterface.addColumn('shared_secrets', 'synced_at', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Dernière synchronisation central/local'
    });

    await queryInterface.addColumn('shared_secrets', 'access_count', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Nombre d\'accès'
    });

    await queryInterface.addColumn('shared_secrets', 'updated_at', {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      comment: 'Date de mise à jour'
    });

    // Renommer rotated_by_member_id en rotated_by pour cohérence
    await queryInterface.renameColumn('shared_secrets', 'rotated_by_member_id', 'rotated_by');

    // Ajouter le type 'sync' à l'ENUM secret_type
    await queryInterface.sequelize.query(`
      ALTER TYPE shared_secrets_secret_type_enum ADD VALUE IF NOT EXISTS 'sync'
    `);

    // Index local_server_id
    await queryInterface.addIndex('shared_secrets', ['local_server_id'], {
      name: 'idx_shared_secrets_server'
    });

    // ===========================================
    // TABLE: vault_items - Ajouts
    // ===========================================
    console.log('[Migration 016] Ajout colonnes vault_items...');

    await queryInterface.addColumn('vault_items', 'access_level', {
      type: Sequelize.STRING(16),
      allowNull: false,
      defaultValue: 'restricted',
      comment: 'Niveau: public, internal, restricted, critical'
    });

    await queryInterface.addColumn('vault_items', 'local_server_id', {
      type: Sequelize.UUID,
      allowNull: true,
      comment: 'ID du serveur local associé'
    });

    await queryInterface.addColumn('vault_items', 'tags', {
      type: Sequelize.ARRAY(Sequelize.STRING),
      allowNull: true,
      defaultValue: [],
      comment: 'Tags pour classification'
    });

    await queryInterface.addColumn('vault_items', 'deleted_at', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Soft delete'
    });

    await queryInterface.addColumn('vault_items', 'last_accessed_by', {
      type: Sequelize.BIGINT,
      allowNull: true,
      comment: 'member_id du dernier accès'
    });

    await queryInterface.addColumn('vault_items', 'created_by', {
      type: Sequelize.BIGINT,
      allowNull: true,
      comment: 'member_id du créateur'
    });

    // Renommer created_by_member_id en created_by si existe
    try {
      await queryInterface.renameColumn('vault_items', 'created_by_member_id', 'created_by');
    } catch (e) {
      // Colonne peut ne pas exister
    }

    // Ajouter types item_type manquants
    await queryInterface.sequelize.query(`
      ALTER TYPE vault_items_item_type_enum ADD VALUE IF NOT EXISTS 'api_key'
    `);
    await queryInterface.sequelize.query(`
      ALTER TYPE vault_items_item_type_enum ADD VALUE IF NOT EXISTS 'credential'
    `);

    // Index access_level
    await queryInterface.addIndex('vault_items', ['access_level'], {
      name: 'idx_vault_items_access_level'
    });

    // Index local_server_id
    await queryInterface.addIndex('vault_items', ['local_server_id'], {
      name: 'idx_vault_items_server'
    });

    // Index GIN pour tags
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_vault_items_tags ON vault_items USING gin(tags)
    `);

    // ===========================================
    // TABLE: security_protocols_log - Ajouts
    // ===========================================
    console.log('[Migration 016] Ajout colonnes security_protocols_log...');

    await queryInterface.addColumn('security_protocols_log', 'protocol_level', {
      type: Sequelize.STRING(16),
      allowNull: true,
      comment: 'Niveau si applicable: levis, salutaris, purgatrix'
    });

    await queryInterface.addColumn('security_protocols_log', 'local_server_id', {
      type: Sequelize.UUID,
      allowNull: true,
      comment: 'Serveur local concerné'
    });

    await queryInterface.addColumn('security_protocols_log', 'trigger_details', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: {},
      comment: 'Détails du déclencheur'
    });

    await queryInterface.addColumn('security_protocols_log', 'affected_entities', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: {},
      comment: 'Entités affectées'
    });

    await queryInterface.addColumn('security_protocols_log', 'severity', {
      type: Sequelize.STRING(16),
      allowNull: false,
      defaultValue: 'medium',
      comment: 'Sévérité: low, medium, high, critical'
    });

    await queryInterface.addColumn('security_protocols_log', 'requires_follow_up', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Si true, nécessite un suivi'
    });

    await queryInterface.addColumn('security_protocols_log', 'follow_up_notes', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: 'Notes de suivi'
    });

    await queryInterface.addColumn('security_protocols_log', 'acknowledged_at', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Date d\'acquittement'
    });

    await queryInterface.addColumn('security_protocols_log', 'acknowledged_by', {
      type: Sequelize.BIGINT,
      allowNull: true,
      comment: 'member_id ayant acquitté'
    });

    await queryInterface.addColumn('security_protocols_log', 'ip_address', {
      type: Sequelize.STRING(45),
      allowNull: true,
      comment: 'Adresse IP de l\'initiateur'
    });

    await queryInterface.addColumn('security_protocols_log', 'user_agent', {
      type: Sequelize.STRING(512),
      allowNull: true,
      comment: 'User-Agent si applicable'
    });

    await queryInterface.addColumn('security_protocols_log', 'updated_at', {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      comment: 'Date de mise à jour'
    });

    // Renommer duration_seconds en duration_ms
    await queryInterface.renameColumn('security_protocols_log', 'duration_seconds', 'duration_ms');

    // Ajouter valeurs ENUM triggered_by
    await queryInterface.sequelize.query(`
      ALTER TYPE security_protocols_log_triggered_by_enum ADD VALUE IF NOT EXISTS 'scheduled'
    `);
    await queryInterface.sequelize.query(`
      ALTER TYPE security_protocols_log_triggered_by_enum ADD VALUE IF NOT EXISTS 'emergency'
    `);

    // Ajouter valeurs ENUM result
    await queryInterface.sequelize.query(`
      ALTER TYPE security_protocols_log_result_enum ADD VALUE IF NOT EXISTS 'pending'
    `);
    await queryInterface.sequelize.query(`
      ALTER TYPE security_protocols_log_result_enum ADD VALUE IF NOT EXISTS 'cancelled'
    `);

    // Ajouter valeurs ENUM scope
    await queryInterface.sequelize.query(`
      ALTER TYPE security_protocols_log_scope_enum ADD VALUE IF NOT EXISTS 'local_and_central'
    `);

    // Index severity
    await queryInterface.addIndex('security_protocols_log', ['severity'], {
      name: 'idx_security_log_severity'
    });

    // Index local_server_id
    await queryInterface.addIndex('security_protocols_log', ['local_server_id'], {
      name: 'idx_security_log_server'
    });

    // Index requires_follow_up partiel
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_security_log_follow_up
      ON security_protocols_log (requires_follow_up)
      WHERE requires_follow_up = true
    `);

    // ===========================================
    // TABLE: emergency_codes - Ajouts
    // ===========================================
    console.log('[Migration 016] Ajout colonnes emergency_codes...');

    await queryInterface.addColumn('emergency_codes', 'access_type', {
      type: Sequelize.STRING(32),
      allowNull: true,
      comment: 'Type d\'accès accordé: admin_emergency, vault_access, recovery'
    });

    await queryInterface.addColumn('emergency_codes', 'access_duration_minutes', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: 120,
      comment: 'Durée d\'accès accordée (défaut: 2h)'
    });

    await queryInterface.addColumn('emergency_codes', 'activated_at', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Date d\'activation du tableau'
    });

    await queryInterface.addColumn('emergency_codes', 'updated_at', {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      comment: 'Date de mise à jour'
    });

    // Ajouter valeurs ENUM status
    await queryInterface.sequelize.query(`
      ALTER TYPE emergency_codes_status_enum ADD VALUE IF NOT EXISTS 'PENDING'
    `);
    await queryInterface.sequelize.query(`
      ALTER TYPE emergency_codes_status_enum ADD VALUE IF NOT EXISTS 'USED'
    `);
    await queryInterface.sequelize.query(`
      ALTER TYPE emergency_codes_status_enum ADD VALUE IF NOT EXISTS 'EXPIRED'
    `);

    // Renommer colonnes pour cohérence avec le modèle
    try {
      await queryInterface.renameColumn('emergency_codes', 'revocation_reason', 'revoked_reason');
      await queryInterface.renameColumn('emergency_codes', 'generated_at', 'created_at');
    } catch (e) {
      // Colonnes peuvent déjà avoir le bon nom
    }

    console.log('✅ Migration 016: Colonnes de sécurité ajoutées');
  },

  async down(queryInterface, Sequelize) {
    // Suppression des colonnes ajoutées (ordre inverse)

    // emergency_codes
    await queryInterface.removeColumn('emergency_codes', 'access_type');
    await queryInterface.removeColumn('emergency_codes', 'access_duration_minutes');
    await queryInterface.removeColumn('emergency_codes', 'activated_at');
    await queryInterface.removeColumn('emergency_codes', 'updated_at');

    // security_protocols_log
    await queryInterface.removeColumn('security_protocols_log', 'protocol_level');
    await queryInterface.removeColumn('security_protocols_log', 'local_server_id');
    await queryInterface.removeColumn('security_protocols_log', 'trigger_details');
    await queryInterface.removeColumn('security_protocols_log', 'affected_entities');
    await queryInterface.removeColumn('security_protocols_log', 'severity');
    await queryInterface.removeColumn('security_protocols_log', 'requires_follow_up');
    await queryInterface.removeColumn('security_protocols_log', 'follow_up_notes');
    await queryInterface.removeColumn('security_protocols_log', 'acknowledged_at');
    await queryInterface.removeColumn('security_protocols_log', 'acknowledged_by');
    await queryInterface.removeColumn('security_protocols_log', 'ip_address');
    await queryInterface.removeColumn('security_protocols_log', 'user_agent');
    await queryInterface.removeColumn('security_protocols_log', 'updated_at');
    await queryInterface.renameColumn('security_protocols_log', 'duration_ms', 'duration_seconds');

    // vault_items
    await queryInterface.removeColumn('vault_items', 'access_level');
    await queryInterface.removeColumn('vault_items', 'local_server_id');
    await queryInterface.removeColumn('vault_items', 'tags');
    await queryInterface.removeColumn('vault_items', 'deleted_at');
    await queryInterface.removeColumn('vault_items', 'last_accessed_by');

    // shared_secrets
    await queryInterface.removeColumn('shared_secrets', 'local_server_id');
    await queryInterface.removeColumn('shared_secrets', 'secret_version');
    await queryInterface.removeColumn('shared_secrets', 'encryption_key_id');
    await queryInterface.removeColumn('shared_secrets', 'synced_at');
    await queryInterface.removeColumn('shared_secrets', 'access_count');
    await queryInterface.removeColumn('shared_secrets', 'updated_at');
    await queryInterface.renameColumn('shared_secrets', 'rotated_by', 'rotated_by_member_id');

    // aes_keys_rotation
    await queryInterface.removeColumn('aes_keys_rotation', 'access_count');
    await queryInterface.removeColumn('aes_keys_rotation', 'last_accessed_at');
    await queryInterface.removeColumn('aes_keys_rotation', 'geo_id');
    await queryInterface.removeColumn('aes_keys_rotation', 'rotated_at');
    await queryInterface.removeColumn('aes_keys_rotation', 'updated_at');
    await queryInterface.renameColumn('aes_keys_rotation', 'rotated_by', 'rotated_by_member_id');

    console.log('⬇️ Migration 016: Colonnes de sécurité supprimées');
  }
};
