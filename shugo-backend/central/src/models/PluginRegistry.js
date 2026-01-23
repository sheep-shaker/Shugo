/**
 * SHUGO v7.0 - Modèle PluginRegistry
 * 
 * Registre centralisé des plugins disponibles et installés.
 * Gère le cycle de vie des plugins : installation, activation,
 * désactivation et mise à jour.
 * 
 * Référence: Document Technique V7.0 - Section 7 et Annexe A.7.1
 */

'use strict';

const { Model, DataTypes, Op } = require('sequelize');
const crypto = require('crypto');

module.exports = (sequelize) => {
  class PluginRegistry extends Model {
    /**
     * Définit les associations avec les autres modèles
     */
    static associate(models) {
      // Configurations du plugin
      PluginRegistry.hasMany(models.PluginConfiguration, {
        foreignKey: 'plugin_id',
        as: 'configurations',
        onDelete: 'CASCADE'
      });
    }

    /**
     * Enregistre un nouveau plugin
     */
    static async registerPlugin(manifestData) {
      // Génération du hash de signature
      const signatureHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(manifestData))
        .digest('hex');

      return this.create({
        plugin_name: manifestData.name,
        plugin_version: manifestData.version,
        display_name: manifestData.displayName || manifestData.name,
        description: manifestData.description,
        author: manifestData.author,
        category: manifestData.category || null,
        status: 'available',
        manifest_data: manifestData,
        permissions_required: manifestData.permissions || [],
        dependencies: manifestData.dependencies || [],
        signature_hash: signatureHash
      });
    }

    /**
     * Installe le plugin
     */
    async install(installationPath) {
      this.status = 'installed';
      this.installation_path = installationPath;
      this.installed_at = new Date();
      await this.save();
    }

    /**
     * Active le plugin
     */
    async activate() {
      if (this.status !== 'installed' && this.status !== 'disabled') {
        throw new Error('Le plugin doit être installé avant d\'être activé');
      }
      this.status = 'active';
      this.activated_at = new Date();
      await this.save();
    }

    /**
     * Désactive le plugin
     */
    async deactivate() {
      this.status = 'disabled';
      await this.save();
    }

    /**
     * Désinstalle le plugin
     */
    async uninstall() {
      this.status = 'available';
      this.installation_path = null;
      this.installed_at = null;
      this.activated_at = null;
      await this.save();
    }

    /**
     * Met à jour le plugin
     */
    async updateVersion(newVersion, newManifest) {
      this.plugin_version = newVersion;
      this.manifest_data = newManifest;
      this.last_updated = new Date();
      
      // Recalcul du hash de signature
      this.signature_hash = crypto
        .createHash('sha256')
        .update(JSON.stringify(newManifest))
        .digest('hex');
      
      await this.save();
    }

    /**
     * Vérifie la signature du plugin
     */
    verifySignature(manifestData) {
      const computedHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(manifestData))
        .digest('hex');
      
      return computedHash === this.signature_hash;
    }

    /**
     * Vérifie si le plugin est actif
     */
    isActive() {
      return this.status === 'active';
    }

    /**
     * Vérifie si le plugin est installé
     */
    isInstalled() {
      return ['installed', 'active', 'disabled'].includes(this.status);
    }

    /**
     * Récupère les plugins par statut
     */
    static async getByStatus(status) {
      return this.findAll({
        where: { status },
        order: [['display_name', 'ASC']]
      });
    }

    /**
     * Récupère les plugins actifs
     */
    static async getActivePlugins() {
      return this.findAll({
        where: { status: 'active' },
        include: [{ association: 'configurations' }]
      });
    }

    /**
     * Récupère les plugins par catégorie
     */
    static async getByCategory(category) {
      return this.findAll({
        where: { category },
        order: [['display_name', 'ASC']]
      });
    }

    /**
     * Recherche des plugins
     */
    static async search(keyword) {
      return this.findAll({
        where: {
          [Op.or]: [
            { plugin_name: { [Op.iLike]: `%${keyword}%` } },
            { display_name: { [Op.iLike]: `%${keyword}%` } },
            { description: { [Op.iLike]: `%${keyword}%` } }
          ]
        },
        order: [['display_name', 'ASC']]
      });
    }

    /**
     * Vérifie les dépendances du plugin
     */
    async checkDependencies() {
      if (!this.dependencies || this.dependencies.length === 0) {
        return { satisfied: true, missing: [] };
      }

      const installedPlugins = await PluginRegistry.findAll({
        where: {
          plugin_name: { [Op.in]: this.dependencies },
          status: { [Op.in]: ['installed', 'active'] }
        },
        attributes: ['plugin_name']
      });

      const installedNames = installedPlugins.map(p => p.plugin_name);
      const missing = this.dependencies.filter(dep => !installedNames.includes(dep));

      return {
        satisfied: missing.length === 0,
        missing
      };
    }

    /**
     * Récupère le catalogue complet des plugins
     */
    static async getCatalog() {
      const plugins = await this.findAll({
        order: [['category', 'ASC'], ['display_name', 'ASC']]
      });

      // Grouper par catégorie
      return plugins.reduce((catalog, plugin) => {
        const cat = plugin.category || 'other';
        if (!catalog[cat]) {
          catalog[cat] = [];
        }
        catalog[cat].push({
          name: plugin.plugin_name,
          displayName: plugin.display_name,
          version: plugin.plugin_version,
          description: plugin.description,
          author: plugin.author,
          status: plugin.status
        });
        return catalog;
      }, {});
    }

    /**
     * Récupère les statistiques des plugins
     */
    static async getStatistics() {
      const plugins = await this.findAll();

      return {
        total: plugins.length,
        active: plugins.filter(p => p.status === 'active').length,
        installed: plugins.filter(p => p.isInstalled()).length,
        available: plugins.filter(p => p.status === 'available').length,
        deprecated: plugins.filter(p => p.status === 'deprecated').length
      };
    }
  }

  PluginRegistry.init({
    plugin_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'Identifiant unique du plugin'
    },
    plugin_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
      comment: 'Nom technique du plugin'
    },
    plugin_version: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment: 'Version du plugin (semver)'
    },
    display_name: {
      type: DataTypes.STRING(200),
      allowNull: false,
      comment: 'Nom d\'affichage du plugin'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Description du plugin'
    },
    author: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Auteur du plugin'
    },
    category: {
      type: DataTypes.STRING(50),
      allowNull: true,
      validate: {
        isIn: [['calendar', 'messaging', 'reporting', 'security', 'integration', 'other', null]]
      },
      comment: 'Catégorie du plugin'
    },
    status: {
      type: DataTypes.ENUM('available', 'installed', 'active', 'disabled', 'deprecated'),
      defaultValue: 'available',
      comment: 'Statut du plugin'
    },
    installation_path: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Chemin d\'installation'
    },
    manifest_data: {
      type: DataTypes.JSON,
      allowNull: false,
      comment: 'Contenu du manifest.json'
    },
    permissions_required: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Permissions nécessaires'
    },
    dependencies: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Dépendances vers autres plugins'
    },
    signature_hash: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: 'Hash de signature pour vérification d\'intégrité'
    },
    download_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'URL de téléchargement'
    },
    file_size_bytes: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'Taille du plugin'
    },
    installed_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'installation'
    },
    activated_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'activation'
    },
    last_updated: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date de dernière mise à jour'
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    sequelize,
    modelName: 'PluginRegistry',
    tableName: 'plugin_registry',
    timestamps: false,
    indexes: [
      { fields: ['plugin_name'], unique: true },
      { fields: ['status'] },
      { fields: ['category'] }
    ]
  });

  return PluginRegistry;
};
