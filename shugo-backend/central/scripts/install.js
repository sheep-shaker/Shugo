#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║                                                                  ║
 * ║              SHUGO v7.0 - CENTRAL SERVER INSTALLER               ║
 * ║                                                                  ║
 * ║  Script d'installation complet pour le serveur central SHUGO    ║
 * ║  Basé sur le Document Technique V7.0                             ║
 * ║                                                                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Usage: node scripts/install.js [options]
 *
 * Options:
 *   --production    Configure pour la production
 *   --skip-deps     Sauter l'installation des dépendances
 *   --skip-admin    Sauter la création de l'admin
 *   --non-interactive  Mode non-interactif (utilise les valeurs par défaut)
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// ============================================
// CONFIGURATION
// ============================================

const ROOT_DIR = path.resolve(__dirname, '..');
const isProduction = process.argv.includes('--production');
const skipDeps = process.argv.includes('--skip-deps');
const skipAdmin = process.argv.includes('--skip-admin');
const nonInteractive = process.argv.includes('--non-interactive');

// ============================================
// CONSOLE COLORS & HELPERS
// ============================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgGold: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

const log = {
  title: (msg) => console.log(`\n${colors.bright}${colors.cyan}═══ ${msg} ═══${colors.reset}\n`),
  step: (num, msg) => console.log(`${colors.blue}[${num}]${colors.reset} ${msg}`),
  info: (msg) => console.log(`${colors.dim}    ℹ ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}    ✓ ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}    ⚠ ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}    ✗ ${msg}${colors.reset}`),
  key: (name, value) => console.log(`${colors.dim}    ${name}: ${colors.reset}${value.substring(0, 20)}...`),
};

// ============================================
// READLINE INTERFACE
// ============================================

let rl;

