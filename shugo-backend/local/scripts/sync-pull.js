#!/usr/bin/env node
// scripts/sync-pull.js
// Script de synchronisation PULL depuis le serveur central

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
 * Pull data from central server
 */
async function pullFromCentral(options = {}) {
    console.log('\n' + '='.repeat(60));
    log('🔄 SHUGO SYNC PULL - Fetching from Central', 'cyan');
    console.log('='.repeat(60) + '\n');
    
    log(`Central URL: ${config.centralUrl}`, 'blue');
    log(`Server ID: ${config.serverId}`, 'blue');
    log(`Geo ID: ${config.geoId}`, 'blue');
    console.log('');
    
    const timestamp = new Date().toISOString();
    const signature = generateSignature({
        serverId: config.serverId,
        geoId: config.geoId,
        timestamp,
        action: 'pull'
    });
    
    try {
        // Check connectivity
        log('Checking connectivity...', 'yellow');
        const healthResponse = await axios.get(`${config.centralUrl}/health`, { timeout: 5000 });
        
        if (healthResponse.status !== 200) {
            throw new Error('Central server not healthy');
        }
        logSuccess('Central server is online');
        
        // Request sync data
        log('Requesting sync data...', 'yellow');
        const response = await axios.post(`${config.centralUrl}/api/v1/sync/pull`, {
            serverId: config.serverId,
            geoId: config.geoId,
            lastSyncTime: options.since || null,
            dataTypes: options.types || ['users', 'guards', 'groups', 'notifications']
        }, {
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
            const data = response.data.data;
            
            console.log('\n📊 Received data:');
            if (data.users) log(`   Users: ${data.users.length}`, 'green');
            if (data.guards) log(`   Guards: ${data.guards.length}`, 'green');
            if (data.groups) log(`   Groups: ${data.groups.length}`, 'green');
            if (data.notifications) log(`   Notifications: ${data.notifications.length}`, 'green');
            
            // Here you would save the data to local database
            // await saveToLocalDatabase(data);
            
            logSuccess(`\nSync pull completed at ${new Date().toISOString()}`);
            
            return {
                success: true,
                data,
                syncTime: response.data.syncTime
            };
        } else {
            throw new Error(response.data.message || 'Sync failed');
        }
        
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            logError('Cannot connect to central server');
            log('Make sure the central server is running', 'yellow');
        } else if (error.response?.status === 401) {
            logError('Authentication failed - check SHARED_SECRET');
        } else if (error.response?.status === 403) {
            logError('Access denied - server not authorized');
        } else {
            logError(`Sync pull failed: ${error.message}`);
        }
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * CLI
 */
async function main() {
    const args = process.argv.slice(2);
    
    const options = {};
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--since' && args[i + 1]) {
            options.since = args[i + 1];
        }
        if (args[i] === '--types' && args[i + 1]) {
            options.types = args[i + 1].split(',');
        }
    }
    
    if (args.includes('--help')) {
        console.log(`
🔄 SHUGO Sync Pull Script

Usage: node sync-pull.js [options]

Options:
  --since <date>    Only pull changes since date (ISO format)
  --types <list>    Comma-separated list of data types
  --help            Show this help

Examples:
  node sync-pull.js
  node sync-pull.js --since 2025-01-01T00:00:00Z
  node sync-pull.js --types users,guards
`);
        return;
    }
    
    await pullFromCentral(options);
}

if (require.main === module) {
    main().catch(err => {
        logError(`Fatal: ${err.message}`);
        process.exit(1);
    });
}

module.exports = { pullFromCentral };
