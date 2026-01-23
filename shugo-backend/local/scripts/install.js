#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║                                                                  ║
 * ║     SHUGO v7.0 - LOCAL SERVER INSTALLER (PROTOCOLE GUILTY SPARK)║
 * ║                                                                  ║
 * ║  Script d'installation pour les serveurs locaux SHUGO           ║
 * ║  Ce script implémente le protocole "343 Guilty Spark"           ║
 * ║  pour l'enregistrement et la configuration des serveurs locaux  ║
 * ║                                                                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Usage: node scripts/install.js [options]
 *
 * Options:
 *   --central-url <url>    URL du serveur central
 *   --token <token>        Token d'enregistrement
 *   --geo-id <id>          Geo ID du serveur local
 *   --skip-deps            Sauter l'installation des dépendances
 *   --skip-register        Sauter l'enregistrement auprès du central
 *   --raspberry-pi         Configurer pour Raspberry Pi
 *   --non-interactive      Mode non-interactif
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const https = require('https');
const http = require('http');

const execAsync = promisify(exec);

// ============================================
// CONFIGURATION
// ============================================

const ROOT_DIR = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

const options = {
  centralUrl: getArg('--central-url'),
  token: getArg('--token'),
  geoId: getArg('--geo-id'),
  skipDeps: args.includes('--skip-deps'),
  skipRegister: args.includes('--skip-register'),
  raspberryPi: args.includes('--raspberry-pi') || isRaspberryPi(),
  nonInteractive: args.includes('--non-interactive'),
};

function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

function isRaspberryPi() {
  try {
    const cpuinfo = fsSync.readFileSync('/proc/cpuinfo', 'utf8');
    return cpuinfo.includes('Raspberry') || cpuinfo.includes('BCM');
  } catch {
    return false;
  }
}

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
};

