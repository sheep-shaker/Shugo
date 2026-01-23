// routes/backup.js
// Route: /api/v1/backup/*
// Description: Gestion des sauvegardes et restaurations

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validateRequest } = require('../middleware/validateRequest');
const { rateLimiter } = require('../middleware/rateLimiter');
const { auditLog } = require('../middleware/audit');
const { require2FA } = require('../middleware/auth2FA');
const BackupService = require('../services/BackupService');
const Joi = require('joi');

// Validation schemas
const schemas = {
  createBackup: Joi.object({
    backup_type: Joi.string().valid('full', 'incremental', 'differential').default('full'),
    frequency: Joi.string().valid('manual', 'daily', 'weekly', 'monthly').default('manual'),
    components: Joi.array().items(
      Joi.string().valid('database', 'vault', 'files', 'logs', 'configs')
    ).default(['database', 'vault', 'files']),
    encryption_enabled: Joi.boolean().default(true),
    compression_enabled: Joi.boolean().default(true),
    retention_days: Joi.number().integer().min(1).max(3650).default(90),
    storage_locations: Joi.array().items(
      Joi.string().valid('local', 's3', 'azure', 'gcp', 'offsite')
    ).min(1).default(['local']),
    notification_emails: Joi.array().items(Joi.string().email()),
    description: Joi.string().max(500)
  }),

  scheduleBackup: Joi.object({
    schedule_type: Joi.string().valid('once', 'recurring').required(),
    start_time: Joi.date().iso().required(),
    end_time: Joi.date().iso().when('schedule_type', {
      is: 'recurring',
      then: Joi.optional(),
      otherwise: Joi.forbidden()
    }),
    recurrence_pattern: Joi.when('schedule_type', {
      is: 'recurring',
      then: Joi.object({
        frequency: Joi.string().valid('daily', 'weekly', 'monthly').required(),
        days_of_week: Joi.array().items(Joi.number().min(0).max(6)),
        day_of_month: Joi.number().min(1).max(31),
        time: Joi.string().pattern(/^\d{2}:\d{2}$/).required()
      }).required(),
      otherwise: Joi.forbidden()
    }),
    backup_config: Joi.object().required()
  }),

  restoreBackup: Joi.object({
    backup_id: Joi.string().uuid().required(),
    restore_type: Joi.string().valid('full', 'selective').default('full'),
    components: Joi.array().items(
      Joi.string().valid('database', 'vault', 'files', 'logs', 'configs')
    ),
    target_environment: Joi.string().valid('current', 'test', 'new').default('current'),
    verify_integrity: Joi.boolean().default(true),
    dry_run: Joi.boolean().default(false),
    restore_point: Joi.date().iso(),
    confirmation_code: Joi.string().required()
  })
};

