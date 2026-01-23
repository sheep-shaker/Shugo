#!/usr/bin/env node
// scripts/deploy-to-pi.js
// Script de déploiement SHUGO sur Raspberry Pi

const path = require('path');
const fs = require('fs').promises;
const { execSync, exec } = require('child_process');
const readline = require('readline');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
    console.log(`${colors.cyan}[${step}]${colors.reset} ${message}`);
}

function logSuccess(message) {
    console.log(`${colors.green}✅ ${message}${colors.reset}`);
}

function logError(message) {
    console.log(`${colors.red}❌ ${message}${colors.reset}`);
}

function logWarning(message) {
    console.log(`${colors.yellow}⚠️  ${message}${colors.reset}`);
}

// Default configuration
const defaultConfig = {
    pi: {
        host: process.env.PI_HOST || '192.168.1.100',
        user: process.env.PI_USER || 'pi',
        port: process.env.PI_SSH_PORT || 22,
        keyPath: process.env.PI_SSH_KEY || '~/.ssh/id_rsa',
        deployPath: process.env.PI_DEPLOY_PATH || '/home/pi/shugo-local'
    },
    local: {
        sourcePath: path.join(__dirname, '..'),
        excludes: [
            'node_modules',
            '.git',
            '.env',
            '*.log',
            'data/*.db',
            'backups/*',
            'coverage',
            '.nyc_output'
        ]
    }
};

/**
 * Prompt for user input
 */