const log = {
  title: (msg) => console.log(`\n${colors.bright}${colors.magenta}═══ ${msg} ═══${colors.reset}\n`),
  step: (num, msg) => console.log(`${colors.blue}[${num}]${colors.reset} ${msg}`),
  info: (msg) => console.log(`${colors.dim}    ℹ ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}    ✓ ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}    ⚠ ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}    ✗ ${msg}${colors.reset}`),
  spark: (msg) => console.log(`${colors.magenta}    ⚡ ${msg}${colors.reset}`),
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
  if (options.nonInteractive) {
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

// ============================================
// CRYPTO HELPERS
// ============================================

function generateHexKey(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function generateServerId(geoId) {
  const suffix = crypto.randomBytes(4).toString('hex');
  const geoPrefix = geoId ? geoId.replace(/-/g, '').substring(0, 8) : 'unknown';
  return `local-${geoPrefix}-${suffix}`;
}

// ============================================
// HTTP CLIENT FOR CENTRAL REGISTRATION
// ============================================

function httpRequest(url, method, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      rejectUnauthorized: false, // For self-signed certs in dev
    };

    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(json.message || `HTTP ${res.statusCode}`));
          }
        } catch {
          reject(new Error(`Invalid response: ${body.substring(0, 100)}`));
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

// ============================================
// INSTALLATION STEPS
// ============================================

/**
 * Display banner
 */
function displayBanner() {
  console.log(`
${colors.magenta}
    ╔═══════════════════════════════════════════════════════════╗
    ║                                                           ║
    ║   ██████╗ ██╗   ██╗██╗██╗  ████████╗██╗   ██╗             ║
    ║  ██╔════╝ ██║   ██║██║██║  ╚══██╔══╝╚██╗ ██╔╝             ║
    ║  ██║  ███╗██║   ██║██║██║     ██║    ╚████╔╝              ║
    ║  ██║   ██║██║   ██║██║██║     ██║     ╚██╔╝               ║
    ║  ╚██████╔╝╚██████╔╝██║███████╗██║      ██║                ║
    ║   ╚═════╝  ╚═════╝ ╚═╝╚══════╝╚═╝      ╚═╝                ║
    ║                                                           ║
    ║   ███████╗██████╗  █████╗ ██████╗ ██╗  ██╗                ║
    ║   ██╔════╝██╔══██╗██╔══██╗██╔══██╗██║ ██╔╝                ║
    ║   ███████╗██████╔╝███████║██████╔╝█████╔╝                 ║
    ║   ╚════██║██╔═══╝ ██╔══██║██╔══██╗██╔═██╗                 ║
    ║   ███████║██║     ██║  ██║██║  ██║██║  ██╗                ║
    ║   ╚══════╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝                ║
    ║                                                           ║
    ║            PROTOCOLE 343 - LOCAL SERVER SETUP             ║
    ║                                                           ║
    ╚═══════════════════════════════════════════════════════════╝
${colors.reset}
${colors.bright}    SHUGO v7.0 - Installation Serveur Local${colors.reset}
    ${colors.dim}Basé sur le protocole Guilty Spark du Document Technique V7.0${colors.reset}

    Plateforme: ${options.raspberryPi ? `${colors.green}Raspberry Pi${colors.reset}` : `${colors.cyan}Standard${colors.reset}`}
    Date: ${new Date().toISOString()}
`);
}

/**
 * Check prerequisites
 */
async function checkPrerequisites() {
  log.title('PHASE 1: VÉRIFICATION DES PRÉREQUIS');

  log.step(1, 'Vérification de Node.js...');
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.split('.')[0].substring(1));

  if (major < 16) {
    log.error(`Node.js 16+ requis. Version actuelle: ${nodeVersion}`);
    throw new Error('Node.js version insuffisante');
  }
  log.success(`Node.js ${nodeVersion}`);

  log.step(2, 'Vérification de npm...');
  try {
    const { stdout } = await execAsync('npm --version');
    log.success(`npm ${stdout.trim()}`);
  } catch {
    log.error('npm non trouvé');
    throw new Error('npm requis');
  }

  log.step(3, 'Vérification du projet...');
  const packagePath = path.join(ROOT_DIR, 'package.json');
  if (!fsSync.existsSync(packagePath)) {
    log.error('package.json non trouvé');
    throw new Error('Exécutez ce script depuis le dossier local/');
  }
  log.success('Structure du projet valide');

  log.step(4, 'Vérification de la plateforme...');
  if (options.raspberryPi) {
    log.spark('Raspberry Pi détecté - optimisations activées');

    // Check available memory
    try {
      const { stdout } = await execAsync('free -m | grep Mem | awk \'{print $2}\'');
      const totalMem = parseInt(stdout.trim());
      log.info(`Mémoire disponible: ${totalMem}MB`);

      if (totalMem < 512) {
        log.warn('Mémoire faible - performances réduites possibles');
      }
    } catch {
      log.info('Impossible de vérifier la mémoire');
    }
  } else {
    log.info(`Plateforme: ${process.platform} ${process.arch}`);
  }
}

/**
 * Create directory structure
 */
async function createDirectories() {
  log.title('PHASE 2: CRÉATION DES RÉPERTOIRES');

  const dirs = [
    'data',
    'data/vault',
    'data/backups',
    'data/sync',
    'logs',
    'plugins',
    'temp',
    'uploads',
  ];

  for (const dir of dirs) {
    const dirPath = path.join(ROOT_DIR, dir);
    await fs.mkdir(dirPath, { recursive: true });
    log.success(`${dir}/`);
  }

  // Set permissions on Raspberry Pi
  if (options.raspberryPi) {
    try {
      await fs.chmod(path.join(ROOT_DIR, 'data', 'vault'), 0o700);
      log.spark('Permissions vault sécurisées');
    } catch {
      log.warn('Impossible de définir les permissions du vault');
    }
  }
}

/**
 * Gather configuration from user
 */
