'use strict';

/**
 * SHUGO v7.0 - Service de gestion des plugins
 *
 * Architecture extensible par plugins :
 * - Installation et désinstallation
 * - Activation et désactivation
 * - Configuration et hooks
 * - Événements et lifecycle
 *
 * @see Document Technique V7.0 - Section 7
 */

const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { Op } = require('sequelize');
const config = require('../config');

/**
 * Statuts des plugins
 */
const PLUGIN_STATUS = {
  AVAILABLE: 'available',
  INSTALLED: 'installed',
  ACTIVE: 'active',
  DISABLED: 'disabled',
  DEPRECATED: 'deprecated',
  ERROR: 'error'
};

/**
 * Catégories de plugins
 */
const PLUGIN_CATEGORIES = {
  CALENDAR: 'calendar',
  MESSAGING: 'messaging',
  REPORTING: 'reporting',
  SECURITY: 'security',
  INTEGRATION: 'integration',
  OTHER: 'other'
};

/**
 * Types d'événements
 */
const EVENT_TYPES = {
  STARTED: 'started',
  STOPPED: 'stopped',
  EXECUTED: 'executed',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
  DATA_PROCESSED: 'data_processed',
  ACTION_TRIGGERED: 'action_triggered',
  CUSTOM: 'custom'
};

/**
 * Hooks disponibles
 */
const PLUGIN_HOOKS = {
  BEFORE_AUTH: 'before_auth',
  AFTER_AUTH: 'after_auth',
  BEFORE_GUARD_CREATE: 'before_guard_create',
  AFTER_GUARD_CREATE: 'after_guard_create',
  BEFORE_USER_CREATE: 'before_user_create',
  AFTER_USER_CREATE: 'after_user_create',
  ON_NOTIFICATION: 'on_notification',
  ON_MESSAGE: 'on_message',
  ON_SYNC: 'on_sync',
  ON_MAINTENANCE: 'on_maintenance',
  CUSTOM: 'custom'
};

class PluginService {
  constructor(models) {
    this.models = models;
    this.PluginRegistry = models?.PluginRegistry;
    this.PluginConfig = models?.PluginConfig;
    this.PluginEvent = models?.PluginEvent;
    this.AuditLog = models?.AuditLog;

    this._auditService = null;

    // Plugins chargés en mémoire
    this._loadedPlugins = new Map();

    // Hooks enregistrés
    this._hooks = new Map();

    // Chemin des plugins
    this._pluginsPath = config.plugins?.directory || path.join(__dirname, '../../../plugins');
  }

  /**
   * Initialise le service
   */
  async initialize(options = {}) {
    const { auditService, autoLoad = true } = options;
    this._auditService = auditService;

    // Initialiser les hooks
    for (const hook of Object.values(PLUGIN_HOOKS)) {
      this._hooks.set(hook, []);
    }

    // Charger les plugins actifs
    if (autoLoad && config.plugins?.enabled) {
      await this.loadActivePlugins();
    }

    console.log('[PluginService] Initialisé');
    return { initialized: true };
  }

  // =========================================
  // INSTALLATION ET DÉSINSTALLATION
  // =========================================

  /**
   * Installe un plugin depuis le catalogue
   */
  async installPlugin(pluginId, options = {}) {
    const plugin = await this.PluginRegistry.findByPk(pluginId);
    if (!plugin) {
      throw new PluginError('PLUGIN_NOT_FOUND', 'Plugin non trouvé');
    }

    if (plugin.status !== PLUGIN_STATUS.AVAILABLE) {
      throw new PluginError('ALREADY_INSTALLED', 'Plugin déjà installé');
    }

    // Vérifier les dépendances
    const { satisfied, missing } = await plugin.checkDependencies();
    if (!satisfied) {
      throw new PluginError('MISSING_DEPENDENCIES', `Dépendances manquantes: ${missing.join(', ')}`);
    }

    // Créer le répertoire d'installation
    const installPath = path.join(this._pluginsPath, plugin.plugin_name);

    try {
      await fs.mkdir(installPath, { recursive: true });

      // Télécharger ou copier les fichiers du plugin
      // En production, cela téléchargerait depuis download_url
      // Ici, on simule l'installation

      await plugin.install(installPath);

      // Créer la configuration par défaut
      if (this.PluginConfig) {
        await this.PluginConfig.create({
          plugin_id: plugin.plugin_id,
          config_data: plugin.manifest_data.defaultConfig || {},
          is_enabled: false
        });
      }

      await this._logActivity('plugin.installed', {
        pluginId: plugin.plugin_id,
        pluginName: plugin.plugin_name,
        version: plugin.plugin_version
      });

      return {
        success: true,
        pluginId: plugin.plugin_id,
        status: plugin.status
      };
    } catch (error) {
      // Nettoyer en cas d'erreur
      try {
        await fs.rmdir(installPath, { recursive: true });
      } catch (e) {
        // Ignorer
      }
      throw new PluginError('INSTALL_FAILED', error.message);
    }
  }

