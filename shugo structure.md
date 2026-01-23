# 🏗️ SHUGO v7.0 - STRUCTURE COMPLÈTE DU BACKEND

> **Document de référence** pour le développement du backend SHUGO
> Basé sur le Document Technique V7.0
> 
> **Légende des statuts :**
> - ✅ = Fichier existant et complet
> - 🔶 = Fichier existant mais incomplet
> - ❌ = Fichier à créer
> - 📁 = Dossier

---

## 📋 TABLE DES MATIÈRES

1. [Serveur Central (AWS/VPS)](#serveur-central)
2. [Serveur Local (Raspberry Pi)](#serveur-local)
3. [Package Core (Code Partagé)](#package-core)
4. [SDK Plugin](#sdk-plugin)
5. [Résumé des Fichiers](#résumé)

---

<a name="serveur-central"></a>
# 1️⃣ SERVEUR CENTRAL (AWS/VPS)

```
shugo-backend/
└── central/
    │
    ├── 📁 src/                                    # Code source principal
    │   │
    │   ├── index.js                               # Point d'entrée Express, configuration middleware, démarrage serveur
    │   │
    │   ├── 📁 config/                             # Configuration centralisée
    │   │   ├── index.js                           # Configuration principale (DB, JWT, sécurité, CORS, rate-limit)
    │   │   ├── database.js                        # Configuration spécifique PostgreSQL (pools, SSL, timezone)
    │   │   ├── security.js                        # Paramètres de sécurité (durées, seuils, algorithmes)
    │   │   └── features.js                        # Feature flags (2FA obligatoire, email verification, etc.)
    │   │
    │   ├── 📁 database/                           # Connexion et gestion base de données
    │   │   ├── connection.js                      # Connexion Sequelize PostgreSQL, pool, test connexion
    │   │   ├── migrations/                        # Dossier des migrations Sequelize
    │   │   │   ├── 001_create_users.js            # Migration table users
    │   │   │   ├── 002_create_sessions.js         # Migration table sessions
    │   │   │   ├── 003_create_locations.js        # Migration table locations
    │   │   │   ├── 004_create_local_instances.js  # Migration table local_instances
    │   │   │   ├── 005_create_groups.js           # Migration table groups
    │   │   │   ├── 006_create_group_memberships.js # Migration table group_membership
    │   │   │   ├── 007_create_guards.js           # Migration table guards
    │   │   │   ├── 008_create_guard_assignments.js # Migration table guard_assignments
    │   │   │   ├── 009_create_guard_scenarios.js  # Migration table guard_scenarios
    │   │   │   ├── 010_create_waiting_list.js     # Migration table waiting_list
    │   │   │   ├── 011_create_notifications.js    # Migration table notifications
    │   │   │   ├── 012_create_messages_center.js  # Migration table messages_center
    │   │   │   ├── 013_create_message_read_status.js # Migration table message_read_status
    │   │   │   ├── 014_create_support_requests.js # Migration table support_requests
    │   │   │   ├── 015_create_user_missions.js    # Migration table user_missions
    │   │   │   ├── 016_create_registration_tokens.js # Migration table registration_tokens
    │   │   │   ├── 017_create_audit_logs.js       # Migration table audit_logs
    │   │   │   ├── 018_create_system_logs.js      # Migration table system_logs
    │   │   │   ├── 019_create_aes_keys_rotation.js # Migration table aes_keys_rotation
    │   │   │   ├── 020_create_shared_secrets.js   # Migration table shared_secrets
    │   │   │   ├── 021_create_emergency_codes.js  # Migration table emergency_codes
    │   │   │   ├── 022_create_vault_items.js      # Migration table vault_items
    │   │   │   ├── 023_create_security_protocols_log.js # Migration table security_protocols_log
    │   │   │   ├── 024_create_maintenance_runs.js # Migration table maintenance_runs
    │   │   │   ├── 025_create_health_checks.js    # Migration table health_checks
    │   │   │   ├── 026_create_system_metrics.js   # Migration table system_metrics
    │   │   │   ├── 027_create_error_codes_registry.js # Migration table error_codes_registry
    │   │   │   ├── 028_create_error_occurrences.js # Migration table error_occurrences
    │   │   │   ├── 029_create_backup_jobs.js      # Migration table backup_jobs
    │   │   │   ├── 030_create_backup_files.js     # Migration table backup_files
    │   │   │   ├── 031_create_restore_operations.js # Migration table restore_operations
    │   │   │   ├── 032_create_plugin_registry.js  # Migration table plugin_registry
    │   │   │   └── 033_create_plugin_configurations.js # Migration table plugin_configurations
    │   │   │
    │   │   └── seeders/                           # Données initiales
    │   │       ├── 001_seed_locations.js          # Localisations de base (geo_id)
    │   │       ├── 002_seed_error_codes.js        # Codes erreur SHUGO-*
    │   │       └── 003_seed_default_scenarios.js  # Scénarios de garde par défaut
    │   │
    │   ├── 📁 models/                             # Modèles Sequelize (ORM)
    │   │   ├── index.js                           # Export centralisé + définition des associations
    │   │   │
    │   │   │   # === UTILISATEURS ET AUTHENTIFICATION ===
    │   │   ├── User.js                            # Utilisateur (member_id, champs chiffrés, rôle, geo_id)
    │   │   ├── Session.js                         # Sessions JWT actives (token_hash, IP, expiration)
    │   │   ├── RegistrationToken.js               # Jetons d'inscription (7 jours, usage unique)
    │   │   │
    │   │   │   # === ORGANISATION ET PÉRIMÈTRES ===
    │   │   ├── Location.js                        # Référentiel géographique (geo_id, nom, adresse, GPS)
    │   │   ├── LocalInstance.js                   # Serveurs locaux enregistrés (status, last_seen, version)
    │   │   ├── Group.js                           # Groupes d'utilisateurs (nom, leader, geo_id)
    │   │   ├── GroupMembership.js                 # Appartenance aux groupes (member_id, group_id, rôle)
    │   │   │
    │   │   │   # === PLANNING ET GARDES ===
    │   │   ├── Guard.js                           # Créneaux de garde (date, heures, type, participants)
    │   │   ├── GuardAssignment.js                 # Inscriptions aux gardes (member_id, status)
    │   │   ├── GuardScenario.js                   # Scénarios prédéfinis (semaine-type, récurrence)
    │   │   ├── WaitingList.js                     # Liste d'attente intelligente (priorité, auto-assign J-3)
    │   │   │
    │   │   │   # === NOTIFICATIONS ET MESSAGES ===
    │   │   ├── Notification.js                    # Notifications système (type, canal, statut envoi)
    │   │   ├── MessagesCenter.js                  # Messages hiérarchiques (système/manuel, scope)
    │   │   ├── MessageReadStatus.js               # Statut de lecture des messages
    │   │   │
    │   │   │   # === SUPPORT ET MISSIONS ===
    │   │   ├── SupportRequest.js                  # Demandes de support (catégorie, priorité, statut)
    │   │   ├── UserMission.js                     # Missions spéciales (privilèges temporaires, scope)
    │   │   │
    │   │   │   # === SÉCURITÉ ET CRYPTOGRAPHIE ===
    │   │   ├── AesKeyRotation.js                  # Rotation des clés AES (version, status, dates)
    │   │   ├── SharedSecret.js                    # Secrets partagés central/local (rotation annuelle)
    │   │   ├── EmergencyCode.js                   # Tableau de secours (100 codes, usage unique)
    │   │   ├── VaultItem.js                       # Éléments stockés dans le Vault (chiffrés)
    │   │   ├── SecurityProtocolLog.js             # Logs des protocoles (Flamma, GuiltySpark...)
    │   │   │
    │   │   │   # === AUDIT ET JOURNALISATION ===
    │   │   ├── AuditLog.js                        # Traçabilité des actions (qui, quoi, quand, résultat)
    │   │   ├── SystemLog.js                       # Logs système (niveau, module, message)
    │   │   │
    │   │   │   # === MAINTENANCE ET MONITORING ===
    │   │   ├── MaintenanceRun.js                  # Historique des maintenances nocturnes
    │   │   ├── HealthCheck.js                     # Résultats des contrôles de santé
    │   │   ├── SystemMetric.js                    # Métriques système (CPU, RAM, disque)
    │   │   ├── ErrorCodeRegistry.js               # Registre des codes erreur SHUGO-*
    │   │   ├── ErrorOccurrence.js                 # Occurrences d'erreurs
    │   │   │
    │   │   │   # === SAUVEGARDE ET RESTAURATION ===
    │   │   ├── BackupJob.js                       # Jobs de sauvegarde (type, statut, taille)
    │   │   ├── BackupFile.js                      # Fichiers de backup (checksum, chiffrement)
    │   │   ├── RestoreOperation.js                # Opérations de restauration
    │   │   │
    │   │   │   # === PLUGINS ===
    │   │   ├── PluginRegistry.js                  # Plugins installés (nom, version, statut)
    │   │   └── PluginConfiguration.js             # Configuration des plugins
    │   │
    │   ├── 📁 routes/                             # Routes API Express
    │   │   ├── index.js                           # Routeur principal, montage des sous-routes
    │   │   │
    │   │   │   # === AUTHENTIFICATION ===
    │   │   ├── auth.js                            # /api/v1/auth/* (register, login, logout, refresh, 2FA, reset)
    │   │   │
    │   │   │   # === UTILISATEURS ===
    │   │   ├── users.js                           # /api/v1/users/* (CRUD, profil, recherche phonétique)
    │   │   │
    │   │   │   # === GARDES ET PLANNING ===
    │   │   ├── guards.js                          # /api/v1/guards/* (CRUD, inscription, annulation)
    │   │   ├── scenarios.js                       # /api/v1/scenarios/* (CRUD scénarios, application)
    │   │   ├── waitingList.js                     # /api/v1/waiting-list/* (inscription, activation)
    │   │   │
    │   │   │   # === GROUPES ===
    │   │   ├── groups.js                          # /api/v1/groups/* (CRUD, membres, hiérarchie)
    │   │   │
    │   │   │   # === NOTIFICATIONS ET MESSAGES ===
    │   │   ├── notifications.js                   # /api/v1/notifications/* (liste, marquer lu)
    │   │   ├── messages.js                        # /api/v1/messages/* (centre de messages, émission)
    │   │   │
    │   │   │   # === SUPPORT ===
    │   │   ├── support.js                         # /api/v1/support/* (créer ticket, assigner, résoudre)
    │   │   │
    │   │   │   # === MISSIONS ===
    │   │   ├── missions.js                        # /api/v1/missions/* (CRUD, attribution, révocation)
    │   │   │
    │   │   │   # === PROTOCOLES SYSTÈME ===
    │   │   ├── protocols.js                       # /api/v1/protocols/* (routeur principal protocoles)
    │   │   ├── protocols/                         # Sous-routes protocoles
    │   │   │   ├── flamma.js                      # Flamma Levis/Salutaris/Purgatrix
    │   │   │   ├── guiltySpark.js                 # Création/gestion serveurs locaux
    │   │   │   ├── cendreBlanché.js               # Suppression définitive utilisateur
    │   │   │   ├── papierFroisse.js               # Réactivation compte
    │   │   │   ├── porteDeGrange.js               # Isolation réseau
    │   │   │   ├── upsideMode.js                  # Mode test/miroir
    │   │   │   └── cleTotem.js                    # Authentification physique
    │   │   │
    │   │   │   # === SÉCURITÉ ET VAULT ===
    │   │   ├── vault.js                           # /api/v1/vault/* (statut, rotation clés)
    │   │   ├── emergencyCodes.js                  # /api/v1/emergency/* (génération tableau, validation)
    │   │   │
    │   │   │   # === SERVEURS LOCAUX ===
    │   │   ├── localServers.js                    # /api/v1/local-servers/* (liste, statut, heartbeat)
    │   │   │
    │   │   │   # === ADMINISTRATION ===
    │   │   ├── admin.js                           # /api/v1/admin/* (statistiques, exports)
    │   │   │
    │   │   │   # === MAINTENANCE ET SANTÉ ===
    │   │   ├── health.js                          # /api/v1/health/* (santé système, métriques)
    │   │   ├── maintenance.js                     # /api/v1/maintenance/* (déclenchement, historique)
    │   │   │
    │   │   │   # === SAUVEGARDE ===
    │   │   ├── backup.js                          # /api/v1/backup/* (déclencher, lister, restaurer)
    │   │   │
    │   │   │   # === PLUGINS ===
    │   │   └── plugins.js                         # /api/v1/plugins/* (liste, installer, configurer)
    │   │
    │   ├── 📁 middleware/                         # Middleware Express
    │   │   ├── index.js                           # Export centralisé des middleware
    │   │   ├── auth.js                            # Authentification JWT, vérification session, checkRole
    │   │   ├── auth2FA.js                         # Vérification 2FA obligatoire si activé
    │   │   ├── validation.js                      # Validation des entrées avec Joi
    │   │   ├── errorHandler.js                    # Gestion globale des erreurs, classe AppError
    │   │   ├── rateLimiter.js                     # Rate limiting par IP et par utilisateur
    │   │   ├── maintenance.js                     # Mode maintenance (blocage accès sauf admins)
    │   │   ├── audit.js                           # Logging automatique des actions dans AuditLog
    │   │   ├── scope.js                           # Vérification du scope géographique (geo_id)
    │   │   ├── permissions.js                     # Vérification des permissions et missions
    │   │   └── sanitizer.js                       # Nettoyage des entrées (XSS, injection)
    │   │
    │   ├── 📁 services/                           # Services métier (logique business)
    │   │   ├── index.js                           # Export centralisé des services
    │   │   │
    │   │   │   # === AUTHENTIFICATION ===
    │   │   ├── AuthService.js                     # Logique d'authentification, tokens, 2FA
    │   │   │
    │   │   │   # === UTILISATEURS ===
    │   │   ├── UserService.js                     # CRUD utilisateurs, recherche, chiffrement
    │   │   │
    │   │   │   # === GARDES ===
    │   │   ├── GuardService.js                    # Logique des gardes, inscriptions, annulations
    │   │   ├── ScenarioService.js                 # Gestion des scénarios, application, récurrence
    │   │   ├── WaitingListService.js              # Liste d'attente, activation automatique J-3
    │   │   │
    │   │   │   # === NOTIFICATIONS ===
    │   │   ├── NotificationService.js             # Envoi notifications (email, Matrix), relances
    │   │   ├── EmailService.js                    # Envoi emails via Mailjet
    │   │   ├── MatrixService.js                   # Intégration Matrix/Element
    │   │   │
    │   │   │   # === SUPPORT ===
    │   │   ├── SupportService.js                  # Gestion des tickets, escalade
    │   │   │
    │   │   │   # === PROTOCOLES SYSTÈME ===
    │   │   ├── ProtocolService.js                 # Service principal des protocoles
    │   │   ├── protocols/                         # Implémentation des protocoles
    │   │   │   ├── FlammaService.js               # Flamma Levis/Salutaris/Purgatrix
    │   │   │   ├── GuiltySparkService.js          # Création/activation serveurs locaux
    │   │   │   ├── CendreBlancheService.js        # Suppression définitive
    │   │   │   ├── PapierFroisseService.js        # Réactivation compte
    │   │   │   ├── PorteDeGrangeService.js        # Isolation réseau
    │   │   │   ├── UpsideModeService.js           # Mode miroir/test
    │   │   │   └── CleTotemService.js             # Authentification physique
    │   │   │
    │   │   │   # === SÉCURITÉ ===
    │   │   ├── VaultService.js                    # Gestion du Vault central
    │   │   ├── KeyRotationService.js              # Rotation des clés AES
    │   │   ├── SecretRotationService.js           # Rotation des secrets partagés
    │   │   ├── EmergencyCodeService.js            # Génération/validation tableaux de secours
    │   │   │
    │   │   │   # === SERVEURS LOCAUX ===
    │   │   ├── LocalServerService.js              # Communication avec serveurs locaux
    │   │   ├── SyncService.js                     # Synchronisation central/local
    │   │   │
    │   │   │   # === MAINTENANCE ===
    │   │   ├── MaintenanceService.js              # Maintenance nocturne automatique
    │   │   ├── HealthService.js                   # Contrôles de santé, métriques
    │   │   │
    │   │   │   # === SAUVEGARDE ===
    │   │   ├── BackupService.js                   # Sauvegardes automatiques, restauration
    │   │   │
    │   │   │   # === AUDIT ===
    │   │   └── AuditService.js                    # Génération rapports audit, export
    │   │
    │   ├── 📁 utils/                              # Utilitaires
    │   │   ├── index.js                           # Export centralisé
    │   │   ├── crypto.js                          # Chiffrement AES-256-GCM, Argon2, HMAC, RSA
    │   │   ├── logger.js                          # Winston logger avec rotation
    │   │   ├── helpers.js                         # Fonctions utilitaires diverses
    │   │   ├── geoId.js                           # Parsing et validation geo_id (CC-PPP-ZZ-JJ-NN)
    │   │   ├── memberId.js                        # Génération et validation member_id
    │   │   ├── phonetic.js                        # Algorithmes phonétiques (soundex, metaphone)
    │   │   ├── dateTime.js                        # Gestion dates, fuseaux horaires
    │   │   ├── validators.js                      # Schémas de validation Joi
    │   │   └── constants.js                       # Constantes globales (rôles, statuts, codes erreur)
    │   │
    │   ├── 📁 cron/                               # Tâches planifiées
    │   │   ├── index.js                           # Export et démarrage des crons
    │   │   ├── scheduler.js                       # Ordonnanceur principal (node-cron)
    │   │   ├── jobs/                              # Jobs individuels
    │   │   │   ├── nightlyMaintenance.js          # Maintenance nocturne (00h00 local)
    │   │   │   ├── keyRotationCheck.js            # Vérification rotation clés (1er décembre)
    │   │   │   ├── secretRotationCheck.js         # Vérification rotation secrets (annuel)
    │   │   │   ├── sessionCleanup.js              # Nettoyage sessions expirées
    │   │   │   ├── logArchive.js                  # Archivage logs journaliers
    │   │   │   ├── waitingListActivation.js       # Activation liste d'attente J-3
    │   │   │   ├── guardReminders.js              # Relances créneaux vides
    │   │   │   ├── backupDaily.js                 # Sauvegarde quotidienne
    │   │   │   ├── backupWeekly.js                # Sauvegarde hebdomadaire (dimanche)
    │   │   │   ├── healthCheck.js                 # Contrôle santé périodique
    │   │   │   ├── metricsCollection.js           # Collecte métriques système
    │   │   │   └── localServerHeartbeat.js        # Vérification heartbeat serveurs locaux
    │   │   │
    │   │   └── tasks/                             # Tâches exécutables manuellement
    │   │       ├── forceKeyRotation.js            # Forcer rotation clés
    │   │       ├── forceSecretRotation.js         # Forcer rotation secrets
    │   │       └── cleanupOldData.js              # Nettoyage données anciennes
    │   │
    │   └── 📁 vault/                              # Vault Central
    │       ├── index.js                           # Export du VaultManager
    │       ├── VaultManager.js                    # Gestionnaire principal du Vault central
    │       ├── KeyStore.js                        # Stockage sécurisé des clés
    │       ├── SecretStore.js                     # Stockage des secrets partagés
    │       └── VaultBackup.js                     # Sauvegarde chiffrée du Vault
    │
    ├── 📁 scripts/                                # Scripts d'administration
    │   ├── generate-keys.js                       # Génération clés AES, JWT, HMAC
    │   ├── create-admin.js                        # Création premier administrateur
    │   ├── migrate-database.js                    # Exécution des migrations
    │   ├── seed-database.js                       # Exécution des seeders
    │   ├── backup-database.js                     # Sauvegarde manuelle
    │   ├── restore-database.js                    # Restauration depuis backup
    │   ├── rotate-keys.js                         # Rotation manuelle des clés
    │   ├── generate-emergency-codes.js            # Génération tableau de secours
    │   ├── register-local-server.js               # Enregistrement nouveau serveur local
    │   ├── health-check.js                        # Diagnostic système
    │   └── cleanup-data.js                        # Nettoyage données anciennes
    │
    ├── 📁 tests/                                  # Tests automatisés
    │   ├── setup.js                               # Configuration Jest
    │   ├── 📁 unit/                               # Tests unitaires
    │   │   ├── models/                            # Tests des modèles
    │   │   ├── services/                          # Tests des services
    │   │   ├── utils/                             # Tests des utilitaires
    │   │   └── middleware/                        # Tests des middleware
    │   ├── 📁 integration/                        # Tests d'intégration
    │   │   ├── auth.test.js                       # Tests authentification
    │   │   ├── guards.test.js                     # Tests gardes
    │   │   ├── protocols.test.js                  # Tests protocoles
    │   │   └── sync.test.js                       # Tests synchronisation
    │   └── 📁 e2e/                                # Tests end-to-end
    │       └── full-flow.test.js                  # Scénarios complets
    │
    ├── 📁 logs/                                   # Fichiers de logs (gitignore)
    │   └── .gitkeep
    │
    ├── 📁 backups/                                # Sauvegardes (gitignore)
    │   └── .gitkeep
    │
    ├── 📁 uploads/                                # Fichiers uploadés (gitignore)
    │   └── .gitkeep
    │
    ├── 📁 temp/                                   # Fichiers temporaires (gitignore)
    │   └── .gitkeep
    │
    │   # === FICHIERS DE CONFIGURATION ===
    ├── package.json                               # Dépendances et scripts npm
    ├── package-lock.json                          # Versions verrouillées
    ├── .env.example                               # Exemple variables d'environnement
    ├── .gitignore                                 # Fichiers ignorés par git
    ├── .eslintrc.js                               # Configuration ESLint
    ├── .prettierrc                                # Configuration Prettier
    ├── jest.config.js                             # Configuration Jest
    ├── Dockerfile                                 # Image Docker production
    ├── docker-compose.yml                         # Composition Docker (app + PostgreSQL + Redis)
    ├── docker-compose.dev.yml                     # Composition Docker développement
    └── README.md                                  # Documentation du serveur central
```

---

<a name="serveur-local"></a>
# 2️⃣ SERVEUR LOCAL (Raspberry Pi)

```
shugo-platform/
├── 📁 packages/
│   │
│   └── 📁 local/                                  # Serveur local Raspberry Pi
│       │
│       ├── 📁 src/                                # Code source
│       │   │
│       │   ├── index.js                           # Point d'entrée, démarrage serveur local
│       │   │
│       │   ├── 📁 config/                         # Configuration
│       │   │   ├── index.js                       # Configuration principale (SQLite, sync, vault)
│       │   │   ├── sync.js                        # Configuration synchronisation avec central
│       │   │   └── hardware.js                    # Configuration matériel (GPIO, Bluetooth)
│       │   │
│       │   ├── 📁 database/                       # Base de données SQLite
│       │   │   ├── index.js                       # Connexion SQLite/Sequelize
│       │   │   └── migrations/                    # Migrations locales
│       │   │       ├── 001_create_local_users.js
│       │   │       ├── 002_create_local_guards.js
│       │   │       ├── 003_create_local_assignments.js
│       │   │       ├── 004_create_local_groups.js
│       │   │       ├── 005_create_local_notifications.js
│       │   │       ├── 006_create_sync_queue.js
│       │   │       ├── 007_create_local_changes.js
│       │   │       ├── 008_create_heartbeat_logs.js
│       │   │       └── 009_create_local_config.js
│       │   │
│       │   ├── 📁 models/                         # Modèles Sequelize locaux
│       │   │   ├── index.js                       # Export et associations
│       │   │   ├── LocalUser.js                   # Copie locale des utilisateurs
│       │   │   ├── LocalGuard.js                  # Gardes du local
│       │   │   ├── LocalAssignment.js             # Inscriptions locales
│       │   │   ├── LocalGroup.js                  # Groupes locaux
│       │   │   ├── LocalGroupMembership.js        # Appartenance groupes
│       │   │   ├── LocalNotification.js           # Notifications locales
│       │   │   ├── SyncQueue.js                   # File d'attente synchronisation
│       │   │   ├── LocalChange.js                 # Changements en attente de sync
│       │   │   ├── HeartbeatLog.js                # Logs heartbeat vers central
│       │   │   └── LocalConfig.js                 # Configuration locale (geo_id, etc.)
│       │   │
│       │   ├── 📁 routes/                         # Routes API locales
│       │   │   ├── index.js                       # Routeur principal
│       │   │   ├── auth.js                        # Authentification locale (mode offline)
│       │   │   ├── users.js                       # Gestion utilisateurs locaux
│       │   │   ├── guards.js                      # Gestion gardes locales
│       │   │   ├── groups.js                      # Gestion groupes locaux
│       │   │   ├── notifications.js               # Notifications locales
│       │   │   ├── sync.js                        # Endpoints de synchronisation
│       │   │   ├── system.js                      # Statut système, vault local
│       │   │   ├── plugins.js                     # Gestion plugins locaux
│       │   │   └── emergency.js                   # Accès d'urgence (tableau de secours)
│       │   │
│       │   ├── 📁 middleware/                     # Middleware Express
│       │   │   ├── index.js                       # Export centralisé
│       │   │   ├── auth.js                        # Authentification locale
│       │   │   ├── errorHandler.js                # Gestion erreurs
│       │   │   ├── rateLimit.js                   # Rate limiting
│       │   │   ├── requestLogger.js               # Logging requêtes
│       │   │   ├── cache.js                       # Cache local
│       │   │   └── offlineMode.js                 # Détection mode hors-ligne
│       │   │
│       │   ├── 📁 services/                       # Services métier locaux
│       │   │   ├── index.js                       # Export centralisé
│       │   │   ├── LocalAuthService.js            # Authentification mode offline
│       │   │   ├── LocalGuardService.js           # Gestion gardes locale
│       │   │   ├── HealthMonitor.js               # Monitoring santé local
│       │   │   └── OfflineQueueService.js         # Gestion file d'attente offline
│       │   │
│       │   ├── 📁 sync/                           # Synchronisation avec central
│       │   │   ├── index.js                       # Export
│       │   │   ├── SyncManager.js                 # Gestionnaire principal synchronisation
│       │   │   ├── SyncQueue.js                   # File d'attente avec retry
│       │   │   ├── ConflictResolver.js            # Résolution conflits sync
│       │   │   ├── DeltaSync.js                   # Synchronisation différentielle
│       │   │   └── FullSync.js                    # Synchronisation complète
│       │   │
│       │   ├── 📁 vault/                          # Vault local
│       │   │   ├── index.js                       # Export
│       │   │   ├── LocalVault.js                  # Gestionnaire Vault local
│       │   │   ├── KeyManager.js                  # Gestion clés locales
│       │   │   └── EmergencyAccess.js             # Accès d'urgence via tableau de secours
│       │   │
│       │   ├── 📁 plugins/                        # Gestionnaire de plugins
│       │   │   ├── index.js                       # Export
│       │   │   └── PluginManager.js               # Chargement/déchargement plugins
│       │   │
│       │   └── 📁 utils/                          # Utilitaires locaux
│       │       ├── index.js
│       │       ├── logger.js                      # Logger local
│       │       ├── validator.js                   # Validation entrées
│       │       └── hardware.js                    # Interaction matériel (GPIO, Bluetooth)
│       │
│       ├── 📁 plugins/                            # Plugins installés
│       │   │
│       │   └── 📁 calendar/                       # Plugin Calendrier d'Activités
│       │       ├── manifest.json                  # Métadonnées plugin
│       │       ├── index.js                       # Point d'entrée plugin
│       │       ├── permissions.json               # Permissions requises
│       │       ├── config.schema.json             # Schéma de configuration
│       │       ├── 📁 models/                     # Modèles du plugin
│       │       │   ├── CalendarActivity.js
│       │       │   ├── CalendarParticipant.js
│       │       │   ├── CalendarVisibility.js
│       │       │   └── CalendarGuardBlock.js
│       │       ├── 📁 routes/                     # Routes du plugin
│       │       │   └── activities.js
│       │       └── 📁 services/                   # Services du plugin
│       │           └── ActivityService.js
│       │
│       ├── 📁 scripts/                            # Scripts d'administration locale
│       │   ├── setup.js                           # Configuration initiale
│       │   ├── migrate.js                         # Migration base locale
│       │   ├── sync-pull.js                       # Récupérer données du central
│       │   ├── sync-push.js                       # Envoyer données au central
│       │   ├── deploy-to-pi.js                    # Déploiement sur Raspberry Pi
│       │   ├── generate-local-keys.js             # Génération clés locales
│       │   └── emergency-access.js                # Accès d'urgence manuel
│       │
│       ├── 📁 data/                               # Données locales (gitignore)
│       │   ├── 📁 vault/                          # Vault local
│       │   └── 📁 db/                             # Base SQLite
│       │
│       ├── 📁 backups/                            # Sauvegardes locales
│       │   └── .gitkeep
│       │
│       ├── 📁 logs/                               # Logs locaux
│       │   └── .gitkeep
│       │
│       │   # === FICHIERS DE CONFIGURATION ===
│       ├── package.json                           # Dépendances locales
│       ├── .env.example                           # Variables d'environnement
│       └── README.md                              # Documentation serveur local
```

---

<a name="package-core"></a>
# 3️⃣ PACKAGE CORE (Code Partagé)

```
shugo-platform/
├── 📁 packages/
│   │
│   └── 📁 core/                                   # Code partagé central/local
│       │
│       ├── index.js                               # Export principal du package
│       │
│       ├── 📁 config/                             # Configuration partagée
│       │   ├── index.js                           # Export
│       │   └── base.js                            # Configuration de base commune
│       │
│       ├── 📁 constants/                          # Constantes partagées
│       │   ├── index.js                           # Export centralisé
│       │   ├── roles.js                           # ROLES: Silver, Gold, Platinum, Admin, Admin_N1
│       │   ├── statuses.js                        # Statuts: active, inactive, suspended, deleted
│       │   ├── errorCodes.js                      # Codes erreur SHUGO-*
│       │   ├── guardTypes.js                      # Types de garde: standard, preparation, closure
│       │   ├── notificationTypes.js               # Types de notification
│       │   ├── protocolTypes.js                   # Types de protocoles système
│       │   └── geoIdFormat.js                     # Format geo_id et codes continents
│       │
│       ├── 📁 models/                             # Modèles de base
│       │   ├── index.js                           # Export
│       │   └── BaseModel.js                       # Classe de base pour tous les modèles
│       │
│       ├── 📁 services/                           # Services de base
│       │   ├── index.js                           # Export
│       │   └── BaseService.js                     # Classe de base pour tous les services
│       │
│       ├── 📁 events/                             # Système d'événements
│       │   ├── index.js                           # Export
│       │   ├── EventBus.js                        # Bus d'événements (pub/sub)
│       │   └── eventTypes.js                      # Types d'événements
│       │
│       ├── 📁 utils/                              # Utilitaires partagés
│       │   ├── index.js                           # Export
│       │   ├── crypto.js                          # Cryptographie commune
│       │   ├── helpers.js                         # Fonctions utilitaires
│       │   ├── logger.js                          # Logger de base
│       │   ├── validators.js                      # Validateurs communs
│       │   └── dateUtils.js                       # Utilitaires dates/timezone
│       │
│       ├── 📁 errors/                             # Gestion d'erreurs
│       │   ├── index.js                           # Export
│       │   ├── AppError.js                        # Classe d'erreur personnalisée
│       │   └── errorFactory.js                    # Fabrique d'erreurs standardisées
│       │
│       ├── package.json                           # Dépendances du package core
│       └── README.md                              # Documentation
```

---

<a name="sdk-plugin"></a>
# 4️⃣ SDK PLUGIN

```
shugo-platform/
├── 📁 packages/
│   │
│   └── 📁 sdk/                                    # SDK pour développement de plugins
│       │
│       ├── 📁 plugin-base/                        # Base pour créer des plugins
│       │   ├── Plugin.js                          # Classe de base Plugin
│       │   ├── PluginContext.js                   # Contexte d'exécution du plugin
│       │   ├── PluginAPI.js                       # API exposée aux plugins
│       │   └── PluginValidator.js                 # Validation manifest et permissions
│       │
│       ├── 📁 templates/                          # Templates pour nouveaux plugins
│       │   ├── 📁 basic/                          # Template plugin basique
│       │   │   ├── manifest.json
│       │   │   ├── index.js
│       │   │   └── permissions.json
│       │   └── 📁 full/                           # Template plugin complet
│       │       ├── manifest.json
│       │       ├── index.js
│       │       ├── permissions.json
│       │       ├── config.schema.json
│       │       └── 📁 src/
│       │           ├── models/
│       │           ├── routes/
│       │           └── services/
│       │
│       ├── package.json                           # Dépendances SDK
│       └── README.md                              # Documentation SDK
```

---

# 5️⃣ RACINE DU MONOREPO

```
shugo-platform/
│
├── 📁 packages/                                   # Packages du monorepo
│   ├── 📁 core/                                   # Code partagé (voir section 3)
│   ├── 📁 local/                                  # Serveur local (voir section 2)
│   └── 📁 sdk/                                    # SDK plugin (voir section 4)
│
├── package.json                                   # Configuration monorepo (workspaces)
├── .gitignore                                     # Fichiers ignorés
├── .eslintrc.js                                   # ESLint monorepo
├── .prettierrc                                    # Prettier monorepo
├── lerna.json                                     # Configuration Lerna (optionnel)
└── README.md                                      # Documentation générale
```

---

<a name="résumé"></a>
# 📊 RÉSUMÉ DES FICHIERS

## Comptage par catégorie

| Catégorie | Serveur Central | Serveur Local | Core | SDK | Total |
|-----------|-----------------|---------------|------|-----|-------|
| **Config** | 4 | 3 | 2 | 0 | **9** |
| **Database/Migrations** | 35 | 10 | 0 | 0 | **45** |
| **Models** | 32 | 10 | 2 | 0 | **44** |
| **Routes** | 22 | 10 | 0 | 0 | **32** |
| **Middleware** | 11 | 7 | 0 | 0 | **18** |
| **Services** | 26 | 5 | 2 | 0 | **33** |
| **Utils** | 10 | 4 | 6 | 0 | **20** |
| **Cron/Jobs** | 16 | 0 | 0 | 0 | **16** |
| **Vault** | 4 | 3 | 0 | 0 | **7** |
| **Sync** | 0 | 5 | 0 | 0 | **5** |
| **Plugins** | 0 | 8 | 0 | 4 | **12** |
| **Scripts** | 11 | 7 | 0 | 0 | **18** |
| **Tests** | 8+ | 0 | 0 | 0 | **8+** |
| **Config Files** | 10 | 4 | 2 | 2 | **18** |
| **TOTAL** | **~189** | **~76** | **~14** | **~6** | **~285** |

---

## Liste des Protocoles Système (Chapitre 8 du V7)

| Protocole | Fichiers Requis | Description |
|-----------|-----------------|-------------|
| **Flamma Levis** | FlammaService.js, flamma.js | Réaction autonome, isolation locale |
| **Flamma Salutaris** | FlammaService.js, flamma.js | Onde de choc locale + centrale |
| **Flamma Purgatrix** | FlammaService.js, flamma.js | Purification mondiale |
| **GuiltySpark** | GuiltySparkService.js, guiltySpark.js | Création/gestion serveurs locaux |
| **Cendre Blanche** | CendreBlancheService.js, cendreBlanché.js | Suppression définitive utilisateur |
| **Papier Froissé** | PapierFroisseService.js, papierFroisse.js | Réactivation compte supprimé |
| **Porte de Grange** | PorteDeGrangeService.js, porteDeGrange.js | Isolation réseau |
| **Upside Mode** | UpsideModeService.js, upsideMode.js | Mode test/miroir |
| **Clé Totem** | CleTotemService.js, cleTotem.js | Authentification physique |

---

## Modèles de Sécurité Critiques (Chapitre 5 du V7)

| Modèle | Table SQL | Description |
|--------|-----------|-------------|
| **AesKeyRotation** | aes_keys_rotation | Rotation des clés AES-256-GCM |
| **SharedSecret** | shared_secrets | Secrets partagés central/local |
| **EmergencyCode** | emergency_codes | Tableau de secours (100 codes) |
| **VaultItem** | vault_items | Éléments stockés dans le Vault |
| **SecurityProtocolLog** | security_protocols_log | Logs des protocoles système |

---

## Tâches CRON Requises (Chapitre 5.7 du V7)

| Job | Fréquence | Description |
|-----|-----------|-------------|
| **nightlyMaintenance** | Quotidien 00h00 local | Maintenance complète (~45 min) |
| **keyRotationCheck** | 1er décembre annuel | Rotation clés AES |
| **secretRotationCheck** | Annuel | Rotation secrets partagés |
| **sessionCleanup** | Quotidien | Nettoyage sessions expirées |
| **logArchive** | Quotidien | Archivage logs journaliers |
| **waitingListActivation** | Quotidien 10h00 | Activation J-3 liste d'attente |
| **guardReminders** | Lun/Jeu/Sam | Relances créneaux vides |
| **backupDaily** | Quotidien 00h30 | Sauvegarde incrémentale |
| **backupWeekly** | Dimanche 02h00 | Sauvegarde complète |
| **healthCheck** | Toutes les 5 min | Contrôle santé système |
| **metricsCollection** | Toutes les 30 sec | Collecte métriques |
| **localServerHeartbeat** | Toutes les 5 min | Vérification serveurs locaux |

---

## Variables d'Environnement Critiques

```bash
# === SÉCURITÉ (OBLIGATOIRE EN PRODUCTION) ===
JWT_SECRET=                    # Secret JWT (min 64 caractères)
JWT_REFRESH_SECRET=            # Secret refresh token
ENCRYPTION_KEY=                # Clé AES-256 (64 caractères hex)
HMAC_KEY=                      # Clé HMAC-SHA256
VAULT_MASTER_KEY=              # Clé maître du Vault
COOKIE_SECRET=                 # Secret cookies

# === BASE DE DONNÉES ===
DB_HOST=                       # Hôte PostgreSQL
DB_PORT=5432                   # Port PostgreSQL
DB_NAME=shugo_central          # Nom base de données
DB_USER=                       # Utilisateur
DB_PASSWORD=                   # Mot de passe (FORT en production)

# === SERVEUR ===
NODE_ENV=production            # Environnement
PORT=3000                      # Port serveur
SERVER_ID=central-001          # Identifiant serveur

# === GÉOGRAPHIE ===
DEFAULT_GEO_ID=02-33-06-01-00  # Geo_id par défaut
TIMEZONE=Europe/Paris          # Fuseau horaire
```

---

**FIN DU DOCUMENT DE STRUCTURE**

*Ce document constitue la référence pour le développement complet du backend SHUGO v7.0*
*Toute modification doit être reportée dans ce fichier*

---
Document généré le: $(date)
Version: 7.0.0