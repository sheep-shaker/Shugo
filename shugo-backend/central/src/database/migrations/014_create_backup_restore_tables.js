'use strict';

/**
 * Migration 014 - Tables de sauvegarde et restauration
 * 
 * Tables pour le système de backup:
 * - backup_jobs: Jobs de sauvegarde
 * - backup_files: Fichiers de sauvegarde
 * - restore_operations: Opérations de restauration
 * 
 * @see Document Technique V7.0 - Section 12, Annexe A.5
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // ===========================================
    // TABLE: backup_jobs
    // ===========================================
    await queryInterface.createTable('backup_jobs', {
      job_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      job_type: {
        type: Sequelize.ENUM('daily', 'weekly', 'monthly', 'manual', 'emergency'),
        allowNull: false,
        comment: 'Type de sauvegarde'
      },
      backup_level: {
        type: Sequelize.ENUM('full', 'incremental', 'differential'),
        allowNull: false,
        comment: 'Niveau de sauvegarde'
      },
      geo_id: {
        type: Sequelize.STRING(16),
        allowNull: true,
        comment: 'Local source (NULL pour central)'
      },
      server_id: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Serveur source'
      },
      scheduled_at: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: 'Date prévue'
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Début d\'exécution'
      },
      completed_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Fin d\'exécution'
      },
      status: {
        type: Sequelize.ENUM('scheduled', 'running', 'completed', 'failed', 'cancelled'),
        allowNull: false,
        defaultValue: 'scheduled',
        comment: 'Statut du job'
      },
      backup_size_bytes: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Taille totale en bytes'
      },
      compression_ratio: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
        comment: 'Ratio de compression'
      },
      backup_location: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Chemin ou URL de stockage'
      },
      encryption_key_id: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: 'Clé de chiffrement utilisée'
      },
      verification_status: {
        type: Sequelize.ENUM('pending', 'verified', 'failed'),
        allowNull: true,
        comment: 'Statut de vérification'
      },
      verified_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date de vérification'
      },
      retention_until: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date de rétention'
      },
      files_count: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Nombre de fichiers'
      },
      duration_seconds: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Durée en secondes'
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Message d\'erreur si échec'
      },
      triggered_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Déclencheur manuel'
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

    // Index backup_jobs
    await queryInterface.addIndex('backup_jobs', ['job_type'], { name: 'idx_backup_jobs_type' });
    await queryInterface.addIndex('backup_jobs', ['status'], { name: 'idx_backup_jobs_status' });
    await queryInterface.addIndex('backup_jobs', ['scheduled_at'], { name: 'idx_backup_jobs_scheduled' });
    await queryInterface.addIndex('backup_jobs', ['retention_until'], { name: 'idx_backup_jobs_retention' });
    await queryInterface.addIndex('backup_jobs', ['geo_id'], { name: 'idx_backup_jobs_geo' });

    // ===========================================
    // TABLE: backup_files
    // ===========================================
    await queryInterface.createTable('backup_files', {
      file_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      job_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'backup_jobs',
          key: 'job_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Job parent'
      },
      file_type: {
        type: Sequelize.ENUM('database', 'vault', 'logs', 'config', 'binary', 'archive'),
        allowNull: false,
        comment: 'Type de fichier'
      },
      file_name: {
        type: Sequelize.STRING(255),
        allowNull: false,
        comment: 'Nom du fichier'
      },
      file_path: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: 'Chemin complet'
      },
      file_size_bytes: {
        type: Sequelize.BIGINT,
        allowNull: false,
        comment: 'Taille en bytes'
      },
      checksum_md5: {
        type: Sequelize.STRING(32),
        allowNull: false,
        comment: 'Checksum MD5'
      },
      checksum_sha256: {
        type: Sequelize.STRING(64),
        allowNull: false,
        comment: 'Checksum SHA-256'
      },
      compression_type: {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: 'Type de compression (gzip, bzip2, lz4)'
      },
      encryption_algorithm: {
        type: Sequelize.STRING(30),
        allowNull: true,
        comment: 'Algorithme de chiffrement (AES-256-GCM)'
      },
      is_encrypted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Fichier chiffré'
      },
      original_size_bytes: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Taille originale avant compression'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Index backup_files
    await queryInterface.addIndex('backup_files', ['job_id'], { name: 'idx_backup_files_job' });
    await queryInterface.addIndex('backup_files', ['file_type'], { name: 'idx_backup_files_type' });
    await queryInterface.addIndex('backup_files', ['created_at'], { name: 'idx_backup_files_created' });

    // ===========================================
    // TABLE: restore_operations
    // ===========================================
    await queryInterface.createTable('restore_operations', {
      restore_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        comment: 'Identifiant unique'
      },
      restore_type: {
        type: Sequelize.ENUM('full', 'partial', 'emergency', 'point_in_time'),
        allowNull: false,
        comment: 'Type de restauration'
      },
      source_backup_job_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'backup_jobs',
          key: 'job_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Backup source'
      },
      target_timestamp: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Timestamp cible (pour point-in-time)'
      },
      target_geo_id: {
        type: Sequelize.STRING(16),
        allowNull: true,
        comment: 'Local cible'
      },
      target_server_id: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Serveur cible'
      },
      requested_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        comment: 'Demandeur'
      },
      approved_by_member_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        comment: 'Approbateur'
      },
      status: {
        type: Sequelize.ENUM('requested', 'approved', 'running', 'completed', 'failed', 'cancelled', 'rolled_back'),
        allowNull: false,
        defaultValue: 'requested',
        comment: 'Statut de l\'opération'
      },
      requested_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        comment: 'Date de demande'
      },
      approved_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date d\'approbation'
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Début d\'exécution'
      },
      completed_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Fin d\'exécution'
      },
      components_restored: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
        comment: 'Composants restaurés'
      },
      validation_results: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {},
        comment: 'Résultats des tests de validation'
      },
      rollback_available: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Rollback possible'
      },
      rollback_deadline: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Délai de rollback (24h)'
      },
      rolled_back_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date de rollback'
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Message d\'erreur si échec'
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Notes'
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {},
        comment: 'Métadonnées'
      }
    });

    // Index restore_operations
    await queryInterface.addIndex('restore_operations', ['restore_type'], { name: 'idx_restore_operations_type' });
    await queryInterface.addIndex('restore_operations', ['status'], { name: 'idx_restore_operations_status' });
    await queryInterface.addIndex('restore_operations', ['requested_by_member_id'], { name: 'idx_restore_operations_requested' });
    await queryInterface.addIndex('restore_operations', ['target_geo_id'], { name: 'idx_restore_operations_geo' });

    console.log('✅ Migration 014: Tables backup_jobs, backup_files, restore_operations créées');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('restore_operations');
    await queryInterface.dropTable('backup_files');
    await queryInterface.dropTable('backup_jobs');
    console.log('⬇️ Migration 014: Tables backup_jobs, backup_files, restore_operations supprimées');
  }
};