  /**
   * Désinstalle un plugin
   */
  async uninstallPlugin(pluginId) {
    const plugin = await this.PluginRegistry.findByPk(pluginId);
    if (!plugin) {
      throw new PluginError('PLUGIN_NOT_FOUND', 'Plugin non trouvé');
    }

    if (!plugin.isInstalled()) {
      throw new PluginError('NOT_INSTALLED', 'Plugin non installé');
    }

    // Désactiver d'abord si actif
    if (plugin.status === PLUGIN_STATUS.ACTIVE) {
      await this.deactivatePlugin(pluginId);
    }

    // Supprimer les fichiers
    if (plugin.installation_path) {
      try {
        await fs.rmdir(plugin.installation_path, { recursive: true });
      } catch (error) {
        console.warn(`[PluginService] Erreur suppression fichiers: ${error.message}`);
      }
    }

    // Supprimer la configuration
    if (this.PluginConfig) {
      await this.PluginConfig.destroy({
        where: { plugin_id: pluginId }
      });
    }

    // Supprimer les événements
    if (this.PluginEvent) {
      await this.PluginEvent.destroy({
        where: { plugin_id: pluginId }
      });
    }

    await plugin.uninstall();

    await this._logActivity('plugin.uninstalled', {
      pluginId: plugin.plugin_id,
      pluginName: plugin.plugin_name
    });

    return { success: true };
  }

  // =========================================
  // ACTIVATION ET DÉSACTIVATION
  // =========================================

  /**
   * Active un plugin
   */
  async activatePlugin(pluginId) {
    const plugin = await this.PluginRegistry.findByPk(pluginId);
    if (!plugin) {
      throw new PluginError('PLUGIN_NOT_FOUND', 'Plugin non trouvé');
    }

    if (!plugin.isInstalled()) {
      throw new PluginError('NOT_INSTALLED', 'Plugin non installé');
    }

    if (plugin.isActive()) {
      throw new PluginError('ALREADY_ACTIVE', 'Plugin déjà actif');
    }

    // Charger le plugin
    await this._loadPlugin(plugin);

    // Activer en base
    await plugin.activate();

    // Activer la configuration
    if (this.PluginConfig) {
      await this.PluginConfig.update(
        { is_enabled: true },
        { where: { plugin_id: pluginId } }
      );
    }

    // Émettre un événement
    await this._emitEvent(pluginId, EVENT_TYPES.STARTED, {
      message: 'Plugin activated'
    });

    await this._logActivity('plugin.activated', {
      pluginId: plugin.plugin_id,
      pluginName: plugin.plugin_name
    });

    return { success: true, status: plugin.status };
  }

  /**
   * Désactive un plugin
   */
  async deactivatePlugin(pluginId) {
    const plugin = await this.PluginRegistry.findByPk(pluginId);
    if (!plugin) {
      throw new PluginError('PLUGIN_NOT_FOUND', 'Plugin non trouvé');
    }

    if (!plugin.isActive()) {
      throw new PluginError('NOT_ACTIVE', 'Plugin non actif');
    }

    // Décharger le plugin
    await this._unloadPlugin(plugin);

    // Désactiver en base
    await plugin.deactivate();

    // Désactiver la configuration
    if (this.PluginConfig) {
      await this.PluginConfig.update(
        { is_enabled: false },
        { where: { plugin_id: pluginId } }
      );
    }

    // Émettre un événement
    await this._emitEvent(pluginId, EVENT_TYPES.STOPPED, {
      message: 'Plugin deactivated'
    });

    await this._logActivity('plugin.deactivated', {
      pluginId: plugin.plugin_id,
      pluginName: plugin.plugin_name
    });

    return { success: true };
  }

