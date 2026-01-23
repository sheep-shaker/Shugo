// models/PluginConfig.js
// Modèle pour la configuration et gestion des plugins

module.exports = (sequelize, DataTypes) => {
  const PluginConfig = sequelize.define('PluginConfig', {
    plugin_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    plugin_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true
    },
    display_name: {
      type: DataTypes.STRING(200),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    version: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: '1.0.0'
    },
    author: {
      type: DataTypes.STRING(200),
      allowNull: true
    },
    category: {
      type: DataTypes.ENUM(
        'security',
        'communication',
        'reporting',
        'integration',
        'automation',
        'ui',
        'protocol',
        'custom'
      ),
      defaultValue: 'custom'
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    auto_start: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Démarrer automatiquement au lancement'
    },
    config: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Configuration spécifique du plugin'
    },
    permissions_required: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Permissions nécessaires pour utiliser le plugin'
    },
    dependencies: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Dépendances vers d\'autres plugins'
    },
    hooks: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Points d\'ancrage dans le système'
    },
    api_endpoints: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Endpoints API exposés par le plugin'
    },
    settings_schema: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Schéma JSON des paramètres configurables'
    },
    user_settings: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Paramètres définis par l\'utilisateur'
    },
    installation_date: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    last_updated: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    last_activated: {
      type: DataTypes.DATE,
      allowNull: true
    },
    last_error: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    error_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    execution_stats: {
      type: DataTypes.JSON,
      defaultValue: {
        total_runs: 0,
        successful_runs: 0,
        failed_runs: 0,
        avg_execution_time: 0
      }
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {}
    },
    is_system: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Plugin système (ne peut pas être désinstallé)'
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
    tableName: 'plugin_configs',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['plugin_name'],
        unique: true,
        name: 'idx_unique_plugin_name'
      },
      {
        fields: ['enabled', 'auto_start'],
        name: 'idx_plugin_enabled'
      },
      {
        fields: ['category'],
        name: 'idx_plugin_category'
      }
    ]
  });

  PluginConfig.associate = function(models) {
    PluginConfig.hasMany(models.PluginEvent, {
      foreignKey: 'plugin_id',
      as: 'events'
    });
  };

  // Méthodes d'instance
  PluginConfig.prototype.activate = async function() {
    this.enabled = true;
    this.last_activated = new Date();
    return await this.save();
  };

  PluginConfig.prototype.deactivate = async function() {
    this.enabled = false;
    return await this.save();
  };

  PluginConfig.prototype.updateStats = async function(success = true, executionTime = 0) {
    const stats = this.execution_stats || {};
    stats.total_runs = (stats.total_runs || 0) + 1;
    
    if (success) {
      stats.successful_runs = (stats.successful_runs || 0) + 1;
    } else {
      stats.failed_runs = (stats.failed_runs || 0) + 1;
      this.error_count = (this.error_count || 0) + 1;
    }
    
    // Calculer la moyenne du temps d'exécution
    const totalTime = (stats.avg_execution_time || 0) * (stats.total_runs - 1) + executionTime;
    stats.avg_execution_time = totalTime / stats.total_runs;
    
    this.execution_stats = stats;
    return await this.save();
  };

  PluginConfig.prototype.validateConfig = function() {
    if (!this.settings_schema) return true;
    
    // Valider user_settings contre settings_schema
    // Implémenter la validation JSON Schema
    return true;
  };

  // Méthodes statiques
  PluginConfig.getEnabledPlugins = async function() {
    return await this.findAll({
      where: { enabled: true },
      order: [['plugin_name', 'ASC']]
    });
  };

  PluginConfig.getAutoStartPlugins = async function() {
    return await this.findAll({
      where: {
        enabled: true,
        auto_start: true
      }
    });
  };

  return PluginConfig;
};