async function gatherConfiguration() {
  log.title('PHASE 3: CONFIGURATION GUILTY SPARK');

  log.spark('Initialisation du protocole 343 Guilty Spark...');

  // Central server URL
  log.step(1, 'Configuration du serveur central...');

  const centralUrl = options.centralUrl ||
    await question('URL du serveur central', 'http://localhost:3000');

  // Registration token
  log.step(2, 'Token d\'enregistrement...');

  let token = options.token;
  if (!token) {
    log.info('Le token se trouve dans: central/data/installation-keys.json');
    token = await question('Token d\'enregistrement (LOCAL_REGISTRATION_TOKEN)');
  }

  if (!token) {
    log.warn('Aucun token fourni - l\'enregistrement sera ignoré');
  }

  // Geo ID
  log.step(3, 'Configuration géographique...');

  const geoId = options.geoId ||
    await question('Geo ID (format: CC-PPP-ZZ-JJ-NN)', '02-033-01-01-00');

  // Validate geo ID format
  const geoIdRegex = /^\d{2}-\d{3}-\d{2}-\d{2}-\d{2}$/;
  if (!geoIdRegex.test(geoId)) {
    log.warn(`Format Geo ID non standard: ${geoId}`);
  }

  // Server name
  log.step(4, 'Identification du serveur...');

  const serverName = await question('Nom du serveur', `SHUGO-LOCAL-${geoId.split('-')[1]}`);
  const port = await question('Port du serveur', '3001');

  return {
    centralUrl,
    token,
    geoId,
    serverName,
    port,
  };
}

/**
 * Generate environment configuration
 */
async function generateEnvironment(config) {
  log.title('PHASE 4: GÉNÉRATION DE LA CONFIGURATION');

  const envPath = path.join(ROOT_DIR, '.env');

  // Check if .env already exists
  if (fsSync.existsSync(envPath)) {
    log.warn('.env existe déjà');
    const overwrite = await question('Écraser le fichier existant? (o/n)', 'n');
    if (overwrite.toLowerCase() !== 'o' && overwrite.toLowerCase() !== 'y') {
      log.info('Conservation du fichier .env existant');
      return null;
    }
    // Backup
    const backupPath = `${envPath}.backup.${Date.now()}`;
    await fs.copyFile(envPath, backupPath);
    log.info(`Sauvegarde: ${path.basename(backupPath)}`);
  }

  log.step(1, 'Génération des clés cryptographiques...');

  const keys = {
    JWT_SECRET: generateHexKey(32),
    JWT_REFRESH_SECRET: generateHexKey(32),
    ENCRYPTION_KEY: generateHexKey(32),
    HMAC_KEY: generateHexKey(32),
    VAULT_MASTER_KEY: generateHexKey(32),
    VAULT_DATA_KEY: generateHexKey(32),
    VAULT_BACKUP_KEY: generateHexKey(32),
    SHARED_SECRET: generateHexKey(32),
  };

  log.success('Clés générées');

  log.step(2, 'Création du fichier .env...');

  const serverId = generateServerId(config.geoId);

  const envContent = `# ============================================
# SHUGO v7.0 - Local Server Configuration
# Generated: ${new Date().toISOString()}
# Protocol: 343 Guilty Spark
# ============================================

# === ENVIRONNEMENT ===
NODE_ENV=production

# === SERVEUR ===
PORT=${config.port}
HOST=0.0.0.0
SERVER_NAME=${config.serverName}
SERVER_ID=${serverId}
SERVER_TYPE=local
GEO_ID=${config.geoId}

# === SERVEUR CENTRAL ===
CENTRAL_URL=${config.centralUrl}
CENTRAL_TIMEOUT=30000
CENTRAL_RETRY_ATTEMPTS=3
CENTRAL_RETRY_DELAY=5000

# === AUTHENTIFICATION CENTRALE ===
SHARED_SECRET=${keys.SHARED_SECRET}
REGISTRATION_TOKEN=${config.token || ''}

# === BASE DE DONNÉES SQLite ===
DB_DIALECT=sqlite
DB_STORAGE=./data/shugo_local.db
DB_LOGGING=false

# === JWT ===
JWT_SECRET=${keys.JWT_SECRET}
JWT_REFRESH_SECRET=${keys.JWT_REFRESH_SECRET}
JWT_ACCESS_EXPIRES=1h
JWT_REFRESH_EXPIRES=7d
JWT_ISSUER=shugo-local

# === SÉCURITÉ ET CRYPTOGRAPHIE ===
ENCRYPTION_KEY=${keys.ENCRYPTION_KEY}
HMAC_KEY=${keys.HMAC_KEY}

# Vault local
VAULT_PATH=./data/vault
VAULT_MASTER_KEY=${keys.VAULT_MASTER_KEY}
VAULT_DATA_KEY=${keys.VAULT_DATA_KEY}
VAULT_BACKUP_KEY=${keys.VAULT_BACKUP_KEY}

# Rate limiting (adapté pour serveur local)
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

# === BACKUP LOCAL ===
BACKUP_ENABLED=true
BACKUP_SCHEDULE=0 2 * * *
BACKUP_RETENTION_DAYS=30
BACKUP_ENCRYPTION=true
BACKUP_PATH=./data/backups

# === NOTIFICATIONS ===
NOTIFICATION_GUARD_DAYS=1,4,6
NOTIFICATION_GUARD_HOUR=9
NOTIFICATION_CLEANUP_DAYS=30

# === LOGS ===
LOG_LEVEL=info
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

# === RASPBERRY PI OPTIMIZATIONS ===
${options.raspberryPi ? `
# Optimisations pour Raspberry Pi
NODE_OPTIONS=--max-old-space-size=256
UV_THREADPOOL_SIZE=4
` : ''}
`;

  await fs.writeFile(envPath, envContent);
  log.success('.env créé');

  // Save keys securely
  log.step(3, 'Sauvegarde sécurisée des clés...');

  const keysPath = path.join(ROOT_DIR, 'data', 'vault', 'installation-keys.json');
  const keysBackup = {
    generated: new Date().toISOString(),
    protocol: 'guilty_spark',
    serverId,
    geoId: config.geoId,
    centralUrl: config.centralUrl,
    keys: {
      SHARED_SECRET: keys.SHARED_SECRET,
      VAULT_MASTER_KEY: keys.VAULT_MASTER_KEY,
    },
    warning: 'CONSERVEZ CE FICHIER EN LIEU SÛR! Ces clés sont nécessaires pour la récupération.'
  };

  await fs.writeFile(keysPath, JSON.stringify(keysBackup, null, 2));

  try {
    await fs.chmod(keysPath, 0o600);
  } catch {
    // May fail on Windows
  }

  log.warn('Clés sauvegardées dans: data/vault/installation-keys.json');
  log.warn('⚠️  CONSERVEZ CE FICHIER EN LIEU SÛR!');

  return { serverId, keys };
}

