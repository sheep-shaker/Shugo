#!/usr/bin/env node
// scripts/sync-push.js
// Script de synchronisation PUSH vers le serveur central

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const axios = require('axios');
const crypto = require('crypto');

// Colors
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    red: '\x1b[31m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(msg) { log(`✅ ${msg}`, 'green'); }
function logError(msg) { log(`❌ ${msg}`, 'red'); }
function logWarning(msg) { log(`⚠️  ${msg}`, 'yellow'); }

const config = {
    centralUrl: process.env.CENTRAL_URL || 'http://localhost:3000',
    serverId: process.env.SERVER_ID || 'local-001',
    geoId: process.env.GEO_ID || '00-00-00-00-00',
    sharedSecret: process.env.SHARED_SECRET || 'default-secret'
};

/**
 * Generate HMAC signature
 */
function generateSignature(data) {
    return crypto
        .createHmac('sha256', config.sharedSecret)
        .update(JSON.stringify(data))
        .digest('hex');
}

/**
 * Get pending changes from local database
 */
async function getPendingChanges() {
    // This would normally query SyncQueue or LocalChange table
    // For now, return mock data structure
    try {
        const { sequelize } = require('../src/database');
        const SyncQueue = require('../src/models/SyncQueue');
        
        const pendingChanges = await SyncQueue.findAll({
            where: { status: 'pending' },
            order: [['created_at', 'ASC']],
            limit: 100
        });
        
        return pendingChanges.map(change => change.toJSON());
    } catch (error) {
        logWarning(`Could not load pending changes: ${error.message}`);
        return [];
    }
}

/**
 * Mark changes as synced
 */
async function markAsSynced(changeIds) {
    try {
        const SyncQueue = require('../src/models/SyncQueue');
        
        await SyncQueue.update(
            { status: 'synced', synced_at: new Date() },
            { where: { id: changeIds } }
        );
        
        return true;
    } catch (error) {
        logWarning(`Could not mark as synced: ${error.message}`);
        return false;
    }
}

/**
 * Push data to central server
 */
async function pushToCentral(options = {}) {
    console.log('\n' + '='.repeat(60));
    log('🔄 SHUGO SYNC PUSH - Sending to Central', 'cyan');
    console.log('='.repeat(60) + '\n');
    
    log(`Central URL: ${config.centralUrl}`, 'blue');
    log(`Server ID: ${config.serverId}`, 'blue');
    log(`Geo ID: ${config.geoId}`, 'blue');
    console.log('');
    
    try {
        // Check connectivity
        log('Checking connectivity...', 'yellow');
        const healthResponse = await axios.get(`${config.centralUrl}/health`, { timeout: 5000 });
        
        if (healthResponse.status !== 200) {
            throw new Error('Central server not healthy');
        }
        logSuccess('Central server is online');
        
        // Get pending changes
        log('Loading pending changes...', 'yellow');
        const pendingChanges = await getPendingChanges();
        
        if (pendingChanges.length === 0) {
            log('\nNo pending changes to sync', 'green');
            return { success: true, pushed: 0 };
        }
        
        log(`Found ${pendingChanges.length} pending change(s)`, 'blue');
        
        // Prepare payload
        const timestamp = new Date().toISOString();
        const payload = {
            serverId: config.serverId,
            geoId: config.geoId,
            timestamp,
            changes: pendingChanges
        };
        
        const signature = generateSignature(payload);
        
        // Push to central
        log('Pushing changes to central...', 'yellow');
        const response = await axios.post(`${config.centralUrl}/api/v1/sync/push`, payload, {
            headers: {
                'X-Server-ID': config.serverId,
                'X-Geo-ID': config.geoId,
                'X-Timestamp': timestamp,
                'X-Signature': signature,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        
        if (response.data.success) {
            // Mark changes as synced
            const syncedIds = response.data.syncedIds || pendingChanges.map(c => c.id);
            await markAsSynced(syncedIds);
            
            console.log('\n📊 Sync results:');
            log(`   Pushed: ${response.data.pushed || pendingChanges.length}`, 'green');
            log(`   Accepted: ${response.data.accepted || 'all'}`, 'green');
            if (response.data.rejected > 0) {
                logWarning(`   Rejected: ${response.data.rejected}`);
            }
            
            logSuccess(`\nSync push completed at ${new Date().toISOString()}`);
            
            return {
                success: true,
                pushed: pendingChanges.length,
                syncTime: response.data.syncTime
            };
        } else {
            throw new Error(response.data.message || 'Push failed');
        }
        
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            logError('Cannot connect to central server');
            log('Changes will be queued for later sync', 'yellow');
        } else if (error.response?.status === 401) {
            logError('Authentication failed - check SHARED_SECRET');
        } else if (error.response?.status === 403) {
            logError('Access denied - server not authorized');
        } else if (error.response?.status === 409) {
            logError('Conflict detected - manual resolution required');
        } else {
            logError(`Sync push failed: ${error.message}`);
        }
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Force push specific data
 */
async function forcePush(dataType, data) {
    log(`Force pushing ${dataType}...`, 'yellow');
    
    const timestamp = new Date().toISOString();
    const payload = {
        serverId: config.serverId,
        geoId: config.geoId,
        timestamp,
        dataType,
        data,
        force: true
    };
    
    const signature = generateSignature(payload);
    
    try {
        const response = await axios.post(`${config.centralUrl}/api/v1/sync/force-push`, payload, {
            headers: {
                'X-Server-ID': config.serverId,
                'X-Geo-ID': config.geoId,
                'X-Timestamp': timestamp,
                'X-Signature': signature,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        
        return response.data;
    } catch (error) {
        logError(`Force push failed: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * CLI
 */
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help')) {
        console.log(`
🔄 SHUGO Sync Push Script

Usage: node sync-push.js [options]

Options:
  --force           Force push even if conflicts exist
  --dry-run         Show what would be pushed without sending
  --help            Show this help

Examples:
  node sync-push.js
  node sync-push.js --force
  node sync-push.js --dry-run
`);
        return;
    }
    
    const options = {
        force: args.includes('--force'),
        dryRun: args.includes('--dry-run')
    };
    
    if (options.dryRun) {
        log('DRY RUN - No changes will be sent', 'yellow');
        const changes = await getPendingChanges();
        console.log(`\nWould push ${changes.length} change(s):`);
        changes.forEach(c => {
            console.log(`  - ${c.entity_type}: ${c.action} (${c.entity_id})`);
        });
        return;
    }
    
    await pushToCentral(options);
}

if (require.main === module) {
    main().catch(err => {
        logError(`Fatal: ${err.message}`);
        process.exit(1);
    });
}

module.exports = { pushToCentral, forcePush };