  /**
   * Charge tous les plugins actifs
   */
  async loadActivePlugins() {
    if (!this.PluginRegistry) return;

    const activePlugins = await this.PluginRegistry.getActivePlugins();

    for (const plugin of activePlugins) {
      try {
        await this._loadPlugin(plugin);
        console.log(`[PluginService] Plugin chargé: ${plugin.plugin_name}`);
      } catch (error) {
        console.error(`[PluginService] Erreur chargement ${plugin.plugin_name}:`, error.message);

        // Marquer le plugin en erreur
        plugin.status = PLUGIN_STATUS.ERROR;
        await plugin.save();
      }
    }

    console.log(`[PluginService] ${this._loadedPlugins.size} plugins chargés`);
  }

  // =========================================
  // CONFIGURATION
  // =========================================

  /**
   * Récupère la configuration d'un plugin
   */
  async getPluginConfig(pluginId) {
    if (!this.PluginConfig) {
      return null;
    }

    const config = await this.PluginConfig.findOne({
      where: { plugin_id: pluginId }
    });

    return config?.config_data || {};
  }

  /**
   * Met à jour la configuration d'un plugin
   */
  async updatePluginConfig(pluginId, newConfig, updatedBy = null) {
    const plugin = await this.PluginRegistry.findByPk(pluginId);
    if (!plugin) {
      throw new PluginError('PLUGIN_NOT_FOUND', 'Plugin non trouvé');
    }

    if (!this.PluginConfig) {
      throw new PluginError('CONFIG_NOT_AVAILABLE', 'Configuration non disponible');
    }

    const [configRecord] = await this.PluginConfig.findOrCreate({
      where: { plugin_id: pluginId },
      defaults: { config_data: {} }
    });

    const mergedConfig = {
      ...configRecord.config_data,
      ...newConfig
    };

    await configRecord.update({
      config_data: mergedConfig,
      configured_by_member_id: updatedBy
    });

    // Notifier le plugin si chargé
    const loadedPlugin = this._loadedPlugins.get(plugin.plugin_name);
    if (loadedPlugin && typeof loadedPlugin.onConfigChange === 'function') {
      try {
        await loadedPlugin.onConfigChange(mergedConfig);
      } catch (error) {
        console.error(`[PluginService] Erreur notification config:`, error.message);
      }
    }

    await this._logActivity('plugin.config_updated', {
      pluginId,
      updatedBy
    });

    return { success: true, config: mergedConfig };
  }

  /**
   * Réinitialise la configuration d'un plugin
   */
  async resetPluginConfig(pluginId) {
    const plugin = await this.PluginRegistry.findByPk(pluginId);
    if (!plugin) {
      throw new PluginError('PLUGIN_NOT_FOUND', 'Plugin non trouvé');
    }

    const defaultConfig = plugin.manifest_data.defaultConfig || {};

    if (this.PluginConfig) {
      await this.PluginConfig.update(
        { config_data: defaultConfig },
        { where: { plugin_id: pluginId } }
      );
    }

    return { success: true, config: defaultConfig };
  }

  // =========================================
  // HOOKS ET ÉVÉNEMENTS
  // =========================================

  /**
   * Enregistre un handler pour un hook
   */
  registerHook(hookName, pluginName, handler) {
    if (!this._hooks.has(hookName)) {
      this._hooks.set(hookName, []);
    }

    this._hooks.get(hookName).push({
      pluginName,
      handler
    });

    console.log(`[PluginService] Hook enregistré: ${hookName} par ${pluginName}`);
  }

  /**
   * Désenregistre un handler
   */
  unregisterHook(hookName, pluginName) {
    if (!this._hooks.has(hookName)) return;

    const handlers = this._hooks.get(hookName);
    this._hooks.set(hookName, handlers.filter(h => h.pluginName !== pluginName));
  }

