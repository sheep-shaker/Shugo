#!/usr/bin/env node
// scripts/backup-database.js
// Script de sauvegarde de la base de données SHUGO Central

const path = require('path');
const fs = require('fs').promises;
const { execSync, exec } = require('child_process');
const crypto = require('crypto');

// Load environment
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const config = {
    database: {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        name: process.env.DB_NAME || 'shugo_central',
        user: process.env.DB_USER || 'shugo_admin',
        password: process.env.DB_PASSWORD
    },
    backup: {
        path: process.env.BACKUP_PATH || path.join(__dirname, '../backups'),
        retentionDaily: parseInt(process.env.BACKUP_RETENTION_DAYS_DAILY) || 30,
        retentionWeekly: parseInt(process.env.BACKUP_RETENTION_DAYS_WEEKLY) || 90,
        retentionMonthly: parseInt(process.env.BACKUP_RETENTION_DAYS_MONTHLY) || 365,
        encrypt: process.env.BACKUP_ENCRYPT !== 'false',
        compress: process.env.BACKUP_COMPRESS !== 'false'
    },
    encryption: {
        key: process.env.ENCRYPTION_KEY,
        algorithm: 'aes-256-gcm'
    }
};

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
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

/**
 * Generate backup filename with timestamp
 */
function generateBackupName(type = 'daily') {
    const now = new Date();
    const timestamp = now.toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);
    
    return `shugo_backup_${type}_${timestamp}`;
}

/**
 * Ensure backup directory exists
 */
async function ensureBackupDir() {
    try {
        await fs.mkdir(config.backup.path, { recursive: true });
        
        // Create subdirectories for different backup types
        await fs.mkdir(path.join(config.backup.path, 'daily'), { recursive: true });
        await fs.mkdir(path.join(config.backup.path, 'weekly'), { recursive: true });
        await fs.mkdir(path.join(config.backup.path, 'monthly'), { recursive: true });
        await fs.mkdir(path.join(config.backup.path, 'manual'), { recursive: true });
        
        return true;
    } catch (error) {
        logError(`Failed to create backup directory: ${error.message}`);
        return false;
    }
}

/**
 * Create PostgreSQL dump
 */
async function createDump(backupName, type = 'daily') {
    logStep('DUMP', 'Creating PostgreSQL dump...');
    
    const dumpPath = path.join(config.backup.path, type, `${backupName}.sql`);
    
    // Set PGPASSWORD environment variable
    const env = { ...process.env, PGPASSWORD: config.database.password };
    
    const pgDumpCmd = [
        'pg_dump',
        `-h ${config.database.host}`,
        `-p ${config.database.port}`,
        `-U ${config.database.user}`,
        `-d ${config.database.name}`,
        '--format=plain',
        '--no-owner',
        '--no-privileges',
        `--file="${dumpPath}"`
    ].join(' ');
    
    try {
        execSync(pgDumpCmd, { env, stdio: 'pipe' });
        
        const stats = await fs.stat(dumpPath);
        logSuccess(`Dump created: ${dumpPath} (${formatBytes(stats.size)})`);
        
        return dumpPath;
    } catch (error) {
        logError(`pg_dump failed: ${error.message}`);
        throw error;
    }
}

/**
 * Compress backup file
 */
async function compressBackup(filePath) {
    if (!config.backup.compress) {
        return filePath;
    }
    
    logStep('COMPRESS', 'Compressing backup...');
    
    const gzipPath = `${filePath}.gz`;
    
    try {
        execSync(`gzip -f "${filePath}"`, { stdio: 'pipe' });
        
        const stats = await fs.stat(gzipPath);
        logSuccess(`Compressed: ${gzipPath} (${formatBytes(stats.size)})`);
        
        return gzipPath;
    } catch (error) {
        logWarning(`Compression failed, keeping uncompressed: ${error.message}`);
        return filePath;
    }
}

/**
 * Encrypt backup file
 */
