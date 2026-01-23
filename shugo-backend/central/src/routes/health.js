// src/routes/health.js
// Routes pour le monitoring et la santé du système

const express = require('express');
const router = express.Router();
const os = require('os');
const fs = require('fs').promises;
const path = require('path');

const config = require('../config');
const logger = require('../utils/logger');
const { sequelize } = require('../database/connection');

// Models
const User = require('../models/User');
const Session = require('../models/Session');
const LocalInstance = require('../models/LocalInstance');
const AuditLog = require('../models/AuditLog');

// Middleware
const { authenticateToken, checkRole } = require('../middleware/auth');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

/**
 * GET /api/v1/health
 * Basic health check
 */
router.get('/', (req, res) => {
    res.json({
        status: 'healthy',
        server: config.server.name,
        version: config.server.version,
        timestamp: new Date().toISOString()
    });
});

/**
 * GET /api/v1/health/status
 * Detailed health status
 */
router.get('/status', asyncHandler(async (req, res) => {
    const healthData = {
        status: 'healthy',
        server: {
            name: config.server.name,
            id: config.server.id,
            version: config.server.version,
            environment: config.env,
            uptime: process.uptime()
        },
        system: {
            platform: os.platform(),
            arch: os.arch(),
            cpus: os.cpus().length,
            memory: {
                total: os.totalmem(),
                free: os.freemem(),
                used: os.totalmem() - os.freemem(),
                usage: ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(2) + '%'
            },
            load: os.loadavg()
        },
        process: {
            pid: process.pid,
            memory: process.memoryUsage(),
            cpu: process.cpuUsage()
        },
        timestamp: new Date().toISOString()
    };
    
    // Check database connection
    try {
        await sequelize.authenticate();
        healthData.database = {
            status: 'connected',
            dialect: sequelize.options.dialect,
            database: sequelize.config.database
        };
    } catch (error) {
        healthData.database = {
            status: 'disconnected',
            error: error.message
        };
        healthData.status = 'degraded';
    }
    
    res.json(healthData);
}));

/**
 * GET /api/v1/health/database
 * Database health check
 */
router.get('/database',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1']),
    asyncHandler(async (req, res) => {
        const dbHealth = {
            connected: false,
            tables: {},
            statistics: {}
        };
        
        try {
            // Test connection
            await sequelize.authenticate();
            dbHealth.connected = true;
            
            // Get database version
            const [results] = await sequelize.query('SELECT version()');
            dbHealth.version = results[0].version;
            
            // Get table counts
            const tables = ['users', 'sessions', 'guards', 'groups', 'notifications', 'audit_logs'];
            
            for (const table of tables) {
                try {
                    const [result] = await sequelize.query(`SELECT COUNT(*) as count FROM ${table}`);
                    dbHealth.tables[table] = parseInt(result[0].count);
                } catch (error) {
                    dbHealth.tables[table] = 'error';
                }
            }
            
            // Get statistics
            dbHealth.statistics = {
                activeUsers: await User.count({ where: { status: 'active' } }),
                activeSessions: await Session.getActiveSessionsCount(),
                todayLogins: await AuditLog.count({
                    where: {
                        action: 'LOGIN',
                        result: 'success',
                        timestamp: {
                            [sequelize.Sequelize.Op.gte]: new Date(new Date().setHours(0, 0, 0, 0))
                        }
                    }
                })
            };
            
            // Get database size
            const [sizeResult] = await sequelize.query(`
                SELECT pg_database_size('${sequelize.config.database}') as size
            `);
            dbHealth.size = {
                bytes: parseInt(sizeResult[0].size),
                readable: formatBytes(parseInt(sizeResult[0].size))
            };
            
        } catch (error) {
            dbHealth.error = error.message;
        }
        
        res.json({
            success: true,
            data: dbHealth
        });
    })
);

/**
 * GET /api/v1/health/metrics
 * System metrics
 */
