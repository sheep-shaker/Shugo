'use strict';

/**
 * SHUGO Local Server - Routes Notifications
 * Gestion des notifications locales
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

// NotificationService sera injecté via app.locals
const getNotificationService = (req) => req.app.locals.notificationService;

/**
 * GET /api/local/notifications
 * Liste des notifications de l'utilisateur
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { unread_only, type, limit } = req.query;
    const notificationService = getNotificationService(req);

    const notifications = await notificationService.getForUser(req.user.member_id, {
      unreadOnly: unread_only === 'true',
      type,
      limit: parseInt(limit) || 50
    });

    res.json({
      success: true,
      data: notifications,
      count: notifications.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/local/notifications/unread-count
 * Nombre de notifications non lues
 */
router.get('/unread-count', authenticate, async (req, res, next) => {
  try {
    const notificationService = getNotificationService(req);
    const count = await notificationService.getUnreadCount(req.user.member_id);

    res.json({
      success: true,
      count
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/local/notifications/:id/read
 * Marquer une notification comme lue
 */
router.post('/:id/read', authenticate, async (req, res, next) => {
  try {
    const notificationService = getNotificationService(req);
    const notification = await notificationService.markAsRead(
      req.params.id,
      req.user.member_id
    );

    res.json({
      success: true,
      data: notification
    });
  } catch (error) {
    if (error.message === 'Notification not found') {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }
    next(error);
  }
});

/**
 * POST /api/local/notifications/read-all
 * Marquer toutes les notifications comme lues
 */
router.post('/read-all', authenticate, async (req, res, next) => {
  try {
    const notificationService = getNotificationService(req);
    await notificationService.markAllAsRead(req.user.member_id);

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/local/notifications/:id/dismiss
 * Rejeter une notification
 */
router.post('/:id/dismiss', authenticate, async (req, res, next) => {
  try {
    const notificationService = getNotificationService(req);
    const notification = await notificationService.dismiss(
      req.params.id,
      req.user.member_id
    );

    res.json({
      success: true,
      data: notification
    });
  } catch (error) {
    if (error.message === 'Notification not found') {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }
    next(error);
  }
});

module.exports = router;