function initReadline() {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

function question(prompt, defaultValue = '') {
  if (nonInteractive) {
    return Promise.resolve(defaultValue);
  }
  return new Promise((resolve) => {
    const displayPrompt = defaultValue
      ? `${prompt} [${defaultValue}]: `
      : `${prompt}: `;
    rl.question(displayPrompt, (answer) => {
      resolve(answer || defaultValue);
    });
  });
}

function questionPassword(prompt) {
  if (nonInteractive) {
    return Promise.resolve('Admin123!'); // Default password for non-interactive
  }
  return new Promise((resolve) => {
    process.stdout.write(`${prompt}: `);

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let password = '';

    const onData = (char) => {
      if (char === '\n' || char === '\r') {
        stdin.setRawMode(wasRaw);
        stdin.removeListener('data', onData);
        console.log('');
        resolve(password);
      } else if (char === '\u007F' || char === '\b') {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (char === '\u0003') {
        // Ctrl+C
        process.exit(1);
      } else {
        password += char;
        process.stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

// ============================================
// CRYPTO HELPERS
// ============================================

function generateHexKey(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function generateJWTSecret() {
  return crypto.randomBytes(64).toString('base64').replace(/[+/=]/g, '');
}

function generateServerId() {
  const suffix = crypto.randomBytes(4).toString('hex');
  return `central-${suffix}`;
}

// ============================================
// INSTALLATION STEPS
// ============================================

/**
 * Step 1: Display banner
 */
function displayBanner() {
  console.log(`
${colors.yellow}
    ███████╗██╗  ██╗██╗   ██╗ ██████╗  ██████╗
    ██╔════╝██║  ██║██║   ██║██╔════╝ ██╔═══██╗
    ███████╗███████║██║   ██║██║  ███╗██║   ██║
    ╚════██║██╔══██║██║   ██║██║   ██║██║   ██║
    ███████║██║  ██║╚██████╔╝╚██████╔╝╚██████╔╝
    ╚══════╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝  ╚═════╝
${colors.reset}
${colors.bright}    ══════════════════════════════════════════${colors.reset}
${colors.cyan}       CENTRAL SERVER INSTALLER v7.0${colors.reset}
${colors.bright}    ══════════════════════════════════════════${colors.reset}

    Mode: ${isProduction ? `${colors.red}PRODUCTION${colors.reset}` : `${colors.green}DÉVELOPPEMENT${colors.reset}`}
    Date: ${new Date().toISOString()}
`);
}

/**
 * Step 2: Check prerequisites
 */
async function checkPrerequisites() {
  log.title('VÉRIFICATION DES PRÉREQUIS');

  // Check Node.js version
  log.step(1, 'Vérification de Node.js...');
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.split('.')[0].substring(1));

  if (major < 18) {
    log.error(`Node.js 18+ requis. Version actuelle: ${nodeVersion}`);
    throw new Error('Node.js version insuffisante');
  }
  log.success(`Node.js ${nodeVersion} ✓`);

  // Check npm
  log.step(2, 'Vérification de npm...');
  try {
    const { stdout } = await execAsync('npm --version');
    log.success(`npm ${stdout.trim()} ✓`);
  } catch {
    log.error('npm non trouvé');
    throw new Error('npm requis');
  }

  // Check if package.json exists
  log.step(3, 'Vérification du projet...');
  const packagePath = path.join(ROOT_DIR, 'package.json');
  if (!fsSync.existsSync(packagePath)) {
    log.error('package.json non trouvé');
    throw new Error('Exécutez ce script depuis le dossier central/');
  }
  log.success('Structure du projet valide ✓');

  // Check for database (PostgreSQL or SQLite)
  log.step(4, 'Vérification de la base de données...');
  if (isProduction) {
    try {
      await execAsync('psql --version');
      log.success('PostgreSQL disponible ✓');
    } catch {
      log.warn('PostgreSQL non trouvé - SQLite sera utilisé');
    }
  } else {
    log.info('Mode dev: SQLite sera utilisé');
  }
}

/**
 * Step 3: Create directory structure
 */
async function createDirectories() {
  log.title('CRÉATION DES RÉPERTOIRES');

  const dirs = [
    'data',
    'logs',
    'backups',
    'backups/daily',
    'backups/weekly',
    'backups/monthly',
    'plugins',
    'temp',
    'uploads',
  ];

  for (const dir of dirs) {
    const dirPath = path.join(ROOT_DIR, dir);
    await fs.mkdir(dirPath, { recursive: true });
    log.success(`${dir}/`);
  }

  // Create .gitkeep files
  for (const dir of ['logs', 'backups', 'temp', 'uploads']) {
    const gitkeepPath = path.join(ROOT_DIR, dir, '.gitkeep');
    if (!fsSync.existsSync(gitkeepPath)) {
      await fs.writeFile(gitkeepPath, '');
    }
  }
}

/**
 * Step 4: Generate environment configuration
 */
async function generateEnvironment() {
  log.title('GÉNÉRATION DE LA CONFIGURATION');

  const envPath = path.join(ROOT_DIR, '.env');

  // Check if .env already exists
  if (fsSync.existsSync(envPath)) {
    log.warn('.env existe déjà');
    const overwrite = await question('Écraser le fichier existant? (o/n)', 'n');
    if (overwrite.toLowerCase() !== 'o' && overwrite.toLowerCase() !== 'y') {
      log.info('Conservation du fichier .env existant');
      return null;
    }
    // Backup existing .env
    const backupPath = `${envPath}.backup.${Date.now()}`;
    await fs.copyFile(envPath, backupPath);
    log.info(`Sauvegarde: ${path.basename(backupPath)}`);
  }

  // Gather configuration
  log.step(1, 'Configuration du serveur...');

  const port = await question('Port du serveur', '3000');
  const baseUrl = isProduction
    ? await question('URL de base', 'https://api.shugo.app')
    : `http://localhost:${port}`;

  log.step(2, 'Configuration de la base de données...');

  let dbConfig;
  if (isProduction) {
    const dbHost = await question('Hôte PostgreSQL', 'localhost');
    const dbPort = await question('Port PostgreSQL', '5432');
    const dbName = await question('Nom de la base', 'shugo_central');
    const dbUser = await question('Utilisateur', 'shugo');
    const dbPassword = await questionPassword('Mot de passe PostgreSQL');

    dbConfig = {
      dialect: 'postgres',
      host: dbHost,
      port: dbPort,
      name: dbName,
      user: dbUser,
      password: dbPassword,
    };
  } else {
    dbConfig = {
      dialect: 'sqlite',
      storage: './data/shugo_central.db',
    };
    log.info('SQLite sera utilisé pour le développement');
  }

  log.step(3, 'Génération des clés cryptographiques...');

  const keys = {
    JWT_SECRET: generateJWTSecret(),
    JWT_REFRESH_SECRET: generateJWTSecret(),
    ENCRYPTION_KEY: generateHexKey(32),
    HMAC_KEY: generateHexKey(32),
    VAULT_MASTER_KEY: generateHexKey(32),
    COOKIE_SECRET: generateHexKey(32),
    LOCAL_REGISTRATION_TOKEN: generateHexKey(32),
  };

  log.key('JWT_SECRET', keys.JWT_SECRET);
  log.key('ENCRYPTION_KEY', keys.ENCRYPTION_KEY);
  log.key('VAULT_MASTER_KEY', keys.VAULT_MASTER_KEY);

  log.step(4, 'Configuration géographique...');

  const geoId = await question('Geo ID par défaut (format: CC-PPP-ZZ-JJ-NN)', '02-033-01-01-00');
  const timezone = await question('Fuseau horaire', 'Europe/Paris');

  // Generate server ID
  const serverId = generateServerId();

  // Create .env content
  const envContent = `# ============================================
# SHUGO v7.0 - Central Server Configuration
# Generated: ${new Date().toISOString()}
# ============================================

# === ENVIRONNEMENT ===
NODE_ENV=${isProduction ? 'production' : 'development'}

# === SERVEUR ===
PORT=${port}
HOST=0.0.0.0
SERVER_ID=${serverId}
SERVER_TYPE=central
BASE_URL=${baseUrl}

# === BASE DE DONNÉES ===
${dbConfig.dialect === 'sqlite' ? `# Use SQLite for development (set to 'postgres' for production)
DB_DIALECT=sqlite
DB_STORAGE=${dbConfig.storage}` : `DB_DIALECT=postgres
DB_HOST=${dbConfig.host}
DB_PORT=${dbConfig.port}
DB_NAME=${dbConfig.name}
DB_USER=${dbConfig.user}
DB_PASSWORD=${dbConfig.password}`}
# PostgreSQL config (when DB_DIALECT=postgres)
DB_HOST=${dbConfig.host || 'localhost'}
DB_PORT=${dbConfig.port || '5432'}
DB_NAME=${dbConfig.name || 'shugo_central'}
DB_USER=${dbConfig.user || 'shugo'}
DB_PASSWORD=${dbConfig.password || 'shugo_dev_password'}
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
JWT_SECRET=${keys.JWT_SECRET}
JWT_REFRESH_SECRET=${keys.JWT_REFRESH_SECRET}
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d
JWT_ISSUER=shugo-central
JWT_AUDIENCE=shugo-users

# === SÉCURITÉ ET CRYPTOGRAPHIE ===
ENCRYPTION_KEY=${keys.ENCRYPTION_KEY}
HMAC_KEY=${keys.HMAC_KEY}
VAULT_MASTER_KEY=${keys.VAULT_MASTER_KEY}
COOKIE_SECRET=${keys.COOKIE_SECRET}

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
DEFAULT_GEO_ID=${geoId}
DEFAULT_TIMEZONE=${timezone}
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
LOCAL_REGISTRATION_TOKEN=${keys.LOCAL_REGISTRATION_TOKEN}
`;

  await fs.writeFile(envPath, envContent);
  log.success('.env généré avec succès');

  // Save keys securely
  const keysPath = path.join(ROOT_DIR, 'data', 'installation-keys.json');
  const keysBackup = {
    generated: new Date().toISOString(),
    serverId,
    mode: isProduction ? 'production' : 'development',
    keys: {
      LOCAL_REGISTRATION_TOKEN: keys.LOCAL_REGISTRATION_TOKEN,
      VAULT_MASTER_KEY: keys.VAULT_MASTER_KEY,
    },
    warning: 'CONSERVEZ CE FICHIER EN LIEU SÛR! Ces clés sont nécessaires pour la récupération.'
  };

  await fs.writeFile(keysPath, JSON.stringify(keysBackup, null, 2));
  await fs.chmod(keysPath, 0o600).catch(() => {}); // May fail on Windows

  log.warn(`Clés sauvegardées dans: data/installation-keys.json`);
  log.warn('⚠️  CONSERVEZ CE FICHIER EN LIEU SÛR!');

  return keys;
}

/**
 * Step 5: Install dependencies
 */
async function installDependencies() {
  if (skipDeps) {
    log.title('INSTALLATION DES DÉPENDANCES (IGNORÉ)');
    return;
  }

  log.title('INSTALLATION DES DÉPENDANCES');

  log.step(1, 'Installation des packages npm...');
  log.info('Cette étape peut prendre plusieurs minutes...');

  return new Promise((resolve, reject) => {
    const npm = spawn('npm', ['install'], {
      cwd: ROOT_DIR,
      shell: true,
      stdio: 'pipe'
    });

    let output = '';

    npm.stdout.on('data', (data) => {
      output += data.toString();
      // Show progress dots
      process.stdout.write('.');
    });

    npm.stderr.on('data', (data) => {
      const msg = data.toString();
      if (!msg.includes('WARN') && !msg.includes('notice')) {
        output += msg;
      }
    });

    npm.on('close', (code) => {
      console.log(''); // New line after dots
      if (code === 0) {
        log.success('Dépendances installées');
        resolve();
      } else {
        log.error('Échec de l\'installation');
        log.info(output);
        reject(new Error('npm install failed'));
      }
    });
  });
}

/**
 * Step 6: Initialize database
 */
async function initializeDatabase() {
  log.title('INITIALISATION DE LA BASE DE DONNÉES');

  // Load environment
  require('dotenv').config({ path: path.join(ROOT_DIR, '.env') });

  log.step(1, 'Connexion à la base de données...');

  try {
    const { sequelize } = require('../src/database/connection');
    await sequelize.authenticate();
    log.success('Connexion établie');

    log.step(2, 'Exécution des migrations...');

    // Run migrations
    const { exec } = require('child_process');
    await new Promise((resolve, reject) => {
      exec('npm run db:migrate', { cwd: ROOT_DIR }, (error, stdout, stderr) => {
        if (error) {
          // Try alternative method
          log.info('Migration via sequelize-cli...');
          exec('npx sequelize-cli db:migrate', { cwd: ROOT_DIR }, (err2, out2, err2msg) => {
            if (err2) {
              log.warn('Migrations manuelles peuvent être nécessaires');
              resolve();
            } else {
              log.success('Migrations exécutées');
              resolve();
            }
          });
        } else {
          log.success('Migrations exécutées');
          resolve();
        }
      });
    });

    log.step(3, 'Exécution des seeders...');

    // Run seeders
    try {
      const seedersPath = path.join(ROOT_DIR, 'src', 'database', 'seeders');
      const files = await fs.readdir(seedersPath);

      for (const file of files.sort()) {
        if (file.endsWith('.js')) {
          try {
            const seeder = require(path.join(seedersPath, file));
            if (typeof seeder.up === 'function') {
              await seeder.up(sequelize.getQueryInterface(), sequelize.Sequelize);
              log.success(`Seeder: ${file}`);
            }
          } catch (seedError) {
            log.warn(`Seeder ${file}: ${seedError.message}`);
          }
        }
      }
    } catch (seedError) {
      log.warn('Seeders ignorés: ' + seedError.message);
    }

    await sequelize.close();

  } catch (error) {
    log.error('Erreur base de données: ' + error.message);
    log.info('Vous pouvez initialiser manuellement avec: npm run db:migrate');
  }
}

/**
 * Step 7: Create admin account
 */
async function createAdminAccount() {
  if (skipAdmin) {
    log.title('CRÉATION ADMINISTRATEUR (IGNORÉ)');
    return;
  }

  log.title('CRÉATION DU COMPTE ADMINISTRATEUR');

  const createAdmin = await question('Créer un compte administrateur maintenant? (o/n)', 'o');

  if (createAdmin.toLowerCase() !== 'o' && createAdmin.toLowerCase() !== 'y') {
    log.info('Vous pouvez créer un admin plus tard avec: node scripts/create-admin.js');
    return;
  }

  // Load environment and models
  require('dotenv').config({ path: path.join(ROOT_DIR, '.env') });

  try {
    const { sequelize } = require('../src/database/connection');
    const User = require('../src/models/User');
    const cryptoManager = require('../src/utils/crypto');
    const speakeasy = require('speakeasy');
    const qrcode = require('qrcode');

    await sequelize.authenticate();

    log.step(1, 'Informations de l\'administrateur...');

    const email = await question('Email', 'admin@shugo.app');
    const firstName = await question('Prénom', 'Admin');
    const lastName = await question('Nom', 'SHUGO');
    const password = await questionPassword('Mot de passe (min. 8 caractères)');

    if (password.length < 8) {
      log.error('Le mot de passe doit contenir au moins 8 caractères');
      return;
    }

    const geoId = await question('Geo ID', process.env.DEFAULT_GEO_ID || '02-033-01-01-00');
    const role = await question('Rôle (Admin/Admin_N1)', 'Admin_N1');

    // Check if email already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      log.error('Cet email existe déjà');
      return;
    }

    log.step(2, 'Création du compte...');

    const transaction = await sequelize.transaction();

    try {
      // Get next member ID
      const memberId = await User.getNextAvailableId();

      // Generate 2FA secret
      const secret = speakeasy.generateSecret({
        name: `SHUGO Admin (${email})`,
        issuer: 'SHUGO System'
      });

      // Generate backup codes
      const backupCodes = [];
      for (let i = 0; i < 10; i++) {
        backupCodes.push(cryptoManager.generateToken(4).toUpperCase());
      }

      // Create user
      const user = await User.create({
        member_id: memberId,
        email_encrypted: email,
        password_hash: await cryptoManager.hashPassword(password),
        first_name_encrypted: firstName,
        last_name_encrypted: lastName,
        role: role,
        geo_id: geoId,
        scope: role === 'Admin_N1' ? 'central' : 'local:' + geoId,
        status: 'active',
        totp_secret_encrypted: secret.base32,
        totp_enabled: true,
        totp_verified: false,
        totp_backup_codes: backupCodes
      }, { transaction });

      await transaction.commit();

      // Generate QR code
      const qrCodeDataUrl = await qrcode.toDataURL(secret.otpauth_url);

      log.success('Compte administrateur créé!');

      console.log(`
${colors.bright}═══════════════════════════════════════════════${colors.reset}
${colors.green}COMPTE ADMINISTRATEUR CRÉÉ${colors.reset}
${colors.bright}═══════════════════════════════════════════════${colors.reset}

  Member ID: ${colors.cyan}${memberId}${colors.reset}
  Email:     ${colors.cyan}${email}${colors.reset}
  Rôle:      ${colors.cyan}${role}${colors.reset}
  Geo ID:    ${colors.cyan}${geoId}${colors.reset}

${colors.yellow}🔐 CONFIGURATION 2FA REQUISE:${colors.reset}

  Secret TOTP: ${colors.bright}${secret.base32}${colors.reset}

${colors.yellow}📋 CODES DE SECOURS (conservez-les):${colors.reset}
`);

      backupCodes.forEach((code, i) => {
        console.log(`  ${i + 1}. ${colors.bright}${code}${colors.reset}`);
      });

      console.log(`
${colors.bright}═══════════════════════════════════════════════${colors.reset}

${colors.red}⚠️  IMPORTANT:${colors.reset}
1. Configurez votre application 2FA avec le secret ci-dessus
2. Sauvegardez les codes de secours en lieu sûr
3. Vous devrez vérifier le 2FA à la première connexion

`);

      // Save admin info to file
      const adminInfoPath = path.join(ROOT_DIR, 'data', 'admin-setup.json');
      const adminInfo = {
        created: new Date().toISOString(),
        memberId,
        email,
        role,
        geoId,
        totpSecret: secret.base32,
        backupCodes,
        qrCodeDataUrl
      };

      await fs.writeFile(adminInfoPath, JSON.stringify(adminInfo, null, 2));
      await fs.chmod(adminInfoPath, 0o600).catch(() => {});

      log.info(`Informations sauvegardées dans: data/admin-setup.json`);

    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    await sequelize.close();

  } catch (error) {
    log.error('Erreur création admin: ' + error.message);
    log.info('Vous pouvez créer un admin plus tard avec: node scripts/create-admin.js');
  }
}

/**
 * Step 8: Final verification
 */
async function verifyInstallation() {
  log.title('VÉRIFICATION DE L\'INSTALLATION');

  const checks = [
    { name: '.env', path: path.join(ROOT_DIR, '.env') },
    { name: 'node_modules', path: path.join(ROOT_DIR, 'node_modules') },
    { name: 'data/', path: path.join(ROOT_DIR, 'data') },
    { name: 'logs/', path: path.join(ROOT_DIR, 'logs') },
    { name: 'backups/', path: path.join(ROOT_DIR, 'backups') },
  ];

  let allPassed = true;

  for (const check of checks) {
    if (fsSync.existsSync(check.path)) {
      log.success(check.name);
    } else {
      log.error(check.name + ' manquant');
      allPassed = false;
    }
  }

  return allPassed;
}

/**
 * Display final summary
 */
function displaySummary(success) {
  console.log(`
${colors.bright}╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║                    INSTALLATION ${success ? `${colors.green}TERMINÉE${colors.reset}${colors.bright}` : `${colors.red}INCOMPLÈTE${colors.reset}${colors.bright}`}                      ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝${colors.reset}
`);

  if (success) {
    console.log(`
${colors.cyan}Prochaines étapes:${colors.reset}

  1. ${colors.bright}Démarrer le serveur:${colors.reset}
     ${colors.dim}npm run dev${colors.reset}       (développement)
     ${colors.dim}npm start${colors.reset}         (production)

  2. ${colors.bright}Accéder à l'API:${colors.reset}
     ${colors.dim}http://localhost:3000/api/v1/health${colors.reset}

  3. ${colors.bright}Créer des serveurs locaux:${colors.reset}
     ${colors.dim}Utilisez le token d'enregistrement dans data/installation-keys.json${colors.reset}

${colors.yellow}Documentation:${colors.reset} https://docs.shugo.app
${colors.yellow}Support:${colors.reset} https://github.com/shugo/shugo-backend/issues

`);
  } else {
    console.log(`
${colors.red}L'installation a rencontré des problèmes.${colors.reset}

Vérifiez les erreurs ci-dessus et réessayez avec:
  ${colors.dim}node scripts/install.js${colors.reset}

`);
  }
}

// ============================================
// MAIN INSTALLATION FLOW
// ============================================

async function main() {
  try {
    displayBanner();

    initReadline();

    // Confirm installation
    if (!nonInteractive) {
      const confirm = await question('Démarrer l\'installation? (o/n)', 'o');
      if (confirm.toLowerCase() !== 'o' && confirm.toLowerCase() !== 'y') {
        console.log('Installation annulée.');
        process.exit(0);
      }
    }

    // Run installation steps
    await checkPrerequisites();
    await createDirectories();
    await generateEnvironment();
    await installDependencies();
    await initializeDatabase();
    await createAdminAccount();

    const success = await verifyInstallation();

    displaySummary(success);

    process.exit(success ? 0 : 1);

  } catch (error) {
    log.error(`Installation échouée: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    if (rl) rl.close();
  }
}

// Run
main();
