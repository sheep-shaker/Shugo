# SHUGO Backend - Serveur Central v7.0

## 🚀 Installation Rapide

### Prérequis
- Node.js 20.11.0 LTS ou supérieur
- PostgreSQL 15.5 ou supérieur
- Redis (optionnel, pour le cache)

### Installation

```bash
# 1. Installer les dépendances
npm install

# 2. Générer les clés de sécurité
node scripts/generate-keys.js

# 3. Configurer l'environnement
cp .env.example .env
# Éditer .env avec vos paramètres de base de données

# 4. Créer la base de données
createdb shugo_central

# 5. Migrer la base de données
npm run migrate

# 6. Créer un administrateur
node scripts/create-admin.js

# 7. Démarrer le serveur
npm start
```

## 📁 Structure du Projet

```
central/
├── src/
│   ├── config/           # Configuration
│   ├── database/         # Connexion DB
│   ├── models/           # Modèles Sequelize
│   ├── routes/           # Routes API
│   ├── middleware/       # Middleware Express
│   ├── services/         # Services métier
│   ├── utils/            # Utilitaires
│   ├── cron/            # Tâches planifiées
│   └── index.js         # Point d'entrée
├── scripts/             # Scripts d'administration
├── logs/               # Fichiers de logs
├── backups/            # Sauvegardes automatiques
└── package.json        # Dépendances
```

## 🔐 Sécurité

- Chiffrement AES-256-GCM pour les données sensibles
- Authentification JWT avec refresh tokens
- 2FA obligatoire avec TOTP
- Rotation automatique des clés
- Audit complet de toutes les actions

## 📚 Documentation API

### Authentication
- `POST /api/v1/auth/register` - Inscription avec token
- `POST /api/v1/auth/login` - Connexion
- `POST /api/v1/auth/logout` - Déconnexion
- `POST /api/v1/auth/refresh` - Rafraîchir le token

### Users
- `GET /api/v1/users` - Liste des utilisateurs
- `GET /api/v1/users/:id` - Détails utilisateur
- `PUT /api/v1/users/:id` - Modifier utilisateur
- `DELETE /api/v1/users/:id` - Supprimer utilisateur

### Guards
- `GET /api/v1/guards` - Liste des gardes
- `POST /api/v1/guards` - Créer une garde
- `PUT /api/v1/guards/:id` - Modifier une garde
- `POST /api/v1/guards/:id/assign` - S'inscrire à une garde

### Health
- `GET /api/v1/health` - Statut du système
- `GET /api/v1/health/metrics` - Métriques détaillées

## 🛠️ Scripts Disponibles

- `npm start` - Démarrer en production
- `npm run dev` - Démarrer en développement
- `npm run migrate` - Migrer la base de données
- `npm run backup` - Sauvegarde manuelle
- `npm test` - Lancer les tests

## 📝 Variables d'Environnement

Voir `.env.example` pour la liste complète des variables.

Variables critiques :
- `JWT_SECRET` - Secret pour les tokens JWT
- `ENCRYPTION_KEY` - Clé de chiffrement AES
- `DB_PASSWORD` - Mot de passe PostgreSQL

## 🐳 Docker

```bash
# Démarrer avec Docker Compose
docker-compose up -d

# Voir les logs
docker-compose logs -f
```

## 📊 Monitoring

- Logs Winston avec rotation quotidienne
- Métriques système via `/api/v1/health/metrics`
- Audit trail complet dans la table `audit_logs`

## 🤝 Contribution

Projet privé - Contribution réservée aux membres autorisés.

## 📄 Licence

Propriétaire - Tous droits réservés © 2025 SHUGO
