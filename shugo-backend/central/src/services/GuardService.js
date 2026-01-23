'use strict';

/**
 * Service de Gestion des Gardes SHUGO
 * 
 * Gère les inscriptions, annulations, scénarios, liste d'attente.
 * 
 * @see Document Technique V7.0 - Section 4.1
 */

const { Op, Transaction } = require('sequelize');
const config = require('../config');

/**
 * Types d'annulation selon le délai
 * @see V7.0 Section 4.1.5
 */
const CANCELLATION_TYPES = {
  NORMAL: 'normal',       // > 7 jours
  ANTICIPATED: 'anticipated', // 72h à 7 jours
  LATE: 'late'           // < 72h
};

/**
 * Service de gestion des gardes
 */
class GuardService {
  constructor(models, sequelize) {
    this.models = models;
    this.sequelize = sequelize;
    this.Guard = models.Guard;
    this.GuardAssignment = models.GuardAssignment;
    this.GuardScenario = models.GuardScenario;
    this.WaitingList = models.WaitingList;
    this.User = models.User;
    this.GuardLog = models.GuardLog;
    this.AuditLog = models.AuditLog;
    this.Notification = models.Notification;
  }

  // =========================================
  // LECTURE DES GARDES
  // =========================================

  /**
   * Récupère une garde par son ID
   * @param {string} guardId
   * @param {Object} options
   * @returns {Promise<Object|null>}
   */
  async getById(guardId, options = {}) {
    const include = [];
    
    if (options.includeAssignments) {
      include.push({
        model: this.GuardAssignment,
        as: 'assignments',
        where: { status: { [Op.in]: ['confirmed', 'pending'] } },
        required: false,
        include: options.includeUsers ? [{
          model: this.User,
          attributes: ['member_id', 'role', 'geo_id']
        }] : []
      });
    }

    if (options.includeScenario) {
      include.push({
        model: this.GuardScenario,
        as: 'scenario'
      });
    }

    const guard = await this.Guard.findByPk(guardId, { include });
    return guard;
  }

  /**
   * Liste les gardes avec filtres
   * @param {Object} filters
   * @param {Object} pagination
   * @returns {Promise<Object>}
   */
  async list(filters = {}, pagination = {}) {
    const {
      geoId,
      dateFrom,
      dateTo,
      status,
      guardType,
      memberId,
      hasAvailability,
      scenarioId
    } = filters;

    const {
      page = 1,
      limit = 50,
      sortBy = 'guard_date',
      sortOrder = 'ASC'
    } = pagination;

    const where = { deleted_at: null };

    if (geoId) {
      where.geo_id = geoId;
    }

    if (dateFrom && dateTo) {
      where.guard_date = { [Op.between]: [dateFrom, dateTo] };
    } else if (dateFrom) {
      where.guard_date = { [Op.gte]: dateFrom };
    } else if (dateTo) {
      where.guard_date = { [Op.lte]: dateTo };
    }

    if (status) {
      where.status = Array.isArray(status) ? { [Op.in]: status } : status;
    }

    if (guardType) {
      where.guard_type = guardType;
    }

    if (scenarioId) {
      where.scenario_id = scenarioId;
    }

    if (hasAvailability === true) {
      where[Op.and] = [
        this.sequelize.literal('current_participants < max_participants')
      ];
    } else if (hasAvailability === false) {
      where[Op.and] = [
        this.sequelize.literal('current_participants >= max_participants')
      ];
    }

    // Si on filtre par membre, joindre les assignments
    const include = [];
    if (memberId) {
      include.push({
        model: this.GuardAssignment,
        as: 'assignments',
        where: { member_id: memberId, status: 'confirmed' },
        required: true
      });
    }

    const { count, rows } = await this.Guard.findAndCountAll({
      where,
      include,
      order: [[sortBy, sortOrder], ['start_time', 'ASC']],
      limit: Math.min(limit, 200),
      offset: (page - 1) * limit
    });

    return {
      guards: rows,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    };
  }

