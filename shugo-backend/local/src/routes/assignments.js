'use strict';

/**
 * SHUGO Local Server - Routes Assignments
 * Gestion des assignations de gardes localement
 */

const express = require('express');
const router = express.Router();
const { LocalAssignment, LocalGuard, LocalUser } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * GET /api/local/assignments
 * Liste des assignations locales
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { guard_id, member_id, status, from_date, to_date } = req.query;

    const where = {};
    if (guard_id) where.guard_id = guard_id;
    if (member_id) where.member_id = member_id;
    if (status) where.status = status;

    const assignments = await LocalAssignment.findAll({
      where,
      include: [
        { model: LocalGuard, as: 'guard', attributes: ['guard_id', 'title', 'start_date', 'end_date'] },
        { model: LocalUser, as: 'user', attributes: ['member_id', 'phonetic_id', 'role'] }
      ],
      order: [['assigned_at', 'DESC']],
      limit: parseInt(req.query.limit) || 100
    });

    res.json({
      success: true,
      data: assignments,
      count: assignments.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/local/assignments/:id
 * Détail d'une assignation
 */
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const assignment = await LocalAssignment.findByPk(req.params.id, {
      include: [
        { model: LocalGuard, as: 'guard' },
        { model: LocalUser, as: 'user' }
      ]
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        error: 'Assignment not found'
      });
    }

    res.json({
      success: true,
      data: assignment
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/local/assignments
 * Créer une assignation locale
 */
router.post('/', authenticate, authorize(['admin', 'manager', 'leader']), async (req, res, next) => {
  try {
    const { guard_id, member_id, slot_number, notes } = req.body;

    // Vérifier que la garde existe
    const guard = await LocalGuard.findByPk(guard_id);
    if (!guard) {
      return res.status(404).json({
        success: false,
        error: 'Guard not found'
      });
    }

    // Vérifier que l'utilisateur existe
    const user = await LocalUser.findByPk(member_id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Vérifier si déjà assigné
    const existing = await LocalAssignment.findOne({
      where: { guard_id, member_id }
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'User already assigned to this guard'
      });
    }

    // Vérifier les slots disponibles
    if (guard.slots_filled >= guard.slots_required) {
      return res.status(400).json({
        success: false,
        error: 'No slots available for this guard'
      });
    }

    // Créer l'assignation
    const assignment = await LocalAssignment.create({
      guard_id,
      member_id,
      slot_number: slot_number || guard.slots_filled + 1,
      status: 'confirmed',
      assigned_by_member_id: req.user.member_id,
      notes
    });

    // Mettre à jour le compteur de slots
    await guard.increment('slots_filled');

    logger.info('Assignment created locally', {
      assignment_id: assignment.assignment_id,
      guard_id,
      member_id,
      assigned_by: req.user.member_id
    });

    res.status(201).json({
      success: true,
      data: assignment
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/local/assignments/:id
 * Modifier une assignation
 */
router.put('/:id', authenticate, authorize(['admin', 'manager', 'leader']), async (req, res, next) => {
  try {
    const assignment = await LocalAssignment.findByPk(req.params.id);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        error: 'Assignment not found'
      });
    }

    const { status, notes, slot_number } = req.body;

    await assignment.update({
      status: status || assignment.status,
      notes: notes !== undefined ? notes : assignment.notes,
      slot_number: slot_number || assignment.slot_number
    });

    logger.info('Assignment updated locally', {
      assignment_id: assignment.assignment_id,
      updated_by: req.user.member_id
    });

    res.json({
      success: true,
      data: assignment
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/local/assignments/:id/check-in
 * Pointage d'arrivée
 */
router.post('/:id/check-in', authenticate, async (req, res, next) => {
  try {
    const assignment = await LocalAssignment.findByPk(req.params.id);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        error: 'Assignment not found'
      });
    }

    // Vérifier que c'est l'utilisateur assigné ou un admin
    if (assignment.member_id !== req.user.member_id &&
        !['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to check-in for this assignment'
      });
    }

    if (assignment.check_in_at) {
      return res.status(400).json({
        success: false,
        error: 'Already checked in'
      });
    }

    await assignment.update({
      check_in_at: new Date(),
      status: 'in_progress'
    });

    logger.info('Check-in recorded', {
      assignment_id: assignment.assignment_id,
      member_id: assignment.member_id
    });

    res.json({
      success: true,
      data: assignment,
      message: 'Check-in recorded successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/local/assignments/:id/check-out
 * Pointage de départ
 */
router.post('/:id/check-out', authenticate, async (req, res, next) => {
  try {
    const assignment = await LocalAssignment.findByPk(req.params.id);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        error: 'Assignment not found'
      });
    }

    // Vérifier que c'est l'utilisateur assigné ou un admin
    if (assignment.member_id !== req.user.member_id &&
        !['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to check-out for this assignment'
      });
    }

    if (!assignment.check_in_at) {
      return res.status(400).json({
        success: false,
        error: 'Must check-in first'
      });
    }

    if (assignment.check_out_at) {
      return res.status(400).json({
        success: false,
        error: 'Already checked out'
      });
    }

    await assignment.update({
      check_out_at: new Date(),
      status: 'completed'
    });

    logger.info('Check-out recorded', {
      assignment_id: assignment.assignment_id,
      member_id: assignment.member_id
    });

    res.json({
      success: true,
      data: assignment,
      message: 'Check-out recorded successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/local/assignments/:id
 * Annuler une assignation
 */
router.delete('/:id', authenticate, authorize(['admin', 'manager', 'leader']), async (req, res, next) => {
  try {
    const assignment = await LocalAssignment.findByPk(req.params.id);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        error: 'Assignment not found'
      });
    }

    const guard = await LocalGuard.findByPk(assignment.guard_id);

    // Soft delete
    await assignment.update({ status: 'cancelled' });
    await assignment.destroy();

    // Décrémenter le compteur de slots
    if (guard && guard.slots_filled > 0) {
      await guard.decrement('slots_filled');
    }

    logger.info('Assignment cancelled locally', {
      assignment_id: assignment.assignment_id,
      cancelled_by: req.user.member_id
    });

    res.json({
      success: true,
      message: 'Assignment cancelled successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/local/assignments/my
 * Mes assignations
 */
router.get('/my/list', authenticate, async (req, res, next) => {
  try {
    const { status, upcoming } = req.query;

    const where = { member_id: req.user.member_id };
    if (status) where.status = status;

    const include = [{
      model: LocalGuard,
      as: 'guard',
      where: upcoming === 'true' ? {
        start_date: { [require('sequelize').Op.gte]: new Date() }
      } : undefined
    }];

    const assignments = await LocalAssignment.findAll({
      where,
      include,
      order: [[{ model: LocalGuard, as: 'guard' }, 'start_date', 'ASC']]
    });

    res.json({
      success: true,
      data: assignments,
      count: assignments.length
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