  /**
   * Désenregistre tous les hooks d'un plugin
   */
  unregisterAllHooks(pluginName) {
    for (const [hookName, handlers] of this._hooks) {
      this._hooks.set(hookName, handlers.filter(h => h.pluginName !== pluginName));
    }
  }

  /**
   * Exécute un hook
   */
  async executeHook(hookName, data = {}) {
    if (!this._hooks.has(hookName)) return { modified: false, data };

    const handlers = this._hooks.get(hookName);
    let modifiedData = { ...data };
    let wasModified = false;

    for (const { pluginName, handler } of handlers) {
      try {
        const result = await handler(modifiedData);
        if (result !== undefined) {
          modifiedData = result;
          wasModified = true;
        }
      } catch (error) {
        console.error(`[PluginService] Erreur hook ${hookName} (${pluginName}):`, error.message);

        // Émettre un événement d'erreur
        const plugin = await this._getPluginByName(pluginName);
        if (plugin) {
          await this._emitEvent(plugin.plugin_id, EVENT_TYPES.ERROR, {
            hook: hookName,
            error: error.message
          }, 'error');
        }
      }
    }

    return { modified: wasModified, data: modifiedData };
  }

  /**
   * Émet un événement pour un plugin
   */
  async _emitEvent(pluginId, eventType, payload = {}, severity = 'info') {
    if (!this.PluginEvent) return;

    try {
      await this.PluginEvent.create({
        plugin_id: pluginId,
        event_type: eventType,
        event_name: `${eventType}_event`,
        payload,
        severity,
        processed: false
      });
    } catch (error) {
      console.error('[PluginService] Erreur émission événement:', error.message);
    }
  }

  /**
   * Récupère les événements non traités
   */
  async getUnprocessedEvents(pluginId = null) {
    if (!this.PluginEvent) return [];

    return this.PluginEvent.getUnprocessedEvents(pluginId);
  }

  /**
   * Marque un événement comme traité
   */
  async markEventProcessed(eventId, result = null) {
    if (!this.PluginEvent) return;

    const event = await this.PluginEvent.findByPk(eventId);
    if (event) {
      await event.markAsProcessed(result);
    }
  }

  // =========================================
  // CATALOGUE ET LISTE
  // =========================================

  /**
   * Récupère la liste des plugins
   */
  async listPlugins(options = {}) {
    const { status, category, page = 1, limit = 20 } = options;

    const where = {};
    if (status) where.status = status;
    if (category) where.category = category;

    const { count, rows } = await this.PluginRegistry.findAndCountAll({
      where,
      order: [['display_name', 'ASC']],
      limit: Math.min(limit, 100),
      offset: (page - 1) * limit,
      include: this.PluginConfig ? [{
        model: this.PluginConfig,
        as: 'configurations',
        attributes: ['is_enabled']
      }] : []
    });

    return {
      plugins: rows.map(p => this._formatPlugin(p)),
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    };
  }

  /**
   * Récupère le catalogue par catégorie
   */
  async getCatalog() {
    if (!this.PluginRegistry) {
      return {};
    }

    return this.PluginRegistry.getCatalog();
  }

  /**
   * Récupère un plugin par ID
   */
  async getPlugin(pluginId) {
    const plugin = await this.PluginRegistry.findByPk(pluginId, {
      include: this.PluginConfig ? [{
        model: this.PluginConfig,
        as: 'configurations'
      }] : []
    });

    if (!plugin) {
      throw new PluginError('PLUGIN_NOT_FOUND', 'Plugin non trouvé');
    }

    return this._formatPlugin(plugin);
  }

  /**
   * Recherche des plugins
   */
  async searchPlugins(keyword) {
    if (!this.PluginRegistry) {
      return [];
    }

    const plugins = await this.PluginRegistry.search(keyword);
    return plugins.map(p => this._formatPlugin(p));
  }

  /**
   * Récupère les statistiques
   */
  async getStatistics() {
    if (!this.PluginRegistry) {
      return { total: 0, active: 0, installed: 0, available: 0 };
    }

    return this.PluginRegistry.getStatistics();
  }

