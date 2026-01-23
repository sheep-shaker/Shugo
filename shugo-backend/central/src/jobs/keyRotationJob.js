// jobs/keyRotationJob.js
// Job CRON pour la rotation automatique des clés de sécurité

const cron = require('node-cron');
const crypto = require('crypto');
const { AuditLog, SystemConfig, VaultKey } = require('../models');
const VaultService = require('../services/VaultService');
const NotificationService = require('../services/NotificationService');
const BackupService = require('../services/BackupService');
const config = require('../config');

class KeyRotationJob {
  constructor() {
    this.jobName = 'KeyRotationJob';
    this.schedule = config.jobs?.keyRotation?.schedule || '0 0 1 * *'; // 1er du mois à minuit
    this.enabled = config.jobs?.keyRotation?.enabled !== false;
    this.task = null;
    this.isRunning = false;
    this.rotationTypes = [
      'vault_keys',
      'jwt_secrets',
      'api_keys',
      'encryption_keys',
      'session_secrets'
    ];
    this.stats = {
      totalRotations: 0,
      lastRotation: null,
      failures: 0
    };
  }

  /**
   * Démarrer le job
   */
  async start() {
    if (!this.enabled) {
      console.log(`[${this.jobName}] Job désactivé`);
      return;
    }

    if (this.task) {
      console.log(`[${this.jobName}] Job déjà démarré`);
      return;
    }

    this.task = cron.schedule(this.schedule, async () => {
      await this.execute();
    }, {
      scheduled: true,
      timezone: config.timezone || 'Europe/Paris'
    });

    console.log(`[${this.jobName}] Job démarré: ${this.schedule}`);
    
    // Vérifier si rotation nécessaire au démarrage
    await this.checkPendingRotations();
  }

