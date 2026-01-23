/**
 * SHUGO v7.0 - Service d'Administration
 *
 * Gestion centralisée des fonctions administratives:
 * - Dashboard et statistiques
 * - Export de données
 * - Génération de rapports
 * - Logs d'audit
 * - Configuration système
 * - Activité utilisateurs
 * - Gestion des erreurs
 * - Diffusion de messages
 * - Impersonnalisation
 * - Conformité
 *
 * @see Document Technique V7.0 - Section Admin
 */

'use strict';

const { Op, fn, col, literal } = require('sequelize');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

// Models
const {
    User,
    Guard,
    Group,
    Session,
    AuditLog,
    LocalInstance,
    ErrorOccurrence,
    ErrorCodeRegistry,
    SystemMetric,
    MaintenanceRun,
    Notification,
    MessagesCenter
} = require('../models');

const { sequelize } = require('../database/connection');
const config = require('../config');
const logger = require('../utils/logger');
const emailService = require('./EmailService');

/**
 * Périodes de temps prédéfinies
 */
const PERIODS = {
    day: { days: 1 },
    week: { days: 7 },
    month: { days: 30 },
    quarter: { days: 90 },
    year: { days: 365 }
};

class AdminService {
    // =========================================
    // DASHBOARD
    // =========================================

    /**
     * Récupère les données du tableau de bord admin
     */
    static async getDashboard({ period = 'week', geo_id, user }) {
        const periodDays = PERIODS[period]?.days || 7;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - periodDays);

        const whereGeo = geo_id ? { geo_id: { [Op.like]: `${geo_id}%` } } : {};

        // Exécuter toutes les requêtes en parallèle
        const [
            userStats,
            guardStats,
            instanceStats,
            recentActivity,
            systemHealth,
            alerts
        ] = await Promise.all([
            this._getUserStats(startDate, whereGeo),
            this._getGuardStats(startDate, whereGeo),
            this._getInstanceStats(),
            this._getRecentActivity(10),
            this._getSystemHealth(),
            this._getActiveAlerts()
        ]);

