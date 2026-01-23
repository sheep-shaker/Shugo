'use strict';

/**
 * SHUGO v7.0 - Configuration des feature flags
 *
 * Permet d'activer/désactiver des fonctionnalités sans redéploiement.
 *
 * @see Document Technique V7.0
 */

/**
 * Feature flags par environnement
 */
const features = {
  // ============================================
  // AUTHENTIFICATION
  // ============================================
  auth: {
    // 2FA obligatoire pour tous les utilisateurs
    require2FAForAll: {
      enabled: process.env.FEATURE_REQUIRE_2FA_ALL === 'true',
      default: false,
      description: 'Force le 2FA pour tous les utilisateurs, pas seulement les admins'
    },

    // Vérification email obligatoire
    requireEmailVerification: {
      enabled: process.env.FEATURE_EMAIL_VERIFICATION !== 'false',
      default: true,
      description: 'Requiert la vérification de l\'email avant première connexion'
    },

    // Connexion sans mot de passe (magic link)
    passwordlessLogin: {
      enabled: process.env.FEATURE_PASSWORDLESS === 'true',
      default: false,
      description: 'Permet la connexion via lien magique envoyé par email'
    },

    // SSO externe
    externalSSO: {
      enabled: process.env.FEATURE_EXTERNAL_SSO === 'true',
      default: false,
      description: 'Active l\'authentification SSO externe (SAML/OIDC)'
    },

    // Biométrie (pour apps mobiles)
    biometricAuth: {
      enabled: process.env.FEATURE_BIOMETRIC === 'true',
      default: false,
      description: 'Permet l\'authentification biométrique sur mobile'
    }
  },

  // ============================================
  // GARDES
  // ============================================
  guards: {
    // Liste d'attente automatique
    autoWaitingList: {
      enabled: process.env.FEATURE_AUTO_WAITING_LIST !== 'false',
      default: true,
      description: 'Active la liste d\'attente automatique avec activation J-3'
    },

    // Rappels automatiques
    autoReminders: {
      enabled: process.env.FEATURE_AUTO_REMINDERS !== 'false',
      default: true,
      description: 'Envoie des rappels automatiques pour les gardes'
    },

    // Échange de gardes entre utilisateurs
    guardSwapping: {
      enabled: process.env.FEATURE_GUARD_SWAP === 'true',
      default: false,
      description: 'Permet aux utilisateurs d\'échanger leurs gardes'
    },

    // Confirmation de présence
    presenceConfirmation: {
      enabled: process.env.FEATURE_PRESENCE_CONFIRM === 'true',
      default: false,
      description: 'Requiert une confirmation de présence le jour de la garde'
    },

    // Scénarios de garde
    guardScenarios: {
      enabled: process.env.FEATURE_SCENARIOS !== 'false',
      default: true,
      description: 'Permet l\'utilisation de scénarios de garde prédéfinis'
    }
  },

  // ============================================
  // NOTIFICATIONS
  // ============================================
  notifications: {
    // Notifications email
    emailNotifications: {
      enabled: process.env.FEATURE_EMAIL_NOTIF !== 'false',
      default: true,
      description: 'Active les notifications par email'
    },

    // Notifications Matrix
    matrixNotifications: {
      enabled: process.env.FEATURE_MATRIX_NOTIF === 'true',
      default: false,
      description: 'Active les notifications via Matrix/Element'
    },

    // Notifications push (mobile)
    pushNotifications: {
      enabled: process.env.FEATURE_PUSH_NOTIF === 'true',
      default: false,
      description: 'Active les notifications push mobiles'
    },

    // Digest quotidien
    dailyDigest: {
      enabled: process.env.FEATURE_DAILY_DIGEST === 'true',
      default: false,
      description: 'Envoie un résumé quotidien des activités'
    },

    // Notifications en temps réel (WebSocket)
    realTimeNotifications: {
      enabled: process.env.FEATURE_REALTIME_NOTIF === 'true',
      default: false,
      description: 'Active les notifications en temps réel via WebSocket'
    }
  },

  // ============================================
  // SÉCURITÉ
  // ============================================
  security: {
    // Rotation automatique des clés
    autoKeyRotation: {
      enabled: process.env.FEATURE_AUTO_KEY_ROTATION !== 'false',
      default: true,
      description: 'Active la rotation automatique des clés de chiffrement'
    },

    // Détection d'anomalies
    anomalyDetection: {
      enabled: process.env.FEATURE_ANOMALY_DETECTION === 'true',
      default: false,
      description: 'Active la détection d\'anomalies de comportement'
    },

    // Alertes de sécurité avancées
    advancedSecurityAlerts: {
      enabled: process.env.FEATURE_ADV_SECURITY === 'true',
      default: false,
      description: 'Active les alertes de sécurité avancées'
    },

    // Mode maintenance programmable
    scheduledMaintenance: {
      enabled: process.env.FEATURE_SCHED_MAINTENANCE !== 'false',
      default: true,
      description: 'Permet la planification des maintenances'
    }
  },

  // ============================================
  // PROTOCOLES SYSTÈME
  // ============================================
  protocols: {
    // Module d'integrite des donnees
    dataIntegrity: {
      enabled: true,
      default: true,
      description: 'Module de verification de coherence des donnees'
    },

    // Protocole Guilty Spark
    guiltySparkProtocol: {
      enabled: process.env.FEATURE_GUILTY_SPARK !== 'false',
      default: true,
      description: 'Active le protocole Guilty Spark (verrouillage d\'urgence)'
    },

    // Protocole Cendre Blanche
    cendreBlancheProtocol: {
      enabled: process.env.FEATURE_CENDRE_BLANCHE !== 'false',
      default: true,
      description: 'Active le protocole Cendre Blanche (suppression définitive)'
    },

    // Mode Upside (dégradé)
    upsideMode: {
      enabled: process.env.FEATURE_UPSIDE_MODE !== 'false',
      default: true,
      description: 'Active le mode dégradé automatique'
    },

    // Clé Totem (récupération physique)
    cleTotem: {
      enabled: process.env.FEATURE_CLE_TOTEM === 'true',
      default: false,
      description: 'Active l\'authentification par clé physique USB'
    }
  },

  // ============================================
  // PLUGINS
  // ============================================
  plugins: {
    // Système de plugins
    pluginSystem: {
      enabled: process.env.FEATURE_PLUGINS === 'true',
      default: false,
      description: 'Active le système de plugins extensible'
    },

    // Marketplace de plugins
    pluginMarketplace: {
      enabled: process.env.FEATURE_PLUGIN_MARKETPLACE === 'true',
      default: false,
      description: 'Active le catalogue de plugins'
    },

    // Plugin Calendrier
    calendarPlugin: {
      enabled: process.env.FEATURE_CALENDAR_PLUGIN === 'true',
      default: false,
      description: 'Active le plugin de calendrier d\'activités'
    }
  },

  // ============================================
  // SYNCHRONISATION
  // ============================================
  sync: {
    // Synchronisation avec serveurs locaux
    localServerSync: {
      enabled: process.env.FEATURE_LOCAL_SYNC !== 'false',
      default: true,
      description: 'Active la synchronisation avec les serveurs locaux'
    },

    // Synchronisation différentielle
    deltaSync: {
      enabled: process.env.FEATURE_DELTA_SYNC !== 'false',
      default: true,
      description: 'Utilise la synchronisation différentielle pour optimiser'
    },

    // Mode hors-ligne
    offlineMode: {
      enabled: process.env.FEATURE_OFFLINE !== 'false',
      default: true,
      description: 'Permet le fonctionnement hors-ligne des serveurs locaux'
    }
  },

  // ============================================
  // RAPPORTS ET ANALYTICS
  // ============================================
  analytics: {
    // Tableau de bord analytics
    analyticsDashboard: {
      enabled: process.env.FEATURE_ANALYTICS === 'true',
      default: false,
      description: 'Active le tableau de bord d\'analytics'
    },

    // Export de rapports
    reportExport: {
      enabled: process.env.FEATURE_REPORT_EXPORT !== 'false',
      default: true,
      description: 'Permet l\'export de rapports (PDF, Excel)'
    },

    // Statistiques avancées
    advancedStats: {
      enabled: process.env.FEATURE_ADV_STATS === 'true',
      default: false,
      description: 'Active les statistiques avancées'
    }
  },

  // ============================================
  // EXPÉRIMENTAL
  // ============================================
  experimental: {
    // Nouvelle interface utilisateur
    newUI: {
      enabled: process.env.FEATURE_NEW_UI === 'true',
      default: false,
      description: 'Active la nouvelle interface utilisateur (beta)'
    },

    // API GraphQL
    graphqlAPI: {
      enabled: process.env.FEATURE_GRAPHQL === 'true',
      default: false,
      description: 'Active l\'API GraphQL en plus de REST'
    },

    // Intelligence artificielle
    aiFeatures: {
      enabled: process.env.FEATURE_AI === 'true',
      default: false,
      description: 'Active les fonctionnalités basées sur l\'IA'
    }
  }
};

