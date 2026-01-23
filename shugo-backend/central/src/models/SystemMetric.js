/**
 * SHUGO v7.0 - Modèle SystemMetric
 * 
 * Collecte et stockage des métriques système.
 * Permet le monitoring des performances et l'analyse des tendances.
 * 
 * Référence: Document Technique V7.0 - Section 10.3 et Annexe A.4.3
 */

'use strict';

const { Model, DataTypes, Op } = require('sequelize');

module.exports = (sequelize) => {
  class SystemMetric extends Model {
    /**
     * Définit les associations avec les autres modèles
     */
    static associate(models) {
      // Pas d'associations directes
    }

    /**
     * Enregistre une métrique
     */
    static async record(options) {
      return this.create({
        metric_name: options.name,
        metric_category: options.category,
        metric_value: options.value,
        metric_unit: options.unit || null,
        tags: options.tags || {},
        collected_at: new Date()
      });
    }

    /**
     * Enregistre plusieurs métriques en batch
     */
    static async recordBatch(metrics) {
      const records = metrics.map(m => ({
        metric_name: m.name,
        metric_category: m.category,
        metric_value: m.value,
        metric_unit: m.unit || null,
        tags: m.tags || {},
        collected_at: new Date()
      }));

      return this.bulkCreate(records);
    }

    /**
     * Récupère les dernières valeurs d'une métrique
     */
    static async getLatest(metricName, limit = 1) {
      return this.findAll({
        where: { metric_name: metricName },
        order: [['collected_at', 'DESC']],
        limit
      });
    }

    /**
     * Récupère l'historique d'une métrique sur une période
     */
    static async getHistory(metricName, hours = 24) {
      const since = new Date();
      since.setHours(since.getHours() - hours);

      return this.findAll({
        where: {
          metric_name: metricName,
          collected_at: { [Op.gte]: since }
        },
        order: [['collected_at', 'ASC']]
      });
    }

    /**
     * Calcule les statistiques d'une métrique
     */
    static async getStatistics(metricName, hours = 24) {
      const since = new Date();
      since.setHours(since.getHours() - hours);

      const result = await this.findAll({
        where: {
          metric_name: metricName,
          collected_at: { [Op.gte]: since }
        },
        attributes: [
          [sequelize.fn('MIN', sequelize.col('metric_value')), 'min'],
          [sequelize.fn('MAX', sequelize.col('metric_value')), 'max'],
          [sequelize.fn('AVG', sequelize.col('metric_value')), 'avg'],
          [sequelize.fn('COUNT', sequelize.col('metric_id')), 'count']
        ],
        raw: true
      });

      return result[0] || { min: null, max: null, avg: null, count: 0 };
    }

    /**
     * Récupère les métriques par catégorie
     */
    static async getByCategory(category, limit = 100) {
      return this.findAll({
        where: { metric_category: category },
        order: [['collected_at', 'DESC']],
        limit
      });
    }

    /**
     * Récupère un dashboard de métriques actuelles
     */
    static async getDashboard() {
      const categories = ['performance', 'security', 'usage', 'error'];
      const dashboard = {};

      for (const category of categories) {
        const latestMetrics = await sequelize.query(`
          SELECT DISTINCT ON (metric_name) 
            metric_name, metric_value, metric_unit, collected_at
          FROM system_metrics
          WHERE metric_category = :category
          ORDER BY metric_name, collected_at DESC
        `, {
          replacements: { category },
          type: sequelize.QueryTypes.SELECT
        });

        dashboard[category] = latestMetrics;
      }

      return dashboard;
    }

    /**
     * Détecte les anomalies (valeurs hors normes)
     */
    static async detectAnomalies(metricName, threshold = 2) {
      const stats = await this.getStatistics(metricName, 168); // 1 semaine
      
      if (!stats.avg || !stats.count || stats.count < 10) {
        return [];
      }

      // Calcul de l'écart-type approximatif
      const history = await this.getHistory(metricName, 168);
      const values = history.map(h => parseFloat(h.metric_value));
      const avg = parseFloat(stats.avg);
      const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
      const stdDev = Math.sqrt(variance);

      // Trouver les anomalies (valeurs > threshold * écart-type)
      const anomalies = history.filter(h => {
        const diff = Math.abs(parseFloat(h.metric_value) - avg);
        return diff > threshold * stdDev;
      });

      return anomalies;
    }

    /**
     * Nettoie les anciennes métriques
     */
    static async cleanupOld(days = 30) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);

      return this.destroy({
        where: {
          collected_at: { [Op.lt]: cutoff }
        }
      });
    }

    /**
     * Agrège les métriques par heure (pour archivage)
     */
    static async aggregateByHour(metricName, date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      return sequelize.query(`
        SELECT 
          DATE_TRUNC('hour', collected_at) as hour,
          MIN(metric_value) as min_value,
          MAX(metric_value) as max_value,
          AVG(metric_value) as avg_value,
          COUNT(*) as sample_count
        FROM system_metrics
        WHERE metric_name = :metricName
          AND collected_at BETWEEN :startOfDay AND :endOfDay
        GROUP BY DATE_TRUNC('hour', collected_at)
        ORDER BY hour
      `, {
        replacements: { metricName, startOfDay, endOfDay },
        type: sequelize.QueryTypes.SELECT
      });
    }
  }

  SystemMetric.init({
    metric_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique de la métrique'
    },
    metric_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Nom de la métrique (ex: cpu_usage, memory_used)'
    },
    metric_category: {
      type: DataTypes.ENUM('performance', 'security', 'usage', 'error', 'business'),
      allowNull: false,
      comment: 'Catégorie de la métrique'
    },
    metric_value: {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: false,
      comment: 'Valeur de la métrique'
    },
    metric_unit: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: 'Unité de mesure (percent, bytes, seconds, count)'
    },
    tags: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Tags additionnels pour le filtrage'
    },
    collected_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      comment: 'Date/heure de la collecte'
    }
  }, {
    sequelize,
    modelName: 'SystemMetric',
    tableName: 'system_metrics',
    timestamps: false,
    indexes: [
      { fields: ['metric_name'] },
      { fields: ['metric_category'] },
      { fields: ['collected_at'] },
      { fields: ['metric_name', 'collected_at'] }
    ]
  });

  return SystemMetric;
};
