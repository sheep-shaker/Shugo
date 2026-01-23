'use strict';

/**
 * Modèle WaitingList - Liste d'attente intelligente J-3
 *
 * Gère la file d'attente pour les créneaux de garde.
 * Activation automatique J-3 avant le créneau.
 *
 * @see Document Technique V7.0 - Section 3.5
 */

const { DataTypes, Op } = require('sequelize');

module.exports = (sequelize) => {
  const WaitingList = sequelize.define('WaitingList', {
    waiting_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique'
    },
    member_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      comment: 'member_id du demandeur'
    },
    guard_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'ID du créneau de garde (si spécifique)'
    },
    slot_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'ID du slot de garde (si applicable)'
    },
    guard_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      comment: 'Date du créneau demandé'
    },
    slot_index: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Index du créneau (0-47 pour 48 créneaux de 30min)'
    },
    slot_start_time: {
      type: DataTypes.TIME,
      allowNull: true,
      comment: 'Heure de début du créneau'
    },
    slot_end_time: {
      type: DataTypes.TIME,
      allowNull: true,
      comment: 'Heure de fin du créneau'
    },
    geo_id: {
      type: DataTypes.STRING(16),
      allowNull: false,
      comment: 'Scope géographique'
    },
    group_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Groupe concerné'
    },
    priority: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 100,
      comment: 'Priorité (1=max, 100=min) basée sur ancienneté et historique'
    },
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'pending',
      comment: 'Statut: pending, activated, assigned, expired, cancelled'
    },
    request_reason: {
      type: DataTypes.STRING(256),
      allowNull: true,
      comment: 'Raison de la demande'
    },
    requested_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: 'Date de la demande'
    },
    activation_date: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'activation prévue (J-3)'
    },
    activated_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'activation effective'
    },
    assigned_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'attribution'
    },
    assigned_by: {
      type: DataTypes.STRING(16),
      allowNull: true,
      comment: 'Attribution: automatic, manual, admin'
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Expiration de la demande'
    },
    cancelled_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'annulation'
    },
    cancel_reason: {
      type: DataTypes.STRING(256),
      allowNull: true,
      comment: 'Raison de l\'annulation'
    },
    notification_sent: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Notification envoyée'
    },
    notification_sent_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'envoi de la notification'
    },
    response_deadline: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Deadline pour répondre (4h par défaut)'
    },
    response_received_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date de réponse'
    },
    response: {
      type: DataTypes.STRING(16),
      allowNull: true,
      comment: 'Réponse: accepted, declined, no_response'
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {},
      comment: 'Métadonnées additionnelles'
    }
  }, {
    tableName: 'waiting_list',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['member_id', 'status'],
        name: 'idx_waiting_member_status'
      },
      {
        fields: ['guard_date', 'status'],
        name: 'idx_waiting_date_status'
      },
      {
        fields: ['geo_id', 'guard_date'],
        name: 'idx_waiting_geo_date'
      },
      {
        fields: ['group_id'],
        name: 'idx_waiting_group'
      },
      {
        fields: ['priority', 'requested_at'],
        name: 'idx_waiting_priority'
      },
      {
        fields: ['activation_date'],
        where: { status: 'pending' },
        name: 'idx_waiting_activation'
      },
      {
        fields: ['status'],
        name: 'idx_waiting_status'
      },
      {
        fields: ['guard_id'],
        name: 'idx_waiting_guard'
      },
      {
        fields: ['slot_id'],
        name: 'idx_waiting_slot'
      }
    ]
  });

  WaitingList.associate = (models) => {
    // Relation avec l'utilisateur
    if (models.User) {
      WaitingList.belongsTo(models.User, {
        foreignKey: 'member_id',
        as: 'Member'
      });
    }

    // Relation avec le créneau de garde
    if (models.Guard) {
      WaitingList.belongsTo(models.Guard, {
        foreignKey: 'guard_id',
        as: 'Guard'
      });
    }

    // Relation avec le slot
    if (models.GuardSlot) {
      WaitingList.belongsTo(models.GuardSlot, {
        foreignKey: 'slot_id',
        as: 'Slot'
      });
    }

    // Relation avec le groupe
    if (models.Group) {
      WaitingList.belongsTo(models.Group, {
        foreignKey: 'group_id',
        as: 'Group'
      });
    }
  };

  /**
   * Méthodes de classe
   */

  // Récupérer les demandes à activer (J-3)
  WaitingList.getToActivate = async function() {
    const activationDate = new Date();
    activationDate.setDate(activationDate.getDate() + 3);
    activationDate.setHours(23, 59, 59, 999);

    return this.findAll({
      where: {
        status: 'pending',
        guard_date: {
          [Op.lte]: activationDate
        }
      },
      order: [['priority', 'ASC'], ['requested_at', 'ASC']]
    });
  };

  // Récupérer la file d'attente pour un créneau
  WaitingList.getQueueForSlot = async function(guardDate, slotIndex, geoId) {
    return this.findAll({
      where: {
        guard_date: guardDate,
        slot_index: slotIndex,
        geo_id: geoId,
        status: ['pending', 'activated']
      },
      order: [['priority', 'ASC'], ['requested_at', 'ASC']]
    });
  };

  // Calculer la priorité d'un membre
  WaitingList.calculatePriority = async function(memberId, models) {
    let priority = 100;

    // Bonus ancienneté
    if (models.User) {
      const user = await models.User.findByPk(memberId);
      if (user) {
        const yearsActive = Math.floor(
          (Date.now() - new Date(user.created_at)) / (365 * 24 * 60 * 60 * 1000)
        );
        priority -= Math.min(yearsActive * 5, 25); // Max -25 pour ancienneté
      }
    }

    // Malus demandes récentes non honorées
    const recentDeclined = await this.count({
      where: {
        member_id: memberId,
        response: 'declined',
        created_at: {
          [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        }
      }
    });
    priority += recentDeclined * 10;

    // Bonus pour les membres actifs (gardes effectuées)
    if (models.GuardAssignment) {
      const guardsCompleted = await models.GuardAssignment.count({
        where: {
          member_id: memberId,
          status: 'completed',
          created_at: {
            [Op.gte]: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
          }
        }
      });
      priority -= Math.min(guardsCompleted * 2, 20); // Max -20 pour activité
    }

    return Math.max(1, Math.min(priority, 200)); // Clamp entre 1 et 200
  };

  return WaitingList;
};