  /**
   * Récupère le planning d'une journée
   * @param {string} geoId
   * @param {Date|string} date
   * @returns {Promise<Object[]>}
   */
  async getDaySchedule(geoId, date) {
    const guards = await this.Guard.findAll({
      where: {
        geo_id: geoId,
        guard_date: date,
        deleted_at: null
      },
      include: [{
        model: this.GuardAssignment,
        as: 'assignments',
        where: { status: 'confirmed' },
        required: false,
        include: [{
          model: this.User,
          attributes: ['member_id', 'first_name_encrypted', 'last_name_encrypted', 'role']
        }]
      }],
      order: [['start_time', 'ASC']]
    });

    return guards.map(g => this._formatGuardWithStatus(g));
  }

  /**
   * Récupère le planning d'une semaine
   * @param {string} geoId
   * @param {Date|string} startDate
   * @returns {Promise<Object>}
   */
  async getWeekSchedule(geoId, startDate) {
    const start = new Date(startDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    const guards = await this.Guard.findAll({
      where: {
        geo_id: geoId,
        guard_date: { [Op.between]: [start, end] },
        deleted_at: null
      },
      include: [{
        model: this.GuardAssignment,
        as: 'assignments',
        where: { status: 'confirmed' },
        required: false
      }],
      order: [['guard_date', 'ASC'], ['start_time', 'ASC']]
    });

    // Grouper par jour
    const byDay = {};
    guards.forEach(g => {
      const dayKey = g.guard_date.toISOString().split('T')[0];
      if (!byDay[dayKey]) byDay[dayKey] = [];
      byDay[dayKey].push(this._formatGuardWithStatus(g));
    });

    return byDay;
  }

  // =========================================
  // CRÉATION DE GARDES
  // =========================================

  /**
   * Crée une nouvelle garde
   * @param {Object} data
   * @param {number} createdBy - member_id du créateur
   * @returns {Promise<Object>}
   */
  async create(data, createdBy) {
    const {
      geoId,
      guardDate,
      startTime,
      endTime,
      guardType = 'standard',
      maxParticipants = 1,
      minParticipants = 1,
      description,
      requirements,
      scenarioId,
      priority = 1
    } = data;

    // Validation
    if (new Date(`${guardDate}T${startTime}`) >= new Date(`${guardDate}T${endTime}`)) {
      throw new GuardError('INVALID_TIME', 'L\'heure de fin doit être après l\'heure de début');
    }

    // Vérifier les chevauchements
    const overlapping = await this._checkOverlap(geoId, guardDate, startTime, endTime);
    if (overlapping) {
      throw new GuardError('OVERLAP', 'Ce créneau chevauche une garde existante');
    }

    const guard = await this.Guard.create({
      geo_id: geoId,
      guard_date: guardDate,
      start_time: startTime,
      end_time: endTime,
      guard_type: guardType,
      max_participants: maxParticipants,
      min_participants: minParticipants,
      current_participants: 0,
      description,
      requirements,
      scenario_id: scenarioId,
      priority,
      status: 'open',
      created_by_member_id: createdBy
    });

    await this._logGuardAction(guard.guard_id, createdBy, 'create', {
      geoId, guardDate, startTime, endTime
    });

    return guard;
  }

  /**
   * Crée des gardes à partir d'un scénario
   * @param {string} scenarioId
   * @param {Date|string} startDate
   * @param {Date|string} endDate
   * @param {number} createdBy
   * @returns {Promise<Object[]>}
   */
  async createFromScenario(scenarioId, startDate, endDate, createdBy) {
    const scenario = await this.GuardScenario.findByPk(scenarioId);
    if (!scenario) {
      throw new GuardError('SCENARIO_NOT_FOUND', 'Scénario non trouvé');
    }

    const templateData = scenario.template_data;
    const guards = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Parcourir chaque jour
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay(); // 0 = dimanche
      const daySlots = templateData.slots?.[dayOfWeek] || templateData.defaultSlots || [];

      for (const slot of daySlots) {
        if (!slot.enabled) continue;

        try {
          const guard = await this.create({
            geoId: scenario.geo_id,
            guardDate: d.toISOString().split('T')[0],
            startTime: slot.startTime,
            endTime: slot.endTime,
            guardType: slot.guardType || 'standard',
            maxParticipants: slot.maxParticipants || 1,
            minParticipants: slot.minParticipants || 1,
            description: slot.description,
            scenarioId,
            priority: slot.priority || 1
          }, createdBy);

          guards.push(guard);
        } catch (err) {
          // Ignorer les erreurs de chevauchement pour continuer
          if (err.code !== 'OVERLAP') throw err;
        }
      }
    }

    return guards;
  }

