/**
 * SHUGO v7.0 - Modèle SupportRequest
 * 
 * Gestion des demandes de support utilisateur.
 * Intégré avec l'assistant Assist'SHUGO pour un routage intelligent
 * vers les responsables appropriés.
 * 
 * Référence: Document Technique V7.0 - Section 4.3 et Annexe A.2.12
 */

'use strict';

const { Model, DataTypes, Op } = require('sequelize');

module.exports = (sequelize) => {
  class SupportRequest extends Model {
    /**
     * Définit les associations avec les autres modèles
     */
    static associate(models) {
      // Utilisateur demandeur
      SupportRequest.belongsTo(models.User, {
        foreignKey: 'requester_member_id',
        as: 'requester'
      });

      // Responsable assigné
      SupportRequest.belongsTo(models.User, {
        foreignKey: 'assigned_to_member_id',
        as: 'assignee'
      });
    }

    /**
     * Détermine le destinataire approprié selon la hiérarchie
     */
    static determineAssignee(requesterRole, category, geoId) {
      // Logique de routage hiérarchique selon le document technique
      const routingRules = {
        'Silver': 'Gold', // Silver -> Gold de son groupe
        'Gold': 'Platinum', // Gold -> Platinum du local
        'Platinum': 'Admin', // Platinum -> Admin
        'Admin': 'Admin_N1' // Admin -> Admin N1
      };

      // Les bugs système vont directement aux admins
      if (category === 'bug' || category === 'technical') {
        return 'Admin';
      }

      return routingRules[requesterRole] || 'Gold';
    }

    /**
     * Crée une nouvelle demande avec routage automatique
     */
    static async createWithRouting(data, requester) {
      const targetRole = this.determineAssignee(
        requester.role,
        data.category,
        requester.geo_id
      );

      const request = await this.create({
        requester_member_id: requester.member_id,
        category: data.category,
        subject: data.subject,
        description: data.description,
        priority: data.priority || 'normal',
        status: 'open'
      });

      // L'assignation se fait ensuite via le service de support
      return request;
    }

    /**
     * Assigne la demande à un responsable
     */
    async assignTo(memberId) {
      this.assigned_to_member_id = memberId;
      this.status = 'in_progress';
      await this.save();
    }

    /**
     * Résout la demande
     */
    async resolve(resolution) {
      this.status = 'resolved';
      this.resolution = resolution;
      this.resolved_at = new Date();
      await this.save();
    }

    /**
     * Ferme la demande
     */
    async close() {
      this.status = 'closed';
      await this.save();
    }

    /**
     * Escalade la demande au niveau supérieur
     */
    async escalate(newAssigneeMemberId, reason) {
      this.assigned_to_member_id = newAssigneeMemberId;
      this.priority = 'high';
      // Ajouter une note d'escalade dans la description
      this.description += `\n\n[ESCALADE] ${new Date().toISOString()}: ${reason}`;
      await this.save();
    }

    /**
     * Récupère les demandes en attente pour un responsable
     */
    static async getPendingForAssignee(memberId, options = {}) {
      const where = {
        assigned_to_member_id: memberId,
        status: { [Op.in]: ['open', 'in_progress'] }
      };

      if (options.priority) {
        where.priority = options.priority;
      }

      return this.findAll({
        where,
        order: [
          ['priority', 'DESC'],
          ['created_at', 'ASC']
        ],
        include: [{
          association: 'requester',
          attributes: ['member_id', 'first_name_encrypted', 'last_name_encrypted', 'role']
        }]
      });
    }

    /**
     * Récupère l'historique des demandes d'un utilisateur
     */
    static async getHistoryForUser(memberId, limit = 20) {
      return this.findAll({
        where: { requester_member_id: memberId },
        order: [['created_at', 'DESC']],
        limit,
        include: [{
          association: 'assignee',
          attributes: ['member_id', 'first_name_encrypted', 'last_name_encrypted']
        }]
      });
    }

    /**
     * Calcule les statistiques de support
     */
    static async getStatistics(geoId, period = 30) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - period);

      const requests = await this.findAll({
        where: {
          created_at: { [Op.gte]: startDate }
        },
        attributes: ['status', 'priority', 'category', 'created_at', 'resolved_at']
      });

      const stats = {
        total: requests.length,
        byStatus: {},
        byPriority: {},
        byCategory: {},
        avgResolutionTime: null
      };

      let totalResolutionTime = 0;
      let resolvedCount = 0;

      requests.forEach(req => {
        // Par statut
        stats.byStatus[req.status] = (stats.byStatus[req.status] || 0) + 1;
        // Par priorité
        stats.byPriority[req.priority] = (stats.byPriority[req.priority] || 0) + 1;
        // Par catégorie
        stats.byCategory[req.category] = (stats.byCategory[req.category] || 0) + 1;
        // Temps de résolution
        if (req.resolved_at) {
          totalResolutionTime += new Date(req.resolved_at) - new Date(req.created_at);
          resolvedCount++;
        }
      });

      if (resolvedCount > 0) {
        stats.avgResolutionTime = Math.round(totalResolutionTime / resolvedCount / (1000 * 60 * 60)); // En heures
      }

      return stats;
    }
  }

  SupportRequest.init({
    request_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique de la demande'
    },
    requester_member_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      validate: {
        min: 1,
        max: 9999999999
      },
      comment: 'Member_id du demandeur'
    },
    assigned_to_member_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      validate: {
        min: 1,
        max: 9999999999
      },
      comment: 'Member_id du responsable assigné'
    },
    category: {
      type: DataTypes.ENUM('technical', 'guard', 'account', 'bug', 'feature', 'other'),
      allowNull: false,
      comment: 'Catégorie de la demande'
    },
    subject: {
      type: DataTypes.STRING(200),
      allowNull: false,
      validate: {
        len: [5, 200]
      },
      comment: 'Sujet de la demande'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [10, 10000]
      },
      comment: 'Description détaillée du problème'
    },
    priority: {
      type: DataTypes.ENUM('low', 'normal', 'high', 'urgent'),
      defaultValue: 'normal',
      comment: 'Priorité de la demande'
    },
    status: {
      type: DataTypes.ENUM('open', 'in_progress', 'resolved', 'closed'),
      defaultValue: 'open',
      comment: 'Statut de la demande'
    },
    resolution: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Description de la résolution'
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    resolved_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date de résolution'
    }
  }, {
    sequelize,
    modelName: 'SupportRequest',
    tableName: 'support_requests',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['requester_member_id'] },
      { fields: ['assigned_to_member_id'] },
      { fields: ['status'] },
      { fields: ['priority'] },
      { fields: ['category'] },
      { fields: ['created_at'] }
    ]
  });

  return SupportRequest;
};