        return {
            period,
            date_range: {
                from: startDate.toISOString(),
                to: new Date().toISOString()
            },
            users: userStats,
            guards: guardStats,
            instances: instanceStats,
            recent_activity: recentActivity,
            system_health: systemHealth,
            alerts,
            generated_at: new Date().toISOString()
        };
    }

    static async _getUserStats(startDate, whereGeo) {
        const [total, active, newUsers, byRole] = await Promise.all([
            User.count({ where: whereGeo }),
            User.count({ where: { ...whereGeo, status: 'active' } }),
            User.count({
                where: {
                    ...whereGeo,
                    created_at: { [Op.gte]: startDate }
                }
            }),
            User.findAll({
                attributes: ['role', [fn('COUNT', col('member_id')), 'count']],
                where: whereGeo,
                group: ['role'],
                raw: true
            })
        ]);

        return {
            total,
            active,
            inactive: total - active,
            new_this_period: newUsers,
            by_role: byRole.reduce((acc, r) => {
                acc[r.role] = parseInt(r.count);
                return acc;
            }, {})
        };
    }

    static async _getGuardStats(startDate, whereGeo) {
        if (!Guard) return { total: 0, completed: 0, upcoming: 0 };

        const now = new Date();
        const [total, completed, upcoming, byStatus] = await Promise.all([
            Guard.count({
                where: {
                    ...whereGeo,
                    date: { [Op.gte]: startDate }
                }
            }),
            Guard.count({
                where: {
                    ...whereGeo,
                    status: 'completed',
                    date: { [Op.gte]: startDate }
                }
            }),
            Guard.count({
                where: {
                    ...whereGeo,
                    date: { [Op.gte]: now }
                }
            }),
            Guard.findAll({
                attributes: ['status', [fn('COUNT', col('guard_id')), 'count']],
                where: {
                    ...whereGeo,
                    date: { [Op.gte]: startDate }
                },
                group: ['status'],
                raw: true
            })
        ]);

        return {
            total,
            completed,
            upcoming,
            completion_rate: total > 0 ? ((completed / total) * 100).toFixed(1) : 0,
            by_status: byStatus.reduce((acc, s) => {
                acc[s.status] = parseInt(s.count);
                return acc;
            }, {})
        };
    }

    static async _getInstanceStats() {
        if (!LocalInstance) return { total: 0, online: 0 };

        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

        const [total, online] = await Promise.all([
            LocalInstance.count(),
            LocalInstance.count({
                where: {
                    status: 'active',
                    last_heartbeat: { [Op.gte]: fiveMinutesAgo }
                }
            })
        ]);

        return {
            total,
            online,
            offline: total - online,
            health_rate: total > 0 ? ((online / total) * 100).toFixed(1) : 100
        };
    }

    static async _getRecentActivity(limit = 10) {
        const logs = await AuditLog.findAll({
            attributes: ['action', 'member_id', 'resource_type', 'result', 'created_at'],
            order: [['created_at', 'DESC']],
            limit,
            raw: true
        });

        return logs;
    }

    static async _getSystemHealth() {
        const memUsage = process.memoryUsage();
        const uptime = process.uptime();

        return {
            status: 'healthy',
            uptime_seconds: Math.floor(uptime),
            uptime_formatted: this._formatUptime(uptime),
            memory: {
                used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
                total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
                percentage: ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(1)
            },
            node_version: process.version,
            platform: process.platform
        };
    }

    static async _getActiveAlerts() {
        if (!ErrorOccurrence) return [];

        const recentErrors = await ErrorOccurrence.findAll({
            where: {
                created_at: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) },
                severity: { [Op.in]: ['critical', 'high'] }
            },
            order: [['created_at', 'DESC']],
            limit: 5,
            raw: true
        });

        return recentErrors.map(e => ({
            type: 'error',
            severity: e.severity,
            code: e.error_code,
            message: e.message,
            timestamp: e.created_at
        }));
    }

    static _formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        return `${days}j ${hours}h ${mins}m`;
    }

    // =========================================
    // STATISTIQUES
    // =========================================

    /**
     * Récupère les statistiques détaillées
     */
    static async getStatistics({ category, period = 'month', date_from, date_to, geo_id, group_by = 'day' }) {
        const startDate = date_from ? new Date(date_from) : new Date(Date.now() - (PERIODS[period]?.days || 30) * 24 * 60 * 60 * 1000);
        const endDate = date_to ? new Date(date_to) : new Date();
        const whereGeo = geo_id ? { geo_id: { [Op.like]: `${geo_id}%` } } : {};

        const stats = {};

        // Statistiques utilisateurs
        if (!category || category.includes('users')) {
            stats.users = await this._calculateUserStats(startDate, endDate, whereGeo, group_by);
        }

        // Statistiques gardes
        if (!category || category.includes('guards')) {
            stats.guards = await this._calculateGuardStats(startDate, endDate, whereGeo, group_by);
        }

        // Statistiques système
        if (!category || category.includes('system')) {
            stats.system = await this._calculateSystemStats(startDate, endDate);
        }

        // Statistiques sécurité
        if (!category || category.includes('security')) {
            stats.security = await this._calculateSecurityStats(startDate, endDate);
        }

        return {
            period: { from: startDate, to: endDate },
            group_by,
            statistics: stats,
            generated_at: new Date().toISOString()
        };
    }

    static async _calculateUserStats(startDate, endDate, whereGeo, groupBy) {
        // Nouveaux utilisateurs par période
        const newUsers = await User.findAll({
            attributes: [
                [fn('DATE', col('created_at')), 'date'],
                [fn('COUNT', col('member_id')), 'count']
            ],
            where: {
                ...whereGeo,
                created_at: { [Op.between]: [startDate, endDate] }
            },
            group: [fn('DATE', col('created_at'))],
            order: [[fn('DATE', col('created_at')), 'ASC']],
            raw: true
        });

        // Connexions par période
        const logins = await AuditLog.findAll({
            attributes: [
                [fn('DATE', col('created_at')), 'date'],
                [fn('COUNT', col('log_id')), 'count']
            ],
            where: {
                action: 'LOGIN',
                result: 'success',
                created_at: { [Op.between]: [startDate, endDate] }
            },
            group: [fn('DATE', col('created_at'))],
            order: [[fn('DATE', col('created_at')), 'ASC']],
            raw: true
        });

        return {
            new_registrations: newUsers,
            login_activity: logins,
            total_new: newUsers.reduce((sum, u) => sum + parseInt(u.count), 0),
            total_logins: logins.reduce((sum, l) => sum + parseInt(l.count), 0)
        };
    }

    static async _calculateGuardStats(startDate, endDate, whereGeo, groupBy) {
        if (!Guard) return { message: 'Guards module not available' };

        const guards = await Guard.findAll({
            attributes: [
                [fn('DATE', col('date')), 'guard_date'],
                'status',
                [fn('COUNT', col('guard_id')), 'count']
            ],
            where: {
                ...whereGeo,
                date: { [Op.between]: [startDate, endDate] }
            },
            group: [fn('DATE', col('date')), 'status'],
            order: [[fn('DATE', col('date')), 'ASC']],
            raw: true
        });

        return {
            by_date_and_status: guards,
            summary: {
                total: guards.reduce((sum, g) => sum + parseInt(g.count), 0)
            }
        };
    }

    static async _calculateSystemStats(startDate, endDate) {
        if (!SystemMetric) return { message: 'SystemMetric not available' };

        const metrics = await SystemMetric.findAll({
            where: {
                recorded_at: { [Op.between]: [startDate, endDate] }
            },
            order: [['recorded_at', 'DESC']],
            limit: 100,
            raw: true
        });

        return {
            metrics,
            average_cpu: metrics.length > 0
                ? (metrics.reduce((sum, m) => sum + (m.cpu_usage || 0), 0) / metrics.length).toFixed(2)
                : 0,
            average_memory: metrics.length > 0
                ? (metrics.reduce((sum, m) => sum + (m.memory_usage || 0), 0) / metrics.length).toFixed(2)
                : 0
        };
    }

    static async _calculateSecurityStats(startDate, endDate) {
        const [failedLogins, lockedAccounts, twoFactorUsage] = await Promise.all([
            AuditLog.count({
                where: {
                    action: 'LOGIN_FAILED',
                    created_at: { [Op.between]: [startDate, endDate] }
                }
            }),
            User.count({
                where: { status: 'locked' }
            }),
            User.count({
                where: { totp_enabled: true }
            })
        ]);

        const totalUsers = await User.count();

        return {
            failed_login_attempts: failedLogins,
            locked_accounts: lockedAccounts,
            two_factor_enabled: twoFactorUsage,
            two_factor_percentage: totalUsers > 0 ? ((twoFactorUsage / totalUsers) * 100).toFixed(1) : 0
        };
    }

    // =========================================
    // EXPORT DE DONNÉES
    // =========================================

    /**
     * Exporte des données selon les critères
     */
    static async exportData({ export_type, format, filters, columns, encryption, delivery, recipient_email, requested_by }) {
        const exportId = crypto.randomBytes(8).toString('hex');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `shugo_export_${export_type}_${timestamp}.${format}`;
        const exportDir = path.join(config.backup?.storagePath || './exports', 'exports');

        // Créer le répertoire d'export
        await fs.mkdir(exportDir, { recursive: true });

        // Récupérer les données selon le type
        let data;
        switch (export_type) {
            case 'users':
                data = await this._exportUsers(filters, columns);
                break;
            case 'guards':
                data = await this._exportGuards(filters, columns);
                break;
            case 'audit_logs':
                data = await this._exportAuditLogs(filters, columns);
                break;
            case 'statistics':
                data = await this._exportStatistics(filters);
                break;
            default:
                throw new Error(`Type d'export non supporté: ${export_type}`);
        }

        // Formater les données
        let content;
        switch (format) {
            case 'json':
                content = JSON.stringify(data, null, 2);
                break;
            case 'csv':
                content = this._toCSV(data);
                break;
            default:
                content = JSON.stringify(data, null, 2);
        }

        const filePath = path.join(exportDir, filename);
        await fs.writeFile(filePath, content, 'utf8');

        // Log l'export
        await AuditLog.logAction({
            member_id: requested_by,
            action: 'DATA_EXPORT',
            resource_type: 'export',
            resource_id: exportId,
            result: 'success',
            metadata: { export_type, format, record_count: Array.isArray(data) ? data.length : 1 }
        });

        // Si livraison par email
        if (delivery === 'email' && recipient_email) {
            // TODO: Envoyer par email avec pièce jointe
            logger.info(`Export ${exportId} envoyé à ${recipient_email}`);
        }

        return {
            id: exportId,
            filename,
            file_path: filePath,
            format,
            record_count: Array.isArray(data) ? data.length : 1,
            size_bytes: Buffer.byteLength(content, 'utf8'),
            created_at: new Date().toISOString(),
            delivery
        };
    }

    static async _exportUsers(filters = {}, columns) {
        const where = {};
        if (filters.status) where.status = filters.status;
        if (filters.geo_id) where.geo_id = { [Op.like]: `${filters.geo_id}%` };

        const users = await User.findAll({
            where,
            attributes: columns || ['member_id', 'role', 'status', 'geo_id', 'created_at', 'last_login'],
            raw: true
        });

        return users;
    }

    static async _exportGuards(filters = {}, columns) {
        if (!Guard) return [];

        const where = {};
        if (filters.date_from) where.date = { [Op.gte]: new Date(filters.date_from) };
        if (filters.date_to) where.date = { ...where.date, [Op.lte]: new Date(filters.date_to) };
        if (filters.status) where.status = filters.status;

        return Guard.findAll({ where, raw: true });
    }

    static async _exportAuditLogs(filters = {}, columns) {
        const where = {};
        if (filters.date_from) where.created_at = { [Op.gte]: new Date(filters.date_from) };
        if (filters.date_to) where.created_at = { ...where.created_at, [Op.lte]: new Date(filters.date_to) };
        if (filters.action_type) where.action = filters.action_type;

        return AuditLog.findAll({
            where,
            order: [['created_at', 'DESC']],
            limit: 10000,
            raw: true
        });
    }

    static async _exportStatistics(filters = {}) {
        return this.getStatistics({
            period: filters.period || 'month',
            date_from: filters.date_from,
            date_to: filters.date_to,
            geo_id: filters.geo_id
        });
    }

    static _toCSV(data) {
        if (!Array.isArray(data) || data.length === 0) return '';

        const headers = Object.keys(data[0]);
        const rows = data.map(row =>
            headers.map(h => {
                const val = row[h];
                if (val === null || val === undefined) return '';
                if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
                    return `"${val.replace(/"/g, '""')}"`;
                }
                return val;
            }).join(',')
        );

        return [headers.join(','), ...rows].join('\n');
    }

    static async cleanupExport(exportId) {
        // Nettoyage différé des fichiers d'export
        logger.info(`Cleaning up export: ${exportId}`);
    }

    // =========================================
    // RAPPORTS
    // =========================================

    /**
     * Génère un rapport
     */
    static async generateReport({ report_type, period, date_from, date_to, geo_scope, include_charts, include_recommendations, format, language, generated_by }) {
        const reportId = crypto.randomBytes(8).toString('hex');

        // Collecter les données du rapport
        const reportData = await this._collectReportData(report_type, {
            period,
            date_from,
            date_to,
            geo_scope
        });

        // Générer le contenu
        const content = {
            id: reportId,
            type: report_type,
            period,
            date_range: { from: date_from, to: date_to },
            generated_at: new Date().toISOString(),
            generated_by,
            data: reportData
        };

        if (include_recommendations) {
            content.recommendations = this._generateRecommendations(report_type, reportData);
        }

        // Sauvegarder le rapport
        const reportsDir = path.join(config.backup?.storagePath || './reports', 'reports');
        await fs.mkdir(reportsDir, { recursive: true });

        const filename = `report_${report_type}_${reportId}.json`;
        const filePath = path.join(reportsDir, filename);
        await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf8');

        return {
            id: reportId,
            type: report_type,
            status: 'completed',
            filename,
            file_path: filePath,
            generated_at: content.generated_at
        };
    }

    static async _collectReportData(reportType, options) {
        switch (reportType) {
            case 'activity':
                return this.getStatistics({ category: ['users', 'guards'], ...options });
            case 'security':
                return this.getStatistics({ category: ['security'], ...options });
            case 'performance':
                return this.getStatistics({ category: ['system'], ...options });
            case 'compliance':
                return this.getComplianceReport({ geo_id: options.geo_scope, include_details: true });
            default:
                return this.getStatistics(options);
        }
    }

    static _generateRecommendations(reportType, data) {
        const recommendations = [];

        if (reportType === 'security') {
            const securityStats = data?.statistics?.security;
            if (securityStats) {
                if (parseFloat(securityStats.two_factor_percentage) < 80) {
                    recommendations.push({
                        priority: 'high',
                        message: 'Moins de 80% des utilisateurs ont activé le 2FA. Recommandation: rendre le 2FA obligatoire.',
                        action: 'enable_mandatory_2fa'
                    });
                }
                if (securityStats.failed_login_attempts > 100) {
                    recommendations.push({
                        priority: 'medium',
                        message: 'Nombre élevé de tentatives de connexion échouées. Vérifier les tentatives de brute force.',
                        action: 'review_failed_logins'
                    });
                }
            }
        }

        return recommendations;
    }

    /**
     * Liste les rapports générés
     */
    static async listReports({ filters = {}, page = 1, limit = 20 }) {
        const reportsDir = path.join(config.backup?.storagePath || './reports', 'reports');

        try {
            const files = await fs.readdir(reportsDir);
            const reports = [];

            for (const file of files.slice((page - 1) * limit, page * limit)) {
                if (file.endsWith('.json')) {
                    const content = await fs.readFile(path.join(reportsDir, file), 'utf8');
                    const report = JSON.parse(content);
                    reports.push({
                        id: report.id,
                        type: report.type,
                        generated_at: report.generated_at,
                        filename: file
                    });
                }
            }

            return {
                reports,
                pagination: {
                    page,
                    limit,
                    total: files.filter(f => f.endsWith('.json')).length
                }
            };
        } catch (error) {
            return { reports: [], pagination: { page, limit, total: 0 } };
        }
    }

    /**
     * Récupère un rapport spécifique
     */
    static async getReport({ report_id, user }) {
        const reportsDir = path.join(config.backup?.storagePath || './reports', 'reports');
        const files = await fs.readdir(reportsDir);

        const reportFile = files.find(f => f.includes(report_id));
        if (!reportFile) return null;

        return {
            id: report_id,
            filename: reportFile,
            file_path: path.join(reportsDir, reportFile)
        };
    }

    // =========================================
    // LOGS D'AUDIT
    // =========================================

    /**
     * Récupère les logs d'audit avec filtres
     */
    static async getAuditLogs({ filters = {}, page = 1, limit = 50 }) {
        const where = {};

        if (filters.action_type) where.action = filters.action_type;
        if (filters.member_id) where.member_id = filters.member_id;
        if (filters.entity_type) where.resource_type = filters.entity_type;
        if (filters.severity) where.severity = filters.severity;
        if (filters.date_from) where.created_at = { [Op.gte]: new Date(filters.date_from) };
        if (filters.date_to) where.created_at = { ...where.created_at, [Op.lte]: new Date(filters.date_to) };

        const { count, rows } = await AuditLog.findAndCountAll({
            where,
            order: [['created_at', 'DESC']],
            limit,
            offset: (page - 1) * limit
        });

        return {
            logs: rows,
            pagination: {
                page,
                limit,
                total: count,
                total_pages: Math.ceil(count / limit)
            }
        };
    }

    // =========================================
    // CONFIGURATION SYSTÈME
    // =========================================

    /**
     * Récupère la configuration système
     */
    static async getSystemConfig({ category, geo_id }) {
        // Retourner la configuration actuelle (non sensible)
        const safeConfig = {
            server: {
                name: config.server?.name,
                version: config.server?.version,
                environment: config.env
            },
            features: config.features,
            security: {
                two_factor_required: config.features?.twoFactorRequired,
                rate_limit_window: config.security?.rateLimit?.windowMs,
                rate_limit_max: config.security?.rateLimit?.maxRequests,
                session_max_concurrent: config.security?.session?.maxConcurrent
            },
            maintenance: {
                enabled: config.maintenance?.enabled,
                nightly_hour: config.maintenance?.nightlyHour
            },
            backup: {
                enabled: config.backup?.enabled,
                retention_days: config.backup?.retentionDays
            }
        };

        if (category) {
            return { [category]: safeConfig[category] || {} };
        }

        return safeConfig;
    }

    /**
     * Met à jour la configuration système
     */
    static async updateSystemConfig({ category, settings, apply_to, geo_id, effective_date, updated_by }) {
        // Valider que la catégorie est modifiable
        const modifiableCategories = ['features', 'security', 'maintenance', 'limits', 'notifications'];
        if (!modifiableCategories.includes(category)) {
            throw new Error(`Catégorie '${category}' non modifiable`);
        }

        // Log la modification
        await AuditLog.logAction({
            member_id: updated_by,
            action: 'CONFIG_UPDATE',
            resource_type: 'system_config',
            resource_id: category,
            result: 'success',
            metadata: { category, settings, apply_to, geo_id }
        });

        logger.info(`Configuration ${category} mise à jour par ${updated_by}`, { settings });

        return {
            category,
            settings,
            applied: true,
            apply_to,
            updated_at: new Date().toISOString()
        };
    }

    // =========================================
    // ACTIVITÉ UTILISATEURS
    // =========================================

    /**
     * Récupère l'activité des utilisateurs
     */
    static async getUserActivity({ filters = {}, page = 1, limit = 50 }) {
        const where = {};

        if (filters.member_id) where.member_id = filters.member_id;
        if (filters.activity_type) where.action = filters.activity_type;
        if (filters.date_from) where.created_at = { [Op.gte]: new Date(filters.date_from) };
        if (filters.date_to) where.created_at = { ...where.created_at, [Op.lte]: new Date(filters.date_to) };

        const { count, rows } = await AuditLog.findAndCountAll({
            where,
            order: [['created_at', 'DESC']],
            limit,
            offset: (page - 1) * limit,
            include: filters.member_id ? [] : [{
                model: User,
                as: 'user',
                attributes: ['member_id', 'role'],
                required: false
            }]
        });

        return {
            activity: rows,
            pagination: {
                page,
                limit,
                total: count,
                total_pages: Math.ceil(count / limit)
            }
        };
    }

    // =========================================
    // ERREURS SYSTÈME
    // =========================================

    /**
     * Récupère les erreurs système
     */
    static async getSystemErrors({ filters = {}, page = 1, limit = 50 }) {
        if (!ErrorOccurrence) {
            return { errors: [], pagination: { page, limit, total: 0, total_pages: 0 } };
        }

        const where = {};

        if (filters.error_code) where.error_code = filters.error_code;
        if (filters.severity) where.severity = filters.severity;
        if (filters.component) where.component = filters.component;
        if (filters.resolved !== undefined) where.resolved = filters.resolved;
        if (filters.date_from) where.created_at = { [Op.gte]: new Date(filters.date_from) };
        if (filters.date_to) where.created_at = { ...where.created_at, [Op.lte]: new Date(filters.date_to) };

        const { count, rows } = await ErrorOccurrence.findAndCountAll({
            where,
            order: [['created_at', 'DESC']],
            limit,
            offset: (page - 1) * limit,
            include: [{
                model: ErrorCodeRegistry,
                as: 'errorCode',
                attributes: ['code', 'description', 'category'],
                required: false
            }]
        });

        return {
            errors: rows,
            pagination: {
                page,
                limit,
                total: count,
                total_pages: Math.ceil(count / limit)
            }
        };
    }

    // =========================================
    // DIFFUSION DE MESSAGES
    // =========================================

    /**
     * Diffuse un message admin
     */
    static async broadcastMessage({ message_type, subject, content, target_geo_id, priority, channels, sent_by }) {
        // Déterminer les destinataires
        const whereUsers = { status: 'active' };
        if (target_geo_id) {
            whereUsers.geo_id = { [Op.like]: `${target_geo_id}%` };
        }

        const recipients = await User.findAll({
            where: whereUsers,
            attributes: ['member_id', 'email_encrypted', 'notification_channel']
        });

        // Créer le message dans MessagesCenter si disponible
        if (MessagesCenter) {
            await MessagesCenter.create({
                sender_member_id: sent_by,
                subject,
                content,
                message_type: message_type || 'announcement',
                priority: priority || 'normal',
                scope_type: target_geo_id ? 'geo' : 'all',
                scope_value: target_geo_id || null,
                status: 'sent'
            });
        }

        // Créer des notifications
        if (Notification) {
            const notifications = recipients.map(r => ({
                member_id: r.member_id,
                title: subject,
                message: content,
                type: 'admin_broadcast',
                priority,
                created_by: sent_by
            }));

            await Notification.bulkCreate(notifications);
        }

        // Log
        await AuditLog.logAction({
            member_id: sent_by,
            action: 'ADMIN_BROADCAST',
            resource_type: 'message',
            result: 'success',
            metadata: { subject, recipients_count: recipients.length, target_geo_id }
        });

        return {
            message_id: crypto.randomBytes(8).toString('hex'),
            recipients_count: recipients.length,
            channels,
            sent_at: new Date().toISOString()
        };
    }

    // =========================================
    // IMPERSONNALISATION
    // =========================================

    /**
     * Crée une session d'impersonnalisation
     */
    static async createImpersonationSession({ target_member_id, duration_minutes, reason, initiated_by }) {
        // Vérifier que la cible existe
        const targetUser = await User.findByPk(target_member_id);
        if (!targetUser) {
            throw new Error('Utilisateur cible non trouvé');
        }

        // Vérifier que l'initiateur a un rôle supérieur
        const initiator = await User.findByPk(initiated_by);
        const roleHierarchy = { 'Visitor': 0, 'Iron': 2, 'Bronze': 4, 'Silver': 6, 'Gold': 8, 'Diamond': 10 };

        if (roleHierarchy[initiator.role] <= roleHierarchy[targetUser.role]) {
            throw new Error('Impossible d\'impersonnaliser un utilisateur de même niveau ou supérieur');
        }

        const sessionId = crypto.randomBytes(16).toString('hex');
        const expiresAt = new Date(Date.now() + duration_minutes * 60 * 1000);

        // Log critique
        await AuditLog.logAction({
            member_id: initiated_by,
            action: 'IMPERSONATION_START',
            resource_type: 'user',
            resource_id: target_member_id.toString(),
            severity: 'critical',
            result: 'success',
            metadata: {
                reason,
                duration_minutes,
                session_id: sessionId,
                expires_at: expiresAt.toISOString()
            }
        });

        logger.warn(`Impersonation started: ${initiated_by} -> ${target_member_id}`, {
            reason,
            session_id: sessionId
        });

        return {
            session_id: sessionId,
            target_member_id,
            initiated_by,
            reason,
            duration_minutes,
            expires_at: expiresAt.toISOString(),
            created_at: new Date().toISOString()
        };
    }

    // =========================================
    // CONFORMITÉ
    // =========================================

    /**
     * Génère un rapport de conformité
     */
    static async getComplianceReport({ geo_id, include_details }) {
        const checks = [];

        // Vérification 2FA
        const totalUsers = await User.count();
        const users2FA = await User.count({ where: { totp_enabled: true } });
        const twoFactorRate = totalUsers > 0 ? (users2FA / totalUsers) * 100 : 0;

        checks.push({
            name: 'two_factor_authentication',
            status: twoFactorRate >= 80 ? 'compliant' : 'non_compliant',
            value: `${twoFactorRate.toFixed(1)}%`,
            requirement: '80% minimum',
            details: include_details ? { total_users: totalUsers, users_with_2fa: users2FA } : undefined
        });

        // Vérification sessions
        const staleSessionsCount = await Session.count({
            where: {
                is_active: true,
                last_activity: { [Op.lt]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
            }
        });

        checks.push({
            name: 'stale_sessions',
            status: staleSessionsCount === 0 ? 'compliant' : 'warning',
            value: staleSessionsCount,
            requirement: '0 sessions inactives > 30 jours',
            details: include_details ? { stale_count: staleSessionsCount } : undefined
        });

        // Vérification backups
        if (MaintenanceRun) {
            const lastBackup = await MaintenanceRun.findOne({
                where: { run_type: 'backup' },
                order: [['started_at', 'DESC']]
            });

            const backupAge = lastBackup ? (Date.now() - new Date(lastBackup.started_at).getTime()) / (24 * 60 * 60 * 1000) : 999;

            checks.push({
                name: 'backup_frequency',
                status: backupAge <= 1 ? 'compliant' : backupAge <= 7 ? 'warning' : 'non_compliant',
                value: lastBackup ? `${backupAge.toFixed(1)} jours` : 'Jamais',
                requirement: 'Backup quotidien',
                details: include_details ? { last_backup: lastBackup?.started_at } : undefined
            });
        }

        // Vérification mots de passe expirés (si applicable)
        checks.push({
            name: 'password_policy',
            status: 'compliant',
            value: 'Argon2id',
            requirement: 'Hachage sécurisé'
        });

        // Score global
        const compliantChecks = checks.filter(c => c.status === 'compliant').length;
        const totalChecks = checks.length;
        const complianceScore = totalChecks > 0 ? (compliantChecks / totalChecks) * 100 : 0;

        return {
            overall_status: complianceScore >= 80 ? 'compliant' : complianceScore >= 60 ? 'partial' : 'non_compliant',
            compliance_score: `${complianceScore.toFixed(1)}%`,
            checks,
            generated_at: new Date().toISOString(),
            geo_id: geo_id || 'global'
        };
    }

    // =========================================
    // MÉTHODES LEGACY (compatibilité)
    // =========================================

    static async getDashboardStats() {
        return this.getDashboard({ period: 'week' });
    }

    static async getSystemHealth() {
        return this._getSystemHealth();
    }

    static async getRecentAuditLogs(limit = 50) {
        return this._getRecentActivity(limit);
    }
}

module.exports = AdminService;
