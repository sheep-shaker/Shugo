/**
 * SHUGO v7.0 - Modèle PluginConfiguration
 * 
 * Gestion de la configuration des plugins installés.
 * Supporte les configurations système et utilisateur,
 * avec possibilité de chiffrement des valeurs sensibles.
 * 
 * Référence: Document Technique V7.0 - Section 7.4 et Annexe A.7.2
 */

'use strict';

const { Model, DataTypes, Op } = require('sequelize');

module.exports = (sequelize) => {
  class PluginConfiguration extends Model {
    /**
     * Définit les associations avec les autres modèles
     */
    static associate(models) {
      // Plugin parent
      PluginConfiguration.belongsTo(models.PluginRegistry, {
        foreignKey: 'plugin_id',
        as: 'plugin',
        onDelete: 'CASCADE'
      });

      // Utilisateur ayant configuré (si config utilisateur)
      PluginConfiguration.belongsTo(models.User, {
        foreignKey: 'configured_by_member_id',
        as: 'configuredBy'
      });
    }

    /**
     * Définit ou met à jour une configuration
     */
    static async setConfig(pluginId, key, value, options = {}) {
      const [config, created] = await this.findOrCreate({
        where: {
          plugin_id: pluginId,
          config_key: key
        },
        defaults: {
          config_value: value,
          is_encrypted: options.encrypt || false,
          is_system_config: options.isSystem || false,
          configured_by_member_id: options.memberId || null
        }
      });

      if (!created) {
        config.config_value = value;
        config.is_encrypted = options.encrypt || config.is_encrypted;
        config.configured_by_member_id = options.memberId || config.configured_by_member_id;
        config.updated_at = new Date();
        await config.save();
      }

      return config;
    }

    /**
     * Récupère une configuration
     */
    static async getConfig(pluginId, key) {
      const config = await this.findOne({
        where: {
          plugin_id: pluginId,
          config_key: key
        }
      });

      return config ? config.config_value : null;
    }

    /**
     * Récupère toutes les configurations d'un plugin
     */
    static async getAllForPlugin(pluginId, includeSystem = true) {
      const where = { plugin_id: pluginId };
      
      if (!includeSystem) {
        where.is_system_config = false;
      }

      const configs = await this.findAll({
        where,
        order: [['config_key', 'ASC']]
      });

      // Convertir en objet clé-valeur
      return configs.reduce((obj, config) => {
        obj[config.config_key] = config.config_value;
        return obj;
      }, {});
    }

    /**
     * Supprime une configuration
     */
    static async deleteConfig(pluginId, key) {
      return this.destroy({
        where: {
          plugin_id: pluginId,
          config_key: key
        }
      });
    }

    /**
     * Supprime toutes les configurations d'un plugin
     */
    static async deleteAllForPlugin(pluginId) {
      return this.destroy({
        where: { plugin_id: pluginId }
      });
    }

    /**
     * Récupère les configurations système uniquement
     */
    static async getSystemConfigs(pluginId) {
      return this.findAll({
        where: {
          plugin_id: pluginId,
          is_system_config: true
        }
      });
    }

    /**
     * Récupère les configurations utilisateur uniquement
     */
    static async getUserConfigs(pluginId) {
      return this.findAll({
        where: {
          plugin_id: pluginId,
          is_system_config: false
        },
        include: [{
          association: 'configuredBy',
          attributes: ['member_id']
        }]
      });
    }

    /**
     * Vérifie si une clé de configuration existe
     */
    static async hasConfig(pluginId, key) {
      const count = await this.count({
        where: {
          plugin_id: pluginId,
          config_key: key
        }
      });
      return count > 0;
    }

    /**
     * Importe une configuration depuis un objet
     */
    static async importConfig(pluginId, configObject, options = {}) {
      const results = [];
      
      for (const [key, value] of Object.entries(configObject)) {
        const config = await this.setConfig(pluginId, key, value, {
          isSystem: options.isSystem || false,
          memberId: options.memberId || null
        });
        results.push(config);
      }
      
      return results;
    }

    /**
     * Exporte la configuration d'un plugin
     */
    static async exportConfig(pluginId, excludeEncrypted = true) {
      const where = { plugin_id: pluginId };
      
      if (excludeEncrypted) {
        where.is_encrypted = false;
      }

      const configs = await this.findAll({ where });

      return configs.map(config => ({
        key: config.config_key,
        value: config.is_encrypted ? '[ENCRYPTED]' : config.config_value,
        isSystem: config.is_system_config,
        updatedAt: config.updated_at
      }));
    }

    /**
     * Valide une configuration contre un schéma
     */
    static async validateAgainstSchema(pluginId, schema) {
      const configs = await this.getAllForPlugin(pluginId);
      const errors = [];
      
      // Vérifier les champs requis
      if (schema.required) {
        for (const requiredKey of schema.required) {
          if (!(requiredKey in configs)) {
            errors.push(`Configuration manquante: ${requiredKey}`);
          }
        }
      }
      
      // Vérifier les types (si définis dans le schéma)
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (key in configs) {
            const value = configs[key];
            // Validation de type basique
            if (propSchema.type === 'number' && typeof value !== 'number') {
              errors.push(`${key} doit être un nombre`);
            }
            if (propSchema.type === 'boolean' && typeof value !== 'boolean') {
              errors.push(`${key} doit être un booléen`);
            }
            if (propSchema.type === 'string' && typeof value !== 'string') {
              errors.push(`${key} doit être une chaîne`);
            }
          }
        }
      }
      
      return {
        valid: errors.length === 0,
        errors
      };
    }

    /**
     * Récupère les configurations modifiées récemment
     */
    static async getRecentlyModified(hours = 24) {
      const since = new Date();
      since.setHours(since.getHours() - hours);

      return this.findAll({
        where: {
          updated_at: { [Op.gte]: since }
        },
        include: [
          { association: 'plugin', attributes: ['plugin_name', 'display_name'] },
          { association: 'configuredBy', attributes: ['member_id'] }
        ],
        order: [['updated_at', 'DESC']]
      });
    }
  }

  PluginConfiguration.init({
    config_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique de la configuration'
    },
    plugin_id: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'Référence vers le plugin'
    },
    config_key: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Clé de configuration'
    },
    config_value: {
      type: DataTypes.JSON,
      allowNull: false,
      comment: 'Valeur de configuration (JSON)'
    },
    is_encrypted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Valeur chiffrée'
    },
    is_system_config: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Configuration système vs utilisateur'
    },
    configured_by_member_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      validate: {
        min: 1,
        max: 9999999999
      },
      comment: 'Member_id du configurateur'
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
    modelName: 'PluginConfiguration',
    tableName: 'plugin_configurations',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['plugin_id'] },
      { fields: ['config_key'] },
      { 
        unique: true,
        fields: ['plugin_id', 'config_key']
      }
    ]
  });

  return PluginConfiguration;
};
