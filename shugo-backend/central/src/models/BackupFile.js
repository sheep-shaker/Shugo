/**
 * SHUGO v7.0 - Modèle BackupFile
 * 
 * Gestion des fichiers individuels générés lors d'une sauvegarde.
 * Chaque sauvegarde peut produire plusieurs fichiers (database, vault, logs, config).
 * 
 * Référence: Document Technique V7.0 - Section 12.1 et Annexe A.5.2
 */

'use strict';

const { Model, DataTypes, Op } = require('sequelize');
const crypto = require('crypto');

module.exports = (sequelize) => {
  class BackupFile extends Model {
    /**
     * Définit les associations avec les autres modèles
     */
    static associate(models) {
      // Job de sauvegarde parent
      BackupFile.belongsTo(models.BackupJob, {
        foreignKey: 'job_id',
        as: 'job',
        onDelete: 'CASCADE'
      });
    }

    /**
     * Crée un enregistrement pour un fichier de backup
     */
    static async createFileRecord(jobId, options) {
      return this.create({
        job_id: jobId,
        file_type: options.fileType,
        file_path: options.filePath,
        file_size_bytes: options.sizeBytes,
        checksum_md5: options.checksumMd5,
        checksum_sha256: options.checksumSha256,
        compression_type: options.compressionType || null,
        encryption_algorithm: options.encryptionAlgorithm || 'AES-256-GCM',
        is_encrypted: options.isEncrypted !== false
      });
    }

    /**
     * Vérifie l'intégrité du fichier avec son checksum
     */
    async verifyIntegrity(actualChecksum, algorithm = 'sha256') {
      const expectedChecksum = algorithm === 'md5' 
        ? this.checksum_md5 
        : this.checksum_sha256;
      
      return actualChecksum === expectedChecksum;
    }

    /**
     * Génère les checksums pour un buffer de données
     */
    static generateChecksums(buffer) {
      return {
        md5: crypto.createHash('md5').update(buffer).digest('hex'),
        sha256: crypto.createHash('sha256').update(buffer).digest('hex')
      };
    }

    /**
     * Récupère tous les fichiers d'un job
     */
    static async getFilesForJob(jobId) {
      return this.findAll({
        where: { job_id: jobId },
        order: [['file_type', 'ASC']]
      });
    }

    /**
     * Récupère les fichiers par type
     */
    static async getByType(fileType, limit = 50) {
      return this.findAll({
        where: { file_type: fileType },
        order: [['created_at', 'DESC']],
        limit,
        include: [{
          association: 'job',
          attributes: ['job_id', 'job_type', 'status', 'scheduled_at']
        }]
      });
    }

    /**
     * Calcule la taille totale des fichiers de backup
     */
    static async getTotalSize(fileType = null) {
      const where = {};
      if (fileType) {
        where.file_type = fileType;
      }

      const result = await this.findAll({
        where,
        attributes: [
          [sequelize.fn('SUM', sequelize.col('file_size_bytes')), 'total_size']
        ],
        raw: true
      });

      return parseInt(result[0]?.total_size || 0);
    }

    /**
     * Récupère les statistiques par type de fichier
     */
    static async getStatisticsByType() {
      const result = await this.findAll({
        attributes: [
          'file_type',
          [sequelize.fn('COUNT', sequelize.col('file_id')), 'count'],
          [sequelize.fn('SUM', sequelize.col('file_size_bytes')), 'total_size'],
          [sequelize.fn('AVG', sequelize.col('file_size_bytes')), 'avg_size']
        ],
        group: ['file_type'],
        raw: true
      });

      return result.reduce((acc, row) => {
        acc[row.file_type] = {
          count: parseInt(row.count),
          totalSize: parseInt(row.total_size || 0),
          avgSize: Math.round(parseFloat(row.avg_size || 0))
        };
        return acc;
      }, {});
    }

    /**
     * Supprime les fichiers expirés
     */
    static async deleteExpiredFiles(jobIds) {
      return this.destroy({
        where: {
          job_id: { [Op.in]: jobIds }
        }
      });
    }

    /**
     * Formate la taille en format lisible
     */
    getFormattedSize() {
      const bytes = this.file_size_bytes;
      if (bytes === 0) return '0 B';
      
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Récupère le dernier fichier d'un type spécifique
     */
    static async getLatestByType(fileType) {
      return this.findOne({
        where: { file_type: fileType },
        order: [['created_at', 'DESC']],
        include: [{
          association: 'job',
          where: { status: 'completed' }
        }]
      });
    }
  }

  BackupFile.init({
    file_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique du fichier'
    },
    job_id: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'Référence vers le job de sauvegarde parent'
    },
    file_type: {
      type: DataTypes.ENUM('database', 'vault', 'logs', 'config', 'binary', 'archive'),
      allowNull: false,
      comment: 'Type de fichier: database, vault, logs, config, binary, archive'
    },
    file_path: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Chemin complet du fichier'
    },
    file_size_bytes: {
      type: DataTypes.BIGINT,
      allowNull: false,
      validate: {
        min: 0
      },
      comment: 'Taille du fichier en octets'
    },
    checksum_md5: {
      type: DataTypes.STRING(32),
      allowNull: false,
      validate: {
        len: [32, 32],
        is: /^[a-f0-9]{32}$/i
      },
      comment: 'Checksum MD5 pour vérification rapide'
    },
    checksum_sha256: {
      type: DataTypes.STRING(64),
      allowNull: false,
      validate: {
        len: [64, 64],
        is: /^[a-f0-9]{64}$/i
      },
      comment: 'Checksum SHA-256 pour vérification sécurisée'
    },
    compression_type: {
      type: DataTypes.STRING(20),
      allowNull: true,
      validate: {
        isIn: [['gzip', 'bzip2', 'lz4', 'zstd', null]]
      },
      comment: 'Type de compression utilisée'
    },
    encryption_algorithm: {
      type: DataTypes.STRING(30),
      allowNull: true,
      defaultValue: 'AES-256-GCM',
      comment: 'Algorithme de chiffrement utilisé'
    },
    is_encrypted: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: 'Fichier chiffré ou non'
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      comment: 'Date de création du fichier'
    }
  }, {
    sequelize,
    modelName: 'BackupFile',
    tableName: 'backup_files',
    timestamps: false,
    indexes: [
      { fields: ['job_id'] },
      { fields: ['file_type'] },
      { fields: ['created_at'] }
    ]
  });

  return BackupFile;
};
