// models/PluginEvent.js
// Modèle pour les événements générés par les plugins

module.exports = (sequelize, DataTypes) => {
  const PluginEvent = sequelize.define('PluginEvent', {
    event_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    plugin_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'plugin_configs',
        key: 'plugin_id'
      }
    },
    event_type: {
      type: DataTypes.ENUM(
        'started',
        'stopped',
        'executed',
        'error',
        'warning',
        'info',
        'data_processed',
        'action_triggered',
        'custom'
      ),
      allowNull: false
    },
    event_name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    payload: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Données de l\'événement'
    },
    severity: {
      type: DataTypes.ENUM('debug', 'info', 'warning', 'error', 'critical'),
      defaultValue: 'info'
    },
    processed: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    processed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    processed_by: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Service ou job qui a traité l\'événement'
    },
    result: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Résultat du traitement'
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    retry_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {}
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'plugin_events',
    timestamps: false,
    underscored: true,
    indexes: [
      {
        fields: ['plugin_id', 'processed', 'created_at'],
        name: 'idx_plugin_events_queue'
      },
      {
        fields: ['event_type', 'severity'],
        name: 'idx_event_type_severity'
      },
      {
        fields: ['created_at'],
        name: 'idx_event_created'
      }
    ]
  });

  PluginEvent.associate = function(models) {
    PluginEvent.belongsTo(models.PluginConfig, {
      foreignKey: 'plugin_id',
      as: 'plugin'
    });
  };

  // Méthodes d'instance
  PluginEvent.prototype.markAsProcessed = async function(result = null) {
    this.processed = true;
    this.processed_at = new Date();
    if (result) {
      this.result = result;
    }
    return await this.save();
  };

  // Méthodes statiques
  PluginEvent.getUnprocessedEvents = async function(pluginId = null) {
    const where = { processed: false };
    if (pluginId) {
      where.plugin_id = pluginId;
    }
    
    return await this.findAll({
      where,
      order: [
        ['severity', 'DESC'],
        ['created_at', 'ASC']
      ]
    });
  };

  return PluginEvent;
};
