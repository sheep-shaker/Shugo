// models/GuardSlot.js
// Modèle pour la gestion détaillée des créneaux de garde

module.exports = (sequelize, DataTypes) => {
  const GuardSlot = sequelize.define('GuardSlot', {
    slot_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    guard_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'guards',
        key: 'guard_id'
      }
    },
    slot_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    slot_time: {
      type: DataTypes.TIME,
      allowNull: false
    },
    duration_minutes: {
      type: DataTypes.INTEGER,
      defaultValue: 60,
      validate: {
        min: 15,
        max: 480
      }
    },
    required_participants: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      validate: {
        min: 1
      }
    },
    assigned_participants: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    required_skills: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Liste des compétences requises'
    },
    status: {
      type: DataTypes.ENUM('available', 'partial', 'full', 'cancelled', 'completed'),
      defaultValue: 'available'
    },
    geo_id: {
      type: DataTypes.STRING(20),
      allowNull: false
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {}
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
    tableName: 'guard_slots',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['guard_id', 'slot_date', 'slot_time'],
        unique: true,
        name: 'idx_unique_slot'
      },
      {
        fields: ['slot_date', 'status'],
        name: 'idx_slot_date_status'
      },
      {
        fields: ['geo_id', 'slot_date'],
        name: 'idx_slot_geo_date'
      }
    ]
  });

  GuardSlot.associate = function(models) {
    GuardSlot.belongsTo(models.Guard, {
      foreignKey: 'guard_id',
      as: 'guard'
    });

    GuardSlot.hasMany(models.GuardAssignment, {
      foreignKey: 'slot_id',
      as: 'assignments'
    });

    GuardSlot.belongsTo(models.Location, {
      foreignKey: 'geo_id',
      targetKey: 'geo_id',
      as: 'location'
    });
  };

  // Méthodes d'instance
  GuardSlot.prototype.isFull = function() {
    return this.assigned_participants >= this.required_participants;
  };

  GuardSlot.prototype.availableSpots = function() {
    return Math.max(0, this.required_participants - this.assigned_participants);
  };

  GuardSlot.prototype.updateStatus = async function() {
    if (this.assigned_participants === 0) {
      this.status = 'available';
    } else if (this.assigned_participants < this.required_participants) {
      this.status = 'partial';
    } else {
      this.status = 'full';
    }
    return await this.save();
  };

  return GuardSlot;
};