/**
 * Vérifie si une fonctionnalité est activée
 * @param {string} featurePath - Chemin de la feature (ex: 'auth.require2FAForAll')
 * @returns {boolean}
 */
function isEnabled(featurePath) {
  const parts = featurePath.split('.');
  let current = features;

  for (const part of parts) {
    if (!current[part]) return false;
    current = current[part];
  }

  if (typeof current === 'object' && 'enabled' in current) {
    return current.enabled;
  }

  return false;
}

/**
 * Récupère toutes les features avec leur état
 * @returns {Object}
 */
function getAllFeatures() {
  const result = {};

  function traverse(obj, path = '') {
    for (const key in obj) {
      const fullPath = path ? `${path}.${key}` : key;
      const value = obj[key];

      if (value && typeof value === 'object') {
        if ('enabled' in value) {
          result[fullPath] = {
            enabled: value.enabled,
            default: value.default,
            description: value.description
          };
        } else {
          traverse(value, fullPath);
        }
      }
    }
  }

  traverse(features);
  return result;
}

/**
 * Récupère les features activées
 * @returns {string[]}
 */
function getEnabledFeatures() {
  const all = getAllFeatures();
  return Object.entries(all)
    .filter(([, value]) => value.enabled)
    .map(([key]) => key);
}

/**
 * Récupère les features désactivées
 * @returns {string[]}
 */
function getDisabledFeatures() {
  const all = getAllFeatures();
  return Object.entries(all)
    .filter(([, value]) => !value.enabled)
    .map(([key]) => key);
}

module.exports = {
  features,
  isEnabled,
  getAllFeatures,
  getEnabledFeatures,
  getDisabledFeatures
};