/**
 * Install dependencies
 */
async function installDependencies() {
  if (options.skipDeps) {
    log.title('PHASE 5: DÉPENDANCES (IGNORÉ)');
    return;
  }

  log.title('PHASE 5: INSTALLATION DES DÉPENDANCES');

  log.step(1, 'Installation des packages npm...');
  log.info('Cette étape peut prendre plusieurs minutes...');

  if (options.raspberryPi) {
    log.spark('Installation optimisée pour Raspberry Pi...');
  }

  return new Promise((resolve, reject) => {
    const npmArgs = ['install'];

    if (options.raspberryPi) {
      // Skip optional dependencies on Pi to save space
      npmArgs.push('--no-optional');
    }

    const npm = spawn('npm', npmArgs, {
      cwd: ROOT_DIR,
      shell: true,
      stdio: 'pipe'
    });

    npm.stdout.on('data', () => process.stdout.write('.'));
    npm.stderr.on('data', () => {});

    npm.on('close', (code) => {
      console.log('');
      if (code === 0) {
        log.success('Dépendances installées');
        resolve();
      } else {
        log.error('Échec de l\'installation des dépendances');
        reject(new Error('npm install failed'));
      }
    });
  });
}

/**
 * Initialize database
 */
async function initializeDatabase() {
  log.title('PHASE 6: INITIALISATION DE LA BASE DE DONNÉES');

  require('dotenv').config({ path: path.join(ROOT_DIR, '.env') });

  log.step(1, 'Création de la base SQLite...');

  try {
    // Try to load and initialize database
    const dbPath = path.join(ROOT_DIR, 'data', 'shugo_local.db');

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    // Run migrations if available
    log.step(2, 'Exécution des migrations...');

    try {
      const migratePath = path.join(ROOT_DIR, 'scripts', 'migrate.js');
      if (fsSync.existsSync(migratePath)) {
        await execAsync(`node "${migratePath}"`, { cwd: ROOT_DIR });
        log.success('Migrations exécutées');
      } else {
        // Try sequelize-cli
        await execAsync('npx sequelize-cli db:migrate', { cwd: ROOT_DIR });
        log.success('Migrations exécutées');
      }
    } catch (migrateError) {
      log.warn('Migrations manuelles peuvent être nécessaires');
      log.info(migrateError.message);
    }

    log.success('Base de données initialisée');

  } catch (error) {
    log.error('Erreur initialisation DB: ' + error.message);
    log.info('La base sera créée au premier démarrage');
  }
}