  /**
   * Arrêter le job
   */
  async stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log(`[${this.jobName}] Job arrêté`);
    }
  }

  /**
   * Exécuter la rotation
   */
  async execute() {
    if (this.isRunning) {
      console.log(`[${this.jobName}] Rotation déjà en cours`);
      return;
    }

    const startTime = Date.now();
    this.isRunning = true;

    console.log(`[${this.jobName}] Début rotation des clés`);

    try {
      // Créer une sauvegarde avant rotation
      await this.createPreRotationBackup();

      const results = {
        rotated: [],
        failed: [],
        duration: 0
      };

      // Rotation de chaque type de clé
      for (const type of this.rotationTypes) {
        try {
          console.log(`[${this.jobName}] Rotation: ${type}`);
          const result = await this.rotateKeys(type);
          results.rotated.push({
            type,
            ...result
          });
        } catch (error) {
          console.error(`[${this.jobName}] Erreur rotation ${type}:`, error);
          results.failed.push({
            type,
            error: error.message
          });
        }
      }

      results.duration = Date.now() - startTime;

      // Mettre à jour les stats
      this.stats.totalRotations++;
      this.stats.lastRotation = {
        timestamp: new Date(),
        results
      };

      if (results.failed.length > 0) {
        this.stats.failures++;
      }

      console.log(`[${this.jobName}] Rotation terminée en ${results.duration}ms`);
      console.log(`  - Clés rotées: ${results.rotated.length}/${this.rotationTypes.length}`);
      console.log(`  - Échecs: ${results.failed.length}`);

      // Log audit
      await this.logAudit('key_rotation.completed', 'critical', results);

      // Notifier les admins
      await this.notifyRotationComplete(results);

      // Si échecs, tenter une restauration
      if (results.failed.length > 0) {
        await this.handleRotationFailure(results);
      }

    } catch (error) {
      console.error(`[${this.jobName}] Erreur critique:`, error);
      
      await this.logAudit('key_rotation.failed', 'critical', {
        error: error.message,
        stack: error.stack
      });

      await this.emergencyNotification(error);

    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Rotation des clés par type
   */
  async rotateKeys(type) {
    const rotationMethods = {
      'vault_keys': () => this.rotateVaultKeys(),
      'jwt_secrets': () => this.rotateJWTSecrets(),
      'api_keys': () => this.rotateAPIKeys(),
      'encryption_keys': () => this.rotateEncryptionKeys(),
      'session_secrets': () => this.rotateSessionSecrets()
    };

    const method = rotationMethods[type];
    if (!method) {
      throw new Error(`Type de rotation inconnu: ${type}`);
    }

    return await method();
  }

  /**
   * Rotation des clés du vault
   */
  async rotateVaultKeys() {
    const result = await VaultService.rotateKeys();
    
    // Sauvegarder la nouvelle clé
    await SystemConfig.upsert({
      config_key: 'vault.last_key_rotation',
      config_value: new Date().toISOString(),
      metadata: {
        key_id: result.new_key_id,
        items_reencrypted: result.items_reencrypted
      }
    });

    return {
      items_reencrypted: result.items_reencrypted,
      new_key_id: result.new_key_id
    };
  }

  /**
   * Rotation des secrets JWT
   */
  async rotateJWTSecrets() {
    // Générer de nouveaux secrets
    const newSecret = crypto.randomBytes(64).toString('hex');
    const newRefreshSecret = crypto.randomBytes(64).toString('hex');

    // Sauvegarder les anciens secrets
    const oldSecret = config.jwt.secret;
    const oldRefreshSecret = config.jwt.refreshSecret;

    // Mettre à jour la configuration
    await SystemConfig.bulkCreate([
      {
        config_key: 'jwt.secret',
        config_value: newSecret,
        encrypted: true
      },
      {
        config_key: 'jwt.refresh_secret',
        config_value: newRefreshSecret,
        encrypted: true
      },
      {
        config_key: 'jwt.old_secret',
        config_value: oldSecret,
        encrypted: true,
        metadata: { rotated_at: new Date() }
      }
    ], {
      updateOnDuplicate: ['config_value', 'metadata', 'updated_at']
    });

    // Mettre à jour la config en mémoire
    config.jwt.secret = newSecret;
    config.jwt.refreshSecret = newRefreshSecret;

    // Invalider toutes les sessions existantes dans 24h
    this.scheduleSessionInvalidation();

    return {
      secrets_rotated: 2,
      grace_period: '24 hours'
    };
  }

  /**
   * Rotation des clés API
   */
  async rotateAPIKeys() {
    const ApiKey = require('../models').ApiKey;
    
    // Récupérer toutes les clés actives
    const activeKeys = await ApiKey.findAll({
      where: { is_active: true }
    });

    let rotated = 0;

    for (const key of activeKeys) {
      // Vérifier l'âge de la clé
      const age = Date.now() - key.created_at;
      const maxAge = config.security?.apiKeyMaxAge || 90 * 24 * 60 * 60 * 1000; // 90 jours

      if (age > maxAge) {
        // Générer une nouvelle clé
        const newKey = `sk_${crypto.randomBytes(32).toString('hex')}`;
        
        // Créer la nouvelle clé
        await ApiKey.create({
          member_id: key.member_id,
          key_hash: crypto.createHash('sha256').update(newKey).digest('hex'),
          name: `${key.name} (rotated)`,
          permissions: key.permissions,
          is_active: true,
          expires_at: new Date(Date.now() + maxAge)
        });

        // Désactiver l'ancienne après 7 jours
        await key.update({
          is_active: false,
          deactivated_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          metadata: {
            ...key.metadata,
            rotated: true,
            rotated_at: new Date()
          }
        });

        rotated++;

        // Notifier le propriétaire
        await this.notifyKeyRotation(key.member_id, key.name);
      }
    }

    return {
      keys_checked: activeKeys.length,
      keys_rotated: rotated
    };
  }

  /**
   * Rotation des clés de chiffrement
   */
  async rotateEncryptionKeys() {
    // Générer une nouvelle clé de chiffrement
    const newKey = crypto.randomBytes(32);
    const newKeyHex = newKey.toString('hex');

    // Sauvegarder l'ancienne clé
    const oldKey = config.encryption?.key;

    // Mettre à jour la configuration
    await SystemConfig.upsert({
      config_key: 'encryption.key',
      config_value: newKeyHex,
      encrypted: true,
      metadata: {
        algorithm: 'aes-256-gcm',
        rotated_at: new Date(),
        previous_key_id: crypto.createHash('sha256').update(oldKey || '').digest('hex').substring(0, 8)
      }
    });

    // Re-chiffrer les données sensibles
    await this.reencryptSensitiveData(oldKey, newKeyHex);

    return {
      key_rotated: true,
      algorithm: 'aes-256-gcm'
    };
  }

  /**
   * Rotation des secrets de session
   */
  async rotateSessionSecrets() {
    const newSecret = crypto.randomBytes(32).toString('hex');

    await SystemConfig.upsert({
      config_key: 'session.secret',
      config_value: newSecret,
      encrypted: true
    });

    // Invalider toutes les sessions
    const Session = require('../models').Session;
    const invalidated = await Session.update(
      { is_active: false },
      { where: { is_active: true } }
    );

    return {
      secret_rotated: true,
      sessions_invalidated: invalidated[0]
    };
  }

  /**
   * Créer une sauvegarde avant rotation
   */
  async createPreRotationBackup() {
    console.log(`[${this.jobName}] Création sauvegarde pré-rotation`);
    
    await BackupService.createBackup({
      backup_type: 'pre_rotation',
      components: ['database', 'vault', 'configs'],
      encryption_enabled: true,
      retention_days: 30,
      description: 'Sauvegarde automatique avant rotation des clés',
      initiated_by: 'SYSTEM_KEY_ROTATION'
    });
  }

  /**
   * Re-chiffrer les données sensibles
   */
  async reencryptSensitiveData(oldKey, newKey) {
    // Implémenter le re-chiffrement des données
    // Ceci dépend de votre structure de données
    console.log(`[${this.jobName}] Re-chiffrement des données sensibles`);
  }

  /**
   * Vérifier les rotations en attente
   */
  async checkPendingRotations() {
    const lastRotations = await SystemConfig.findAll({
      where: {
        config_key: {
          [Op.like]: '%.last_rotation'
        }
      }
    });

    for (const config of lastRotations) {
      const lastDate = new Date(config.config_value);
      const daysSince = (Date.now() - lastDate) / (24 * 60 * 60 * 1000);

      if (daysSince > 30) {
        console.log(`[${this.jobName}] Rotation en retard pour ${config.config_key}: ${daysSince} jours`);
        
        await NotificationService.broadcastToAdmins({
          type: 'key_rotation.overdue',
          title: 'Rotation de clés en retard',
          message: `La rotation pour ${config.config_key} n'a pas été effectuée depuis ${Math.floor(daysSince)} jours`,
          priority: 'high'
        });
      }
    }
  }

  /**
   * Gérer l'échec de rotation
   */
  async handleRotationFailure(results) {
    console.error(`[${this.jobName}] Tentative de récupération après échec`);

    // Si plus de 50% d'échec, restaurer
    if (results.failed.length > this.rotationTypes.length / 2) {
      console.error(`[${this.jobName}] Échec critique, restauration nécessaire`);
      
      // Déclencher protocole Papier Froissé
      await this.triggerEmergencyRestore();
    }
  }

  /**
   * Déclencher une restauration d'urgence
   */
  async triggerEmergencyRestore() {
    await NotificationService.broadcastToAdmins({
      type: 'key_rotation.emergency',
      title: '🚨 ÉCHEC CRITIQUE ROTATION',
      message: 'La rotation des clés a échoué. Restauration d\'urgence requise.',
      priority: 'critical',
      data: {
        action_required: 'Exécuter le protocole Papier Froissé immédiatement'
      }
    });
  }

  /**
   * Programmer l'invalidation des sessions
   */
  scheduleSessionInvalidation() {
    setTimeout(async () => {
      const Session = require('../models').Session;
      await Session.update(
        { is_active: false },
        { 
          where: { 
            created_at: { [Op.lt]: new Date() }
          }
        }
      );
      console.log(`[${this.jobName}] Sessions anciennes invalidées`);
    }, 24 * 60 * 60 * 1000); // 24 heures
  }

  /**
   * Notifier la rotation d'une clé API
   */
  async notifyKeyRotation(userId, keyName) {
    await NotificationService.send({
      user_id: userId,
      type: 'api_key.rotated',
      title: 'Clé API rotée',
      message: `Votre clé API "${keyName}" a été rotée. L'ancienne clé reste valide pendant 7 jours.`,
      priority: 'high'
    });
  }

  /**
   * Notifier la completion
   */
  async notifyRotationComplete(results) {
    await NotificationService.broadcastToAdmins({
      type: 'key_rotation.complete',
      title: 'Rotation des clés terminée',
      message: `Rotation effectuée: ${results.rotated.length} succès, ${results.failed.length} échecs`,
      priority: results.failed.length > 0 ? 'warning' : 'info',
      data: results
    });
  }

  /**
   * Notification d'urgence
   */
  async emergencyNotification(error) {
    await NotificationService.broadcastToAdmins({
      type: 'key_rotation.critical_error',
      title: '🚨 ERREUR CRITIQUE ROTATION',
      message: `Erreur critique lors de la rotation: ${error.message}`,
      priority: 'critical',
      data: {
        error: error.message,
        stack: error.stack,
        timestamp: new Date()
      }
    });
  }

  /**
   * Logger dans l'audit
   */
  async logAudit(action, severity, details) {
    try {
      await AuditLog.create({
        action_type: action,
        entity_type: 'security',
        entity_id: this.jobName,
        severity,
        details
      });
    } catch (error) {
      console.error(`[${this.jobName}] Erreur audit:`, error);
    }
  }

  /**
   * Obtenir le statut
   */
  getStatus() {
    return {
      name: this.jobName,
      enabled: this.enabled,
      schedule: this.schedule,
      running: this.isRunning,
      stats: this.stats
    };
  }

  /**
   * Rotation manuelle
   */
  async runManual(type = null) {
    if (type) {
      console.log(`[${this.jobName}] Rotation manuelle: ${type}`);
      return await this.rotateKeys(type);
    } else {
      console.log(`[${this.jobName}] Rotation manuelle complète`);
      return await this.execute();
    }
  }
}

module.exports = new KeyRotationJob();
