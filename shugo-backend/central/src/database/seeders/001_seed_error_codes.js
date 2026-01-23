'use strict';

/**
 * Seeder 001 - Codes erreur SHUGO
 * 
 * Peuple la table error_codes_registry avec les codes standard.
 * Format: SHUGO-{CATEGORY}-{SEVERITY}-{NUMBER}
 * 
 * @see Document Technique V7.0 - Section 11.2
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const errorCodes = [
      // === SYS - Système et infrastructure ===
      {
        error_code: 'SHUGO-SYS-INFO-001',
        category: 'SYS',
        severity: 'INFO',
        title: 'Service démarré',
        description: 'Un service système a démarré correctement.',
        auto_resolution_available: false
      },
      {
        error_code: 'SHUGO-SYS-WARN-001',
        category: 'SYS',
        severity: 'WARN',
        title: 'Espace disque faible',
        description: 'Espace disque disponible inférieur à 20%.',
        resolution_steps: 'Nettoyer les logs anciens, supprimer les fichiers temporaires.',
        auto_resolution_available: true,
        auto_resolution_action: 'cleanupOldLogs'
      },
      {
        error_code: 'SHUGO-SYS-WARN-002',
        category: 'SYS',
        severity: 'WARN',
        title: 'Mémoire système faible',
        description: 'Utilisation mémoire supérieure à 85%.',
        resolution_steps: 'Redémarrer les services non essentiels.',
        auto_resolution_available: true,
        auto_resolution_action: 'restartNonCriticalServices'
      },
      {
        error_code: 'SHUGO-SYS-ERROR-001',
        category: 'SYS',
        severity: 'ERROR',
        title: 'Service non disponible',
        description: 'Un service critique ne répond pas.',
        resolution_steps: 'Redémarrer le service concerné.',
        auto_resolution_available: true,
        auto_resolution_action: 'restartService'
      },
      {
        error_code: 'SHUGO-SYS-CRITICAL-001',
        category: 'SYS',
        severity: 'CRITICAL',
        title: 'Serveur en surcharge critique',
        description: 'Ressources système insuffisantes pour fonctionner.',
        resolution_steps: 'Intervention manuelle requise. Vérifier les processus.',
        auto_resolution_available: false
      },

      // === AUTH - Authentification et autorisation ===
      {
        error_code: 'SHUGO-AUTH-INFO-001',
        category: 'AUTH',
        severity: 'INFO',
        title: 'Connexion réussie',
        description: 'Un utilisateur s\'est connecté avec succès.',
        auto_resolution_available: false
      },
      {
        error_code: 'SHUGO-AUTH-WARN-001',
        category: 'AUTH',
        severity: 'WARN',
        title: 'Tentatives de connexion multiples',
        description: 'Plusieurs tentatives de connexion échouées détectées.',
        resolution_steps: 'Vérifier l\'IP source et l\'utilisateur concerné.',
        auto_resolution_available: false
      },
      {
        error_code: 'SHUGO-AUTH-ERROR-001',
        category: 'AUTH',
        severity: 'ERROR',
        title: 'Compte verrouillé',
        description: 'Compte verrouillé après trop d\'échecs d\'authentification.',
        resolution_steps: 'Débloquer manuellement via interface admin.',
        auto_resolution_available: false
      },
      {
        error_code: 'SHUGO-AUTH-ERROR-002',
        category: 'AUTH',
        severity: 'ERROR',
        title: 'Token JWT invalide',
        description: 'Token d\'authentification invalide ou expiré.',
        resolution_steps: 'L\'utilisateur doit se reconnecter.',
        auto_resolution_available: false
      },
      {
        error_code: 'SHUGO-AUTH-ERROR-023',
        category: 'AUTH',
        severity: 'ERROR',
        title: 'Échecs répétés depuis IP',
        description: 'Multiples échecs d\'authentification depuis une même IP.',
        resolution_steps: 'Bloquer temporairement l\'IP.',
        auto_resolution_available: true,
        auto_resolution_action: 'blockIP'
      },
      {
        error_code: 'SHUGO-AUTH-CRITICAL-001',
        category: 'AUTH',
        severity: 'CRITICAL',
        title: 'Compromission suspectée',
        description: 'Tentative d\'accès non autorisé détectée.',
        resolution_steps: 'Activer le protocole d'integrite, notifier les administrateurs.',
        auto_resolution_available: true,
        auto_resolution_action: 'triggerIntegrityCheck'
      },

      // === GUARD - Gestion des gardes ===
      {
        error_code: 'SHUGO-GUARD-INFO-001',
        category: 'GUARD',
        severity: 'INFO',
        title: 'Inscription confirmée',
        description: 'Inscription à une garde confirmée.',
        auto_resolution_available: false
      },
      {
        error_code: 'SHUGO-GUARD-INFO-003',
        category: 'GUARD',
        severity: 'INFO',
        title: 'Planning optimisé',
        description: 'Le planning a été automatiquement optimisé.',
        auto_resolution_available: false
      },
      {
        error_code: 'SHUGO-GUARD-WARN-001',
        category: 'GUARD',
        severity: 'WARN',
        title: 'Créneau bientôt vide',
        description: 'Créneau de garde sans inscription à J-3.',
        resolution_steps: 'Activer la liste d\'attente automatiquement.',
        auto_resolution_available: true,
        auto_resolution_action: 'activateWaitingList'
      },
      {
        error_code: 'SHUGO-GUARD-ERROR-001',
        category: 'GUARD',
        severity: 'ERROR',
        title: 'Annulation tardive',
        description: 'Annulation de garde à moins de 72h.',
        resolution_steps: 'Notifier les Platinum, proposer remplaçant.',
        auto_resolution_available: false
      },

      // === VAULT - Sécurité et cryptographie ===
      {
        error_code: 'SHUGO-VAULT-WARN-001',
        category: 'VAULT',
        severity: 'WARN',
        title: 'Rotation de clé imminente',
        description: 'Clé AES expire dans moins de 30 jours.',
        resolution_steps: 'Préparer la rotation lors de la prochaine maintenance.',
        auto_resolution_available: false
      },
      {
        error_code: 'SHUGO-VAULT-ERROR-001',
        category: 'VAULT',
        severity: 'ERROR',
        title: 'Échec de déchiffrement',
        description: 'Impossible de déchiffrer des données du Vault.',
        resolution_steps: 'Vérifier l\'intégrité de la clé et des données.',
        auto_resolution_available: false
      },
      {
        error_code: 'SHUGO-VAULT-CRITICAL-007',
        category: 'VAULT',
        severity: 'CRITICAL',
        title: 'Corruption du Vault',
        description: 'Corruption détectée dans le Vault local.',
        resolution_steps: 'Basculer vers Vault de secours, déclencher le protocole d'integrite.',
        auto_resolution_available: true,
        auto_resolution_action: 'triggerIntegrityCheck'
      },

      // === NET - Réseau et communication ===
      {
        error_code: 'SHUGO-NET-WARN-001',
        category: 'NET',
        severity: 'WARN',
        title: 'Latence réseau élevée',
        description: 'Temps de réponse réseau supérieur au seuil.',
        resolution_steps: 'Vérifier la connexion réseau.',
        auto_resolution_available: false
      },
      {
        error_code: 'SHUGO-NET-ERROR-012',
        category: 'NET',
        severity: 'ERROR',
        title: 'Perte de communication centrale',
        description: 'Perte de communication avec le serveur central.',
        resolution_steps: 'Activer mode autonome, tenter reconnexion.',
        auto_resolution_available: true,
        auto_resolution_action: 'enableOfflineMode'
      },
      {
        error_code: 'SHUGO-NET-CRITICAL-001',
        category: 'NET',
        severity: 'CRITICAL',
        title: 'Isolation réseau détectée',
        description: 'Le serveur semble isolé du réseau.',
        resolution_steps: 'Intervention physique requise.',
        auto_resolution_available: false
      },

      // === DATA - Base de données et intégrité ===
      {
        error_code: 'SHUGO-DATA-WARN-001',
        category: 'DATA',
        severity: 'WARN',
        title: 'Index fragmenté',
        description: 'Un index de base de données nécessite une maintenance.',
        resolution_steps: 'Reconstruire l\'index lors de la prochaine maintenance.',
        auto_resolution_available: true,
        auto_resolution_action: 'scheduleIndexRebuild'
      },
      {
        error_code: 'SHUGO-DATA-WARN-045',
        category: 'DATA',
        severity: 'WARN',
        title: 'Requête SQL lente',
        description: 'Requête SQL prenant plus de 5 secondes.',
        resolution_steps: 'Analyser et optimiser la requête.',
        auto_resolution_available: false
      },
      {
        error_code: 'SHUGO-DATA-ERROR-001',
        category: 'DATA',
        severity: 'ERROR',
        title: 'Incohérence des données',
        description: 'Incohérence détectée dans les données.',
        resolution_steps: 'Analyser et corriger manuellement.',
        auto_resolution_available: false
      },
      {
        error_code: 'SHUGO-DATA-CRITICAL-001',
        category: 'DATA',
        severity: 'CRITICAL',
        title: 'Base de données corrompue',
        description: 'Corruption critique de la base de données.',
        resolution_steps: 'Restaurer depuis la dernière sauvegarde.',
        auto_resolution_available: false
      },

      // === PLUGIN - Extensions et modules ===
      {
        error_code: 'SHUGO-PLUGIN-INFO-001',
        category: 'PLUGIN',
        severity: 'INFO',
        title: 'Plugin installé',
        description: 'Un plugin a été installé avec succès.',
        auto_resolution_available: false
      },
      {
        error_code: 'SHUGO-PLUGIN-WARN-001',
        category: 'PLUGIN',
        severity: 'WARN',
        title: 'Plugin obsolète',
        description: 'Une mise à jour du plugin est disponible.',
        resolution_steps: 'Mettre à jour le plugin.',
        auto_resolution_available: false
      },
      {
        error_code: 'SHUGO-PLUGIN-ERROR-001',
        category: 'PLUGIN',
        severity: 'ERROR',
        title: 'Erreur d\'exécution plugin',
        description: 'Le plugin a rencontré une erreur d\'exécution.',
        resolution_steps: 'Vérifier les logs du plugin, désactiver si nécessaire.',
        auto_resolution_available: true,
        auto_resolution_action: 'disablePlugin'
      },
      {
        error_code: 'SHUGO-PLUGIN-ERROR-002',
        category: 'PLUGIN',
        severity: 'ERROR',
        title: 'Signature plugin invalide',
        description: 'La signature du plugin ne correspond pas.',
        resolution_steps: 'Le plugin sera rejeté automatiquement.',
        auto_resolution_available: true,
        auto_resolution_action: 'rejectPlugin'
      }
    ];

    // Ajouter timestamps
    const now = new Date();
    const records = errorCodes.map(code => ({
      ...code,
      is_active: true,
      created_at: now,
      updated_at: now
    }));

    await queryInterface.bulkInsert('error_codes_registry', records);
    console.log(`✅ Seeder 001: ${records.length} codes erreur insérés`);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('error_codes_registry', null, {});
    console.log('⬇️ Seeder 001: Codes erreur supprimés');
  }
};
