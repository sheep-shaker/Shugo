#!/usr/bin/env node
/**
 * SHUGO v7.0 - Générateur de configuration .env
 *
 * Génère les fichiers .env pour le serveur central et local
 * avec des clés cryptographiques sécurisées.
 *
 * Usage: node scripts/generate-env.js [--production]
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const isProduction = process.argv.includes('--production');
const rootDir = path.resolve(__dirname, '..');

console.log('🔐 SHUGO v7.0 - Générateur de configuration');
console.log('==========================================');
console.log(`Mode: ${isProduction ? 'PRODUCTION' : 'DÉVELOPPEMENT'}\n`);

// Génère une clé hex de la longueur spécifiée (en bytes)
function generateHexKey(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Génère un secret JWT
function generateJWTSecret() {
  return crypto.randomBytes(64).toString('base64').replace(/[+/=]/g, '');
}

// Génère un server ID unique
function generateServerId(type) {
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${type}-${suffix}`;
}

// Génère un geo_id pour le local
function generateGeoId() {
  return '01-075-01-01-01'; // Paris par défaut
}

// ============================================
// Génération des clés partagées
// ============================================

const sharedKeys = {
  ENCRYPTION_KEY: generateHexKey(32),
  HMAC_KEY: generateHexKey(32),
  VAULT_MASTER_KEY: generateHexKey(32),
  JWT_SECRET: generateJWTSecret(),
  JWT_REFRESH_SECRET: generateJWTSecret(),
  COOKIE_SECRET: generateHexKey(32),
  SHARED_SECRET: generateHexKey(32), // Pour sync local-central
};

console.log('✅ Clés cryptographiques générées:\n');
console.log(`   ENCRYPTION_KEY:    ${sharedKeys.ENCRYPTION_KEY.substring(0, 16)}...`);
console.log(`   HMAC_KEY:          ${sharedKeys.HMAC_KEY.substring(0, 16)}...`);
console.log(`   VAULT_MASTER_KEY:  ${sharedKeys.VAULT_MASTER_KEY.substring(0, 16)}...`);
console.log(`   JWT_SECRET:        ${sharedKeys.JWT_SECRET.substring(0, 16)}...`);
console.log(`   SHARED_SECRET:     ${sharedKeys.SHARED_SECRET.substring(0, 16)}...`);
console.log('');

// ============================================
// Configuration Central
// ============================================

const centralConfig = `# ============================================
# SHUGO v7.0 - Central Server Configuration
# Generated: ${new Date().toISOString()}
# ============================================

# === ENVIRONNEMENT ===
NODE_ENV=${isProduction ? 'production' : 'development'}

# === SERVEUR ===
PORT=3000
HOST=0.0.0.0
SERVER_ID=${generateServerId('central')}
SERVER_TYPE=central
BASE_URL=${isProduction ? 'https://api.shugo.app' : 'http://localhost:3000'}

# === BASE DE DONNÉES PostgreSQL ===
DB_HOST=${isProduction ? 'db.shugo.app' : 'localhost'}
DB_PORT=5432
DB_NAME=shugo_central
DB_USER=shugo
DB_PASSWORD=${isProduction ? generateHexKey(16) : 'shugo_dev_password'}
DB_LOGGING=${isProduction ? 'false' : 'true'}
DB_TIMEZONE=+00:00
DB_SSL=${isProduction ? 'true' : 'false'}
DB_SSL_REJECT_UNAUTHORIZED=true

# Pool de connexions
DB_POOL_MAX=${isProduction ? '20' : '5'}
DB_POOL_MIN=${isProduction ? '5' : '1'}
DB_POOL_ACQUIRE=30000
DB_POOL_IDLE=10000

# === REDIS ===
REDIS_ENABLED=${isProduction ? 'true' : 'false'}
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_PREFIX=shugo:

# === JWT ET AUTHENTIFICATION ===
JWT_SECRET=${sharedKeys.JWT_SECRET}
JWT_REFRESH_SECRET=${sharedKeys.JWT_REFRESH_SECRET}
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d
JWT_ISSUER=shugo-central
JWT_AUDIENCE=shugo-users

# === SÉCURITÉ ET CRYPTOGRAPHIE ===
ENCRYPTION_KEY=${sharedKeys.ENCRYPTION_KEY}
HMAC_KEY=${sharedKeys.HMAC_KEY}
VAULT_MASTER_KEY=${sharedKeys.VAULT_MASTER_KEY}
COOKIE_SECRET=${sharedKeys.COOKIE_SECRET}

# Argon2 (hachage mot de passe)
ARGON2_MEMORY=${isProduction ? '65536' : '4096'}
ARGON2_TIME=3
ARGON2_PARALLELISM=${isProduction ? '4' : '1'}

# TOTP (2FA)
TOTP_ISSUER=SHUGO
TOTP_WINDOW=1

# Rate limiting
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX=${isProduction ? '100' : '1000'}
RATE_LIMIT_AUTH=${isProduction ? '5' : '20'}
AUTH_LOCKOUT_MINUTES=15

# Sessions
MAX_CONCURRENT_SESSIONS=5
SESSION_INACTIVITY=1800000

# === GÉOGRAPHIE ===
DEFAULT_GEO_ID=01-075-01-01-01
DEFAULT_TIMEZONE=Europe/Paris
DEFAULT_LANGUAGE=fr

# === NOTIFICATIONS ===
MAILJET_ENABLED=false
MAILJET_API_KEY=
MAILJET_API_SECRET=
MAILJET_FROM_EMAIL=noreply@shugo.app
MAILJET_FROM_NAME=SHUGO

MATRIX_ENABLED=false
MATRIX_HOMESERVER=https://matrix.org
MATRIX_ACCESS_TOKEN=
MATRIX_USER_ID=@shugo-bot:matrix.org

# === MAINTENANCE ===
MAINTENANCE_ENABLED=true
MAINTENANCE_HOUR=3
MAINTENANCE_MINUTE=0
MAINTENANCE_DURATION=45
MAINTENANCE_TIMEZONE=local

# === SAUVEGARDE ===
BACKUP_ENABLED=true
BACKUP_DAILY_HOUR=2
BACKUP_DAILY_MINUTE=0
BACKUP_WEEKLY_DAY=0
BACKUP_WEEKLY_HOUR=3
BACKUP_PATH=./backups

BACKUP_RETENTION_DAILY=30
BACKUP_RETENTION_WEEKLY=90
BACKUP_RETENTION_MONTHLY=365

BACKUP_EXTERNAL_ENABLED=false

# === LOGS ===
LOG_LEVEL=${isProduction ? 'info' : 'debug'}
LOG_FORMAT=json
LOG_DIR=./logs
LOG_MAX_SIZE=20m
LOG_MAX_FILES=14d
AUDIT_RETENTION_DAYS=365

# === PLUGINS ===
PLUGINS_ENABLED=true
PLUGINS_DIR=./plugins
PLUGINS_AUTOLOAD=false

# === CORS ===
CORS_ENABLED=true
CORS_ORIGINS=${isProduction ? 'https://app.shugo.app' : 'http://localhost:3000,http://localhost:8080,http://localhost:5173'}

# === FEATURES FLAGS ===
FEATURE_2FA_REQUIRED=${isProduction ? 'true' : 'false'}
FEATURE_EMAIL_VERIFY=true
FEATURE_REGISTRATION_OPEN=true
FEATURE_MAINTENANCE_MODE=false
FEATURE_DEBUG_MODE=${isProduction ? 'false' : 'true'}

# === SYNC LOCAL SERVERS ===
LOCAL_REGISTRATION_TOKEN=${generateHexKey(32)}
`;

// ============================================
// Configuration Local
// ============================================

const localServerId = generateServerId('local');
const localGeoId = generateGeoId();

const localConfig = `# ============================================
# SHUGO v7.0 - Local Server Configuration
# Generated: ${new Date().toISOString()}
# ============================================

# === ENVIRONNEMENT ===
NODE_ENV=${isProduction ? 'production' : 'development'}

# === SERVEUR ===
PORT=3001
HOST=0.0.0.0
SERVER_ID=${localServerId}
SERVER_TYPE=local
GEO_ID=${localGeoId}

# === SERVEUR CENTRAL ===
CENTRAL_URL=${isProduction ? 'https://api.shugo.app' : 'http://localhost:3000'}
CENTRAL_TIMEOUT=30000
CENTRAL_RETRY_ATTEMPTS=3
CENTRAL_RETRY_DELAY=1000

# === AUTHENTIFICATION CENTRAL ===
SHARED_SECRET=${sharedKeys.SHARED_SECRET}
REGISTRATION_TOKEN=

# === BASE DE DONNÉES SQLite ===
DATABASE_PATH=./data/shugo.db
DATABASE_BACKUP_PATH=./data/backups

# === JWT (Local) ===
JWT_SECRET=${sharedKeys.JWT_SECRET}
JWT_ACCESS_EXPIRES=1h
JWT_ISSUER=shugo-local

# === SÉCURITÉ ===
ENCRYPTION_KEY=${sharedKeys.ENCRYPTION_KEY}
HMAC_KEY=${sharedKeys.HMAC_KEY}

# Vault local
VAULT_PATH=./data/vault
VAULT_MASTER_KEY=${sharedKeys.VAULT_MASTER_KEY}
VAULT_DATA_KEY=${generateHexKey(32)}
VAULT_BACKUP_KEY=${generateHexKey(32)}

# Rate limiting (plus permissif en local)
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX=200
RATE_LIMIT_AUTH=10

# === SYNCHRONISATION ===
SYNC_ENABLED=true
SYNC_MODE=auto
SYNC_INTERVAL=300000
SYNC_BATCH_SIZE=100
SYNC_RETRY_ATTEMPTS=3
SYNC_RETRY_DELAY=5000

# Heartbeat
HEARTBEAT_INTERVAL=60000
HEARTBEAT_TIMEOUT=10000

# Priorités de sync (plus bas = plus prioritaire)
SYNC_PRIORITY_USERS=1
SYNC_PRIORITY_GUARDS=2
SYNC_PRIORITY_GROUPS=3
SYNC_PRIORITY_ASSIGNMENTS=4

# === BACKUP LOCAL ===
BACKUP_ENABLED=true
BACKUP_SCHEDULE=0 2 * * *
BACKUP_RETENTION_DAYS=30
BACKUP_ENCRYPTION=true

# === NOTIFICATIONS ===
NOTIFICATION_GUARD_DAYS=1,4,6
NOTIFICATION_GUARD_HOUR=9
NOTIFICATION_CLEANUP_DAYS=30

# === LOGS ===
LOG_LEVEL=${isProduction ? 'info' : 'debug'}
LOG_FORMAT=json
LOG_DIR=./logs
LOG_MAX_SIZE=10m
LOG_MAX_FILES=7d

# === CACHE ===
CACHE_ENABLED=true
CACHE_TTL=300
CACHE_CHECK_PERIOD=60

# === PLUGINS ===
PLUGINS_ENABLED=true
PLUGINS_DIR=./plugins
`;

// ============================================
// Écriture des fichiers
// ============================================

const centralEnvPath = path.join(rootDir, 'central', '.env');
const localEnvPath = path.join(rootDir, 'local', '.env');

// Vérifier si les fichiers existent
const centralExists = fs.existsSync(centralEnvPath);
const localExists = fs.existsSync(localEnvPath);

if (centralExists || localExists) {
  console.log('⚠️  Fichiers .env existants détectés:');
  if (centralExists) console.log('   - central/.env');
  if (localExists) console.log('   - local/.env');
  console.log('');

  // Sauvegarder les anciens fichiers
  const timestamp = Date.now();
  if (centralExists) {
    const backupPath = `${centralEnvPath}.backup.${timestamp}`;
    fs.copyFileSync(centralEnvPath, backupPath);
    console.log(`   Sauvegarde: central/.env.backup.${timestamp}`);
  }
  if (localExists) {
    const backupPath = `${localEnvPath}.backup.${timestamp}`;
    fs.copyFileSync(localEnvPath, backupPath);
    console.log(`   Sauvegarde: local/.env.backup.${timestamp}`);
  }
  console.log('');
}

// Écrire les nouveaux fichiers
fs.writeFileSync(centralEnvPath, centralConfig);
console.log('✅ Fichier créé: central/.env');

fs.writeFileSync(localEnvPath, localConfig);
console.log('✅ Fichier créé: local/.env');

// ============================================
// Créer les dossiers nécessaires
// ============================================

const dirsToCreate = [
  path.join(rootDir, 'central', 'logs'),
  path.join(rootDir, 'central', 'backups'),
  path.join(rootDir, 'central', 'plugins'),
  path.join(rootDir, 'local', 'logs'),
  path.join(rootDir, 'local', 'data'),
  path.join(rootDir, 'local', 'data', 'backups'),
  path.join(rootDir, 'local', 'data', 'vault'),
  path.join(rootDir, 'local', 'plugins'),
];

console.log('\n📁 Création des dossiers...');
dirsToCreate.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`   Créé: ${path.relative(rootDir, dir)}/`);
  }
});

// ============================================
// Résumé
// ============================================

console.log('\n==========================================');
console.log('✅ Configuration terminée!\n');

console.log('📋 Prochaines étapes:\n');
console.log('1. Central Server:');
console.log('   cd central');
console.log('   # Créer la base PostgreSQL:');
console.log('   # createdb -U postgres shugo_central');
console.log('   npm run db:migrate');
console.log('   npm run dev\n');

console.log('2. Local Server:');
console.log('   cd local');
console.log('   npm run migrate');
console.log('   npm run dev\n');

if (!isProduction) {
  console.log('⚠️  Mode développement - Ne pas utiliser en production!');
  console.log('   Pour la production: node scripts/generate-env.js --production\n');
}

console.log('🔑 Clé partagée pour enregistrer le serveur local:');
console.log(`   SHARED_SECRET: ${sharedKeys.SHARED_SECRET}\n`);