  // =========================================
  // ENREGISTREMENT DE PLUGINS
  // =========================================

  /**
   * Enregistre un nouveau plugin dans le catalogue
   */
  async registerPlugin(manifestData) {
    // Valider le manifest
    this._validateManifest(manifestData);

    // Vérifier l'unicité
    const existing = await this.PluginRegistry.findOne({
      where: { plugin_name: manifestData.name }
    });

    if (existing) {
      throw new PluginError('PLUGIN_EXISTS', 'Un plugin avec ce nom existe déjà');
    }

    const plugin = await this.PluginRegistry.registerPlugin(manifestData);

    await this._logActivity('plugin.registered', {
      pluginId: plugin.plugin_id,
      pluginName: plugin.plugin_name
    });

    return this._formatPlugin(plugin);
  }

  /**
   * Met à jour un plugin
   */
  async updatePlugin(pluginId, newVersion, newManifest) {
    const plugin = await this.PluginRegistry.findByPk(pluginId);
    if (!plugin) {
      throw new PluginError('PLUGIN_NOT_FOUND', 'Plugin non trouvé');
    }

    // Valider le nouveau manifest
    this._validateManifest(newManifest);

    // Désactiver si actif
    const wasActive = plugin.isActive();
    if (wasActive) {
      await this.deactivatePlugin(pluginId);
    }

    // Mettre à jour
    await plugin.updateVersion(newVersion, newManifest);

    // Réactiver si nécessaire
    if (wasActive) {
      await this.activatePlugin(pluginId);
    }

    await this._logActivity('plugin.updated', {
      pluginId: plugin.plugin_id,
      pluginName: plugin.plugin_name,
      newVersion
    });

    return this._formatPlugin(plugin);
  }

  /**
   * Supprime un plugin du catalogue
   */
  async deletePlugin(pluginId) {
    const plugin = await this.PluginRegistry.findByPk(pluginId);
    if (!plugin) {
      throw new PluginError('PLUGIN_NOT_FOUND', 'Plugin non trouvé');
    }

    if (plugin.isInstalled()) {
      throw new PluginError('STILL_INSTALLED', 'Désinstallez le plugin avant suppression');
    }

    await plugin.destroy();

    await this._logActivity('plugin.deleted', {
      pluginId,
      pluginName: plugin.plugin_name
    });

    return { success: true };
  }

  // =========================================
  // MÉTHODES PRIVÉES
  // =========================================

  /**
   * Charge un plugin en mémoire
   */
  async _loadPlugin(plugin) {
    if (this._loadedPlugins.has(plugin.plugin_name)) {
      return this._loadedPlugins.get(plugin.plugin_name);
    }

    const pluginPath = plugin.installation_path || path.join(this._pluginsPath, plugin.plugin_name);

    try {
      // Vérifier que le fichier principal existe
      const mainFile = path.join(pluginPath, 'index.js');
      await fs.access(mainFile);

      // Charger le module
      const PluginModule = require(mainFile);
      const instance = new PluginModule({
        config: await this.getPluginConfig(plugin.plugin_id),
        models: this.models,
        hooks: {
          register: (hookName, handler) => this.registerHook(hookName, plugin.plugin_name, handler)
        },
        emit: (eventType, payload, severity) => this._emitEvent(plugin.plugin_id, eventType, payload, severity)
      });

      // Initialiser si méthode disponible
      if (typeof instance.initialize === 'function') {
        await instance.initialize();
      }

      // Enregistrer les hooks déclarés
      if (instance.hooks && typeof instance.hooks === 'object') {
        for (const [hookName, handler] of Object.entries(instance.hooks)) {
          this.registerHook(hookName, plugin.plugin_name, handler);
        }
      }

      this._loadedPlugins.set(plugin.plugin_name, instance);

      return instance;
    } catch (error) {
      console.error(`[PluginService] Erreur chargement plugin ${plugin.plugin_name}:`, error.message);
      throw error;
    }
  }

