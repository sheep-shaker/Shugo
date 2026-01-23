'use strict';

/**
 * SHUGO Local Server - Notification Service
 * Gestion des notifications locales et rappels de garde
 */

const cron = require('node-cron');
const logger = require('../utils/logger');
const { LocalNotification, LocalUser, LocalGuard, LocalAssignment } = require('../models');
const { Op } = require('sequelize');

class NotificationService {
  constructor(config, eventBus) {
    this.config = config;
    this.eventBus = eventBus;
    this.jobs = [];
  }

  /**
   * Initialize notification service
   */
  async initialize() {
    // Schedule reminder jobs
    this.scheduleGuardReminders();
    this.scheduleUnreadCleanup();

    // Subscribe to events
    this.subscribeToEvents();

    logger.info('NotificationService initialized');
  }

  /**
   * Create a notification
   */
  async create(memberId, type, title, message, options = {}) {
    try {
      const notification = await LocalNotification.create({
        member_id: memberId,
        type,
        title,
        message,
        priority: options.priority || 'normal',
        data: options.data ? JSON.stringify(options.data) : null,
        expires_at: options.expiresAt || null
      });

      logger.debug('Notification created', {
        notification_id: notification.notification_id,
        member_id: memberId,
        type
      });

      // Emit event for real-time delivery
      this.eventBus.emit('notification.created', {
        notification,
        memberId
      });

      return notification;

    } catch (error) {
      logger.error('Failed to create notification:', error);
      throw error;
    }
  }

  /**
   * Create notifications for multiple users
   */
  async createBulk(memberIds, type, title, message, options = {}) {
    const notifications = [];

    for (const memberId of memberIds) {
      try {
        const notification = await this.create(memberId, type, title, message, options);
        notifications.push(notification);
      } catch (error) {
        logger.error(`Failed to create notification for ${memberId}:`, error);
      }
    }

    return notifications;
  }

