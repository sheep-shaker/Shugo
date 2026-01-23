// services/WaitingListService.js
// Service de gestion de la liste d'attente avec activation J-3

const { WaitingList, Guard, GuardAssignment, User, Notification, AuditLog } = require('../models');
const { Op } = require('sequelize');
const EmailService = require('./EmailService');
const NotificationService = require('./NotificationService');

class WaitingListService {
  async getWaitingList({ geo_id, guard_id, status, page, limit, user }) {
    try {
      const where = {};
      
      if (geo_id) {
        const guards = await Guard.findAll({
          where: { geo_id },
          attributes: ['guard_id']
        });
        where.guard_id = { [Op.in]: guards.map(g => g.guard_id) };
      }
      
      if (guard_id) where.guard_id = guard_id;
      if (status) where.status = status;

      const offset = (page - 1) * limit;

      const { count, rows } = await WaitingList.findAndCountAll({
        where,
        limit,
        offset,
        order: [['created_at', 'ASC'], ['priority', 'DESC']],
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['member_id', 'first_name', 'last_name', 'email']
          },
          {
            model: Guard,
            as: 'guard',
            attributes: ['guard_id', 'date', 'shift', 'geo_id']
          }
        ]
      });

      // Calculer prochaine activation
      const nextActivation = await this.getNextActivationDate();

