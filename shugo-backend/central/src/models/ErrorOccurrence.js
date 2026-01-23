/**
 * SHUGO v7.0 - Modèle ErrorOccurrence
 * 
 * Enregistrement des occurrences d'erreurs dans le système.
 * Permet le suivi des problèmes et l'analyse des tendances.
 * 
 * Référence: Document Technique V7.0 - Section 11.2 et Annexe A.4.5
 */

'use strict';

const { Model, DataTypes, Op } = require('sequelize');

module.exports = (sequelize) => {
  class ErrorOccurrence extends Model {
    /**
     * Définit les associations avec les autres modèles
     */
    static associate(models) {
      // Référence vers le registre des codes d'erreur
      ErrorOccurrence.belongsTo(models.ErrorCodeRegistry, {
        foreignKey: 'error_code',
        targetKey: 'error_code',
        as: 'errorDefinition'
      });

      // Utilisateur concerné (si applicable)
      ErrorOccurrence.belongsTo(models.User, {
        foreignKey: 'member_id',
        as: 'affectedUser'
      });
    }

    /**
     * Enregistre une nouvelle occurrence d'erreur
     */
    static async record(options) {
      return this.create({
        error_code: options.errorCode,
        occurred_at: new Date(),
        context: options.context || {},
        member_id: options.memberId || null,
        resolution_attempted: false,
        resolution_successful: null,
        resolution_details: null
      });
    }

    /**
     * Marque l'erreur comme résolue
     */
    async markResolved(success, details) {
      this.resolution_attempted = true;
      this.resolution_successful = success;
      this.resolution_details = details;
      await this.save();
    }

    /**
     * Récupère les erreurs récentes
     */
    static async getRecent(hours = 24, options = {}) {
      const since = new Date();
      since.setHours(since.getHours() - hours);

      const where = {
        occurred_at: { [Op.gte]: since }
      };

      if (options.errorCode) {
        where.error_code = options.errorCode;
      }

      if (options.memberId) {
        where.member_id = options.memberId;
      }

      return this.findAll({
        where,
        order: [['occurred_at', 'DESC']],
        limit: options.limit || 100,
        include: [{
          association: 'errorDefinition',
          attributes: ['title', 'severity', 'category']
        }]
      });
    }

    /**
     * Compte les occurrences par code d'erreur
     */
    static async countByErrorCode(hours = 24) {
      const since = new Date();
      since.setHours(since.getHours() - hours);

      return this.findAll({
        where: {
          occurred_at: { [Op.gte]: since }
        },
        attributes: [
          'error_code',
          [sequelize.fn('COUNT', sequelize.col('occurrence_id')), 'count']
        ],
        group: ['error_code'],
        order: [[sequelize.literal('count'), 'DESC']],
        include: [{
          association: 'errorDefinition',
          attributes: ['title', 'severity']
        }]
      });
    }

    /**
     * Récupère les erreurs critiques non résolues
     */
    static async getUnresolvedCritical() {
      return this.findAll({
        where: {
          resolution_successful: { [Op.ne]: true }
        },
        include: [{
          association: 'errorDefinition',
          where: { severity: 'CRITICAL' },
          attributes: ['title', 'resolution_steps', 'auto_resolution_available']
        }],
        order: [['occurred_at', 'DESC']]
      });
    }

    /**
     * Calcule les statistiques d'erreurs
     */
    static async getStatistics(days = 7) {
      const since = new Date();
      since.setDate(since.getDate() - days);

      const occurrences = await this.findAll({
        where: {
          occurred_at: { [Op.gte]: since }
        },
        include: [{
          association: 'errorDefinition',
          attributes: ['severity', 'category']
        }]
      });

      const stats = {
        total: occurrences.length,
        bySeverity: { INFO: 0, WARN: 0, ERROR: 0, CRITICAL: 0 },
        byCategory: {},
        resolved: 0,
        resolutionRate: 0,
        topErrors: {}
      };

      occurrences.forEach(occ => {
        // Par sévérité
        if (occ.errorDefinition) {
          stats.bySeverity[occ.errorDefinition.severity]++;
          
          // Par catégorie
          const cat = occ.errorDefinition.category;
          stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
        }

        // Résolutions
        if (occ.resolution_successful === true) {
          stats.resolved++;
        }

        // Top erreurs
        stats.topErrors[occ.error_code] = (stats.topErrors[occ.error_code] || 0) + 1;
      });

      // Taux de résolution
      const attemptedResolutions = occurrences.filter(o => o.resolution_attempted).length;
      if (attemptedResolutions > 0) {
        stats.resolutionRate = Math.round((stats.resolved / attemptedResolutions) * 100);
      }

      // Trier les top erreurs
      stats.topErrors = Object.entries(stats.topErrors)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});

      return stats;
    }

    /**
     * Récupère les erreurs pour un utilisateur spécifique
     */
    static async getForUser(memberId, limit = 50) {
      return this.findAll({
        where: { member_id: memberId },
        order: [['occurred_at', 'DESC']],
        limit,
        include: [{
          association: 'errorDefinition',
          attributes: ['title', 'severity', 'category', 'resolution_steps']
        }]
      });
    }

    /**
     * Nettoie les anciennes occurrences
     */
    static async cleanupOld(days = 90) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);

      return this.destroy({
        where: {
          occurred_at: { [Op.lt]: cutoff }
        }
      });
    }

    /**
     * Détecte les pics d'erreurs (alerte si trop d'erreurs en peu de temps)
     */
    static async detectSpike(errorCode, threshold = 10, minutes = 5) {
      const since = new Date();
      since.setMinutes(since.getMinutes() - minutes);

      const count = await this.count({
        where: {
          error_code: errorCode,
          occurred_at: { [Op.gte]: since }
        }
      });

      return count >= threshold;
    }
  }

  ErrorOccurrence.init({
    occurrence_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique de l\'occurrence'
    },
    error_code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'Référence vers le code d\'erreur'
    },
    occurred_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      comment: 'Date/heure de l\'occurrence'
    },
    context: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Contexte de l\'erreur (stack trace, paramètres, etc.)'
    },
    resolution_attempted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Une tentative de résolution a été effectuée'
    },
    resolution_successful: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      comment: 'La résolution a-t-elle réussi'
    },
    resolution_details: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Détails de la résolution'
    },
    member_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      validate: {
        min: 1,
        max: 9999999999
      },
      comment: 'Member_id de l\'utilisateur concerné (si applicable)'
    }
  }, {
    sequelize,
    modelName: 'ErrorOccurrence',
    tableName: 'error_occurrences',
    timestamps: false,
    indexes: [
      { fields: ['error_code'] },
      { fields: ['occurred_at'] },
      { fields: ['member_id'] },
      { fields: ['resolution_successful'] },
      { fields: ['error_code', 'occurred_at'] }
    ]
  });

  return ErrorOccurrence;
};