/**
 * Register with central server (Guilty Spark protocol)
 */
async function registerWithCentral(config, installInfo) {
  if (options.skipRegister || !config.token) {
    log.title('PHASE 7: ENREGISTREMENT CENTRAL (IGNORÉ)');
    log.info('L\'enregistrement pourra être fait manuellement plus tard');
    return null;
  }

  log.title('PHASE 7: ENREGISTREMENT GUILTY SPARK');

  log.spark('Connexion au serveur central...');

  const registrationData = {
    server_id: installInfo.serverId,
    server_name: config.serverName,
    geo_id: config.geoId,
    server_type: 'local',
    registration_token: config.token,
    shared_secret: installInfo.keys.SHARED_SECRET,
    version: '7.0.0',
    platform: options.raspberryPi ? 'raspberry_pi' : process.platform,
    capabilities: {
      offline_mode: true,
      sync: true,
      vault: true,
      plugins: true,
    },
  };

  try {
    log.step(1, 'Envoi de la demande d\'enregistrement...');

    const response = await httpRequest(
      `${config.centralUrl}/api/v1/local-servers/register-token`,
      'POST',
      registrationData
    );

    if (response.success) {
      log.success('Enregistrement réussi!');
      log.spark(`Instance ID: ${response.data.instance_id || installInfo.serverId}`);

      // Save registration info
      const regPath = path.join(ROOT_DIR, 'data', 'registration.json');
      await fs.writeFile(regPath, JSON.stringify({
        registered: new Date().toISOString(),
        instanceId: response.data.instance_id,
        centralUrl: config.centralUrl,
        geoId: config.geoId,
        response: response.data,
      }, null, 2));

      log.info('Informations d\'enregistrement sauvegardées');

      return response.data;

    } else {
      throw new Error(response.message || 'Enregistrement échoué');
    }

  } catch (error) {
    log.error(`Échec de l'enregistrement: ${error.message}`);
    log.info('Vous pouvez enregistrer manuellement via l\'API du central');
    log.info(`POST ${config.centralUrl}/api/v1/local-servers/register-token`);

    return null;
  }
}

/**
 * Setup systemd service (Raspberry Pi)
 */
async function setupSystemdService(config) {
  if (!options.raspberryPi) {
    return;
  }

  log.title('PHASE 8: CONFIGURATION SYSTEMD');

  const setupService = await question('Configurer le démarrage automatique? (o/n)', 'o');

  if (setupService.toLowerCase() !== 'o' && setupService.toLowerCase() !== 'y') {
    log.info('Configuration systemd ignorée');
    return;
  }

  const user = process.env.USER || 'pi';
  const serviceContent = `[Unit]
Description=SHUGO Local Server - ${config.serverName}
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${ROOT_DIR}
ExecStart=/usr/bin/node ${path.join(ROOT_DIR, 'src', 'index.js')}
Restart=always
RestartSec=10
Environment=NODE_ENV=production
StandardOutput=append:/var/log/shugo-local.log
StandardError=append:/var/log/shugo-local.error.log

# Optimizations for Raspberry Pi
MemoryMax=512M
CPUQuota=80%

[Install]
WantedBy=multi-user.target
`;

  try {
    // Write service file to temp
    const tempServicePath = '/tmp/shugo-local.service';
    await fs.writeFile(tempServicePath, serviceContent);

    log.step(1, 'Installation du service systemd...');
    log.info('Cette opération nécessite sudo');

    await execAsync(`sudo mv ${tempServicePath} /etc/systemd/system/shugo-local.service`);
    await execAsync('sudo systemctl daemon-reload');
    await execAsync('sudo systemctl enable shugo-local.service');

    log.success('Service systemd installé');
    log.spark('Le serveur démarrera automatiquement au boot');
    log.info('Démarrer maintenant: sudo systemctl start shugo-local');

  } catch (error) {
    log.warn('Installation systemd échouée: ' + error.message);
    log.info('Vous pouvez installer manuellement le service');
  }
}

