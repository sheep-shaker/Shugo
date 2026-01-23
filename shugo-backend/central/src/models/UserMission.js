/**
 * SHUGO v7.0 - Modèle UserMission
 * 
 * Gestion des missions spéciales attribuées aux utilisateurs.
 * Permet d'accorder des privilèges temporaires ou permanents
 * indépendamment du rôle hiérarchique.
 * 
 * Référence: Document Technique V7.0 - Section 2.7.2 et Annexe A.2.13
 */

'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class UserMission extends Model {
    /**
     * Définit les associations avec les autres modèles
     */
    static associate(models) {
      // Utilisateur bénéficiaire de la mission
      UserMission.belongsTo(models.User, {
        foreignKey: 'member_id',
        as: 'user'
      });

      // Administrateur ayant créé la mission
      UserMission.belongsTo(models.User, {
        foreignKey: 'created_by_member_id',
        as: 'creator'
      });

      // Administrateur ayant révoqué la mission (si applicable)
      UserMission.belongsTo(models.User, {
        foreignKey: 'revoked_by_member_id',
        as: 'revoker'
      });

      // Groupe concerné par la mission (si scope groupe)
      UserMission.belongsTo(models.Group, {
        foreignKey: 'scope_group_id',
        as: 'scopeGroup'
      });
    }

    /**
     * Vérifie si la mission est actuellement active et valide
     */
    isCurrentlyActive() {
      if (!this.is_active) return false;
      if (this.revoked_at) return false;
      if (this.expires_at && new Date() > new Date(this.expires_at)) {
        return false;
      }
      return true;
    }

    /**
     * Vérifie si l'utilisateur a un privilège spécifique via cette mission
     */
    hasPrivilege(privilege) {
      if (!this.isCurrentlyActive()) return false;
      if (!this.privileges_granted) return false;
      return this.privileges_granted.includes(privilege);
    }

    /**
     * Révoque la mission
     */
    async revoke(revokedByMemberId, reason) {
      this.is_active = false;
      this.revoked_at = new Date();
      this.revoked_by_member_id = revokedByMemberId;
      this.revocation_reason = reason;
      await this.save();
    }
  }

  UserMission.init({
    mission_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique de la mission'
    },
    member_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      validate: {
        min: 1,
        max: 9999999999
      },
      comment: 'Member_id de l\'utilisateur bénéficiaire'
    },
    mission_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        isIn: [[
          'Responsable_Tableau_Cryptage',
          'Responsable_Materiel',
          'Coordinateur_Planning',
          'Gestionnaire_Activites',
          'Support_Technique',
          'Auditeur',
          'Formateur',
          'Custom'
        ]]
      },
      comment: 'Type de mission prédéfini ou personnalisé'
    },
    mission_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Nom lisible de la mission'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Description détaillée de la mission et ses responsabilités'
    },
    privileges_granted: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
      comment: 'Liste des privilèges accordés (array de strings)'
    },
    scope_geo_id: {
      type: DataTypes.STRING(16),
      allowNull: true,
      validate: {
        is: /^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/
      },
      comment: 'Portée géographique de la mission (optionnel)'
    },
    scope_group_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Portée de groupe de la mission (optionnel)'
    },
    created_by_member_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      validate: {
        min: 1,
        max: 9999999999
      },
      comment: 'Member_id de l\'administrateur ayant créé la mission'
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'expiration (NULL = mission permanente)'
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: 'Mission active ou non'
    },
    justification: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [10, 2000]
      },
      comment: 'Justification obligatoire de l\'attribution'
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    revoked_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date de révocation de la mission'
    },
    revoked_by_member_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      validate: {
        min: 1,
        max: 9999999999
      },
      comment: 'Member_id de l\'administrateur ayant révoqué'
    },
    revocation_reason: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Motif de la révocation'
    }
  }, {
    sequelize,
    modelName: 'UserMission',
    tableName: 'user_missions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false, // Pas de updated_at, on utilise revoked_at
    indexes: [
      { fields: ['member_id'] },
      { fields: ['mission_type'] },
      { fields: ['is_active'] },
      { fields: ['expires_at'] },
      { fields: ['scope_geo_id'] },
      { fields: ['scope_group_id'] }
    ],
    hooks: {
      beforeCreate: (mission) => {
        // Définir les privilèges par défaut selon le type de mission
        if (mission.privileges_granted.length === 0) {
          const defaultPrivileges = {
            'Responsable_Tableau_Cryptage': [
              'generate_emergency_codes',
              'download_emergency_table',
              'view_emergency_history',
              'trigger_emergency_rotation'
            ],
            'Responsable_Materiel': [
              'manage_inventory',
              'schedule_maintenance',
              'view_hardware_status'
            ],
            'Coordinateur_Planning': [
              'modify_guards',
              'apply_scenarios',
              'manage_waiting_list'
            ],
            'Gestionnaire_Activites': [
              'create_activities',
              'manage_participants',
              'block_guard_slots'
            ],
            'Support_Technique': [
              'view_system_logs',
              'run_diagnostics',
              'access_health_metrics'
            ],
            'Auditeur': [
              'view_audit_logs',
              'export_reports',
              'access_compliance_data'
            ],
            'Formateur': [
              'access_training_mode',
              'create_demo_accounts',
              'view_user_progress'
            ]
          };
          
          if (defaultPrivileges[mission.mission_type]) {
            mission.privileges_granted = defaultPrivileges[mission.mission_type];
          }
        }
      }
    }
  });

  return UserMission;
};