  /**
   * Get notifications for a user
   */
  async getForUser(memberId, options = {}) {
    const where = { member_id: memberId };

    if (options.unreadOnly) {
      where.read_at = null;
    }

    if (options.type) {
      where.type = options.type;
    }

    // Exclude expired
    where[Op.or] = [
      { expires_at: null },
      { expires_at: { [Op.gt]: new Date() } }
    ];

    return await LocalNotification.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit: options.limit || 50
    });
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId, memberId) {
    const notification = await LocalNotification.findOne({
      where: {
        notification_id: notificationId,
        member_id: memberId
      }
    });

    if (!notification) {
      throw new Error('Notification not found');
    }

    notification.read_at = new Date();
    await notification.save();

    return notification;
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(memberId) {
    await LocalNotification.update(
      { read_at: new Date() },
      {
        where: {
          member_id: memberId,
          read_at: null
        }
      }
    );
  }

  /**
   * Dismiss notification
   */
  async dismiss(notificationId, memberId) {
    const notification = await LocalNotification.findOne({
      where: {
        notification_id: notificationId,
        member_id: memberId
      }
    });

    if (!notification) {
      throw new Error('Notification not found');
    }

    notification.dismissed_at = new Date();
    await notification.save();

    return notification;
  }

  /**
   * Get unread count for user
   */
  async getUnreadCount(memberId) {
    return await LocalNotification.count({
      where: {
        member_id: memberId,
        read_at: null,
        dismissed_at: null,
        [Op.or]: [
          { expires_at: null },
          { expires_at: { [Op.gt]: new Date() } }
        ]
      }
    });
  }

  /**
   * Schedule guard reminders (Mon/Thu/Sat at 9 AM)
   */
  scheduleGuardReminders() {
    // Reminder for upcoming guards
    const reminderJob = cron.schedule('0 9 * * 1,4,6', async () => {
      try {
        await this.sendGuardReminders();
      } catch (error) {
        logger.error('Guard reminder job failed:', error);
      }
    });

    this.jobs.push(reminderJob);
    logger.info('Guard reminders scheduled for Mon/Thu/Sat at 9 AM');
  }

  /**
   * Send reminders for upcoming guards
   */
  async sendGuardReminders() {
    const now = new Date();
    const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    // Find assignments for guards in the next 48 hours
    const upcomingAssignments = await LocalAssignment.findAll({
      where: {
        status: 'confirmed'
      },
      include: [{
        model: LocalGuard,
        as: 'guard',
        where: {
          start_date: {
            [Op.between]: [now, in48Hours]
          },
          status: 'active'
        }
      }]
    });

    for (const assignment of upcomingAssignments) {
      const guard = assignment.guard;
      const hoursUntil = Math.round((new Date(guard.start_date) - now) / (60 * 60 * 1000));

      await this.create(
        assignment.member_id,
        'guard_reminder',
        'Rappel de garde',
        `Vous avez une garde "${guard.title}" dans ${hoursUntil} heures`,
        {
          priority: hoursUntil <= 24 ? 'high' : 'normal',
          data: {
            guard_id: guard.guard_id,
            start_date: guard.start_date,
            location: guard.location
          },
          expiresAt: guard.start_date
        }
      );
    }

    logger.info(`Sent ${upcomingAssignments.length} guard reminders`);
  }

  /**
   * Schedule cleanup of old notifications
   */
  scheduleUnreadCleanup() {
    // Run daily at 2 AM
    const cleanupJob = cron.schedule('0 2 * * *', async () => {
      try {
        await this.cleanupOldNotifications();
      } catch (error) {
        logger.error('Notification cleanup job failed:', error);
      }
    });

    this.jobs.push(cleanupJob);
  }

  /**
   * Cleanup old and expired notifications
   */
  async cleanupOldNotifications() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Delete old read notifications
    const deletedRead = await LocalNotification.destroy({
      where: {
        read_at: { [Op.lt]: thirtyDaysAgo }
      }
    });

    // Delete expired notifications
    const deletedExpired = await LocalNotification.destroy({
      where: {
        expires_at: { [Op.lt]: new Date() }
      }
    });

    logger.info('Notification cleanup completed', {
      deletedRead,
      deletedExpired
    });
  }

  /**
   * Subscribe to system events
   */
  subscribeToEvents() {
    // Assignment created
    this.eventBus.on('assignment.created', async (event) => {
      const { assignment, guard } = event.data;

      await this.create(
        assignment.member_id,
        'assignment',
        'Nouvelle assignation',
        `Vous avez été assigné à la garde "${guard.title}"`,
        {
          priority: 'high',
          data: { guard_id: guard.guard_id, assignment_id: assignment.assignment_id }
        }
      );
    });

    // Guard updated
    this.eventBus.on('guard.updated', async (event) => {
      const { guard, changes } = event.data;

      // Get all assigned users
      const assignments = await LocalAssignment.findAll({
        where: { guard_id: guard.guard_id, status: 'confirmed' }
      });

      const memberIds = assignments.map(a => a.member_id);

      if (memberIds.length > 0) {
        await this.createBulk(
          memberIds,
          'guard_update',
          'Garde modifiée',
          `La garde "${guard.title}" a été mise à jour`,
          {
            data: { guard_id: guard.guard_id, changes }
          }
        );
      }
    });

    // Guard cancelled
    this.eventBus.on('guard.cancelled', async (event) => {
      const { guard } = event.data;

      const assignments = await LocalAssignment.findAll({
        where: { guard_id: guard.guard_id }
      });

      const memberIds = assignments.map(a => a.member_id);

      if (memberIds.length > 0) {
        await this.createBulk(
          memberIds,
          'guard_cancelled',
          'Garde annulée',
          `La garde "${guard.title}" a été annulée`,
          {
            priority: 'urgent',
            data: { guard_id: guard.guard_id }
          }
        );
      }
    });

    // Sync status changes
    this.eventBus.on('sync.offline', async () => {
      // Notify admins
      const admins = await LocalUser.findAll({
        where: { role: { [Op.in]: ['admin', 'manager'] } }
      });

      for (const admin of admins) {
        await this.create(
          admin.member_id,
          'system',
          'Mode hors ligne',
          'La connexion au serveur central a été perdue',
          { priority: 'high' }
        );
      }
    });

    this.eventBus.on('sync.online', async () => {
      const admins = await LocalUser.findAll({
        where: { role: { [Op.in]: ['admin', 'manager'] } }
      });

      for (const admin of admins) {
        await this.create(
          admin.member_id,
          'system',
          'Connexion rétablie',
          'La connexion au serveur central a été rétablie',
          { priority: 'normal' }
        );
      }
    });
  }

  /**
   * Stop notification service
   */
  stop() {
    for (const job of this.jobs) {
      job.stop();
    }
    this.jobs = [];
    logger.info('NotificationService stopped');
  }
}

module.exports = NotificationService;