/**
 * Verify installation
 */
async function verifyInstallation() {
  log.title('VÉRIFICATION FINALE');

  const checks = [
    { name: '.env', path: path.join(ROOT_DIR, '.env') },
    { name: 'node_modules', path: path.join(ROOT_DIR, 'node_modules') },
    { name: 'data/', path: path.join(ROOT_DIR, 'data') },
    { name: 'data/vault/', path: path.join(ROOT_DIR, 'data', 'vault') },
    { name: 'logs/', path: path.join(ROOT_DIR, 'logs') },
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
 * Display summary
 */
function displaySummary(success, config, installInfo) {
  console.log(`
${colors.magenta}╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║           PROTOCOLE GUILTY SPARK ${success ? `${colors.green}TERMINÉ${colors.reset}${colors.magenta}` : `${colors.red}INCOMPLET${colors.reset}${colors.magenta}`}                   ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝${colors.reset}
`);

  if (success) {
    console.log(`
${colors.cyan}Informations du serveur:${colors.reset}
  Server ID:   ${colors.bright}${installInfo?.serverId || 'N/A'}${colors.reset}
  Nom:         ${colors.bright}${config.serverName}${colors.reset}
  Geo ID:      ${colors.bright}${config.geoId}${colors.reset}
  Port:        ${colors.bright}${config.port}${colors.reset}
  Central:     ${colors.bright}${config.centralUrl}${colors.reset}

${colors.cyan}Prochaines étapes:${colors.reset}

  1. ${colors.bright}Démarrer le serveur:${colors.reset}
     ${colors.dim}npm start${colors.reset}
     ${options.raspberryPi ? `${colors.dim}sudo systemctl start shugo-local${colors.reset}` : ''}

  2. ${colors.bright}Vérifier la connexion au central:${colors.reset}
     ${colors.dim}Le serveur se synchronisera automatiquement${colors.reset}

  3. ${colors.bright}Tester l'API:${colors.reset}
     ${colors.dim}curl http://localhost:${config.port}/api/v1/health${colors.reset}

${colors.yellow}⚠️  IMPORTANT:${colors.reset}
  - Conservez les clés dans data/vault/installation-keys.json
  - Le serveur central doit être accessible pour la synchronisation
  - Configurez les backups externes pour la production

${colors.magenta}⚡ Le protocole 343 Guilty Spark a été exécuté avec succès.${colors.reset}
`);
  } else {
    console.log(`
${colors.red}L'installation a rencontré des problèmes.${colors.reset}

Vérifiez les erreurs ci-dessus et réessayez avec:
  ${colors.dim}node scripts/install.js${colors.reset}

Pour l'aide: node scripts/install.js --help
`);
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  try {
    displayBanner();

    initReadline();

    // Show help if requested
    if (args.includes('--help') || args.includes('-h')) {
      console.log(`
Usage: node scripts/install.js [options]

Options:
  --central-url <url>    URL du serveur central
  --token <token>        Token d'enregistrement
  --geo-id <id>          Geo ID du serveur local
  --skip-deps            Sauter l'installation des dépendances
  --skip-register        Sauter l'enregistrement auprès du central
  --raspberry-pi         Configurer pour Raspberry Pi
  --non-interactive      Mode non-interactif
  --help                 Afficher cette aide
`);
      process.exit(0);
    }

    // Confirm installation
    if (!options.nonInteractive) {
      const confirm = await question('Démarrer l\'installation Guilty Spark? (o/n)', 'o');
      if (confirm.toLowerCase() !== 'o' && confirm.toLowerCase() !== 'y') {
        console.log('Installation annulée.');
        process.exit(0);
      }
    }

    // Run installation phases
    await checkPrerequisites();
    await createDirectories();

    const config = await gatherConfiguration();
    const installInfo = await generateEnvironment(config);

    await installDependencies();
    await initializeDatabase();
    await registerWithCentral(config, installInfo);
    await setupSystemdService(config);

    const success = await verifyInstallation();

    displaySummary(success, config, installInfo);

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
