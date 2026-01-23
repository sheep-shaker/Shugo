#!/usr/bin/env node
// packages/local/scripts/setup.js
// Initial setup script for SHUGO local server

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

// Create readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Promisify readline question
const question = (prompt) => {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
};

// Log helpers
const log = {
    info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
    warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
    title: (msg) => console.log(`\n${colors.bright}${colors.cyan}${msg}${colors.reset}\n`)
};

/**
 * Main setup function
 */
async function setup() {
    log.title('🚀 SHUGO LOCAL SERVER SETUP');
    
    try {
        // Check Node.js version
        await checkNodeVersion();
        
        // Create directory structure
        await createDirectories();
        
        // Generate environment file
        await generateEnvFile();
        
        // Install dependencies
        await installDependencies();
        
        // Initialize database
        await initializeDatabase();
        
        // Generate keys
        await generateKeys();
        
        // Create initial configuration
        await createInitialConfig();
        
        // Setup systemd service (optional for Pi)
        await setupSystemdService();
        
        log.title('✅ SETUP COMPLETED SUCCESSFULLY!');
        log.info('You can now start the server with: npm start');
        
    } catch (error) {
        log.error(`Setup failed: ${error.message}`);
        process.exit(1);
    } finally {
        rl.close();
    }
}

/**
 * Check Node.js version
 */
async function checkNodeVersion() {
    log.info('Checking Node.js version...');
    
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.split('.')[0].substring(1));
    
    if (major < 16) {
        throw new Error(`Node.js 16+ required. Current version: ${nodeVersion}`);
    }
    
    log.success(`Node.js ${nodeVersion} detected`);
}

/**
 * Create directory structure
 */
async function createDirectories() {
    log.info('Creating directory structure...');
    
    const dirs = [
        'data',
        'data/vault',
        'backups',
        'logs',
        'uploads',
        'plugins',
        'temp'
    ];
    
    for (const dir of dirs) {
        const dirPath = path.join(__dirname, '..', dir);
        await fs.mkdir(dirPath, { recursive: true });
        log.success(`Created ${dir}/`);
    }
}

/**
 * Generate .env file
 */
async function generateEnvFile() {
    log.info('Generating environment configuration...');
    
    const envPath = path.join(__dirname, '..', '.env');
    
    // Check if already exists
    try {
        await fs.access(envPath);
        const overwrite = await question(`${colors.yellow}.env file exists. Overwrite? (y/n): ${colors.reset}`);
        if (overwrite.toLowerCase() !== 'y') {
            log.info('Keeping existing .env file');
            return;
        }
    } catch {}
    
    // Gather configuration
    log.title('Server Configuration');
    
    const serverName = await question('Server name [SHUGO-LOCAL]: ') || 'SHUGO-LOCAL';
    const geoId = await question('Geo ID (format: XX-XXX-XX-XX-XX): ');
    const port = await question('Server port [3001]: ') || '3001';
    const centralUrl = await question('Central server URL [https://central.shugo.local]: ') || 'https://central.shugo.local';
    
    // Generate secrets
    const jwtSecret = crypto.randomBytes(32).toString('hex');
    const jwtRefreshSecret = crypto.randomBytes(32).toString('hex');
    const sharedSecret = crypto.randomBytes(32).toString('hex');
    const vaultMasterKey = crypto.randomBytes(32).toString('hex');
    const vaultDataKey = crypto.randomBytes(32).toString('hex');
    const vaultBackupKey = crypto.randomBytes(32).toString('hex');
    
    // Generate server ID
    const serverId = `local_${geoId}_${crypto.randomBytes(8).toString('hex')}`;
    
    // Create .env content
    const envContent = `# SHUGO Local Server Configuration
# Generated: ${new Date().toISOString()}

# Server
NODE_ENV=production
PORT=${port}
HOST=0.0.0.0
SERVER_NAME=${serverName}
SERVER_ID=${serverId}
GEO_ID=${geoId}

# Central Server
CENTRAL_URL=${centralUrl}
SHARED_SECRET=${sharedSecret}

# Database
DB_DIALECT=sqlite
DB_PATH=./data/shugo_local.db

# Security
JWT_SECRET=${jwtSecret}
JWT_REFRESH_SECRET=${jwtRefreshSecret}
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

# Vault Keys
VAULT_MASTER_KEY=${vaultMasterKey}
VAULT_DATA_KEY=${vaultDataKey}
VAULT_BACKUP_KEY=${vaultBackupKey}

# Sync
SYNC_MODE=auto
SYNC_INTERVAL=300000
HEARTBEAT_INTERVAL=300000

# Logging
LOG_LEVEL=info
DEBUG=false

# Backup
BACKUP_ENABLED=true
BACKUP_SCHEDULE=0 3 * * *
BACKUP_RETENTION_DAYS=7
`;
    
    await fs.writeFile(envPath, envContent);
    log.success('.env file generated');
    
    // Save important keys securely
    const keysPath = path.join(__dirname, '..', 'data', 'vault', 'setup.keys');
    const keysContent = {
        generated: new Date().toISOString(),
        serverId,
        sharedSecret,
        vaultMasterKey,
        warning: 'KEEP THIS FILE SECURE! These are your encryption keys.'
    };
    
    await fs.writeFile(keysPath, JSON.stringify(keysContent, null, 2));
    await fs.chmod(keysPath, 0o600);
    
    log.warn(`Important keys saved to: ${keysPath}`);
    log.warn('⚠️  BACKUP THIS FILE SECURELY!');
}