async function encryptBackup(filePath) {
    if (!config.backup.encrypt || !config.encryption.key) {
        logWarning('Encryption disabled or key not set');
        return filePath;
    }
    
    logStep('ENCRYPT', 'Encrypting backup...');
    
    const encryptedPath = `${filePath}.enc`;
    
    try {
        const data = await fs.readFile(filePath);
        
        // Generate IV
        const iv = crypto.randomBytes(16);
        
        // Create cipher
        const key = Buffer.from(config.encryption.key, 'hex').slice(0, 32);
        const cipher = crypto.createCipheriv(config.encryption.algorithm, key, iv);
        
        // Encrypt
        const encrypted = Buffer.concat([
            cipher.update(data),
            cipher.final()
        ]);
        
        // Get auth tag
        const authTag = cipher.getAuthTag();
        
        // Write: IV (16) + AuthTag (16) + Encrypted data
        const output = Buffer.concat([iv, authTag, encrypted]);
        await fs.writeFile(encryptedPath, output);
        
        // Remove unencrypted file
        await fs.unlink(filePath);
        
        const stats = await fs.stat(encryptedPath);
        logSuccess(`Encrypted: ${encryptedPath} (${formatBytes(stats.size)})`);
        
        return encryptedPath;
    } catch (error) {
        logError(`Encryption failed: ${error.message}`);
        return filePath;
    }
}

/**
 * Create backup metadata file
 */
async function createMetadata(backupPath, type) {
    const metadataPath = `${backupPath}.meta.json`;
    
    const stats = await fs.stat(backupPath);
    
    const metadata = {
        version: '7.0.0',
        type: type,
        timestamp: new Date().toISOString(),
        database: config.database.name,
        filename: path.basename(backupPath),
        size: stats.size,
        compressed: backupPath.endsWith('.gz') || backupPath.includes('.gz.'),
        encrypted: backupPath.endsWith('.enc'),
        checksum: await calculateChecksum(backupPath),
        retention: {
            daily: config.backup.retentionDaily,
            weekly: config.backup.retentionWeekly,
            monthly: config.backup.retentionMonthly
        }
    };
    
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    logSuccess(`Metadata created: ${metadataPath}`);
    
    return metadata;
}

/**
 * Calculate file checksum
 */
