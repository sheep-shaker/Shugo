/**
 * SHUGO v7.0 - Modèle ErrorCodeRegistry
 * 
 * Registre centralisé des codes d'erreur SHUGO.
 * Format: SHUGO-{CATEGORY}-{SEVERITY}-{NUMBER}
 * 
 * Référence: Document Technique V7.0 - Section 11.2 et Annexe A.4.4
 */

'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class ErrorCodeRegistry extends Model {
    /**
     * Définit les associations avec les autres modèles
     */
    static associate(models) {
      // Occurrences de cette erreur
      ErrorCodeRegistry.hasMany(models.ErrorOccurrence, {
        foreignKey: 'error_code',
        sourceKey: 'error_code',
        as: 'occurrences'
      });
    }

    /**
     * Génère un nouveau code d'erreur
     */
    static generateCode(category, severity) {
      const categories = ['SYS', 'AUTH', 'GUARD', 'VAULT', 'NET', 'DATA', 'PLUGIN'];
      const severities = ['INFO', 'WARN', 'ERROR', 'CRITICAL'];

      if (!categories.includes(category)) {
        throw new Error(`Catégorie invalide: ${category}`);
      }
      if (!severities.includes(severity)) {
        throw new Error(`Sévérité invalide: ${severity}`);
      }

      // Le numéro sera auto-incrémenté
      return `SHUGO-${category}-${severity}`;
    }

    /**
     * Récupère un code d'erreur par son identifiant
     */
    static async getByCode(errorCode) {
      return this.findByPk(errorCode);
    }

    /**
     * Récupère tous les codes d'une catégorie
     */
    static async getByCategory(category) {
      return this.findAll({
        where: { category },
        order: [['error_code', 'ASC']]
      });
    }

    /**
     * Récupère tous les codes d'une sévérité
     */
    static async getBySeverity(severity) {
      return this.findAll({
        where: { severity },
        order: [['category', 'ASC'], ['error_code', 'ASC']]
      });
    }

    /**
     * Enregistre un nouveau code d'erreur
     */
    static async registerCode(options) {
      const { category, severity, number, title, description, resolutionSteps, autoResolution } = options;
      
      const errorCode = `SHUGO-${category}-${severity}-${number.toString().padStart(3, '0')}`;

      return this.create({
        error_code: errorCode,
        category,
        severity,
        title,
        description,
        resolution_steps: resolutionSteps || null,
        auto_resolution_available: !!autoResolution,
        auto_resolution_script: autoResolution || null
      });
    }

    /**
     * Vérifie si une résolution automatique est disponible
     */
    hasAutoResolution() {
      return this.auto_resolution_available && this.auto_resolution_script;
    }

    /**
     * Récupère le script de résolution automatique
     */
    getAutoResolutionScript() {
      if (!this.hasAutoResolution()) {
        return null;
      }
      return this.auto_resolution_script;
    }

    /**
     * Recherche des codes d'erreur par mot-clé
     */
    static async search(keyword) {
      const { Op } = require('sequelize');
      
      return this.findAll({
        where: {
          [Op.or]: [
            { error_code: { [Op.iLike]: `%${keyword}%` } },
            { title: { [Op.iLike]: `%${keyword}%` } },
            { description: { [Op.iLike]: `%${keyword}%` } }
          ]
        },
        order: [['severity', 'DESC'], ['category', 'ASC']]
      });
    }

    /**
     * Exporte le registre complet pour documentation
     */
    static async exportRegistry() {
      const codes = await this.findAll({
        order: [['category', 'ASC'], ['severity', 'DESC'], ['error_code', 'ASC']]
      });

      return codes.map(code => ({
        code: code.error_code,
        category: code.category,
        severity: code.severity,
        title: code.title,
        description: code.description,
        resolution: code.resolution_steps,
        autoResolution: code.auto_resolution_available
      }));
    }
  }

  ErrorCodeRegistry.init({
    error_code: {
      type: DataTypes.STRING(50),
      primaryKey: true,
      validate: {
        is: /^SHUGO-(SYS|AUTH|GUARD|VAULT|NET|DATA|PLUGIN)-(INFO|WARN|ERROR|CRITICAL)-\d{3}$/
      },
      comment: 'Code erreur format SHUGO-{CATEGORY}-{SEVERITY}-{NUMBER}'
    },
    category: {
      type: DataTypes.ENUM('SYS', 'AUTH', 'GUARD', 'VAULT', 'NET', 'DATA', 'PLUGIN'),
      allowNull: false,
      comment: 'Catégorie: SYS, AUTH, GUARD, VAULT, NET, DATA, PLUGIN'
    },
    severity: {
      type: DataTypes.ENUM('INFO', 'WARN', 'ERROR', 'CRITICAL'),
      allowNull: false,
      comment: 'Sévérité: INFO, WARN, ERROR, CRITICAL'
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
      comment: 'Titre court de l\'erreur'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Description détaillée de l\'erreur'
    },
    resolution_steps: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Étapes de résolution manuelle'
    },
    auto_resolution_available: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Résolution automatique disponible'
    },
    auto_resolution_script: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Script/commande de résolution automatique'
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    sequelize,
    modelName: 'ErrorCodeRegistry',
    tableName: 'error_codes_registry',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['category'] },
      { fields: ['severity'] }
    ]
  });

  return ErrorCodeRegistry;
};