/**
 * Install dependencies
 */
async function installDependencies() {
    log.info('Installing dependencies...');
    
    const useYarn = await question('Use Yarn instead of NPM? (y/n): ');
    const command = useYarn.toLowerCase() === 'y' ? 'yarn install' : 'npm install';
    
    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd: path.join(__dirname, '..')
        });
        
        if (stderr && !stderr.includes('warning')) {
            log.warn(stderr);
        }
        
        log.success('Dependencies installed');
    } catch (error) {
        throw new Error(`Failed to install dependencies: ${error.message}`);
    }
}

/**
 * Initialize database
 */
async function initializeDatabase() {
    log.info('Initializing database...');
    
    try {
        const { initDatabase } = require('../src/database');
        await initDatabase();
        log.success('Database initialized');
    } catch (error) {
        log.warn(`Database initialization skipped: ${error.message}`);
    }
}

/**
 * Generate encryption keys
 */
async function generateKeys() {
    log.info('Generating encryption keys...');
    
    const LocalVault = require('../src/vault/LocalVault');
    const config = require('../src/config');
    
    const vault = new LocalVault(config.vault);
    await vault.initialize();
    
    log.success('Encryption keys generated');
}

/**
 * Create initial configuration
 */
async function createInitialConfig() {
    log.info('Creating initial configuration...');
    
    const configPath = path.join(__dirname, '..', 'data', 'config.json');
    
    const config = {
        version: '1.0.0',
        initialized: new Date().toISOString(),
        features: {
            guards: true,
            groups: true,
            notifications: true,
            calendar: false,
            matrix: false,
            sso: false
        },
        plugins: {
            enabled: []
        },
        maintenance: {
            daily: {
                enabled: true,
                time: '00:00'
            }
        }
    };
    
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    log.success('Initial configuration created');
}

/**
 * Setup systemd service (for Raspberry Pi)
 */
async function setupSystemdService() {
    const isRaspberryPi = process.platform === 'linux' && process.arch === 'arm';
    
    if (!isRaspberryPi) {
        log.info('Skipping systemd service setup (not on Raspberry Pi)');
        return;
    }
    
    const setupService = await question('Setup systemd service for auto-start? (y/n): ');
    
    if (setupService.toLowerCase() !== 'y') {
        return;
    }
    
    log.info('Creating systemd service...');
    
    const servicePath = '/etc/systemd/system/shugo-local.service';
    const serviceContent = `[Unit]
Description=SHUGO Local Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=${path.join(__dirname, '..')}
ExecStart=/usr/bin/node ${path.join(__dirname, '..', 'src', 'index.js')}
Restart=always
RestartSec=10
StandardOutput=append:/var/log/shugo-local.log
StandardError=append:/var/log/shugo-local.error.log

[Install]
WantedBy=multi-user.target
`;
    
    try {
        // Write service file (requires sudo)
        await fs.writeFile('/tmp/shugo-local.service', serviceContent);
        
        log.info('Service file created. Installing (requires sudo)...');
        
        await execAsync('sudo mv /tmp/shugo-local.service ' + servicePath);
        await execAsync('sudo systemctl daemon-reload');
        await execAsync('sudo systemctl enable shugo-local.service');
        
        log.success('Systemd service installed');
        log.info('Start service with: sudo systemctl start shugo-local');
        
    } catch (error) {
        log.warn(`Service installation failed: ${error.message}`);
        log.info('You can install manually by copying the service file');
    }
}

// Run setup
setup().catch(error => {
    console.error('Setup error:', error);
    process.exit(1);
});
