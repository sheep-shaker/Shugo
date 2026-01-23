// packages/local/src/plugins/PluginManager.js
// Plugin manager for local server

const path = require('path');
const fs = require('fs').promises;
const ShugoPlugin = require('@shugo/sdk/plugin-base/Plugin');
const logger = require('../utils/logger');

class PluginManager {
    constructor(config, context) {
        this.config = config;
        this.context = context; // api, eventBus, database, logger
        this.plugins = new Map();
        this.pluginsPath = path.join(__dirname, '../../plugins');
        this.enabledPlugins = new Set();
    }
    
    /**
     * Initialize plugin manager
     */
    async initialize() {
        logger.info('Initializing Plugin Manager...');
        
        // Create plugins directory
        await fs.mkdir(this.pluginsPath, { recursive: true });
        
        // Load enabled plugins list
        await this.loadEnabledPlugins();
        
        // Scan and load plugins
        await this.scanPlugins();
        
        // Initialize enabled plugins
        await this.initializeEnabledPlugins();
        
        logger.info(`Plugin Manager initialized: ${this.plugins.size} plugins loaded`);
    }
    
    /**
     * Scan plugins directory
     */
    async scanPlugins() {
        try {
            const entries = await fs.readdir(this.pluginsPath, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    await this.loadPlugin(entry.name);
                }
            }
        } catch (error) {
            logger.error('Failed to scan plugins:', error);
        }
    }
    
    /**
     * Load a plugin
     */
    async loadPlugin(pluginId) {
        try {
            const pluginPath = path.join(this.pluginsPath, pluginId);
            const manifestPath = path.join(pluginPath, 'manifest.json');
            
            // Check if manifest exists
            const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);
            if (!manifestExists) {
                logger.warn(`Plugin ${pluginId} has no manifest.json`);
                return;
            }
            
            // Read manifest
            const manifestContent = await fs.readFile(manifestPath, 'utf8');
            const manifest = JSON.parse(manifestContent);
            
            // Validate manifest
            ShugoPlugin.validateManifest(manifest);
            
            // Add base path to manifest
            manifest.basePath = pluginPath;
            
            // Load plugin class
            const PluginClass = require(path.join(pluginPath, 'index.js'));
            
            // Create plugin instance
            const plugin = new PluginClass(manifest);
            
            // Store plugin
            this.plugins.set(pluginId, plugin);
            
            logger.info(`Plugin loaded: ${plugin.name} v${plugin.version}`);
            
            return plugin;
            
        } catch (error) {
            logger.error(`Failed to load plugin ${pluginId}:`, error);
            return null;
        }
    }
    
    /**
     * Initialize enabled plugins
     */
    async initializeEnabledPlugins() {
        for (const pluginId of this.enabledPlugins) {
            const plugin = this.plugins.get(pluginId);
            if (plugin) {
                await this.initializePlugin(plugin);
            }
        }
    }
    
    /**
     * Initialize a plugin
     */
    async initializePlugin(plugin) {
        try {
            // Check dependencies
            for (const dep of plugin.dependencies) {
                if (!this.plugins.has(dep)) {
                    throw new Error(`Missing dependency: ${dep}`);
                }
                if (!this.enabledPlugins.has(dep)) {
                    throw new Error(`Dependency not enabled: ${dep}`);
                }
            }
            
            // Initialize plugin
            await plugin.initialize(this.context);
            
            // Enable plugin
            await plugin.onEnable();
            
            logger.info(`Plugin initialized: ${plugin.id}`);
            
        } catch (error) {
            logger.error(`Failed to initialize plugin ${plugin.id}:`, error);
            throw error;
        }
    }
    
    /**
     * Install a plugin
     */
    async installPlugin(pluginId, source = null) {
        try {
            // If source provided, download/copy plugin
            if (source) {
                await this.downloadPlugin(pluginId, source);
            }
            
            // Load plugin
            const plugin = await this.loadPlugin(pluginId);
            if (!plugin) {
                throw new Error('Failed to load plugin');
            }
            
            // Run install lifecycle
            await plugin.onInstall();
            
            // Initialize plugin
            await this.initializePlugin(plugin);
            
            // Add to enabled plugins
            this.enabledPlugins.add(pluginId);
            await this.saveEnabledPlugins();
            
            logger.info(`Plugin installed: ${pluginId}`);
            
            // Emit event
            this.context.eventBus.emit('plugin.installed', {
                pluginId,
                plugin: plugin.getInfo()
            });
            
            return plugin;
            
        } catch (error) {
            logger.error(`Failed to install plugin ${pluginId}:`, error);
            throw error;
        }
    }
    
    /**
     * Uninstall a plugin
     */
    async uninstallPlugin(pluginId) {
        try {
            const plugin = this.plugins.get(pluginId);
            if (!plugin) {
                throw new Error('Plugin not found');
            }
            
            // Disable plugin
            if (this.enabledPlugins.has(pluginId)) {
                await this.disablePlugin(pluginId);
            }
            
            // Run uninstall lifecycle
            await plugin.onUninstall();
            
            // Remove from plugins
            this.plugins.delete(pluginId);
            
            // Remove plugin files
            const pluginPath = path.join(this.pluginsPath, pluginId);
            await fs.rmdir(pluginPath, { recursive: true });
            
            logger.info(`Plugin uninstalled: ${pluginId}`);
            
            // Emit event
            this.context.eventBus.emit('plugin.uninstalled', { pluginId });
            
        } catch (error) {
            logger.error(`Failed to uninstall plugin ${pluginId}:`, error);
            throw error;
        }
    }
    
    /**
     * Enable a plugin
     */
    async enablePlugin(pluginId) {
        try {
            const plugin = this.plugins.get(pluginId);
            if (!plugin) {
                throw new Error('Plugin not found');
            }
            
            if (this.enabledPlugins.has(pluginId)) {
                return; // Already enabled
            }
            
            // Initialize if needed
            if (!plugin.initialized) {
                await this.initializePlugin(plugin);
            }
            
            // Enable plugin
            await plugin.onEnable();
            
            // Add to enabled plugins
            this.enabledPlugins.add(pluginId);
            await this.saveEnabledPlugins();
            
            logger.info(`Plugin enabled: ${pluginId}`);
            
            // Emit event
            this.context.eventBus.emit('plugin.enabled', {
                pluginId,
                plugin: plugin.getInfo()
            });
            
        } catch (error) {
            logger.error(`Failed to enable plugin ${pluginId}:`, error);
            throw error;
        }
    }
    
    /**
     * Disable a plugin
     */
    async disablePlugin(pluginId) {
        try {
            const plugin = this.plugins.get(pluginId);
            if (!plugin) {
                throw new Error('Plugin not found');
            }
            
            if (!this.enabledPlugins.has(pluginId)) {
                return; // Already disabled
            }
            
            // Check if other plugins depend on this
            for (const [otherId, otherPlugin] of this.plugins) {
                if (otherId !== pluginId && 
                    this.enabledPlugins.has(otherId) && 
                    otherPlugin.dependencies.includes(pluginId)) {
                    throw new Error(`Cannot disable: ${otherId} depends on ${pluginId}`);
                }
            }
            
            // Disable plugin
            await plugin.onDisable();
            
            // Remove from enabled plugins
            this.enabledPlugins.delete(pluginId);
            await this.saveEnabledPlugins();
            
            logger.info(`Plugin disabled: ${pluginId}`);
            
            // Emit event
            this.context.eventBus.emit('plugin.disabled', { pluginId });
            
        } catch (error) {
            logger.error(`Failed to disable plugin ${pluginId}:`, error);
            throw error;
        }
    }
    
    /**
     * Get plugin
     */
    getPlugin(pluginId) {
        return this.plugins.get(pluginId);
    }
    
    /**
     * Get all plugins
     */
    getAllPlugins() {
        const plugins = [];
        for (const [id, plugin] of this.plugins) {
            plugins.push({
                ...plugin.getInfo(),
                enabled: this.enabledPlugins.has(id)
            });
        }
        return plugins;
    }
    
    /**
     * Get enabled plugins
     */
    getEnabledPlugins() {
        return Array.from(this.enabledPlugins);
    }
    
    /**
     * Load enabled plugins list
     */
    async loadEnabledPlugins() {
        try {
            const configPath = path.join(this.pluginsPath, 'enabled.json');
            const content = await fs.readFile(configPath, 'utf8');
            const enabled = JSON.parse(content);
            this.enabledPlugins = new Set(enabled);
        } catch (error) {
            // File doesn't exist, use default
            this.enabledPlugins = new Set();
        }
    }
    
    /**
     * Save enabled plugins list
     */
    async saveEnabledPlugins() {
        const configPath = path.join(this.pluginsPath, 'enabled.json');
        const enabled = Array.from(this.enabledPlugins);
        await fs.writeFile(configPath, JSON.stringify(enabled, null, 2));
    }
    
    /**
     * Download plugin from source
     */
    async downloadPlugin(pluginId, source) {
        // TODO: Implement plugin download from:
        // - Central server
        // - Git repository
        // - ZIP file
        logger.info(`Downloading plugin ${pluginId} from ${source}`);
    }
    
    /**
     * Get plugin routes
     */
    getPluginRoutes() {
        const routes = [];
        for (const plugin of this.plugins.values()) {
            if (plugin.enabled) {
                routes.push(...plugin.routes);
            }
        }
        return routes;
    }
    
    /**
     * Execute plugin command
     */
    async executeCommand(pluginId, commandName, ...args) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin || !plugin.enabled) {
            throw new Error('Plugin not available');
        }
        
        const command = plugin.commands.get(commandName);
        if (!command) {
            throw new Error(`Command not found: ${commandName}`);
        }
        
        return await command.handler(...args);
    }
}

module.exports = PluginManager;
