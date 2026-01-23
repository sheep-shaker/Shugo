// models/UserAvailability.js
// Modèle pour les disponibilités des utilisateurs

module.exports = (sequelize, DataTypes) => {
  const UserAvailability = sequelize.define('UserAvailability', {
    availability_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    member_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'member_id'
      }
    },
    availability_type: {
      type: DataTypes.ENUM('recurring', 'specific', 'exception'),
      defaultValue: 'recurring',
      comment: 'recurring: hebdomadaire, specific: date précise, exception: indisponibilité'
    },
    day_of_week: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 0,
        max: 6
      },
      comment: '0=Dimanche, 6=Samedi (pour recurring)'
    },
    specific_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: 'Pour les disponibilités/indisponibilités spécifiques'
    },
    start_time: {
      type: DataTypes.TIME,
      allowNull: false
    },
    end_time: {
      type: DataTypes.TIME,
      allowNull: false
    },
    is_available: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: 'true=disponible, false=indisponible'
    },
    priority: {
      type: DataTypes.ENUM('low', 'normal', 'high', 'mandatory'),
      defaultValue: 'normal',
      comment: 'Priorité de disponibilité'
    },
    geo_id: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: 'Zone géographique de disponibilité'
    },
    max_distance_km: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Distance maximale acceptée depuis geo_id'
    },
    valid_from: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    valid_until: {
      type: DataTypes.DATE,
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Préférences supplémentaires'
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
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
    tableName: 'user_availabilities',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['member_id', 'is_active'],
        name: 'idx_user_availability_active'
      },
      {
        fields: ['availability_type', 'day_of_week'],
        name: 'idx_availability_type_day'
      },
      {
        fields: ['specific_date'],
        name: 'idx_specific_date'
      },
      {
        fields: ['geo_id'],
        name: 'idx_availability_geo'
      }
    ]
  });

  UserAvailability.associate = function(models) {
    UserAvailability.belongsTo(models.User, {
      foreignKey: 'member_id',
      as: 'user'
    });

    UserAvailability.belongsTo(models.Location, {
      foreignKey: 'geo_id',
      targetKey: 'geo_id',
      as: 'location'
    });
  };

  // Méthodes d'instance
  UserAvailability.prototype.isValidOn = function(date) {
    const checkDate = new Date(date);
    
    // Vérifier la période de validité
    if (this.valid_from && checkDate < new Date(this.valid_from)) return false;
    if (this.valid_until && checkDate > new Date(this.valid_until)) return false;
    
    // Vérifier selon le type
    if (this.availability_type === 'specific') {
      return this.specific_date === date;
    } else if (this.availability_type === 'recurring') {
      return checkDate.getDay() === this.day_of_week;
    }
    
    return true;
  };

  UserAvailability.prototype.overlaps = function(startTime, endTime) {
    return (startTime < this.end_time && endTime > this.start_time);
  };

  // Méthodes statiques
  UserAvailability.getUserAvailabilityForDate = async function(userId, date) {
    const dayOfWeek = new Date(date).getDay();
    
    const availabilities = await this.findAll({
      where: {
        member_id: userId,
        is_active: true,
        [sequelize.Op.and]: [
          {
            [sequelize.Op.or]: [
              // Disponibilités récurrentes pour ce jour
              {
                availability_type: 'recurring',
                day_of_week: dayOfWeek
              },
              // Disponibilités spécifiques pour cette date
              {
                availability_type: 'specific',
                specific_date: date
              }
            ]
          },
          {
            [sequelize.Op.or]: [
              { valid_from: { [sequelize.Op.lte]: date } },
              { valid_from: null }
            ]
          },
          {
            [sequelize.Op.or]: [
              { valid_until: { [sequelize.Op.gte]: date } },
              { valid_until: null }
            ]
          }
        ]
      },
      order: [
        ['priority', 'DESC'],
        ['start_time', 'ASC']
      ]
    });

    // Filtrer les exceptions (indisponibilités)
    const exceptions = await this.findAll({
      where: {
        member_id: userId,
        availability_type: 'exception',
        specific_date: date,
        is_active: true
      }
    });

    return {
      available: availabilities.filter(a => a.is_available),
      unavailable: [...availabilities.filter(a => !a.is_available), ...exceptions]
    };
  };

  return UserAvailability;
};