  // =========================================
  // INSCRIPTION AUX GARDES
  // =========================================

  /**
   * Inscrit un membre à une garde
   * @param {string} guardId
   * @param {number} memberId
   * @param {number} assignedBy - Qui fait l'inscription
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async register(guardId, memberId, assignedBy, options = {}) {
    // Utiliser une transaction avec isolation SERIALIZABLE
    return this.sequelize.transaction({
      isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE
    }, async (t) => {
      // 1. Verrouiller la garde pour mise à jour
      const guard = await this.Guard.findByPk(guardId, {
        lock: t.LOCK.UPDATE,
        transaction: t
      });

      if (!guard) {
        throw new GuardError('GUARD_NOT_FOUND', 'Garde non trouvée');
      }

      // 2. Vérifications
      if (guard.status === 'cancelled' || guard.status === 'closed') {
        throw new GuardError('GUARD_CLOSED', 'Cette garde est fermée ou annulée');
      }

      if (guard.current_participants >= guard.max_participants) {
        throw new GuardError('GUARD_FULL', 'Cette garde est complète');
      }

      // 3. Vérifier si le membre n'est pas déjà inscrit
      const existingAssignment = await this.GuardAssignment.findOne({
        where: {
          guard_id: guardId,
          member_id: memberId,
          status: { [Op.in]: ['confirmed', 'pending'] }
        },
        transaction: t
      });

      if (existingAssignment) {
        throw new GuardError('ALREADY_REGISTERED', 'Déjà inscrit à cette garde');
      }

      // 4. Vérifier les permissions (hiérarchie)
      const assignerUser = await this.User.findByPk(assignedBy, { transaction: t });
      const targetUser = await this.User.findByPk(memberId, { transaction: t });

      if (!assignerUser || !targetUser) {
        throw new GuardError('USER_NOT_FOUND', 'Utilisateur non trouvé');
      }

      if (memberId !== assignedBy) {
        // Inscription par un autre - vérifier les droits
        const canAssign = this._canAssignOther(assignerUser, targetUser);
        if (!canAssign) {
          throw new GuardError('PERMISSION_DENIED', 'Vous ne pouvez pas inscrire cet utilisateur');
        }
      }

      // 5. Créer l'inscription
      const assignment = await this.GuardAssignment.create({
        guard_id: guardId,
        member_id: memberId,
        assigned_by_member_id: assignedBy,
        assignment_type: memberId === assignedBy ? 'voluntary' : 'assigned',
        status: 'confirmed',
        assigned_at: new Date(),
        confirmed_at: new Date()
      }, { transaction: t });

      // 6. Mettre à jour le compteur
      await guard.update({
        current_participants: guard.current_participants + 1,
        status: guard.current_participants + 1 >= guard.max_participants ? 'full' : 'open'
      }, { transaction: t });

      // 7. Retirer de la liste d'attente si présent
      await this.WaitingList.update(
        { status: 'assigned', assigned_at: new Date() },
        { where: { guard_id: guardId, member_id: memberId, status: 'waiting' }, transaction: t }
      );

      // 8. Logger
      await this._logGuardAction(guardId, memberId, 'register', {
        assignedBy,
        assignmentType: assignment.assignment_type
      }, t);

      return {
        assignment,
        guard: await this.Guard.findByPk(guardId, { transaction: t })
      };
    });
  }

  /**
   * Annule une inscription à une garde
   * @param {string} guardId
   * @param {number} memberId
   * @param {number} cancelledBy
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async cancel(guardId, memberId, cancelledBy, options = {}) {
    const { replacementMemberId, reason } = options;

    return this.sequelize.transaction({
      isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE
    }, async (t) => {
      // 1. Récupérer l'inscription
      const assignment = await this.GuardAssignment.findOne({
        where: {
          guard_id: guardId,
          member_id: memberId,
          status: 'confirmed'
        },
        transaction: t
      });

      if (!assignment) {
        throw new GuardError('ASSIGNMENT_NOT_FOUND', 'Inscription non trouvée');
      }

      // 2. Récupérer la garde
      const guard = await this.Guard.findByPk(guardId, {
        lock: t.LOCK.UPDATE,
        transaction: t
      });

      // 3. Déterminer le type d'annulation
      const cancellationType = this._getCancellationType(guard.guard_date, guard.start_time);

      // 4. Mettre à jour l'inscription
      await assignment.update({
        status: 'cancelled',
        cancelled_at: new Date(),
        cancellation_reason: reason,
        replacement_requested: !!replacementMemberId,
        replacement_member_id: replacementMemberId
      }, { transaction: t });

      // 5. Mettre à jour la garde
      await guard.update({
        current_participants: Math.max(0, guard.current_participants - 1),
        status: 'open'
      }, { transaction: t });

      // 6. Gérer le remplaçant si proposé
      if (replacementMemberId) {
        // Créer une proposition de remplacement avec délai de réponse
        const deadline = this._getReplacementDeadline(guard.guard_date, guard.start_time);
        
        await assignment.update({
          replacement_deadline: deadline
        }, { transaction: t });

        // TODO: Envoyer notification au remplaçant
        await this._notifyReplacement(replacementMemberId, guard, deadline);
      }

      // 7. Alerter selon le type d'annulation
      if (cancellationType === CANCELLATION_TYPES.LATE) {
        // Alerter les Platinum/Admin
        await this._alertLateCancel(guard, memberId);
      } else if (cancellationType === CANCELLATION_TYPES.ANTICIPATED) {
        // Alerter les Platinum
        await this._alertAnticipatedCancel(guard, memberId);
      }

      // 8. Logger
      await this._logGuardAction(guardId, memberId, 'cancel', {
        cancelledBy,
        cancellationType,
        replacementMemberId,
        reason
      }, t);

      return {
        cancellationType,
        replacementRequested: !!replacementMemberId,
        guard: await this.Guard.findByPk(guardId, { transaction: t })
      };
    });
  }

  // =========================================
  // LISTE D'ATTENTE
  // =========================================

  /**
   * Inscrit un membre en liste d'attente
   * @param {string} guardId
   * @param {number} memberId
   * @returns {Promise<Object>}
   */
  async addToWaitingList(guardId, memberId) {
    const guard = await this.Guard.findByPk(guardId);
    if (!guard) {
      throw new GuardError('GUARD_NOT_FOUND', 'Garde non trouvée');
    }

    // Vérifier si déjà inscrit ou en attente
    const existing = await this.WaitingList.findOne({
      where: {
        guard_id: guardId,
        member_id: memberId,
        status: 'waiting'
      }
    });

    if (existing) {
      throw new GuardError('ALREADY_WAITING', 'Déjà en liste d\'attente');
    }

    const existingAssignment = await this.GuardAssignment.findOne({
      where: {
        guard_id: guardId,
        member_id: memberId,
        status: 'confirmed'
      }
    });

    if (existingAssignment) {
      throw new GuardError('ALREADY_REGISTERED', 'Déjà inscrit à cette garde');
    }

    // Calculer la priorité (basée sur l'ordre d'arrivée pour l'instant)
    const count = await this.WaitingList.count({
      where: { guard_id: guardId, status: 'waiting' }
    });

    const waitingEntry = await this.WaitingList.create({
      guard_id: guardId,
      member_id: memberId,
      priority_score: count + 1,
      status: 'waiting'
    });

    await this._logGuardAction(guardId, memberId, 'waiting_list_add', {});

    return waitingEntry;
  }

