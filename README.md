# 🛡️ SHUGO V7 - Production Ready

## 📦 Contenu de l'archive

Cette archive contient le backend complet de SHUGO v7 avec :

- **84 fichiers JavaScript** validés syntaxiquement
- **Serveur Central** (36 fichiers) - Pour déploiement AWS/VPS
- **Serveur Local** (38 fichiers) - Pour Raspberry Pi
- **Package Core** (9 fichiers) - Code partagé
- **SDK Plugin** (1 fichier) - Base pour extensions

## 🚀 Démarrage Rapide

### Serveur Central (AWS/VPS)

```bash
# Extraire l'archive
tar -xzf SHUGO-v7-PRODUCTION-READY.tar.gz

# Aller dans le dossier central
cd shugo-backend/central

# Copier et configurer l'environnement
cp .env.example .env
nano .env  # Configurer les variables

# Installer les dépendances
npm install

# Générer les clés de sécurité
npm run generate-keys

# Migrer la base de données
npm run migrate

# Créer le premier admin
npm run create-admin

# Démarrer le serveur
npm start
```

### Serveur Local (Raspberry Pi)

```bash
# Aller dans le dossier local
cd shugo-platform/packages/local

# Copier et configurer l'environnement
cp .env.example .env
nano .env  # Configurer les variables

# Installer les dépendances
npm install

# Setup initial
npm run setup

# Migrer la base de données
npm run migrate

# Démarrer le serveur
npm start
```

## 📋 Scripts Disponibles

### Serveur Central
| Script | Description |
|--------|-------------|
| `npm start` | Démarrer en production |
| `npm run dev` | Démarrer en développement |
| `npm run migrate` | Migrer la base de données |
| `npm run backup` | Créer une sauvegarde |
| `npm run generate-keys` | Générer les clés de sécurité |
| `npm run create-admin` | Créer un administrateur |

### Serveur Local
| Script | Description |
|--------|-------------|
| `npm start` | Démarrer en production |
| `npm run dev` | Démarrer en développement |
| `npm run setup` | Configuration initiale |
| `npm run migrate` | Migrer la base de données |
| `npm run deploy` | Déployer sur Raspberry Pi |
| `npm run sync:pull` | Synchroniser depuis le central |
| `npm run sync:push` | Envoyer vers le central |

## 🔧 Configuration Requise

### Serveur Central
- Node.js >= 18.0.0
- PostgreSQL >= 15
- Redis (optionnel)
- 2 GB RAM minimum
- 10 GB espace disque

### Serveur Local (Raspberry Pi)
- Node.js >= 18.0.0
- Raspberry Pi 4 (recommandé)
- 2 GB RAM minimum
- 16 GB carte SD

## 🔐 Sécurité

L'archive inclut :
- ✅ Authentification JWT + 2FA (TOTP)
- ✅ Chiffrement AES-256-GCM
- ✅ Hachage Argon2
- ✅ Signature HMAC pour sync
- ✅ Rate limiting
- ✅ Helmet (headers sécurité)
- ✅ CORS configuré
- ✅ Validation Joi

## 📁 Structure

```
shugo-backend/
└── central/
    ├── src/
    │   ├── index.js          # Point d'entrée
    │   ├── config/           # Configuration
    │   ├── database/         # Connexion DB
    │   ├── middleware/       # Auth, errors, etc.
    │   ├── models/           # 13 modèles Sequelize
    │   ├── routes/           # 6 routes API
    │   ├── services/         # Business logic
    │   ├── cron/             # Tâches planifiées
    │   └── utils/            # Crypto, logger
    ├── scripts/              # 4 scripts utilitaires
    ├── package.json
    └── .env.example

shugo-platform/
├── packages/
│   ├── core/                 # Code partagé
│   │   ├── models/           # BaseModel
│   │   ├── services/         # BaseService
│   │   ├── events/           # EventBus
│   │   ├── utils/            # Crypto, helpers
│   │   └── constants/        # Rôles, erreurs
│   ├── local/                # Serveur Raspberry Pi
│   │   ├── src/
│   │   │   ├── index.js      # Point d'entrée
│   │   │   ├── config/
│   │   │   ├── database/
│   │   │   ├── middleware/
│   │   │   ├── models/       # 11 modèles
│   │   │   ├── routes/       # 7 routes
│   │   │   ├── services/
│   │   │   ├── sync/         # SyncManager
│   │   │   ├── vault/        # LocalVault
│   │   │   └── plugins/
│   │   ├── scripts/          # 5 scripts
│   │   └── plugins/          # Plugin calendar
│   └── sdk/                  # Base pour plugins
└── package.json
```

## ✅ Vérifications Effectuées

- [x] Syntaxe JavaScript valide (84/84 fichiers)
- [x] Tous les require() pointent vers des fichiers existants
- [x] Tous les scripts npm ont leurs fichiers
- [x] Modèle SystemLog créé pour le nettoyage des logs
- [x] Scripts de synchronisation créés
- [x] Script de déploiement Raspberry Pi créé
- [x] Dossiers logs/backups/data créés

## 📞 Support

En cas de problème, vérifier :
1. Version Node.js >= 18
2. Variables d'environnement configurées
3. Base de données accessible
4. Ports non utilisés (3000 central, 3001 local)

---

*SHUGO v7.0.0 - Système Hiérarchisé d'Utilisation et de Gestion Opérationnelle*
