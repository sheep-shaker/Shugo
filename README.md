# SHUGO v7.0

**Système Hiérarchisé d'Utilisation et de Gestion Opérationnelle**

Application de gestion de plannings de garde communautaire avec architecture distribuée.

## Architecture

```
                    ┌─────────────────────┐
                    │     Frontend        │
                    │   (React + Vite)    │
                    │   localhost:5173    │
                    └──────────┬──────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
              ▼                                 ▼
┌─────────────────────────┐       ┌─────────────────────────┐
│    Serveur Central      │       │    Serveur Local        │
│      (Express.js)       │◄─────►│    (Raspberry Pi)       │
│    localhost:3000       │ Sync  │    localhost:3001       │
│                         │       │                         │
│ - Authentification      │       │ - Gestion des gardes    │
│ - Gestion utilisateurs  │       │ - Inscriptions          │
│ - Groupes & Locations   │       │ - Planning local        │
│ - Notifications         │       │ - Mode hors-ligne       │
└─────────────────────────┘       └─────────────────────────┘
         │                                   │
         ▼                                   ▼
    PostgreSQL                           SQLite
   (Production)                      (Embarqué Pi)
```

## Statut du Projet

| Composant | Statut | Description |
|-----------|--------|-------------|
| Frontend | En développement | React 19 + Vite + TailwindCSS |
| Serveur Central | Fonctionnel | Express.js + Sequelize |
| Serveur Local | A développer | Pour Raspberry Pi 5 |

## Structure du Projet

```
shugo.app/
├── shugo-frontend/          # Application React
│   ├── src/
│   │   ├── components/      # Composants UI (shadcn/ui)
│   │   ├── pages/           # Pages de l'application
│   │   ├── services/        # Appels API
│   │   ├── stores/          # State management (Zustand)
│   │   └── lib/             # Utilitaires
│   └── package.json
│
├── shugo-backend/
│   ├── central/             # Serveur Central
│   │   ├── src/
│   │   │   ├── config/      # Configuration
│   │   │   ├── database/    # Connexion DB
│   │   │   ├── middleware/  # Auth, CORS, etc.
│   │   │   ├── models/      # 9 modèles Sequelize
│   │   │   ├── routes/      # API REST
│   │   │   ├── services/    # Logique métier
│   │   │   └── utils/       # Logger, crypto
│   │   └── package.json
│   │
│   ├── local/               # Serveur Local (Raspberry Pi)
│   │   └── (à développer)
│   │
│   └── core/                # Code partagé
│
├── TODOLIST-SHUGO-V7.md     # Liste des tâches restantes
└── README.md
```

## Démarrage Rapide

### Prérequis

- Node.js >= 20.11.0
- npm >= 10.0.0
- Git

### Installation

```bash
# Cloner le dépôt
git clone https://github.com/sheep-shaker/Shugo.git
cd Shugo

# --- Backend (Serveur Central) ---
cd shugo-backend/central
cp .env.example .env
npm install
npm run dev

# --- Frontend (dans un autre terminal) ---
cd shugo-frontend
npm install
npm run dev
```

### Accès

| Service | URL | Description |
|---------|-----|-------------|
| Frontend | http://localhost:5173 | Application React |
| Backend API | http://localhost:3000 | Serveur Central |
| API Docs | http://localhost:3000/api-docs | Swagger UI |
| Health Check | http://localhost:3000/health | État du serveur |

### Compte Admin Test

```
Email: shugopaca@gmail.com
Mot de passe: ShugoAdmin2024!
```

## Scripts Disponibles

### Backend Central

```bash
npm run dev              # Démarrer en mode développement
npm start                # Démarrer en production
npm test                 # Lancer les tests
npm run lint             # Vérifier le code
npm run scripts:create-admin    # Créer un admin
npm run scripts:backup          # Sauvegarder la DB
```

### Frontend

```bash
npm run dev      # Démarrer le serveur de développement
npm run build    # Build de production
npm run preview  # Prévisualiser le build
npm run lint     # Vérifier le code
```

## API Endpoints

### Authentification
- `POST /api/v1/auth/login` - Connexion
- `POST /api/v1/auth/register` - Inscription
- `POST /api/v1/auth/refresh` - Rafraîchir le token
- `POST /api/v1/auth/logout` - Déconnexion

### Utilisateurs
- `GET /api/v1/users` - Liste des utilisateurs (Admin)
- `GET /api/v1/users/me` - Profil utilisateur
- `POST /api/v1/users` - Créer un utilisateur (Admin)
- `PATCH /api/v1/users/:id` - Modifier un utilisateur

### Groupes
- `GET /api/v1/groups` - Liste des groupes
- `GET /api/v1/groups/my-groups` - Mes groupes
- `POST /api/v1/groups` - Créer un groupe
- `POST /api/v1/groups/:id/add-member` - Ajouter un membre
- `POST /api/v1/groups/:id/remove-member` - Retirer un membre

### Localisations
- `GET /api/v1/locations` - Liste des localisations
- `GET /api/v1/locations/:geoId/children` - Enfants d'une localisation
- `POST /api/v1/locations` - Créer une localisation
- `PUT /api/v1/locations/:geoId` - Modifier une localisation

### Notifications
- `GET /api/v1/notifications` - Mes notifications
- `PATCH /api/v1/notifications/:id/read` - Marquer comme lue

## Hiérarchie des Rôles

| Rôle | Niveau | Permissions |
|------|--------|-------------|
| Silver | 1 | Utilisateur de base |
| Gold | 2 | Membre actif, peut s'inscrire aux gardes |
| Platinum | 3 | Responsable de localisation |
| Admin | 4 | Administrateur régional |
| Admin_N1 | 5 | Super administrateur |

## Format geo_id

Le geo_id identifie une localisation de manière hiérarchique :

```
CC-PPP-ZZ-JJ-NN
│  │   │  │  └── Numéro de local (01-99)
│  │   │  └───── Numéro de juridiction (01-99)
│  │   └──────── Code zone (01-99)
│  └──────────── Code province/région (001-999)
└─────────────── Code pays (01-99)

Exemple: 02-033-04-01-01
         │  │   │  │  └── Local #1
         │  │   │  └───── Juridiction #1
         │  │   └──────── Zone #4
         │  └──────────── Province #33
         └─────────────── Pays #2
```

## Technologies

### Frontend
- React 19
- Vite 7
- TailwindCSS 4
- Zustand (state management)
- React Query (data fetching)
- React Hook Form + Zod (formulaires)
- Radix UI / shadcn/ui (composants)

### Backend
- Express.js 4.18
- Sequelize 6.35 (ORM)
- SQLite (développement)
- PostgreSQL (production)
- JWT (authentification)
- Argon2 (hachage mots de passe)
- Winston (logging)

## Sécurité

- Authentification JWT avec access/refresh tokens
- Hachage des mots de passe avec Argon2
- Rate limiting sur les endpoints sensibles
- Validation des entrées avec Joi
- Headers de sécurité avec Helmet
- CORS configuré

## Prochaines Étapes

Voir [TODOLIST-SHUGO-V7.md](TODOLIST-SHUGO-V7.md) pour la liste complète des tâches.

**Priorités :**
1. Stabiliser la connexion frontend/backend
2. Compléter les fonctionnalités utilisateur
3. Déployer le serveur central en production
4. Développer le serveur local pour Raspberry Pi

## Licence

AGPL-3.0

---

*SHUGO v7.0.0 - Développé avec Claude Code*
