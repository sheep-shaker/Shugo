// src/middleware/maintenance.js
// Middleware pour gérer le mode maintenance

const config = require('../config');
const logger = require('../utils/logger');

/**
 * Check if maintenance mode is active
 */
const isMaintenanceActive = () => {
    // Check manual maintenance flag
    if (config.maintenance.enabled) {
        return true;
    }
    
    // Check scheduled maintenance
    if (config.maintenance.autoSchedule) {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        
        // Check if we're in the maintenance window (default: 00:00 - 00:45)
        if (currentHour === config.maintenance.scheduleHour) {
            if (currentMinute >= config.maintenance.scheduleMinute && currentMinute < 45) {
                return true;
            }
        }
    }
    
    return false;
};

/**
 * Check if IP is allowed during maintenance
 */
const isAllowedIP = (ip) => {
    const allowedIPs = config.maintenance.allowedIPs || [];
    
    // Normalize IP (remove IPv6 prefix for IPv4)
    const normalizedIP = ip.replace(/^::ffff:/, '');
    
    return allowedIPs.some(allowedIP => {
        // Support wildcards (e.g., "192.168.1.*")
        const regex = new RegExp('^' + allowedIP.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
        return regex.test(normalizedIP);
    });
};

/**
 * Maintenance mode middleware
 */
const maintenanceMode = (req, res, next) => {
    // Skip for health check endpoint
    if (req.path === '/health' || req.path === '/api/v1/health/status') {
        return next();
    }
    
    // Check if maintenance is active
    if (!isMaintenanceActive()) {
        return next();
    }
    
    // Check if requester IP is allowed
    if (isAllowedIP(req.ip)) {
        logger.info('Maintenance mode bypassed for allowed IP', {
            ip: req.ip,
            path: req.path
        });
        return next();
    }
    
    // Check if user is admin (if authenticated)
    if (req.user && ['Admin', 'Admin_N1'].includes(req.user.role)) {
        logger.info('Maintenance mode bypassed for admin', {
            member_id: req.user.member_id,
            path: req.path
        });
        return next();
    }
    
    // Return maintenance response
    logger.warn('Request blocked due to maintenance mode', {
        ip: req.ip,
        path: req.path
    });
    
    res.status(503).json({
        success: false,
        message: config.maintenance.message || 'System is under maintenance. Please try again later.',
        maintenance: {
            active: true,
            scheduled: config.maintenance.autoSchedule,
            estimated_end: getEstimatedEndTime()
        }
    });
};

/**
 * Get estimated end time of maintenance
 */
const getEstimatedEndTime = () => {
    if (config.maintenance.autoSchedule) {
        const now = new Date();
        const endTime = new Date(now);
        endTime.setHours(config.maintenance.scheduleHour);
        endTime.setMinutes(45); // Default 45 minutes maintenance window
        endTime.setSeconds(0);
        
        // If we're past the window, it's tomorrow
        if (now > endTime) {
            endTime.setDate(endTime.getDate() + 1);
        }
        
        return endTime.toISOString();
    }
    
    // Manual maintenance - no estimated end time
    return null;
};

/**
 * Toggle maintenance mode programmatically
 */
const toggleMaintenanceMode = (enabled, message = null) => {
    config.maintenance.enabled = enabled;
    
    if (message) {
        config.maintenance.message = message;
    }
    
    logger.warn(`Maintenance mode ${enabled ? 'ACTIVATED' : 'DEACTIVATED'}`, {
        message: message || config.maintenance.message,
        timestamp: new Date().toISOString()
    });
    
    return {
        enabled,
        message: config.maintenance.message,
        allowedIPs: config.maintenance.allowedIPs
    };
};

/**
 * Get maintenance status
 */
const getMaintenanceStatus = () => {
    return {
        active: isMaintenanceActive(),
        manual: config.maintenance.enabled,
        scheduled: config.maintenance.autoSchedule,
        message: config.maintenance.message,
        schedule: config.maintenance.autoSchedule ? {
            hour: config.maintenance.scheduleHour,
            minute: config.maintenance.scheduleMinute,
            duration_minutes: 45
        } : null,
        estimated_end: isMaintenanceActive() ? getEstimatedEndTime() : null,
        allowed_ips: config.maintenance.allowedIPs
    };
};

/**
 * Schedule maintenance window
 */
const scheduleMaintenanceWindow = (startTime, durationMinutes = 45, message = null) => {
    const start = new Date(startTime);
    const end = new Date(start.getTime() + durationMinutes * 60000);
    
    logger.info('Maintenance window scheduled', {
        start: start.toISOString(),
        end: end.toISOString(),
        duration: durationMinutes,
        message
    });
    
    // Set timer to activate maintenance
    const timeUntilStart = start.getTime() - Date.now();
    
    if (timeUntilStart > 0) {
        setTimeout(() => {
            toggleMaintenanceMode(true, message);
            
            // Set timer to deactivate maintenance
            setTimeout(() => {
                toggleMaintenanceMode(false);
            }, durationMinutes * 60000);
        }, timeUntilStart);
    }
    
    return {
        scheduled: true,
        start: start.toISOString(),
        end: end.toISOString(),
        duration: durationMinutes
    };
};

/**
 * Express route handlers for maintenance control
 */
const maintenanceRoutes = {
    // GET /api/v1/maintenance/status
    getStatus: (req, res) => {
        res.json({
            success: true,
            data: getMaintenanceStatus()
        });
    },
    
    // POST /api/v1/maintenance/toggle
    toggle: (req, res) => {
        const { enabled, message } = req.body;
        
        const status = toggleMaintenanceMode(enabled, message);
        
        res.json({
            success: true,
            message: `Maintenance mode ${enabled ? 'activated' : 'deactivated'}`,
            data: status
        });
    },
    
    // POST /api/v1/maintenance/schedule
    schedule: (req, res) => {
        const { startTime, duration, message } = req.body;
        
        try {
            const result = scheduleMaintenanceWindow(startTime, duration, message);
            
            res.json({
                success: true,
                message: 'Maintenance window scheduled',
                data: result
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: 'Failed to schedule maintenance',
                error: error.message
            });
        }
    }
};

module.exports = {
    maintenanceMode,
    toggleMaintenanceMode,
    getMaintenanceStatus,
    scheduleMaintenanceWindow,
    maintenanceRoutes,
    isMaintenanceActive,
    isAllowedIP
};