function prompt(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

/**
 * Check if rsync is available
 */
function checkRsync() {
    try {
        execSync('which rsync', { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Check SSH connection to Pi
 */
async function checkSSHConnection(config) {
    logStep('SSH', 'Testing SSH connection to Raspberry Pi...');
    
    const sshCmd = `ssh -o ConnectTimeout=5 -o BatchMode=yes -p ${config.pi.port} ${config.pi.user}@${config.pi.host} "echo connected"`;
    
    try {
        execSync(sshCmd, { stdio: 'pipe' });
        logSuccess('SSH connection successful');
        return true;
    } catch (error) {
        logError('SSH connection failed');
        log('Make sure:', 'yellow');
        log('  1. Raspberry Pi is powered on and connected to network', 'yellow');
        log('  2. SSH is enabled on the Pi', 'yellow');
        log('  3. Your SSH key is authorized on the Pi', 'yellow');
        log(`  4. Host: ${config.pi.host} is correct`, 'yellow');
        return false;
    }
}

/**
 * Get Pi system info
 */
async function getPiInfo(config) {
    logStep('INFO', 'Getting Raspberry Pi information...');
    
    const sshPrefix = `ssh -p ${config.pi.port} ${config.pi.user}@${config.pi.host}`;
    
    try {
        const hostname = execSync(`${sshPrefix} "hostname"`, { encoding: 'utf8' }).trim();
        const nodeVersion = execSync(`${sshPrefix} "node --version 2>/dev/null || echo 'not installed'"`, { encoding: 'utf8' }).trim();
        const npmVersion = execSync(`${sshPrefix} "npm --version 2>/dev/null || echo 'not installed'"`, { encoding: 'utf8' }).trim();
        const diskSpace = execSync(`${sshPrefix} "df -h / | tail -1 | awk '{print \\$4}'"`, { encoding: 'utf8' }).trim();
        const memory = execSync(`${sshPrefix} "free -h | grep Mem | awk '{print \\$7}'"`, { encoding: 'utf8' }).trim();
        
        console.log(`
📊 Raspberry Pi Information:
   Hostname:    ${hostname}
   Node.js:     ${nodeVersion}
   npm:         ${npmVersion}
   Free Disk:   ${diskSpace}
   Free Memory: ${memory}
`);
        
        // Check Node.js version
        if (nodeVersion === 'not installed') {
            logError('Node.js is not installed on the Pi!');
            log('Install with: curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt-get install -y nodejs', 'yellow');
            return false;
        }
        
        const majorVersion = parseInt(nodeVersion.replace('v', '').split('.')[0]);
        if (majorVersion < 18) {
            logWarning(`Node.js ${nodeVersion} is too old. SHUGO requires Node.js >= 18`);
            return false;
        }
        
        return true;
        
    } catch (error) {
        logError(`Failed to get Pi info: ${error.message}`);
        return false;
    }
}

/**
 * Create deployment package
 */
async function createPackage(config) {
    logStep('PACKAGE', 'Creating deployment package...');
    
    const packageDir = path.join(config.local.sourcePath, '.deploy');
    const packageFile = path.join(packageDir, 'shugo-local.tar.gz');
    
    try {
        // Create deploy directory
        await fs.mkdir(packageDir, { recursive: true });
        
        // Create exclusion file
        const excludeFile = path.join(packageDir, 'exclude.txt');
        await fs.writeFile(excludeFile, config.local.excludes.join('\n'));
        
        // Create tarball
        const tarCmd = `tar -czf "${packageFile}" -X "${excludeFile}" -C "${config.local.sourcePath}" .`;
        execSync(tarCmd, { stdio: 'pipe' });
        
        const stats = await fs.stat(packageFile);
        logSuccess(`Package created: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        
        return packageFile;
        
    } catch (error) {
        logError(`Failed to create package: ${error.message}`);
        throw error;
    }
}

/**
 * Deploy to Raspberry Pi
 */
async function deployToPi(config, packageFile) {
    const sshPrefix = `ssh -p ${config.pi.port} ${config.pi.user}@${config.pi.host}`;
    const scpPrefix = `scp -P ${config.pi.port}`;
    
    try {
        // Create remote directory
        logStep('REMOTE', 'Preparing remote directory...');
        execSync(`${sshPrefix} "mkdir -p ${config.pi.deployPath}"`, { stdio: 'pipe' });
        
        // Backup existing installation
        logStep('BACKUP', 'Backing up existing installation...');
        execSync(`${sshPrefix} "cd ${config.pi.deployPath} && if [ -f package.json ]; then tar -czf ../shugo-backup-$(date +%Y%m%d_%H%M%S).tar.gz .; fi"`, { stdio: 'pipe' });
        
        // Upload package
        logStep('UPLOAD', 'Uploading package to Pi...');
        execSync(`${scpPrefix} "${packageFile}" ${config.pi.user}@${config.pi.host}:${config.pi.deployPath}/`, { stdio: 'inherit' });
        
        // Extract package
        logStep('EXTRACT', 'Extracting package...');
        execSync(`${sshPrefix} "cd ${config.pi.deployPath} && tar -xzf shugo-local.tar.gz && rm shugo-local.tar.gz"`, { stdio: 'pipe' });
        
        // Install dependencies
        logStep('INSTALL', 'Installing dependencies (this may take a while on Pi)...');
        execSync(`${sshPrefix} "cd ${config.pi.deployPath} && npm install --production"`, { stdio: 'inherit' });
        
        // Run setup if first deployment
        logStep('SETUP', 'Running setup...');
        execSync(`${sshPrefix} "cd ${config.pi.deployPath} && if [ ! -f .env ]; then npm run setup; fi"`, { stdio: 'pipe' });
        
        // Run migrations
        logStep('MIGRATE', 'Running database migrations...');
        execSync(`${sshPrefix} "cd ${config.pi.deployPath} && npm run migrate"`, { stdio: 'inherit' });
        
        logSuccess('Deployment completed!');
        return true;
        
    } catch (error) {
        logError(`Deployment failed: ${error.message}`);
        return false;
    }
}

/**
 * Deploy using rsync (faster for updates)
 */
async function deployWithRsync(config) {
    logStep('RSYNC', 'Deploying with rsync...');
    
    const excludes = config.local.excludes.map(e => `--exclude="${e}"`).join(' ');
    const rsyncCmd = `rsync -avz --delete ${excludes} -e "ssh -p ${config.pi.port}" "${config.local.sourcePath}/" ${config.pi.user}@${config.pi.host}:${config.pi.deployPath}/`;
    
    try {
        execSync(rsyncCmd, { stdio: 'inherit' });
        
        // Install dependencies
        const sshPrefix = `ssh -p ${config.pi.port} ${config.pi.user}@${config.pi.host}`;
        logStep('INSTALL', 'Installing dependencies...');
        execSync(`${sshPrefix} "cd ${config.pi.deployPath} && npm install --production"`, { stdio: 'inherit' });
        
        // Run migrations
        logStep('MIGRATE', 'Running database migrations...');
        execSync(`${sshPrefix} "cd ${config.pi.deployPath} && npm run migrate -- --alter"`, { stdio: 'inherit' });
        
        logSuccess('Rsync deployment completed!');
        return true;
        
    } catch (error) {
        logError(`Rsync deployment failed: ${error.message}`);
        return false;
    }
}

/**
 * Start/Restart service on Pi
 */
async function manageService(config, action = 'restart') {
    const sshPrefix = `ssh -p ${config.pi.port} ${config.pi.user}@${config.pi.host}`;
    
    logStep('SERVICE', `${action.charAt(0).toUpperCase() + action.slice(1)}ing SHUGO service...`);
    
    try {
        // Check if PM2 is installed
        const hasPm2 = execSync(`${sshPrefix} "which pm2 2>/dev/null || echo ''"`, { encoding: 'utf8' }).trim();
        
        if (hasPm2) {
            // Use PM2
            switch (action) {
                case 'start':
                    execSync(`${sshPrefix} "cd ${config.pi.deployPath} && pm2 start npm --name shugo-local -- start"`, { stdio: 'inherit' });
                    break;
                case 'stop':
                    execSync(`${sshPrefix} "pm2 stop shugo-local"`, { stdio: 'pipe' });
                    break;
                case 'restart':
                    execSync(`${sshPrefix} "pm2 restart shugo-local || (cd ${config.pi.deployPath} && pm2 start npm --name shugo-local -- start)"`, { stdio: 'inherit' });
                    break;
                case 'status':
                    execSync(`${sshPrefix} "pm2 status"`, { stdio: 'inherit' });
                    break;
            }
        } else {
            logWarning('PM2 not installed. Consider installing with: npm install -g pm2');
            
            if (action === 'start' || action === 'restart') {
                log('Starting with nohup...', 'yellow');
                execSync(`${sshPrefix} "cd ${config.pi.deployPath} && nohup npm start > /dev/null 2>&1 &"`, { stdio: 'pipe' });
            }
        }
        
        logSuccess(`Service ${action} completed`);
        return true;
        
    } catch (error) {
        logError(`Service ${action} failed: ${error.message}`);
        return false;
    }
}

/**
 * Main deployment function
 */
async function deploy(options = {}) {
    console.log('\n' + '='.repeat(60));
    log('🍓 SHUGO RASPBERRY PI DEPLOYMENT', 'magenta');
    console.log('='.repeat(60) + '\n');
    
    const config = { ...defaultConfig, ...options };
    
    // Display configuration
    log('Configuration:', 'blue');
    log(`   Host:        ${config.pi.host}`, 'cyan');
    log(`   User:        ${config.pi.user}`, 'cyan');
    log(`   SSH Port:    ${config.pi.port}`, 'cyan');
    log(`   Deploy Path: ${config.pi.deployPath}`, 'cyan');
    console.log('');
    
    // Check SSH connection
    if (!await checkSSHConnection(config)) {
        return { success: false, error: 'SSH connection failed' };
    }
    
    // Get Pi info
    if (!await getPiInfo(config)) {
        return { success: false, error: 'Pi requirements not met' };
    }
    
    // Choose deployment method
    const useRsync = checkRsync() && !options.full;
    
    if (useRsync) {
        log('Using rsync for fast deployment...', 'blue');
        if (!await deployWithRsync(config)) {
            return { success: false, error: 'Rsync deployment failed' };
        }
    } else {
        log('Using full package deployment...', 'blue');
        const packageFile = await createPackage(config);
        if (!await deployToPi(config, packageFile)) {
            return { success: false, error: 'Package deployment failed' };
        }
    }
    
    // Restart service
    if (!options.noRestart) {
        await manageService(config, 'restart');
    }
    
    console.log('\n' + '='.repeat(60));
    logSuccess('DEPLOYMENT SUCCESSFUL!');
    console.log('='.repeat(60));
    
    log(`
🎉 SHUGO Local Server deployed to Raspberry Pi!

Access the server at:
   http://${config.pi.host}:3001/health

Useful commands on the Pi:
   pm2 status          - Check service status
   pm2 logs shugo-local - View logs
   pm2 restart shugo-local - Restart service
`, 'green');
    
    return { success: true };
}

/**
 * CLI Interface
 */
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'deploy';
    
    // Parse options
    const options = {
        full: args.includes('--full'),
        noRestart: args.includes('--no-restart')
    };
    
    // Override config from command line
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--host' && args[i + 1]) {
            defaultConfig.pi.host = args[i + 1];
        }
        if (args[i] === '--user' && args[i + 1]) {
            defaultConfig.pi.user = args[i + 1];
        }
        if (args[i] === '--port' && args[i + 1]) {
            defaultConfig.pi.port = args[i + 1];
        }
    }
    
    switch (command) {
        case 'deploy':
            await deploy(options);
            break;
            
        case 'status':
            await checkSSHConnection(defaultConfig);
            await getPiInfo(defaultConfig);
            await manageService(defaultConfig, 'status');
            break;
            
        case 'start':
            await manageService(defaultConfig, 'start');
            break;
            
        case 'stop':
            await manageService(defaultConfig, 'stop');
            break;
            
        case 'restart':
            await manageService(defaultConfig, 'restart');
            break;
            
        case 'help':
        default:
            console.log(`
🍓 SHUGO Raspberry Pi Deployment Script

Usage: node deploy-to-pi.js [command] [options]

Commands:
  deploy          Deploy to Raspberry Pi (default)
  status          Check Pi status and service
  start           Start SHUGO service on Pi
  stop            Stop SHUGO service on Pi
  restart         Restart SHUGO service on Pi
  help            Show this help message

Options:
  --host <ip>     Pi IP address (default: ${defaultConfig.pi.host})
  --user <user>   SSH user (default: ${defaultConfig.pi.user})
  --port <port>   SSH port (default: ${defaultConfig.pi.port})
  --full          Force full package deployment (skip rsync)
  --no-restart    Don't restart service after deployment

Environment Variables:
  PI_HOST         Raspberry Pi IP address
  PI_USER         SSH user
  PI_SSH_PORT     SSH port
  PI_SSH_KEY      Path to SSH private key
  PI_DEPLOY_PATH  Deployment path on Pi

Examples:
  node deploy-to-pi.js deploy
  node deploy-to-pi.js deploy --host 192.168.1.50
  node deploy-to-pi.js status
  node deploy-to-pi.js restart
`);
            break;
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        logError(`Fatal error: ${error.message}`);
        process.exit(1);
    });
}

module.exports = { deploy, checkSSHConnection, getPiInfo, manageService };
