/**
 * SHUGO v7.0 - Modèle MessagesCenter
 * 
 * Centre de notifications centralisé pour la diffusion hiérarchisée
 * des messages opérationnels. Supporte les messages système automatiques
 * et les messages hiérarchiques manuels.
 * 
 * Référence: Document Technique V7.0 - Section 4.2 et Annexe A.2.10
 */

'use strict';

const { Model, DataTypes, Op } = require('sequelize');

module.exports = (sequelize) => {
  class MessagesCenter extends Model {
    /**
     * Définit les associations avec les autres modèles
     */
    static associate(models) {
      // Émetteur du message (NULL pour messages système)
      MessagesCenter.belongsTo(models.User, {
        foreignKey: 'sender_member_id',
        as: 'sender'
      });

      // Statuts de lecture des destinataires
      MessagesCenter.hasMany(models.MessageReadStatus, {
        foreignKey: 'message_id',
        as: 'readStatuses'
      });
    }

    /**
     * Vérifie si le message est encore actif (non expiré)
     */
    isActive() {
      if (this.expires_at && new Date() > new Date(this.expires_at)) {
        return false;
      }
      return true;
    }

    /**
     * Vérifie si un utilisateur peut voir ce message selon son scope
     */
    isVisibleTo(user) {
      switch (this.target_scope) {
        case 'global':
          return true;
        case 'geo_id':
          return user.geo_id === this.target_identifier ||
                 user.geo_id.startsWith(this.target_identifier.substring(0, 8));
        case 'group':
          // Vérifier via l'appartenance au groupe
          return true; // À implémenter avec la relation
        case 'individual':
          return user.member_id.toString() === this.target_identifier;
        default:
          return false;
      }
    }

    /**
     * Récupère les messages actifs pour un utilisateur
     */
    static async getActiveMessagesForUser(memberId, geoId, groupIds = []) {
      const now = new Date();
      
      return this.findAll({
        where: {
          [Op.or]: [
            { target_scope: 'global' },
            { 
              target_scope: 'geo_id',
              target_identifier: { [Op.like]: geoId.substring(0, 8) + '%' }
            },
            {
              target_scope: 'group',
              target_identifier: { [Op.in]: groupIds.map(id => id.toString()) }
            },
            {
              target_scope: 'individual',
              target_identifier: memberId.toString()
            }
          ],
          [Op.or]: [
            { expires_at: null },
            { expires_at: { [Op.gt]: now } }
          ]
        },
        order: [
          ['is_pinned', 'DESC'],
          ['priority', 'DESC'],
          ['created_at', 'DESC']
        ],
        include: [{
          association: 'sender',
          attributes: ['member_id', 'first_name_encrypted', 'last_name_encrypted']
        }]
      });
    }

    /**
     * Crée un message système automatique
     */
    static async createSystemMessage(options) {
      return this.create({
        type: 'system',
        sender_member_id: null,
        target_scope: options.targetScope || 'global',
        target_identifier: options.targetIdentifier || null,
        title: options.title,
        content: options.content,
        priority: options.priority || 'normal',
        expires_at: options.expiresAt || null,
        is_pinned: options.isPinned || false
      });
    }

    /**
     * Expire le message manuellement
     */
    async expire() {
      this.expires_at = new Date();
      await this.save();
    }
  }

  MessagesCenter.init({
    message_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique du message'
    },
    type: {
      type: DataTypes.ENUM('system', 'hierarchical'),
      allowNull: false,
      comment: 'Type: system (automatique) ou hierarchical (manuel)'
    },
    sender_member_id: {
      type: DataTypes.BIGINT,
      allowNull: true, // NULL pour messages système
      validate: {
        min: 1,
        max: 9999999999
      },
      comment: 'Member_id de l\'émetteur (NULL pour système)'
    },
    target_scope: {
      type: DataTypes.ENUM('global', 'geo_id', 'group', 'individual'),
      allowNull: false,
      comment: 'Portée du message: global, geo_id, group, individual'
    },
    target_identifier: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Identifiant cible selon le scope (geo_id, group_id, member_id)'
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
      validate: {
        len: [3, 200]
      },
      comment: 'Titre du message'
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [1, 10000]
      },
      comment: 'Contenu du message'
    },
    priority: {
      type: DataTypes.ENUM('low', 'normal', 'high', 'urgent'),
      defaultValue: 'normal',
      comment: 'Priorité du message'
    },
    is_pinned: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Message épinglé en haut de la liste'
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'expiration du message'
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
    modelName: 'MessagesCenter',
    tableName: 'messages_center',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['type'] },
      { fields: ['target_scope'] },
      { fields: ['sender_member_id'] },
      { fields: ['created_at'] },
      { fields: ['expires_at'] },
      { fields: ['priority'] },
      { fields: ['is_pinned'] }
    ],
    hooks: {
      beforeCreate: (message) => {
        // Messages hiérarchiques expirent par défaut après 3 jours
        if (message.type === 'hierarchical' && !message.expires_at) {
          const threeDaysFromNow = new Date();
          threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
          message.expires_at = threeDaysFromNow;
        }
      }
    }
  });

  return MessagesCenter;
};