  /**
   * Active automatiquement la liste d'attente à J-3
   * @param {string} guardId
   * @returns {Promise<Object[]>}
   */
  async activateWaitingList(guardId) {
    const guard = await this.Guard.findByPk(guardId);
    if (!guard) return [];

    // Vérifier qu'il reste des places
    const availableSlots = guard.max_participants - guard.current_participants;
    if (availableSlots <= 0) return [];

    // Récupérer les personnes en attente par priorité
    const waitingEntries = await this.WaitingList.findAll({
      where: {
        guard_id: guardId,
        status: 'waiting'
      },
      order: [['priority_score', 'ASC']],
      limit: availableSlots
    });

    const activated = [];

    for (const entry of waitingEntries) {
      try {
        // Inscrire automatiquement
        const result = await this.register(
          guardId,
          entry.member_id,
          entry.member_id, // Auto-inscription
          { fromWaitingList: true }
        );

        // Mettre à jour l'entrée de liste d'attente
        await entry.update({
          status: 'assigned',
          auto_assigned: true,
          assigned_at: new Date()
        });

        // Notifier le membre
        await this._notifyWaitingListActivation(entry.member_id, guard);

        activated.push(entry);
      } catch (err) {
        // Continuer avec les suivants si erreur
        console.error(`Erreur activation liste attente pour ${entry.member_id}:`, err);
      }
    }

    return activated;
  }