      return {
        data: rows.map((r, index) => ({
          ...r.toJSON(),
          position: index + 1
        })),
        total: count,
        page,
        pages: Math.ceil(count / limit),
        limit,
        next_activation_date: nextActivation
      };

    } catch (error) {
      console.error('Get waiting list error:', error);
      throw error;
    }
  }

  async getUserPositions({ member_id, include_inactive }) {
    try {
      const where = {
        member_id,
        status: include_inactive ? undefined : 'waiting'
      };

      if (!include_inactive) {
        where.status = 'waiting';
      }

      const positions = await WaitingList.findAll({
        where,
        include: [{
          model: Guard,
          as: 'guard',
          attributes: ['date', 'shift', 'geo_id', 'status']
        }],
        order: [['created_at', 'DESC']]
      });

      // Calculer la position pour chaque entrée
      for (const pos of positions) {
        const position = await WaitingList.count({
          where: {
            guard_id: pos.guard_id,
            status: 'waiting',
            created_at: { [Op.lt]: pos.created_at }
          }
        }) + 1;

        pos.dataValues.position = position;
      }

      return positions;

    } catch (error) {
      console.error('Get user positions error:', error);
      throw error;
    }
  }

  async getGuardWaitingList({ guard_id, user, include_stats }) {
    try {
      const guard = await Guard.findByPk(guard_id);
      if (!guard) return null;

      const waitingList = await WaitingList.findAll({
        where: {
          guard_id,
          status: 'waiting'
        },
        include: [{
          model: User,
          as: 'user',
          attributes: ['member_id', 'first_name', 'last_name', 'email']
        }],
        order: [['created_at', 'ASC'], ['priority', 'DESC']]
      });

      const data = {
        guard,
        waiting_list: waitingList.map((w, index) => ({
          ...w.toJSON(),
          position: index + 1
        })),
        total_waiting: waitingList.length
      };

      if (include_stats) {
        data.stats = {
          average_wait_time: await this.getAverageWaitTime(guard_id),
          activation_probability: this.calculateActivationProbability(guard, waitingList.length)
        };
      }

      return data;

    } catch (error) {
      console.error('Get guard waiting list error:', error);
      throw error;
    }
  }

  async joinWaitingList({ guard_id, member_id, priority, notification_preference, max_distance_km, availability_constraints }) {
    const transaction = await WaitingList.sequelize.transaction();

    try {
      // Vérifier que le garde existe et est ouvert
      const guard = await Guard.findByPk(guard_id);
      if (!guard) throw new Error('Créneau non trouvé');
      if (guard.status !== 'open') throw new Error('Créneau non disponible pour inscription');

      // Vérifier que l'utilisateur n'est pas déjà inscrit
      const existing = await WaitingList.findOne({
        where: {
          guard_id,
          member_id,
          status: 'waiting'
        }
      });

      if (existing) {
        throw new Error('Vous êtes déjà sur la liste d\'attente');
      }

      // Créer l'entrée
      const entry = await WaitingList.create({
        guard_id,
        member_id,
        priority,
        status: 'waiting',
        notification_preference,
        max_distance_km,
        availability_constraints,
        created_at: new Date()
      }, { transaction });

      // Calculer la position
      const position = await WaitingList.count({
        where: {
          guard_id,
          status: 'waiting',
          created_at: { [Op.lt]: entry.created_at }
        }
      }) + 1;

      // Log audit
      await AuditLog.create({
        action_type: 'waitingList.join',
        member_id,
        entity_type: 'guard',
        entity_id: guard_id,
        details: { position, priority }
      }, { transaction });

      await transaction.commit();

      return { ...entry.toJSON(), position };

    } catch (error) {
      await transaction.rollback();
      console.error('Join waiting list error:', error);
      throw error;
    }
  }

  async updatePosition({ position_id, updates, member_id }) {
    const transaction = await WaitingList.sequelize.transaction();

    try {
      const position = await WaitingList.findOne({
        where: {
          waiting_list_id: position_id,
          member_id,
          status: 'waiting'
        }
      });

      if (!position) {
        throw new Error('Position non trouvée ou non autorisée');
      }

      await position.update(updates, { transaction });

      await AuditLog.create({
        action_type: 'waitingList.update',
        member_id,
        entity_type: 'waitingList',
        entity_id: position_id,
        details: { updates }
      }, { transaction });

      await transaction.commit();

      return position;

    } catch (error) {
      await transaction.rollback();
      console.error('Update position error:', error);
      throw error;
    }
  }

  async leaveWaitingList({ position_id, member_id, reason }) {
    const transaction = await WaitingList.sequelize.transaction();

    try {
      const position = await WaitingList.findOne({
        where: {
          waiting_list_id: position_id,
          member_id
        }
      });

      if (!position) {
        throw new Error('Position non trouvée');
      }

      await position.update({
        status: 'cancelled',
        cancelled_at: new Date(),
        cancellation_reason: reason
      }, { transaction });

      await AuditLog.create({
        action_type: 'waitingList.leave',
        member_id,
        entity_type: 'waitingList',
        entity_id: position_id,
        details: { reason }
      }, { transaction });

      await transaction.commit();

    } catch (error) {
      await transaction.rollback();
      console.error('Leave waiting list error:', error);
      throw error;
    }
  }

  async activatePositions({ guard_ids, activation_date, send_notifications, activated_by }) {
    const transaction = await WaitingList.sequelize.transaction();
    let activated_count = 0;

    try {
      for (const guard_id of guard_ids) {
        const guard = await Guard.findByPk(guard_id);
        if (!guard || guard.status !== 'open') continue;

        // Récupérer la liste d'attente
        const waitingList = await WaitingList.findAll({
          where: {
            guard_id,
            status: 'waiting'
          },
          order: [['created_at', 'ASC'], ['priority', 'DESC']],
          limit: guard.max_guards - (guard.assigned_count || 0)
        });

        for (const entry of waitingList) {
          // Créer l'assignation
          await GuardAssignment.create({
            guard_id,
            member_id: entry.member_id,
            status: 'confirmed',
            assigned_at: new Date(),
            source: 'waiting_list'
          }, { transaction });

          // Mettre à jour la liste d'attente
          await entry.update({
            status: 'activated',
            activated_at: activation_date || new Date()
          }, { transaction });

          // Notification
          if (send_notifications) {
            await this.sendActivationNotification(entry, guard);
          }

          activated_count++;
        }
      }

      await AuditLog.create({
        action_type: 'waitingList.activate',
        member_id: activated_by,
        severity: 'info',
        details: {
          guards_processed: guard_ids.length,
          activated_count
        }
      }, { transaction });

      await transaction.commit();

      return { activated_count, guards_processed: guard_ids.length };

    } catch (error) {
      await transaction.rollback();
      console.error('Activate positions error:', error);
      throw error;
    }
  }

  async getPendingActivations({ days_ahead, geo_id }) {
    try {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + days_ahead);

      const guards = await Guard.findAll({
        where: {
          date: {
            [Op.gte]: targetDate,
            [Op.lt]: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000)
          },
          status: 'open',
          ...(geo_id && { geo_id })
        },
        include: [{
          model: WaitingList,
          as: 'waitingList',
          where: { status: 'waiting' },
          required: false
        }]
      });

      const pending = guards.filter(g => {
        const available = g.max_guards - (g.assigned_count || 0);
        const waiting = g.waitingList?.length || 0;
        return available > 0 && waiting > 0;
      });

      return pending.map(g => ({
        guard_id: g.guard_id,
        date: g.date,
        shift: g.shift,
        available_slots: g.max_guards - (g.assigned_count || 0),
        waiting_count: g.waitingList?.length || 0,
        can_activate: Math.min(
          g.max_guards - (g.assigned_count || 0),
          g.waitingList?.length || 0
        )
      }));

    } catch (error) {
      console.error('Get pending activations error:', error);
      throw error;
    }
  }

  async activateNow({ position_id, notify, activated_by }) {
    const transaction = await WaitingList.sequelize.transaction();

    try {
      const position = await WaitingList.findByPk(position_id, {
        include: [{
          model: Guard,
          as: 'guard'
        }]
      });

      if (!position) throw new Error('Position non trouvée');
      if (position.status !== 'waiting') throw new Error('Position déjà activée');

      const guard = position.guard;
      if (guard.assigned_count >= guard.max_guards) {
        throw new Error('Créneau complet');
      }

      // Créer l'assignation
      await GuardAssignment.create({
        guard_id: guard.guard_id,
        member_id: position.member_id,
        status: 'confirmed',
        assigned_at: new Date(),
        source: 'waiting_list_manual'
      }, { transaction });

      // Mettre à jour la position
      await position.update({
        status: 'activated',
        activated_at: new Date()
      }, { transaction });

      // Notification
      if (notify) {
        await this.sendActivationNotification(position, guard);
      }

      await AuditLog.create({
        action_type: 'waitingList.activateNow',
        member_id: activated_by,
        entity_type: 'waitingList',
        entity_id: position_id
      }, { transaction });

      await transaction.commit();

      return { success: true, guard_id: guard.guard_id };

    } catch (error) {
      await transaction.rollback();
      console.error('Activate now error:', error);
      throw error;
    }
  }

  async getStatistics({ geo_id, date_from, date_to }) {
    try {
      const where = {};
      if (date_from) where.created_at = { [Op.gte]: new Date(date_from) };
      if (date_to) {
        where.created_at = {
          ...where.created_at,
          [Op.lte]: new Date(date_to)
        };
      }

      if (geo_id) {
        const guards = await Guard.findAll({
          where: { geo_id },
          attributes: ['guard_id']
        });
        where.guard_id = { [Op.in]: guards.map(g => g.guard_id) };
      }

      const [total, activated, cancelled, avgWaitTime] = await Promise.all([
        WaitingList.count({ where }),
        WaitingList.count({ where: { ...where, status: 'activated' } }),
        WaitingList.count({ where: { ...where, status: 'cancelled' } }),
        this.calculateAverageWaitTime(where)
      ]);

      return {
        total_entries: total,
        activated: activated,
        cancelled: cancelled,
        activation_rate: total > 0 ? (activated / total * 100).toFixed(2) : 0,
        average_wait_time_hours: avgWaitTime,
        current_waiting: await WaitingList.count({
          where: { ...where, status: 'waiting' }
        })
      };

    } catch (error) {
      console.error('Get statistics error:', error);
      throw error;
    }
  }

  async processJ3Activations({ dry_run }) {
    const transaction = dry_run ? null : await WaitingList.sequelize.transaction();
    let activated_count = 0;

    try {
      // Date J+3
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 3);
      targetDate.setHours(0, 0, 0, 0);
      
      const endDate = new Date(targetDate);
      endDate.setHours(23, 59, 59, 999);

      // Trouver les gardes concernées
      const guards = await Guard.findAll({
        where: {
          date: { [Op.between]: [targetDate, endDate] },
          status: 'open'
        }
      });

      for (const guard of guards) {
        const available = guard.max_guards - (guard.assigned_count || 0);
        if (available <= 0) continue;

        // Récupérer la liste d'attente avec scores de matching
        const waitingList = await WaitingList.findAll({
          where: {
            guard_id: guard.guard_id,
            status: 'waiting',
            is_active: true
          },
          order: [
            ['priority', 'DESC'],
            ['skill_match_score', 'DESC'],
            ['availability_match_score', 'DESC'],
            ['position', 'ASC']
          ],
          limit: available
        });

        for (const entry of waitingList) {
          if (!dry_run) {
            // Créer l'assignation
            await GuardAssignment.create({
              guard_id: guard.guard_id,
              member_id: entry.member_id,
              status: 'confirmed',
              assigned_at: new Date(),
              source: 'j3_activation'
            }, { transaction });

            // Mettre à jour l'entrée
            await entry.update({
              status: 'activated',
              activated_at: new Date()
            }, { transaction });

            // Notification
            await this.sendJ3ActivationNotification(entry, guard);
          }

          activated_count++;
        }
      }

      if (!dry_run) {
        await AuditLog.create({
          action_type: 'waitingList.processJ3',
          entity_type: 'system',
          severity: 'info',
          details: {
            target_date: targetDate,
            activated_count,
            guards_processed: guards.length
          }
        }, { transaction });

        await transaction.commit();
      }

      return {
        activated_count,
        guards_processed: guards.length,
        dry_run
      };

    } catch (error) {
      if (transaction) await transaction.rollback();
      console.error('Process J-3 error:', error);
      throw error;
    }
  }

  // Méthodes privées

  async getNextActivationDate() {
    const now = new Date();
    const j3 = new Date();
    j3.setDate(j3.getDate() + 3);
    j3.setHours(0, 0, 0, 0);
    return j3;
  }

  async getAverageWaitTime(guard_id) {
    const activations = await WaitingList.findAll({
      where: {
        guard_id,
        status: 'activated',
        activated_at: { [Op.not]: null }
      },
      attributes: ['created_at', 'activated_at']
    });

    if (activations.length === 0) return null;

    const totalWait = activations.reduce((sum, a) => {
      const wait = a.activated_at - a.created_at;
      return sum + wait;
    }, 0);

    return Math.round(totalWait / activations.length / (1000 * 60 * 60)); // en heures
  }

  calculateActivationProbability(guard, waitingCount) {
    if (waitingCount === 0) return 100;
    
    const available = guard.max_guards - (guard.assigned_count || 0);
    if (available >= waitingCount) return 100;
    
    return Math.round((available / waitingCount) * 100);
  }

  async calculateAverageWaitTime(where) {
    const activations = await WaitingList.findAll({
      where: {
        ...where,
        status: 'activated',
        activated_at: { [Op.not]: null }
      },
      attributes: ['created_at', 'activated_at']
    });

    if (activations.length === 0) return 0;

    const totalWait = activations.reduce((sum, a) => {
      const wait = a.activated_at - a.created_at;
      return sum + wait;
    }, 0);

    return Math.round(totalWait / activations.length / (1000 * 60 * 60));
  }

  async sendActivationNotification(entry, guard) {
    try {
      const user = await User.findByPk(entry.member_id);
      if (!user) return;

      await NotificationService.send({
        user_id: user.member_id,
        type: 'waiting_list_activation',
        title: 'Activation depuis la liste d\'attente',
        message: `Vous avez été assigné au créneau du ${guard.date.toLocaleDateString()} - ${guard.shift}`,
        data: {
          guard_id: guard.guard_id,
          waiting_list_id: entry.waiting_list_id
        }
      });

      if (entry.notification_preference?.includes('email')) {
        await EmailService.sendWaitingListActivation({
          email: user.email,
          name: user.first_name,
          guard_date: guard.date,
          guard_shift: guard.shift
        });
      }

    } catch (error) {
      console.error('Send activation notification error:', error);
    }
  }

  async sendJ3ActivationNotification(entry, guard) {
    try {
      const user = await User.findByPk(entry.member_id);
      if (!user) return;

      await NotificationService.send({
        user_id: user.member_id,
        type: 'j3_activation',
        title: 'Activation J-3',
        message: `Activation automatique pour le ${guard.date.toLocaleDateString()} - ${guard.shift}`,
        priority: 'high',
        data: {
          guard_id: guard.guard_id,
          waiting_list_id: entry.waiting_list_id
        }
      });

      await EmailService.sendJ3Activation({
        email: user.email,
        name: user.first_name,
        guard_date: guard.date,
        guard_shift: guard.shift
      });

    } catch (error) {
      console.error('Send J-3 notification error:', error);
    }
  }
}

module.exports = new WaitingListService();