  /**
   * Décharge un plugin de la mémoire
   */
  async _unloadPlugin(plugin) {
    const instance = this._loadedPlugins.get(plugin.plugin_name);

    if (instance) {
      // Appeler la méthode de destruction si disponible
      if (typeof instance.destroy === 'function') {
        try {
          await instance.destroy();
        } catch (error) {
          console.error(`[PluginService] Erreur destruction plugin:`, error.message);
        }
      }

      // Désenregistrer les hooks
      this.unregisterAllHooks(plugin.plugin_name);

      // Retirer de la mémoire
      this._loadedPlugins.delete(plugin.plugin_name);

      // Supprimer du cache require
      const pluginPath = plugin.installation_path || path.join(this._pluginsPath, plugin.plugin_name);
      const mainFile = path.join(pluginPath, 'index.js');
      delete require.cache[require.resolve(mainFile)];
    }
  }

  /**
   * Récupère un plugin par nom
   */
  async _getPluginByName(pluginName) {
    return this.PluginRegistry.findOne({
      where: { plugin_name: pluginName }
    });
  }

  /**
   * Valide un manifest de plugin
   */
  _validateManifest(manifest) {
    const required = ['name', 'version'];

    for (const field of required) {
      if (!manifest[field]) {
        throw new PluginError('INVALID_MANIFEST', `Champ requis manquant: ${field}`);
      }
    }

    // Valider le format de version (semver)
    if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
      throw new PluginError('INVALID_VERSION', 'Format de version invalide (semver requis)');
    }

    // Valider le nom (alphanumerique avec tirets)
    if (!/^[a-z0-9-]+$/.test(manifest.name)) {
      throw new PluginError('INVALID_NAME', 'Nom invalide (alphanumerique et tirets uniquement)');
    }
  }

  /**
   * Formate un plugin pour l'API
   */
  _formatPlugin(plugin) {
    return {
      pluginId: plugin.plugin_id,
      name: plugin.plugin_name,
      version: plugin.plugin_version,
      displayName: plugin.display_name,
      description: plugin.description,
      author: plugin.author,
      category: plugin.category,
      status: plugin.status,
      isLoaded: this._loadedPlugins.has(plugin.plugin_name),
      permissions: plugin.permissions_required,
      dependencies: plugin.dependencies,
      config: plugin.configurations?.[0]?.config_data || null,
      installedAt: plugin.installed_at,
      activatedAt: plugin.activated_at,
      lastUpdated: plugin.last_updated
    };
  }

  /**
   * Log une activité
   */
  async _logActivity(action, data) {
    try {
      if (this._auditService) {
        await this._auditService.logOperation(action, {
          module: 'plugins',
          ...data
        });
      }
    } catch (error) {
      console.error('[PluginService] Erreur audit:', error.message);
    }
  }

  // =========================================
  // ADMINISTRATION
  // =========================================

  /**
   * Récupère l'état des plugins chargés
   */
  getLoadedPlugins() {
    return Array.from(this._loadedPlugins.keys());
  }

  /**
   * Recharge tous les plugins
   */
  async reloadAllPlugins() {
    // Décharger tous les plugins
    for (const [pluginName] of this._loadedPlugins) {
      const plugin = await this._getPluginByName(pluginName);
      if (plugin) {
        await this._unloadPlugin(plugin);
      }
    }

    // Recharger les plugins actifs
    await this.loadActivePlugins();

    return { reloaded: this._loadedPlugins.size };
  }

  /**
   * Arrête le service proprement
   */
  async shutdown() {
    // Décharger tous les plugins
    for (const [pluginName] of this._loadedPlugins) {
      const plugin = await this._getPluginByName(pluginName);
      if (plugin) {
        await this._unloadPlugin(plugin);
      }
    }

    console.log('[PluginService] Arrêté');
  }
}

/**
 * Classe d'erreur pour le service de plugins
 */
class PluginError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PluginError';
    this.code = code;
  }
}

module.exports = PluginService;
module.exports.PluginError = PluginError;
module.exports.PLUGIN_STATUS = PLUGIN_STATUS;
module.exports.PLUGIN_CATEGORIES = PLUGIN_CATEGORIES;
module.exports.EVENT_TYPES = EVENT_TYPES;
module.exports.PLUGIN_HOOKS = PLUGIN_HOOKS;