async function calculateChecksum(filePath) {
    const data = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Clean old backups based on retention policy
 */
async function cleanOldBackups(type) {
    logStep('CLEAN', `Cleaning old ${type} backups...`);
    
    const retentionDays = {
        daily: config.backup.retentionDaily,
        weekly: config.backup.retentionWeekly,
        monthly: config.backup.retentionMonthly,
        manual: 365 * 10 // Keep manual backups for 10 years
    }[type];
    
    const backupDir = path.join(config.backup.path, type);
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    
    try {
        const files = await fs.readdir(backupDir);
        let deleted = 0;
        
        for (const file of files) {
            const filePath = path.join(backupDir, file);
            const stats = await fs.stat(filePath);
            
            if (stats.mtime < cutoffDate) {
                await fs.unlink(filePath);
                deleted++;
            }
        }
        
        if (deleted > 0) {
            logSuccess(`Deleted ${deleted} old backup(s)`);
        } else {
            log('No old backups to delete', 'green');
        }
        
        return deleted;
    } catch (error) {
        logWarning(`Cleanup failed: ${error.message}`);
        return 0;
    }
}

/**
 * List existing backups
 */
async function listBackups(type = null) {
    const types = type ? [type] : ['daily', 'weekly', 'monthly', 'manual'];
    const backups = [];
    
    for (const t of types) {
        const backupDir = path.join(config.backup.path, t);
        
        try {
            const files = await fs.readdir(backupDir);
            
            for (const file of files) {
                if (file.endsWith('.meta.json')) continue;
                
                const filePath = path.join(backupDir, file);
                const stats = await fs.stat(filePath);
                
                backups.push({
                    type: t,
                    filename: file,
                    path: filePath,
                    size: stats.size,
                    created: stats.mtime
                });
            }
        } catch (error) {
            // Directory doesn't exist
        }
    }
    
    return backups.sort((a, b) => b.created - a.created);
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Determine backup type based on current date
 */
function determineBackupType() {
    const now = new Date();
    const dayOfMonth = now.getDate();
    const dayOfWeek = now.getDay();
    
    // First day of month = monthly
    if (dayOfMonth === 1) {
        return 'monthly';
    }
    
    // Sunday = weekly
    if (dayOfWeek === 0) {
        return 'weekly';
    }
    
    // Otherwise = daily
    return 'daily';
}

/**
 * Main backup function
 */
async function runBackup(type = null) {
    console.log('\n' + '='.repeat(60));
    log('🗄️  SHUGO DATABASE BACKUP', 'cyan');
    console.log('='.repeat(60) + '\n');
    
    const startTime = Date.now();
    const backupType = type || determineBackupType();
    
    log(`Backup type: ${backupType.toUpperCase()}`, 'blue');
    log(`Database: ${config.database.name}`, 'blue');
    log(`Timestamp: ${new Date().toISOString()}`, 'blue');
    console.log('');
    
    try {
        // Ensure backup directory exists
        if (!await ensureBackupDir()) {
            throw new Error('Failed to create backup directory');
        }
        
        // Generate backup name
        const backupName = generateBackupName(backupType);
        
        // Create dump
        let backupPath = await createDump(backupName, backupType);
        
        // Compress
        backupPath = await compressBackup(backupPath);
        
        // Encrypt
        backupPath = await encryptBackup(backupPath);
        
        // Create metadata
        const metadata = await createMetadata(backupPath, backupType);
        
        // Clean old backups
        await cleanOldBackups(backupType);
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        console.log('\n' + '='.repeat(60));
        logSuccess(`BACKUP COMPLETED in ${duration}s`);
        console.log('='.repeat(60));
        
        console.log(`
📁 Backup Details:
   File: ${path.basename(backupPath)}
   Size: ${formatBytes(metadata.size)}
   Type: ${backupType}
   Compressed: ${metadata.compressed ? 'Yes' : 'No'}
   Encrypted: ${metadata.encrypted ? 'Yes' : 'No'}
   Checksum: ${metadata.checksum.slice(0, 16)}...
`);
        
        return {
            success: true,
            path: backupPath,
            metadata,
            duration
        };
        
    } catch (error) {
        console.log('\n' + '='.repeat(60));
        logError(`BACKUP FAILED: ${error.message}`);
        console.log('='.repeat(60));
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * CLI Interface
 */
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'run';
    
    switch (command) {
        case 'run':
        case 'backup':
            const type = args[1]; // daily, weekly, monthly, manual
            await runBackup(type);
            break;
            
        case 'list':
            const listType = args[1];
            const backups = await listBackups(listType);
            
            console.log('\n📋 EXISTING BACKUPS:\n');
            
            if (backups.length === 0) {
                console.log('No backups found.');
            } else {
                for (const backup of backups) {
                    console.log(`[${backup.type.toUpperCase()}] ${backup.filename}`);
                    console.log(`   Size: ${formatBytes(backup.size)} | Created: ${backup.created.toISOString()}`);
                    console.log('');
                }
                console.log(`Total: ${backups.length} backup(s)`);
            }
            break;
            
        case 'clean':
            const cleanType = args[1] || 'daily';
            await cleanOldBackups(cleanType);
            break;
            
        case 'help':
        default:
            console.log(`
🗄️  SHUGO Database Backup Script

Usage: node backup-database.js [command] [options]

Commands:
  run [type]      Run backup (type: daily|weekly|monthly|manual)
  list [type]     List existing backups
  clean [type]    Clean old backups based on retention
  help            Show this help message

Examples:
  node backup-database.js run
  node backup-database.js run manual
  node backup-database.js list
  node backup-database.js list weekly
  node backup-database.js clean daily
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

module.exports = { runBackup, listBackups, cleanOldBackups };
