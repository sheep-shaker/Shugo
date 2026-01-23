# SHUGO v7.0 - Configuration de la Base de Données

## Serveur Local (SQLite) ✅

Le serveur local utilise SQLite et ne nécessite aucune installation supplémentaire.

```bash
cd shugo-backend/local
npm run migrate
```

Tables créées automatiquement:
- local_users
- local_guards
- local_assignments
- local_groups
- local_group_memberships
- local_notifications
- sync_queue
- local_changes
- heartbeat_logs
- local_config

## Serveur Central (PostgreSQL)

### Installation PostgreSQL

#### Windows
1. Télécharger: https://www.postgresql.org/download/windows/
2. Installer PostgreSQL 14+
3. Retenir le mot de passe du superutilisateur

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

#### macOS
```bash
brew install postgresql@14
brew services start postgresql@14
```

### Création de la Base de Données

```bash
# Connexion en tant que superutilisateur
sudo -u postgres psql

# Créer l'utilisateur shugo
CREATE USER shugo WITH PASSWORD 'votre_mot_de_passe_fort';

# Créer la base de données
CREATE DATABASE shugo_central OWNER shugo;

# Accorder les permissions
GRANT ALL PRIVILEGES ON DATABASE shugo_central TO shugo;

# Créer les extensions (optionnel mais recommandé)
\c shugo_central
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

# Quitter
\q
```

### Configuration .env

Mettre à jour `central/.env`:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=shugo_central
DB_USER=shugo
DB_PASSWORD=votre_mot_de_passe_fort
```

### Migration

```bash
cd shugo-backend/central
npm run db:migrate
```

### Vérification

```bash
# Tester la connexion
psql -h localhost -U shugo -d shugo_central -c "SELECT version();"

# Lister les tables
psql -h localhost -U shugo -d shugo_central -c "\dt"
```

## Docker (Alternative)

Pour un environnement de développement rapide:

```bash
# Démarrer PostgreSQL avec Docker
docker run -d \
  --name shugo-postgres \
  -e POSTGRES_USER=shugo \
  -e POSTGRES_PASSWORD=shugo_dev_password \
  -e POSTGRES_DB=shugo_central \
  -p 5432:5432 \
  postgres:14-alpine

# Vérifier
docker logs shugo-postgres
```

## Prochaines étapes

1. Configurer PostgreSQL (instructions ci-dessus)
2. Exécuter les migrations: `npm run db:migrate`
3. Lancer le serveur: `npm run dev`
