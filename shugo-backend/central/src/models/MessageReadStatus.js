/**
 * SHUGO v7.0 - Modèle MessageReadStatus
 * 
 * Suivi du statut de lecture des messages par les utilisateurs.
 * Permet de marquer les messages comme lus ou ignorés.
 * 
 * Référence: Document Technique V7.0 - Section 4.2.3 et Annexe A.2.11
 */

'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class MessageReadStatus extends Model {
    /**
     * Définit les associations avec les autres modèles
     */
    static associate(models) {
      // Message concerné
      MessageReadStatus.belongsTo(models.MessagesCenter, {
        foreignKey: 'message_id',
        as: 'message',
        onDelete: 'CASCADE'
      });

      // Utilisateur qui a lu le message
      MessageReadStatus.belongsTo(models.User, {
        foreignKey: 'member_id',
        as: 'reader'
      });
    }

    /**
     * Marque un message comme lu pour un utilisateur
     */
    static async markAsRead(messageId, memberId) {
      const [status, created] = await this.findOrCreate({
        where: {
          message_id: messageId,
          member_id: memberId
        },
        defaults: {
          read_at: new Date(),
          is_ignored: false
        }
      });

      if (!created && !status.read_at) {
        status.read_at = new Date();
        await status.save();
      }

      return status;
    }

    /**
     * Marque un message comme ignoré (masqué sans suppression)
     */
    static async markAsIgnored(messageId, memberId) {
      const [status, created] = await this.findOrCreate({
        where: {
          message_id: messageId,
          member_id: memberId
        },
        defaults: {
          is_ignored: true
        }
      });

      if (!created) {
        status.is_ignored = true;
        await status.save();
      }

      return status;
    }

    /**
     * Vérifie si un message a été lu par un utilisateur
     */
    static async isReadBy(messageId, memberId) {
      const status = await this.findOne({
        where: {
          message_id: messageId,
          member_id: memberId
        }
      });

      return status ? !!status.read_at : false;
    }

    /**
     * Récupère l'historique des 10 derniers messages lus par un utilisateur
     */
    static async getRecentHistory(memberId, limit = 10) {
      return this.findAll({
        where: {
          member_id: memberId,
          read_at: { [require('sequelize').Op.not]: null }
        },
        order: [['read_at', 'DESC']],
        limit,
        include: [{
          association: 'message',
          attributes: ['message_id', 'title', 'type', 'priority', 'created_at']
        }]
      });
    }

    /**
     * Compte les messages non lus pour un utilisateur
     */
    static async countUnreadForUser(memberId, messageIds) {
      const readStatuses = await this.findAll({
        where: {
          member_id: memberId,
          message_id: { [require('sequelize').Op.in]: messageIds },
          read_at: { [require('sequelize').Op.not]: null }
        },
        attributes: ['message_id']
      });

      const readMessageIds = readStatuses.map(s => s.message_id);
      return messageIds.filter(id => !readMessageIds.includes(id)).length;
    }
  }

  MessageReadStatus.init({
    read_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique du statut de lecture'
    },
    message_id: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'Référence vers le message'
    },
    member_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      validate: {
        min: 1,
        max: 9999999999
      },
      comment: 'Member_id de l\'utilisateur'
    },
    read_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
      comment: 'Date et heure de lecture'
    },
    is_ignored: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Message masqué par l\'utilisateur'
    }
  }, {
    sequelize,
    modelName: 'MessageReadStatus',
    tableName: 'message_read_status',
    timestamps: false, // Pas de created_at/updated_at, on utilise read_at
    indexes: [
      { fields: ['message_id'] },
      { fields: ['member_id'] },
      { 
        unique: true,
        fields: ['message_id', 'member_id']
      }
    ]
  });

  return MessageReadStatus;
};
