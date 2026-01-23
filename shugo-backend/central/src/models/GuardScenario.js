/**
 * SHUGO v7.0 - Modèle GuardScenario
 * 
 * Scénarios prédéfinis pour la gestion des plannings de garde.
 * Permet de définir des semaines-types et des configurations récurrentes.
 * 
 * Référence: Document Technique V7.0 - Section 4.1.2 et Annexe A.2.8
 */

'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class GuardScenario extends Model {
    /**
     * Définit les associations avec les autres modèles
     */
    static associate(models) {
      // Créé par un utilisateur
      GuardScenario.belongsTo(models.User, {
        foreignKey: 'created_by_member_id',
        as: 'creator'
      });

      // Peut avoir plusieurs gardes associées
      GuardScenario.hasMany(models.Guard, {
        foreignKey: 'scenario_id',
        as: 'guards'
      });
    }

    /**
     * Vérifie si le scénario est actuellement valide
     */
    isCurrentlyValid() {
      const now = new Date();
      const validFrom = this.valid_from ? new Date(this.valid_from) : null;
      const validUntil = this.valid_until ? new Date(this.valid_until) : null;

      if (validFrom && now < validFrom) return false;
      if (validUntil && now > validUntil) return false;
      return this.is_active;
    }

    /**
     * Génère les créneaux de garde à partir du template
     */
    generateGuardsFromTemplate(startDate, endDate) {
      if (!this.template_data || !this.template_data.slots) {
        return [];
      }
      
      const guards = [];
      const current = new Date(startDate);
      
      while (current <= endDate) {
        const dayOfWeek = current.getDay(); // 0 = Dimanche
        const daySlots = this.template_data.slots.filter(
          slot => slot.dayOfWeek === dayOfWeek
        );
        
        for (const slot of daySlots) {
          guards.push({
            geo_id: this.geo_id,
            guard_date: new Date(current),
            start_time: slot.start_time,
            end_time: slot.end_time,
            guard_type: slot.guard_type || 'standard',
            max_participants: slot.max_participants || 1,
            min_participants: slot.min_participants || 1,
            scenario_id: this.scenario_id,
            auto_generated: true
          });
        }
        
        current.setDate(current.getDate() + 1);
      }
      
      return guards;
    }
  }

  GuardScenario.init({
    scenario_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique du scénario'
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Nom du scénario (ex: Semaine standard, Vacances)'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Description détaillée du scénario'
    },
    geo_id: {
      type: DataTypes.STRING(16),
      allowNull: false,
      validate: {
        is: /^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/
      },
      comment: 'Identifiant géographique au format CC-PPP-ZZ-JJ-NN'
    },
    scenario_type: {
      type: DataTypes.ENUM('daily', 'weekly', 'monthly', 'special'),
      defaultValue: 'daily',
      allowNull: false,
      comment: 'Type de scénario: daily, weekly, monthly, special'
    },
    code: {
      type: DataTypes.STRING(32),
      allowNull: false,
      unique: true,
      validate: {
        isIn: [['NORMAL', 'EARLY', 'LATE', 'CUSTOM']]
      },
      comment: 'Code du scénario: NORMAL, EARLY, LATE, CUSTOM'
    },
    cancellation_window_hours: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 72,
      validate: {
        min: 0
      },
      comment: 'Délai d\'annulation en heures avant le créneau'
    },
    template_data: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
      comment: 'Configuration JSON des créneaux (slots, heures, types)'
    },
    is_default: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Indique si c\'est le scénario par défaut du local'
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: 'Scénario actif ou non'
    },
    valid_from: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: 'Date de début de validité'
    },
    valid_until: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: 'Date de fin de validité'
    },
    created_by_member_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      validate: {
        min: 1,
        max: 9999999999
      },
      comment: 'Member_id du créateur (Platinum/Admin)'
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
    modelName: 'GuardScenario',
    tableName: 'guard_scenarios',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['geo_id'] },
      { fields: ['scenario_type'] },
      { fields: ['is_active'] },
      { fields: ['code'] }
    ],
    hooks: {
      beforeValidate: (scenario) => {
        // Validation des dates
        if (scenario.valid_from && scenario.valid_until) {
          if (new Date(scenario.valid_from) > new Date(scenario.valid_until)) {
            throw new Error('valid_from doit être antérieur à valid_until');
          }
        }
      }
    }
  });

  return GuardScenario;
};