router.get('/metrics',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1']),
    asyncHandler(async (req, res) => {
        const metrics = {
            timestamp: new Date().toISOString(),
            server: {
                uptime: process.uptime(),
                requests: 0, // Would need request counter middleware
                errors: 0 // Would need error counter
            },
            resources: {
                cpu: {
                    cores: os.cpus().length,
                    model: os.cpus()[0]?.model,
                    speed: os.cpus()[0]?.speed,
                    usage: process.cpuUsage()
                },
                memory: {
                    system: {
                        total: os.totalmem(),
                        free: os.freemem(),
                        used: os.totalmem() - os.freemem(),
                        percentage: ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(2)
                    },
                    process: {
                        rss: process.memoryUsage().rss,
                        heapTotal: process.memoryUsage().heapTotal,
                        heapUsed: process.memoryUsage().heapUsed,
                        external: process.memoryUsage().external
                    }
                },
                disk: await getDiskUsage()
            },
            network: {
                instances: await LocalInstance.getMetrics()
            }
        };
        
        res.json({
            success: true,
            data: metrics
        });
    })
);

/**
 * GET /api/v1/health/logs
 * Get recent system logs
 */
router.get('/logs',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1']),
    asyncHandler(async (req, res) => {
        const { level = 'error', limit = 50 } = req.query;
        
        const logs = await AuditLog.findAll({
            where: {
                severity: {
                    [sequelize.Sequelize.Op.in]: getSeveritiesForLevel(level)
                }
            },
            order: [['timestamp', 'DESC']],
            limit: parseInt(limit)
        });
        
        res.json({
            success: true,
            data: logs
        });
    })
);

/**
 * POST /api/v1/health/test-email
 * Test email configuration
 */
router.post('/test-email',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1']),
    asyncHandler(async (req, res) => {
        const { to } = req.body;
        
        if (!config.email.enabled) {
            throw new AppError('Email is not configured', 400);
        }
        
        // TODO: Implement email sending
        logger.info('Test email requested', { to });
        
        res.json({
            success: true,
            message: 'Test email sent (simulated)'
        });
    })
);

/**
 * POST /api/v1/health/clear-cache
 * Clear system caches
 */
router.post('/clear-cache',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1']),
    asyncHandler(async (req, res) => {
        // Clear expired sessions
        const deletedSessions = await Session.cleanupExpired();
        
        // Clear old logs (if configured)
        const deletedLogs = config.isDevelopment ? 
            await AuditLog.cleanup(30) : 0;
        
        // Log the action
        await AuditLog.logAction({
            member_id: req.user.member_id,
            action: 'CLEAR_CACHE',
            resource_type: 'system',
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            result: 'success',
            category: 'admin',
            metadata: {
                sessions_cleared: deletedSessions,
                logs_cleared: deletedLogs
            }
        });
        
        res.json({
            success: true,
            message: 'Cache cleared',
            data: {
                sessions_cleared: deletedSessions,
                logs_cleared: deletedLogs
            }
        });
    })
);

/**
 * GET /api/v1/health/network
 * Check network connectivity
 */
router.get('/network',
    authenticateToken,
    checkRole(['Admin', 'Admin_N1']),
    asyncHandler(async (req, res) => {
        const instances = await LocalInstance.findActive();
        
        const networkStatus = {
            total_instances: instances.length,
            online: 0,
            offline: 0,
            instances: []
        };
        
        for (const instance of instances) {
            const status = {
                instance_id: instance.instance_id,
                name: instance.name,
                geo_id: instance.geo_id,
                ip_address: instance.ip_address,
                last_seen: instance.last_seen,
                online: instance.isOnline(),
                cpu_usage: instance.cpu_usage,
                memory_usage: instance.memory_usage,
                disk_usage: instance.disk_usage,
                user_count: instance.user_count
            };
            
            if (status.online) {
                networkStatus.online++;
            } else {
                networkStatus.offline++;
            }
            
            networkStatus.instances.push(status);
        }
        
        res.json({
            success: true,
            data: networkStatus
        });
    })
);

// Helper functions
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function getDiskUsage() {
    try {
        // This is a simplified version - would need proper disk usage library
        const stats = await fs.stat(config.paths.root);
        return {
            available: 'unknown',
            used: 'unknown',
            percentage: 'unknown'
        };
    } catch (error) {
        return {
            error: error.message
        };
    }
}

function getSeveritiesForLevel(level) {
    const levels = {
        'debug': ['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'],
        'info': ['INFO', 'WARN', 'ERROR', 'CRITICAL'],
        'warn': ['WARN', 'ERROR', 'CRITICAL'],
        'error': ['ERROR', 'CRITICAL'],
        'critical': ['CRITICAL']
    };
    return levels[level] || levels['error'];
}

module.exports = router;
