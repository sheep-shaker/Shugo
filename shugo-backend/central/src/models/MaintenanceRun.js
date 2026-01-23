/**
 * SHUGO v7.0 - Modèle MaintenanceRun
 * 
 * Historique des maintenances nocturnes automatiques.
 * Chaque nuit à 00h00 (heure locale), le système effectue une maintenance
 * planifiée d'environ 45 minutes.
 * 
 * Référence: Document Technique V7.0 - Section 5.7 et Annexe A.4.1
 */

'use strict';

const { Model, DataTypes, Op } = require('sequelize');

module.exports = (sequelize) => {
  class MaintenanceRun extends Model {
    /**
     * Définit les associations avec les autres modèles
     */
    static associate(models) {
      // Pas d'associations directes, les logs sont autonomes
    }

    /**
     * Démarre une nouvelle maintenance
     */
    static async startMaintenance(type = 'daily') {
      return this.create({
        run_type: type,
        scheduled_at: new Date(),
        started_at: new Date(),
        status: 'running',
        steps_completed: [],
        errors_encountered: [],
        metrics: {}
      });
    }

    /**
     * Ajoute une étape complétée
     */
    async addCompletedStep(stepName, duration, details = {}) {
      const step = {
        name: stepName,
        completed_at: new Date().toISOString(),
        duration_ms: duration,
        ...details
      };

      this.steps_completed = [...(this.steps_completed || []), step];
      await this.save();
    }

    /**
     * Enregistre une erreur rencontrée
     */
    async addError(errorCode, message, context = {}) {
      const error = {
        code: errorCode,
        message,
        occurred_at: new Date().toISOString(),
        context
      };

      this.errors_encountered = [...(this.errors_encountered || []), error];
      await this.save();
    }

    /**
     * Met à jour les métriques
     */
    async updateMetrics(newMetrics) {
      this.metrics = { ...(this.metrics || {}), ...newMetrics };
      await this.save();
    }

    /**
     * Termine la maintenance avec succès
     */
    async complete(nextRunScheduled = null) {
      this.status = 'completed';
      this.completed_at = new Date();
      if (nextRunScheduled) {
        this.next_run_scheduled = nextRunScheduled;
      }
      await this.save();
    }

    /**
     * Termine la maintenance en échec
     */
    async fail(errorMessage) {
      this.status = 'failed';
      this.completed_at = new Date();
      await this.addError('MAINTENANCE_FAILED', errorMessage);
    }

    /**
     * Annule la maintenance en cours
     */
    async cancel(reason) {
      this.status = 'cancelled';
      this.completed_at = new Date();
      await this.addError('MAINTENANCE_CANCELLED', reason);
    }

    /**
     * Calcule la durée totale de la maintenance
     */
    getDuration() {
      if (!this.started_at) return null;
      const endTime = this.completed_at || new Date();
      return Math.round((new Date(endTime) - new Date(this.started_at)) / 1000); // En secondes
    }

    /**
     * Vérifie si la maintenance est en cours
     */
    isRunning() {
      return this.status === 'running';
    }

    /**
     * Récupère la dernière maintenance réussie
     */
    static async getLastSuccessful() {
      return this.findOne({
        where: { status: 'completed' },
        order: [['completed_at', 'DESC']]
      });
    }

    /**
     * Récupère l'historique des maintenances
     */
    static async getHistory(limit = 30, type = null) {
      const where = {};
      if (type) {
        where.run_type = type;
      }

      return this.findAll({
        where,
        order: [['scheduled_at', 'DESC']],
        limit
      });
    }

    /**
     * Vérifie si une maintenance est actuellement en cours
     */
    static async isMaintenanceRunning() {
      const running = await this.findOne({
        where: { status: 'running' }
      });
      return !!running;
    }

    /**
     * Calcule les statistiques des maintenances
     */
    static async getStatistics(days = 30) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const runs = await this.findAll({
        where: {
          scheduled_at: { [Op.gte]: startDate }
        }
      });

      const stats = {
        total: runs.length,
        completed: 0,
        failed: 0,
        cancelled: 0,
        avgDuration: 0,
        totalErrors: 0
      };

      let totalDuration = 0;
      let durationCount = 0;

      runs.forEach(run => {
        if (run.status === 'completed') {
          stats.completed++;
          if (run.started_at && run.completed_at) {
            totalDuration += new Date(run.completed_at) - new Date(run.started_at);
            durationCount++;
          }
        } else if (run.status === 'failed') {
          stats.failed++;
        } else if (run.status === 'cancelled') {
          stats.cancelled++;
        }
        stats.totalErrors += (run.errors_encountered || []).length;
      });

      if (durationCount > 0) {
        stats.avgDuration = Math.round(totalDuration / durationCount / 1000); // En secondes
      }

      return stats;
    }
  }

  MaintenanceRun.init({
    run_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique de la maintenance'
    },
    run_type: {
      type: DataTypes.ENUM('daily', 'weekly', 'monthly', 'emergency'),
      allowNull: false,
      comment: 'Type de maintenance: daily, weekly, monthly, emergency'
    },
    scheduled_at: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Date/heure de planification'
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date/heure de démarrage effectif'
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date/heure de fin'
    },
    status: {
      type: DataTypes.ENUM('scheduled', 'running', 'completed', 'failed', 'cancelled'),
      defaultValue: 'scheduled',
      comment: 'Statut de la maintenance'
    },
    steps_completed: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Liste des étapes accomplies avec détails'
    },
    errors_encountered: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Erreurs rencontrées pendant la maintenance'
    },
    metrics: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Métriques de performance de la maintenance'
    },
    next_run_scheduled: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Prochaine maintenance planifiée'
    }
  }, {
    sequelize,
    modelName: 'MaintenanceRun',
    tableName: 'maintenance_runs',
    timestamps: false,
    indexes: [
      { fields: ['run_type'] },
      { fields: ['status'] },
      { fields: ['scheduled_at'] },
      { fields: ['completed_at'] }
    ]
  });

  return MaintenanceRun;
};
