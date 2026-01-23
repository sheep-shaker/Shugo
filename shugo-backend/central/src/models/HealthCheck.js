/**
 * SHUGO v7.0 - Modèle HealthCheck
 * 
 * Enregistrement des résultats des contrôles de santé système.
 * Permet le monitoring continu des composants critiques et
 * la détection proactive des problèmes.
 * 
 * Référence: Document Technique V7.0 - Section 11.3 et Annexe A.4.2
 */

'use strict';

const { Model, DataTypes, Op } = require('sequelize');

module.exports = (sequelize) => {
  class HealthCheck extends Model {
    /**
     * Définit les associations avec les autres modèles
     */
    static associate(models) {
      // Pas d'associations directes
    }

    /**
     * Enregistre un nouveau contrôle de santé
     */
    static async recordCheck(options) {
      return this.create({
        check_type: options.checkType,
        component_name: options.componentName,
        check_name: options.checkName,
        status: options.status,
        response_time_ms: options.responseTime || null,
        details: options.details || {},
        error_message: options.errorMessage || null,
        checked_at: new Date()
      });
    }

    /**
     * Récupère le dernier état de santé d'un composant
     */
    static async getLatestForComponent(componentName) {
      return this.findOne({
        where: { component_name: componentName },
        order: [['checked_at', 'DESC']]
      });
    }

    /**
     * Récupère l'état de santé global du système
     */
    static async getSystemHealth() {
      const latestChecks = await this.findAll({
        attributes: [
          'component_name',
          [sequelize.fn('MAX', sequelize.col('checked_at')), 'latest_check']
        ],
        group: ['component_name'],
        raw: true
      });

      const healthStatus = {
        overall: 'healthy',
        components: {},
        lastCheck: null,
        criticalIssues: 0,
        warnings: 0
      };

      for (const check of latestChecks) {
        const latestHealth = await this.findOne({
          where: {
            component_name: check.component_name,
            checked_at: check.latest_check
          }
        });

        if (latestHealth) {
          healthStatus.components[check.component_name] = {
            status: latestHealth.status,
            lastCheck: latestHealth.checked_at,
            responseTime: latestHealth.response_time_ms
          };

          if (latestHealth.status === 'critical') {
            healthStatus.criticalIssues++;
            healthStatus.overall = 'critical';
          } else if (latestHealth.status === 'warning' && healthStatus.overall !== 'critical') {
            healthStatus.warnings++;
            healthStatus.overall = 'warning';
          }

          if (!healthStatus.lastCheck || latestHealth.checked_at > healthStatus.lastCheck) {
            healthStatus.lastCheck = latestHealth.checked_at;
          }
        }
      }

      return healthStatus;
    }

    /**
     * Récupère l'historique des problèmes d'un composant
     */
    static async getIssueHistory(componentName, hours = 24) {
      const since = new Date();
      since.setHours(since.getHours() - hours);

      return this.findAll({
        where: {
          component_name: componentName,
          status: { [Op.in]: ['warning', 'critical'] },
          checked_at: { [Op.gte]: since }
        },
        order: [['checked_at', 'DESC']]
      });
    }

    /**
     * Calcule les statistiques de disponibilité
     */
    static async getAvailabilityStats(componentName, days = 7) {
      const since = new Date();
      since.setDate(since.getDate() - days);

      const checks = await this.findAll({
        where: {
          component_name: componentName,
          checked_at: { [Op.gte]: since }
        },
        attributes: ['status', 'response_time_ms']
      });

      if (checks.length === 0) {
        return { availability: null, avgResponseTime: null, checks: 0 };
      }

      const healthyCount = checks.filter(c => c.status === 'healthy').length;
      const responseTimes = checks
        .filter(c => c.response_time_ms !== null)
        .map(c => c.response_time_ms);

      return {
        availability: Math.round((healthyCount / checks.length) * 100 * 100) / 100,
        avgResponseTime: responseTimes.length > 0 
          ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
          : null,
        checks: checks.length
      };
    }

    /**
     * Nettoie les anciens enregistrements
     */
    static async cleanupOld(days = 30) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);

      return this.destroy({
        where: {
          checked_at: { [Op.lt]: cutoff }
        }
      });
    }

    /**
     * Vérifie si un composant a des problèmes récents
     */
    static async hasRecentIssues(componentName, minutes = 15) {
      const since = new Date();
      since.setMinutes(since.getMinutes() - minutes);

      const issues = await this.findOne({
        where: {
          component_name: componentName,
          status: { [Op.in]: ['warning', 'critical'] },
          checked_at: { [Op.gte]: since }
        }
      });

      return !!issues;
    }
  }

  HealthCheck.init({
    check_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique du contrôle'
    },
    check_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        isIn: [['system', 'database', 'vault', 'network', 'security', 'service']]
      },
      comment: 'Type de contrôle: system, database, vault, network, security, service'
    },
    component_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Nom du composant vérifié'
    },
    check_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Nom du contrôle spécifique'
    },
    status: {
      type: DataTypes.ENUM('healthy', 'warning', 'critical', 'unknown'),
      allowNull: false,
      comment: 'Résultat du contrôle'
    },
    response_time_ms: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 0
      },
      comment: 'Temps de réponse en millisecondes'
    },
    details: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Détails supplémentaires du contrôle'
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Message d\'erreur si le contrôle a échoué'
    },
    checked_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      comment: 'Date/heure du contrôle'
    }
  }, {
    sequelize,
    modelName: 'HealthCheck',
    tableName: 'health_checks',
    timestamps: false,
    indexes: [
      { fields: ['check_type'] },
      { fields: ['component_name'] },
      { fields: ['status'] },
      { fields: ['checked_at'] },
      { fields: ['component_name', 'checked_at'] }
    ]
  });

  return HealthCheck;
};