  /**
   * Récupère la liste d'attente d'une garde
   * @param {string} guardId
   * @param {Object} options
   * @returns {Promise<Object[]>}
   */
  async getWaitingList(guardId, options = {}) {
    const where = { guard_id: guardId };
    
    if (!options.includeAll) {
      where.status = 'waiting';
    }

    return this.WaitingList.findAll({
      where,
      order: [['priority_score', 'ASC']],
      include: options.includeUsers ? [{
        model: this.User,
        attributes: ['member_id', 'role', 'geo_id']
      }] : []
    });
  }

  // =========================================
  // MODIFICATION DE GARDES
  // =========================================

  /**
   * Met à jour une garde
   * @param {string} guardId
   * @param {Object} updates
   * @param {number} updatedBy
   * @returns {Promise<Object>}
   */
  async update(guardId, updates, updatedBy) {
    const guard = await this.Guard.findByPk(guardId);
    if (!guard) {
      throw new GuardError('GUARD_NOT_FOUND', 'Garde non trouvée');
    }

    const allowedFields = [
      'startTime', 'endTime', 'guardType', 'maxParticipants',
      'minParticipants', 'description', 'requirements', 'priority', 'status'
    ];

    const updateData = {};
    const oldValues = {};

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        const dbField = this._camelToSnake(field);
        oldValues[dbField] = guard[dbField];
        updateData[dbField] = updates[field];
      }
    }

    // Validation si changement d'heures
    if (updateData.start_time || updateData.end_time) {
      const startTime = updateData.start_time || guard.start_time;
      const endTime = updateData.end_time || guard.end_time;
      
      if (new Date(`2000-01-01T${startTime}`) >= new Date(`2000-01-01T${endTime}`)) {
        throw new GuardError('INVALID_TIME', 'L\'heure de fin doit être après l\'heure de début');
      }
    }

    // Vérifier si réduction du max_participants pose problème
    if (updateData.max_participants && updateData.max_participants < guard.current_participants) {
      throw new GuardError('INVALID_MAX', 'Le nombre maximum ne peut pas être inférieur aux inscrits actuels');
    }

    await guard.update(updateData);

    await this._logGuardAction(guardId, updatedBy, 'update', {
      changes: Object.keys(updateData),
      oldValues
    });

    return guard;
  }

  /**
   * Annule une garde entière
   * @param {string} guardId
   * @param {string} reason
   * @param {number} cancelledBy
   * @returns {Promise<void>}
   */
  async cancelGuard(guardId, reason, cancelledBy) {
    return this.sequelize.transaction(async (t) => {
      const guard = await this.Guard.findByPk(guardId, { transaction: t });
      if (!guard) {
        throw new GuardError('GUARD_NOT_FOUND', 'Garde non trouvée');
      }

      // Annuler toutes les inscriptions
      const assignments = await this.GuardAssignment.findAll({
        where: { guard_id: guardId, status: 'confirmed' },
        transaction: t
      });

      for (const assignment of assignments) {
        await assignment.update({
          status: 'cancelled',
          cancelled_at: new Date(),
          cancellation_reason: 'Garde annulée: ' + reason
        }, { transaction: t });

        // Notifier chaque inscrit
        await this._notifyGuardCancelled(assignment.member_id, guard, reason);
      }

      // Mettre à jour la garde
      await guard.update({
        status: 'cancelled',
        description: (guard.description || '') + `\n[ANNULÉE: ${reason}]`
      }, { transaction: t });

      await this._logGuardAction(guardId, cancelledBy, 'cancel_guard', {
        reason,
        affectedMembers: assignments.length
      }, t);
    });
  }

  // =========================================
  // SYNTHÈSE ET RAPPORTS
  // =========================================

  /**
   * Synthèse de couverture pour un geo_id
   * @param {string} geoId
   * @param {Date|string} startDate
   * @param {Date|string} endDate
   * @returns {Promise<Object>}
   */
  async getCoverageSummary(geoId, startDate, endDate) {
    const guards = await this.Guard.findAll({
      where: {
        geo_id: geoId,
        guard_date: { [Op.between]: [startDate, endDate] },
        deleted_at: null
      },
      attributes: ['guard_id', 'guard_date', 'start_time', 'end_time', 
                   'current_participants', 'min_participants', 'max_participants', 'status']
    });

    const summary = {
      total: guards.length,
      covered: 0,     // >= min_participants
      partial: 0,     // > 0 mais < min_participants
      empty: 0,       // 0 participant
      cancelled: 0,
      byDay: {}
    };

    guards.forEach(g => {
      const dayKey = g.guard_date.toISOString().split('T')[0];
      if (!summary.byDay[dayKey]) {
        summary.byDay[dayKey] = { total: 0, covered: 0, partial: 0, empty: 0 };
      }

      summary.byDay[dayKey].total++;

      if (g.status === 'cancelled') {
        summary.cancelled++;
      } else if (g.current_participants >= g.min_participants) {
        summary.covered++;
        summary.byDay[dayKey].covered++;
      } else if (g.current_participants > 0) {
        summary.partial++;
        summary.byDay[dayKey].partial++;
      } else {
        summary.empty++;
        summary.byDay[dayKey].empty++;
      }
    });

    summary.coverageRate = summary.total > 0 
      ? Math.round((summary.covered / summary.total) * 100) 
      : 0;

    return summary;
  }

  /**
   * Créneaux vides nécessitant attention
   * @param {string} geoId
   * @param {number} daysAhead
   * @returns {Promise<Object[]>}
   */
  async getEmptySlots(geoId, daysAhead = 14) {
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    return this.Guard.findAll({
      where: {
        geo_id: geoId,
        guard_date: { [Op.between]: [today, futureDate] },
        current_participants: 0,
        status: 'open',
        deleted_at: null
      },
      order: [['guard_date', 'ASC'], ['start_time', 'ASC']]
    });
  }

  // =========================================
  // MÉTHODES PRIVÉES
  // =========================================

  /**
   * Vérifie le chevauchement avec des gardes existantes
   */
  async _checkOverlap(geoId, date, startTime, endTime, excludeGuardId = null) {
    const where = {
      geo_id: geoId,
      guard_date: date,
      status: { [Op.ne]: 'cancelled' },
      deleted_at: null,
      [Op.or]: [
        // Nouveau créneau commence pendant un existant
        {
          start_time: { [Op.lte]: startTime },
          end_time: { [Op.gt]: startTime }
        },
        // Nouveau créneau finit pendant un existant
        {
          start_time: { [Op.lt]: endTime },
          end_time: { [Op.gte]: endTime }
        },
        // Nouveau créneau englobe un existant
        {
          start_time: { [Op.gte]: startTime },
          end_time: { [Op.lte]: endTime }
        }
      ]
    };

    if (excludeGuardId) {
      where.guard_id = { [Op.ne]: excludeGuardId };
    }

    const overlap = await this.Guard.findOne({ where });
    return overlap;
  }

  /**
   * Détermine le type d'annulation selon le délai
   */
  _getCancellationType(guardDate, guardTime) {
    const guardDateTime = new Date(`${guardDate}T${guardTime}`);
    const now = new Date();
    const hoursUntil = (guardDateTime - now) / (1000 * 60 * 60);

    if (hoursUntil < 72) {
      return CANCELLATION_TYPES.LATE;
    } else if (hoursUntil < 168) { // 7 jours
      return CANCELLATION_TYPES.ANTICIPATED;
    }
    return CANCELLATION_TYPES.NORMAL;
  }

  /**
   * Calcule le délai de réponse pour un remplaçant
   */
  _getReplacementDeadline(guardDate, guardTime) {
    const guardDateTime = new Date(`${guardDate}T${guardTime}`);
    const now = new Date();
    const hoursUntil = (guardDateTime - now) / (1000 * 60 * 60);

    // Si moins de 12h avant la garde, 1h de délai
    // Sinon, 4h de délai
    const delayHours = hoursUntil < 12 ? 1 : 4;
    
    return new Date(now.getTime() + delayHours * 60 * 60 * 1000);
  }

  /**
   * Vérifie si un utilisateur peut inscrire un autre
   */
  _canAssignOther(assigner, target) {
    const roleHierarchy = {
      'Admin_N1': 5,
      'Admin': 4,
      'Platinum': 3,
      'Gold': 2,
      'Silver': 1
    };

    // Silver ne peut inscrire que lui-même
    if (assigner.role === 'Silver') return false;

    // Gold peut inscrire les membres de son groupe
    if (assigner.role === 'Gold') {
      return target.group_id === assigner.group_id;
    }

    // Platinum peut inscrire tous les membres de son geo_id
    if (assigner.role === 'Platinum') {
      return target.geo_id === assigner.geo_id;
    }

    // Admin peut inscrire tous les membres du serveur
    return roleHierarchy[assigner.role] >= 4;
  }

  /**
   * Formate une garde avec son statut de couverture
   */
  _formatGuardWithStatus(guard) {
    const data = guard.toJSON ? guard.toJSON() : { ...guard };
    
    // Couleur selon couverture (V7.0 Section 4.1.7)
    if (data.status === 'cancelled') {
      data.coverageStatus = 'grey';
    } else if (data.current_participants >= data.max_participants) {
      data.coverageStatus = 'green';
    } else if (data.current_participants >= data.min_participants) {
      data.coverageStatus = 'green';
    } else if (data.current_participants > 0) {
      data.coverageStatus = 'orange';
    } else {
      data.coverageStatus = 'red';
    }

    return data;
  }

  /**
   * Convertit camelCase en snake_case
   */
  _camelToSnake(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  /**
   * Log une action de garde
   */
  async _logGuardAction(guardId, memberId, action, details = {}, transaction = null) {
    try {
      await this.GuardLog.create({
        guard_id: guardId,
        member_id: memberId,
        action,
        details,
        notification_sent: false
      }, { transaction });
    } catch (err) {
      console.error('Erreur guard log:', err);
    }
  }

  // Méthodes de notification (à implémenter avec NotificationService)
  async _notifyReplacement(memberId, guard, deadline) {
    // TODO: Implémenter avec NotificationService
  }

  async _notifyWaitingListActivation(memberId, guard) {
    // TODO: Implémenter avec NotificationService
  }

  async _notifyGuardCancelled(memberId, guard, reason) {
    // TODO: Implémenter avec NotificationService
  }

  async _alertLateCancel(guard, memberId) {
    // TODO: Alerter Platinum/Admin
  }

  async _alertAnticipatedCancel(guard, memberId) {
    // TODO: Alerter Platinum
  }
}

/**
 * Classe d'erreur pour les gardes
 */
class GuardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GuardError';
    this.code = code;
    this.statusCode = this._getStatusCode(code);
  }

  _getStatusCode(code) {
    const codes = {
      GUARD_NOT_FOUND: 404,
      SCENARIO_NOT_FOUND: 404,
      ASSIGNMENT_NOT_FOUND: 404,
      USER_NOT_FOUND: 404,
      GUARD_CLOSED: 400,
      GUARD_FULL: 409,
      ALREADY_REGISTERED: 409,
      ALREADY_WAITING: 409,
      OVERLAP: 409,
      INVALID_TIME: 400,
      INVALID_MAX: 400,
      PERMISSION_DENIED: 403
    };
    return codes[code] || 500;
  }
}

module.exports = GuardService;
module.exports.GuardError = GuardError;
module.exports.CANCELLATION_TYPES = CANCELLATION_TYPES;
