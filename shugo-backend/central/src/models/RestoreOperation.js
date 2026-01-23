/**
 * SHUGO v7.0 - Modèle RestoreOperation
 * 
 * Gestion des opérations de restauration système.
 * Supporte la restauration complète, partielle, d'urgence et point-in-time.
 * 
 * Référence: Document Technique V7.0 - Section 12.3 et Annexe A.5.3
 */

'use strict';

const { Model, DataTypes, Op } = require('sequelize');

module.exports = (sequelize) => {
  class RestoreOperation extends Model {
    /**
     * Définit les associations avec les autres modèles
     */
    static associate(models) {
      // Sauvegarde source
      RestoreOperation.belongsTo(models.BackupJob, {
        foreignKey: 'source_backup_job_id',
        as: 'sourceBackup'
      });

      // Utilisateur demandeur
      RestoreOperation.belongsTo(models.User, {
        foreignKey: 'requested_by_member_id',
        as: 'requester'
      });

      // Utilisateur approbateur
      RestoreOperation.belongsTo(models.User, {
        foreignKey: 'approved_by_member_id',
        as: 'approver'
      });
    }

    /**
     * Crée une nouvelle demande de restauration
     */
    static async createRequest(options) {
      return this.create({
        restore_type: options.restoreType,
        source_backup_job_id: options.sourceBackupJobId || null,
        target_timestamp: options.targetTimestamp || null,
        requested_by_member_id: options.requestedByMemberId,
        status: 'requested',
        components_restored: [],
        validation_results: {}
      });
    }

    /**
     * Approuve la restauration
     */
    async approve(approverMemberId) {
      this.approved_by_member_id = approverMemberId;
      this.status = 'approved';
      await this.save();
    }

    /**
     * Démarre la restauration
     */
    async start() {
      this.status = 'running';
      this.started_at = new Date();
      await this.save();
    }

    /**
     * Ajoute un composant restauré
     */
    async addRestoredComponent(componentName, details = {}) {
      const component = {
        name: componentName,
        restored_at: new Date().toISOString(),
        ...details
      };

      this.components_restored = [...(this.components_restored || []), component];
      await this.save();
    }

    /**
     * Termine la restauration avec succès
     */
    async complete(validationResults = {}) {
      this.status = 'completed';
      this.completed_at = new Date();
      this.validation_results = validationResults;
      this.rollback_available = true;
      
      // Rollback disponible pendant 24h
      const rollbackDeadline = new Date();
      rollbackDeadline.setHours(rollbackDeadline.getHours() + 24);
      this.rollback_deadline = rollbackDeadline;
      
      await this.save();
    }

    /**
     * Marque la restauration comme échouée
     */
    async fail(errorDetails) {
      this.status = 'failed';
      this.completed_at = new Date();
      this.validation_results = { error: errorDetails };
      await this.save();
    }

    /**
     * Annule la restauration
     */
    async cancel() {
      this.status = 'cancelled';
      this.completed_at = new Date();
      await this.save();
    }

    /**
     * Vérifie si le rollback est encore disponible
     */
    isRollbackAvailable() {
      if (!this.rollback_available) return false;
      if (!this.rollback_deadline) return false;
      return new Date() < new Date(this.rollback_deadline);
    }

    /**
     * Désactive la possibilité de rollback
     */
    async disableRollback() {
      this.rollback_available = false;
      await this.save();
    }

    /**
     * Calcule la durée de la restauration
     */
    getDuration() {
      if (!this.started_at) return null;
      const endTime = this.completed_at || new Date();
      return Math.round((new Date(endTime) - new Date(this.started_at)) / 1000);
    }

    /**
     * Récupère les restaurations en attente d'approbation
     */
    static async getPendingApproval() {
      return this.findAll({
        where: { status: 'requested' },
        order: [['created_at', 'ASC']],
        include: [
          { association: 'requester', attributes: ['member_id', 'role'] },
          { association: 'sourceBackup', attributes: ['job_id', 'job_type', 'completed_at'] }
        ]
      });
    }

    /**
     * Récupère l'historique des restaurations
     */
    static async getHistory(options = {}) {
      const where = {};
      
      if (options.status) {
        where.status = options.status;
      }
      
      if (options.restoreType) {
        where.restore_type = options.restoreType;
      }

      return this.findAll({
        where,
        order: [['created_at', 'DESC']],
        limit: options.limit || 50,
        include: [
          { association: 'requester', attributes: ['member_id'] },
          { association: 'approver', attributes: ['member_id'] },
          { association: 'sourceBackup', attributes: ['job_id', 'job_type'] }
        ]
      });
    }

    /**
     * Vérifie si une restauration est en cours
     */
    static async isRestoreRunning() {
      const running = await this.findOne({
        where: { status: 'running' }
      });
      return !!running;
    }

    /**
     * Récupère les statistiques de restauration
     */
    static async getStatistics(days = 90) {
      const since = new Date();
      since.setDate(since.getDate() - days);

      const operations = await this.findAll({
        where: {
          created_at: { [Op.gte]: since }
        }
      });

      const stats = {
        total: operations.length,
        completed: 0,
        failed: 0,
        cancelled: 0,
        avgDuration: 0,
        byType: {}
      };

      let totalDuration = 0;
      let durationCount = 0;

      operations.forEach(op => {
        if (op.status === 'completed') {
          stats.completed++;
          if (op.started_at && op.completed_at) {
            totalDuration += new Date(op.completed_at) - new Date(op.started_at);
            durationCount++;
          }
        } else if (op.status === 'failed') {
          stats.failed++;
        } else if (op.status === 'cancelled') {
          stats.cancelled++;
        }

        stats.byType[op.restore_type] = (stats.byType[op.restore_type] || 0) + 1;
      });

      if (durationCount > 0) {
        stats.avgDuration = Math.round(totalDuration / durationCount / 1000);
      }

      return stats;
    }

    /**
     * Récupère la dernière restauration réussie
     */
    static async getLastSuccessful() {
      return this.findOne({
        where: { status: 'completed' },
        order: [['completed_at', 'DESC']],
        include: [{ association: 'sourceBackup' }]
      });
    }
  }

  RestoreOperation.init({
    restore_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique de la restauration'
    },
    restore_type: {
      type: DataTypes.ENUM('full', 'partial', 'emergency', 'point_in_time'),
      allowNull: false,
      comment: 'Type de restauration'
    },
    source_backup_job_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Référence vers le job de sauvegarde source'
    },
    target_timestamp: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Timestamp cible pour restauration point-in-time'
    },
    requested_by_member_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      validate: {
        min: 1,
        max: 9999999999
      },
      comment: 'Member_id du demandeur'
    },
    approved_by_member_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      validate: {
        min: 1,
        max: 9999999999
      },
      comment: 'Member_id de l\'approbateur'
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
      type: DataTypes.ENUM('requested', 'approved', 'running', 'completed', 'failed', 'cancelled'),
      defaultValue: 'requested',
      comment: 'Statut de la restauration'
    },
    components_restored: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Liste des composants restaurés'
    },
    validation_results: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Résultats des tests de validation'
    },
    rollback_available: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Rollback disponible'
    },
    rollback_deadline: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date limite pour rollback'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Notes et commentaires'
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    sequelize,
    modelName: 'RestoreOperation',
    tableName: 'restore_operations',
    timestamps: false,
    indexes: [
      { fields: ['restore_type'] },
      { fields: ['status'] },
      { fields: ['requested_by_member_id'] },
      { fields: ['source_backup_job_id'] },
      { fields: ['created_at'] }
    ]
  });

  return RestoreOperation;
};