// GET /api/v1/backup/jobs - Liste les jobs de sauvegarde
router.get(
  '/jobs',
  authenticate,
  authorize(['admin', 'operator']),
  rateLimiter('backup:list'),
  async (req, res, next) => {
    try {
      const {
        status,
        backup_type,
        frequency,
        date_from,
        date_to,
        page = 1,
        limit = 20
      } = req.query;

      const jobs = await BackupService.listBackupJobs({
        filters: { status, backup_type, frequency, date_from, date_to },
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: jobs.data,
        meta: {
          total: jobs.total,
          page: jobs.page,
          pages: jobs.pages,
          limit: jobs.limit,
          storage_used: jobs.storage_used,
          next_scheduled: jobs.next_scheduled
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/backup/jobs/:id - Détails d'un job de sauvegarde
router.get(
  '/jobs/:id',
  authenticate,
  authorize(['admin', 'operator']),
  rateLimiter('backup:read'),
  async (req, res, next) => {
    try {
      const job = await BackupService.getBackupJob({
        job_id: req.params.id,
        include_files: req.query.include_files === 'true',
        include_logs: req.query.include_logs === 'true'
      });

      if (!job) {
        return res.status(404).json({
          success: false,
          error: { code: 'SHUGO-404', message: 'Job de sauvegarde non trouvé' }
        });
      }

      res.json({
        success: true,
        data: job
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/backup/create - Crée une sauvegarde manuelle
router.post(
  '/create',
  authenticate,
  authorize(['admin']),
  require2FA,
  validateRequest(schemas.createBackup),
  rateLimiter('backup:create'),
  auditLog('backup.create'),
  async (req, res, next) => {
    try {
      const backup = await BackupService.createBackup({
        ...req.body,
        initiated_by: req.user.member_id
      });

      res.status(202).json({
        success: true,
        data: backup,
        message: 'Sauvegarde initiée. Vous serez notifié à la fin du processus.'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/backup/schedule - Programme une sauvegarde
router.post(
  '/schedule',
  authenticate,
  authorize(['admin']),
  validateRequest(schemas.scheduleBackup),
  rateLimiter('backup:schedule'),
  auditLog('backup.schedule'),
  async (req, res, next) => {
    try {
      const schedule = await BackupService.scheduleBackup({
        ...req.body,
        scheduled_by: req.user.member_id
      });

      res.json({
        success: true,
        data: schedule,
        message: 'Sauvegarde programmée avec succès'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/backup/restore - Restaure depuis une sauvegarde
router.post(
  '/restore',
  authenticate,
  authorize(['admin']),
  require2FA,
  validateRequest(schemas.restoreBackup),
  rateLimiter('backup:restore'),
  auditLog('backup.restore'),
  async (req, res, next) => {
    try {
      const restore = await BackupService.restoreBackup({
        ...req.body,
        initiated_by: req.user.member_id
      });

      const message = req.body.dry_run 
        ? 'Simulation de restauration terminée avec succès'
        : 'Restauration initiée. Le système sera indisponible pendant la restauration.';

      res.status(202).json({
        success: true,
        data: restore,
        message
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/backup/jobs/:id - Supprime un job de sauvegarde
router.delete(
  '/jobs/:id',
  authenticate,
  authorize(['admin']),
  rateLimiter('backup:delete'),
  auditLog('backup.delete'),
  async (req, res, next) => {
    try {
      await BackupService.deleteBackup({
        job_id: req.params.id,
        deleted_by: req.user.member_id,
        keep_files: req.query.keep_files === 'true'
      });

      res.json({
        success: true,
        message: 'Job de sauvegarde supprimé'
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/backup/verify/:id - Vérifie l'intégrité d'une sauvegarde
router.post(
  '/verify/:id',
  authenticate,
  authorize(['admin', 'operator']),
  rateLimiter('backup:verify'),
  auditLog('backup.verify'),
  async (req, res, next) => {
    try {
      const result = await BackupService.verifyBackup({
        job_id: req.params.id,
        deep_check: req.body.deep_check === true
      });

      res.json({
        success: true,
        data: result,
        message: result.valid ? 
          'Intégrité de la sauvegarde confirmée' : 
          'ALERTE : Problèmes d\'intégrité détectés'
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/backup/storage - État du stockage
router.get(
  '/storage',
  authenticate,
  authorize(['admin', 'operator']),
  rateLimiter('backup:storage'),
  async (req, res, next) => {
    try {
      const storage = await BackupService.getStorageStatus();

      res.json({
        success: true,
        data: storage
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/backup/cleanup - Nettoyage des anciennes sauvegardes
router.post(
  '/cleanup',
  authenticate,
  authorize(['admin']),
  rateLimiter('backup:cleanup'),
  auditLog('backup.cleanup'),
  async (req, res, next) => {
    try {
      const { 
        older_than_days = 90,
        keep_minimum = 3,
        dry_run = true 
      } = req.body;

      const result = await BackupService.cleanupOldBackups({
        older_than_days,
        keep_minimum,
        dry_run,
        initiated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: result,
        message: dry_run 
          ? `Simulation : ${result.would_delete} sauvegardes seraient supprimées`
          : `${result.deleted} sauvegardes supprimées, ${result.space_freed} libérés`
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/backup/restore-points - Points de restauration disponibles
router.get(
  '/restore-points',
  authenticate,
  authorize(['admin', 'operator']),
  rateLimiter('backup:restorePoints'),
  async (req, res, next) => {
    try {
      const { 
        component,
        date_from,
        date_to,
        include_incremental = 'false'
      } = req.query;

      const restorePoints = await BackupService.getRestorePoints({
        component,
        date_from,
        date_to,
        include_incremental: include_incremental === 'true'
      });

      res.json({
        success: true,
        data: restorePoints
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/backup/schedules - Sauvegardes programmées
router.get(
  '/schedules',
  authenticate,
  authorize(['admin', 'operator']),
  rateLimiter('backup:schedules'),
  async (req, res, next) => {
    try {
      const schedules = await BackupService.getSchedules({
        active_only: req.query.active_only !== 'false'
      });

      res.json({
        success: true,
        data: schedules
      });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/v1/backup/schedules/:id - Modifie une programmation
router.patch(
  '/schedules/:id',
  authenticate,
  authorize(['admin']),
  rateLimiter('backup:updateSchedule'),
  auditLog('backup.updateSchedule'),
  async (req, res, next) => {
    try {
      const schedule = await BackupService.updateSchedule({
        schedule_id: req.params.id,
        updates: req.body,
        updated_by: req.user.member_id
      });

      res.json({
        success: true,
        data: schedule,
        message: 'Programmation mise à jour'
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/backup/schedules/:id - Supprime une programmation
router.delete(
  '/schedules/:id',
  authenticate,
  authorize(['admin']),
  rateLimiter('backup:deleteSchedule'),
  auditLog('backup.deleteSchedule'),
  async (req, res, next) => {
    try {
      await BackupService.deleteSchedule({
        schedule_id: req.params.id,
        deleted_by: req.user.member_id
      });

      res.json({
        success: true,
        message: 'Programmation supprimée'
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
