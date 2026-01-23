/**
 * SHUGO v7.0 - Modèle BackupJob
 * 
 * Gestion des jobs de sauvegarde automatiques et manuels.
 * Implémente la stratégie 3-2-1 : 3 copies, 2 supports, 1 externalisé.
 * 
 * Référence: Document Technique V7.0 - Section 12 et Annexe A.5.1
 */

'use strict';

const { Model, DataTypes, Op } = require('sequelize');

module.exports = (sequelize) => {
  class BackupJob extends Model {
    /**
     * Définit les associations avec les autres modèles
     */
    static associate(models) {
      // Fichiers générés par cette sauvegarde
      BackupJob.hasMany(models.BackupFile, {
        foreignKey: 'job_id',
        as: 'files',
        onDelete: 'CASCADE'
      });

      // Clé de chiffrement utilisée
      BackupJob.belongsTo(models.AesKeyRotation, {
        foreignKey: 'encryption_key_id',
        as: 'encryptionKey'
      });
    }

    /**
     * Démarre un nouveau job de sauvegarde
     */
    static async startJob(type, level) {
      const job = await this.create({
        job_type: type,
        backup_level: level,
        scheduled_at: new Date(),
        started_at: new Date(),
        status: 'running'
      });

      return job;
    }

    /**
     * Termine le job avec succès
     */
    async complete(options = {}) {
      this.status = 'completed';
      this.completed_at = new Date();
      this.backup_size_bytes = options.sizeBytes || null;
      this.compression_ratio = options.compressionRatio || null;
      this.backup_location = options.location || null;
      this.verification_status = 'pending';
      
      // Calcul de la date de rétention
      const retentionDays = {
        'daily': 30,
        'weekly': 90,
        'monthly': 365,
        'manual': 90,
        'emergency': 365
      };
      
      const retention = new Date();
      retention.setDate(retention.getDate() + (retentionDays[this.job_type] || 30));
      this.retention_until = retention;

      await this.save();
    }

    /**
     * Marque le job comme échoué
     */
    async fail(errorMessage) {
      this.status = 'failed';
      this.completed_at = new Date();
      this.error_message = errorMessage;
      await this.save();
    }

    /**
     * Annule le job
     */
    async cancel() {
      this.status = 'cancelled';
      this.completed_at = new Date();
      await this.save();
    }

    /**
     * Met à jour le statut de vérification
     */
    async updateVerification(status) {
      this.verification_status = status;
      await this.save();
    }

    /**
     * Calcule la durée du job
     */
    getDuration() {
      if (!this.started_at) return null;
      const endTime = this.completed_at || new Date();
      return Math.round((new Date(endTime) - new Date(this.started_at)) / 1000);
    }

    /**
     * Récupère le dernier job réussi d'un type
     */
    static async getLastSuccessful(type = null) {
      const where = { 
        status: 'completed',
        verification_status: 'verified'
      };
      
      if (type) {
        where.job_type = type;
      }

      return this.findOne({
        where,
        order: [['completed_at', 'DESC']],
        include: [{ association: 'files' }]
      });
    }

    /**
     * Récupère l'historique des sauvegardes
     */
    static async getHistory(options = {}) {
      const where = {};
      
      if (options.type) {
        where.job_type = options.type;
      }
      
      if (options.status) {
        where.status = options.status;
      }

      return this.findAll({
        where,
        order: [['scheduled_at', 'DESC']],
        limit: options.limit || 50,
        include: [{ 
          association: 'files',
          attributes: ['file_id', 'file_type', 'file_size_bytes']
        }]
      });
    }

    /**
     * Vérifie si une sauvegarde est en cours
     */
    static async isBackupRunning() {
      const running = await this.findOne({
        where: { status: 'running' }
      });
      return !!running;
    }

    /**
     * Récupère les sauvegardes à purger (dépassant la rétention)
     */
    static async getExpiredBackups() {
      return this.findAll({
        where: {
          retention_until: { [Op.lt]: new Date() },
          status: 'completed'
        },
        include: [{ association: 'files' }]
      });
    }

    /**
     * Calcule l'espace total utilisé par les sauvegardes
     */
    static async getTotalSize() {
      const result = await this.findAll({
        where: { status: 'completed' },
        attributes: [
          [sequelize.fn('SUM', sequelize.col('backup_size_bytes')), 'total_size']
        ],
        raw: true
      });

      return result[0]?.total_size || 0;
    }

    /**
     * Récupère les statistiques de sauvegarde
     */
    static async getStatistics(days = 30) {
      const since = new Date();
      since.setDate(since.getDate() - days);

      const jobs = await this.findAll({
        where: {
          scheduled_at: { [Op.gte]: since }
        }
      });

      const stats = {
        total: jobs.length,
        completed: 0,
        failed: 0,
        cancelled: 0,
        totalSize: 0,
        avgDuration: 0,
        byType: {}
      };

      let totalDuration = 0;
      let durationCount = 0;

      jobs.forEach(job => {
        if (job.status === 'completed') {
          stats.completed++;
          if (job.backup_size_bytes) {
            stats.totalSize += parseInt(job.backup_size_bytes);
          }
          if (job.started_at && job.completed_at) {
            totalDuration += new Date(job.completed_at) - new Date(job.started_at);
            durationCount++;
          }
        } else if (job.status === 'failed') {
          stats.failed++;
        } else if (job.status === 'cancelled') {
          stats.cancelled++;
        }

        stats.byType[job.job_type] = (stats.byType[job.job_type] || 0) + 1;
      });

      if (durationCount > 0) {
        stats.avgDuration = Math.round(totalDuration / durationCount / 1000);
      }

      return stats;
    }

    /**
     * Programme une sauvegarde
     */
    static async scheduleBackup(type, level, scheduledAt) {
      return this.create({
        job_type: type,
        backup_level: level,
        scheduled_at: scheduledAt,
        status: 'scheduled'
      });
    }
  }

  BackupJob.init({
    job_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique du job'
    },
    job_type: {
      type: DataTypes.ENUM('daily', 'weekly', 'monthly', 'manual', 'emergency'),
      allowNull: false,
      comment: 'Type de sauvegarde'
    },
    backup_level: {
      type: DataTypes.ENUM('full', 'incremental', 'differential'),
      allowNull: false,
      comment: 'Niveau de sauvegarde'
    },
    scheduled_at: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Date/heure de planification'
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date/heure de démarrage'
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date/heure de fin'
    },
    status: {
      type: DataTypes.ENUM('scheduled', 'running', 'completed', 'failed', 'cancelled'),
      defaultValue: 'scheduled',
      comment: 'Statut du job'
    },
    backup_size_bytes: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'Taille totale de la sauvegarde en octets'
    },
    compression_ratio: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      comment: 'Ratio de compression (ex: 0.65 = 65%)'
    },
    backup_location: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Chemin ou URL de stockage'
    },
    encryption_key_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Référence vers la clé de chiffrement utilisée'
    },
    verification_status: {
      type: DataTypes.ENUM('verified', 'failed', 'pending'),
      allowNull: true,
      comment: 'Statut de vérification d\'intégrité'
    },
    retention_until: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date jusqu\'à laquelle conserver la sauvegarde'
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Message d\'erreur en cas d\'échec'
    }
  }, {
    sequelize,
    modelName: 'BackupJob',
    tableName: 'backup_jobs',
    timestamps: false,
    indexes: [
      { fields: ['job_type'] },
      { fields: ['status'] },
      { fields: ['scheduled_at'] },
      { fields: ['retention_until'] },
      { fields: ['verification_status'] }
    ]
  });

  return BackupJob;
};
