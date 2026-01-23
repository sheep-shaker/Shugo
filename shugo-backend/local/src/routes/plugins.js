// packages/local/src/routes/plugins.js
// Plugin management routes for local server

const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * GET /api/local/plugins
 * Get all plugins
 */
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        const pluginManager = req.app.locals.pluginManager;
        
        if (!pluginManager) {
            return res.status(503).json({
                success: false,
                error: 'Plugin system not available'
            });
        }
        
        const plugins = pluginManager.getAllPlugins();
        
        res.json({
            success: true,
            data: plugins
        });
        
    } catch (error) {
        logger.error('Get plugins error:', error);
        next(error);
    }
});

/**
 * GET /api/local/plugins/:id
 * Get plugin details
 */
router.get('/:id', authMiddleware, async (req, res, next) => {
    try {
        const pluginManager = req.app.locals.pluginManager;
        const plugin = pluginManager?.getPlugin(req.params.id);
        
        if (!plugin) {
            return res.status(404).json({
                success: false,
                error: 'Plugin not found'
            });
        }
        
        res.json({
            success: true,
            data: plugin.getInfo()
        });
        
    } catch (error) {
        logger.error('Get plugin error:', error);
        next(error);
    }
});

/**
 * POST /api/local/plugins/:id/enable
 * Enable a plugin (Admin only)
 */
router.post('/:id/enable', authMiddleware, requireRole('Admin'), async (req, res, next) => {
    try {
        const pluginManager = req.app.locals.pluginManager;
        
        if (!pluginManager) {
            return res.status(503).json({
                success: false,
                error: 'Plugin system not available'
            });
        }
        
        await pluginManager.enablePlugin(req.params.id);
        
        logger.info('Plugin enabled', {
            plugin_id: req.params.id,
            enabled_by: req.user.member_id
        });
        
        res.json({
            success: true,
            message: `Plugin ${req.params.id} enabled successfully`
        });
        
    } catch (error) {
        logger.error('Enable plugin error:', error);
        next(error);
    }
});

/**
 * POST /api/local/plugins/:id/disable
 * Disable a plugin (Admin only)
 */
router.post('/:id/disable', authMiddleware, requireRole('Admin'), async (req, res, next) => {
    try {
        const pluginManager = req.app.locals.pluginManager;
        
        if (!pluginManager) {
            return res.status(503).json({
                success: false,
                error: 'Plugin system not available'
            });
        }
        
        await pluginManager.disablePlugin(req.params.id);
        
        logger.info('Plugin disabled', {
            plugin_id: req.params.id,
            disabled_by: req.user.member_id
        });
        
        res.json({
            success: true,
            message: `Plugin ${req.params.id} disabled successfully`
        });
        
    } catch (error) {
        logger.error('Disable plugin error:', error);
        next(error);
    }
});

/**
 * Plugin routes handler
 * Dynamically handle plugin-specific routes
 */
router.use('/:pluginId/*', authMiddleware, async (req, res, next) => {
    try {
        const pluginManager = req.app.locals.pluginManager;
        const plugin = pluginManager?.getPlugin(req.params.pluginId);
        
        if (!plugin || !plugin.enabled) {
            return res.status(404).json({
                success: false,
                error: 'Plugin not available'
            });
        }
        
        // Find matching route in plugin
        const pluginPath = req.path.replace(`/${req.params.pluginId}`, '');
        const route = plugin.routes.find(r => 
            r.path === `/plugins/${req.params.pluginId}${pluginPath}` &&
            r.method === req.method
        );
        
        if (!route) {
            return res.status(404).json({
                success: false,
                error: 'Plugin route not found'
            });
        }
        
        // Check role requirements
        if (route.roles && route.roles.length > 0) {
            if (!route.roles.includes(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    error: 'Insufficient permissions for this plugin route'
                });
            }
        }
        
        // Execute plugin handler
        await route.handler(req, res, next);
        
    } catch (error) {
        logger.error('Plugin route error:', error);
        next(error);
    }
});

module.exports = router;
