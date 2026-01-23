// models/UserSkill.js
// Modèle pour les compétences et qualifications des utilisateurs

module.exports = (sequelize, DataTypes) => {
  const UserSkill = sequelize.define('UserSkill', {
    skill_id: {
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
    skill_type: {
      type: DataTypes.ENUM(
        'security',
        'medical',
        'communication',
        'technical',
        'leadership',
        'language',
        'driving',
        'weapon',
        'special'
      ),
      allowNull: false
    },
    skill_name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    level: {
      type: DataTypes.ENUM('beginner', 'intermediate', 'advanced', 'expert'),
      defaultValue: 'beginner'
    },
    certified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    certification_number: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    certified_by: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: 'Organisme de certification'
    },
    certification_date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    expiry_date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    is_verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Vérifié par un admin'
    },
    verified_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'member_id'
      }
    },
    verification_date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Détails supplémentaires (langues parlées, permis spécifiques, etc.)'
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
    tableName: 'user_skills',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['member_id', 'skill_type', 'skill_name'],
        unique: true,
        name: 'idx_unique_user_skill'
      },
      {
        fields: ['skill_type', 'level'],
        name: 'idx_skill_type_level'
      },
      {
        fields: ['expiry_date'],
        name: 'idx_skill_expiry'
      },
      {
        fields: ['is_active', 'certified'],
        name: 'idx_active_certified'
      }
    ]
  });

  UserSkill.associate = function(models) {
    UserSkill.belongsTo(models.User, {
      foreignKey: 'member_id',
      as: 'user'
    });

    UserSkill.belongsTo(models.User, {
      foreignKey: 'verified_by',
      as: 'verifier'
    });
  };

  // Méthodes d'instance
  UserSkill.prototype.isValid = function() {
    if (!this.is_active) return false;
    if (this.expiry_date && new Date(this.expiry_date) < new Date()) return false;
    return true;
  };

  UserSkill.prototype.needsRenewal = function() {
    if (!this.expiry_date) return false;
    const daysUntilExpiry = (new Date(this.expiry_date) - new Date()) / (1000 * 60 * 60 * 24);
    return daysUntilExpiry <= 30; // Alerte 30 jours avant expiration
  };

  // Méthodes statiques pour les compétences communes
  UserSkill.getRequiredSkillsForGuard = function(guardType) {
    const skillMap = {
      'security': ['security', 'communication'],
      'event': ['security', 'communication', 'medical'],
      'vip': ['security', 'driving', 'weapon'],
      'medical': ['medical', 'communication']
    };
    return skillMap[guardType] || [];
  };

  return UserSkill;
};
