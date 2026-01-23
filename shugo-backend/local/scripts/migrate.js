#!/usr/bin/env node
// scripts/migrate.js
// Script de migration de la base de données SHUGO Local

const path = require('path');
const fs = require('fs').promises;

// Load environment
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { Sequelize } = require('sequelize');

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
 * Create Sequelize instance
 */
function createSequelize() {
    const dialect = process.env.DB_DIALECT || 'sqlite';
    
    if (dialect === 'sqlite') {
        const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/shugo_local.db');
        
        return new Sequelize({
            dialect: 'sqlite',
            storage: dbPath,
            logging: false
        });
    } else {
        return new Sequelize({
            dialect: 'postgres',
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME || 'shugo_local',
            username: process.env.DB_USER || 'shugo',
            password: process.env.DB_PASSWORD,
            logging: false
        });
    }
}

/**
 * Get all model files
 */
async function getModelFiles() {
    const modelsDir = path.join(__dirname, '../src/models');
    const files = await fs.readdir(modelsDir);
    
    return files
        .filter(f => f.endsWith('.js') && f !== 'index.js')
        .map(f => path.join(modelsDir, f));
}

/**
 * Run migrations
 */
async function runMigrations(options = {}) {
    console.log('\n' + '='.repeat(60));
    log('🗃️  SHUGO LOCAL DATABASE MIGRATION', 'cyan');
    console.log('='.repeat(60) + '\n');
    
    const sequelize = createSequelize();
    
    try {
        // Test connection
        await sequelize.authenticate();
        logSuccess('Database connection established');
        
        // Ensure data directory exists for SQLite
        if (process.env.DB_DIALECT === 'sqlite' || !process.env.DB_DIALECT) {
            const dataDir = path.join(__dirname, '../data');
            await fs.mkdir(dataDir, { recursive: true });
            logSuccess('Data directory ensured');
        }
        
        // Load models and initialize them with sequelize instance
        log('\n📊 Loading and initializing models...', 'blue');
        const models = require('../src/models');

        for (const modelName in models) {
            if (models[modelName] && typeof models[modelName].init === 'function') {
                try {
                    models[modelName].init(sequelize);
                    log(`   ✓ ${modelName}`, 'green');
                } catch (error) {
                    logWarning(`   ✗ ${modelName}: ${error.message}`);
                }
            }
        }

        // Setup associations if available
        if (typeof models.associate === 'function') {
            log('\n🔗 Setting up associations...', 'blue');
            try {
                models.associate();
                logSuccess('Associations configured');
            } catch (error) {
                logWarning(`Associations warning: ${error.message}`);
            }
        }

        // Determine sync options
        let syncOptions = {};
        
        if (options.force) {
            logWarning('\n⚠️  FORCE mode: All tables will be dropped and recreated!');
            syncOptions = { force: true };
        } else if (options.alter) {
            log('\n🔄 ALTER mode: Tables will be modified to match models', 'yellow');
            syncOptions = { alter: true };
        } else {
            log('\n📝 SAFE mode: Only create missing tables', 'blue');
            syncOptions = {};
        }
        
        // Run sync
        log('\n🚀 Running migration...', 'cyan');
        await sequelize.sync(syncOptions);
        
        // Get table info
        const tables = await sequelize.getQueryInterface().showAllTables();
        
        console.log('\n' + '='.repeat(60));
        logSuccess('MIGRATION COMPLETED');
        console.log('='.repeat(60));
        
        log(`\n📋 Tables in database (${tables.length}):`, 'blue');
        for (const table of tables) {
            log(`   • ${table}`, 'green');
        }
        
        await sequelize.close();
        
        return {
            success: true,
            tables: tables.length
        };
        
    } catch (error) {
        logError(`Migration failed: ${error.message}`);
        console.error(error);
        
        await sequelize.close();
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Show database status
 */
async function showStatus() {
    console.log('\n' + '='.repeat(60));
    log('📊 SHUGO LOCAL DATABASE STATUS', 'cyan');
    console.log('='.repeat(60) + '\n');
    
    const sequelize = createSequelize();
    
    try {
        await sequelize.authenticate();
        logSuccess('Database connection: OK');
        
        const tables = await sequelize.getQueryInterface().showAllTables();
        log(`\nTables found: ${tables.length}`, 'blue');
        
        for (const table of tables) {
            try {
                const [results] = await sequelize.query(`SELECT COUNT(*) as count FROM "${table}"`);
                const count = results[0].count || results[0].COUNT || 0;
                log(`   • ${table}: ${count} rows`, 'green');
            } catch (e) {
                log(`   • ${table}: (error reading)`, 'yellow');
            }
        }
        
        await sequelize.close();
        
    } catch (error) {
        logError(`Cannot connect to database: ${error.message}`);
    }
}

/**
 * Reset database
 */
async function resetDatabase() {
    console.log('\n' + '='.repeat(60));
    logWarning('⚠️  DATABASE RESET - ALL DATA WILL BE LOST!');
    console.log('='.repeat(60) + '\n');
    
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise((resolve) => {
        rl.question('Are you sure? Type "RESET" to confirm: ', async (answer) => {
            rl.close();
            
            if (answer !== 'RESET') {
                log('Reset cancelled.', 'yellow');
                resolve({ success: false, cancelled: true });
                return;
            }
            
            const result = await runMigrations({ force: true });
            resolve(result);
        });
    });
}

/**
 * CLI Interface
 */
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'run';
    
    switch (command) {
        case 'run':
        case 'migrate':
            await runMigrations({
                force: args.includes('--force') || args.includes('-f'),
                alter: args.includes('--alter') || args.includes('-a')
            });
            break;
            
        case 'status':
            await showStatus();
            break;
            
        case 'reset':
            await resetDatabase();
            break;
            
        case 'help':
        default:
            console.log(`
🗃️  SHUGO Local Database Migration Script

Usage: node migrate.js [command] [options]

Commands:
  run, migrate    Run database migration
  status          Show database status
  reset           Reset database (drops all tables)
  help            Show this help message

Options:
  --force, -f     Force sync (drop and recreate tables)
  --alter, -a     Alter existing tables to match models

Examples:
  node migrate.js run
  node migrate.js run --alter
  node migrate.js run --force
  node migrate.js status
  node migrate.js reset
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

module.exports = { runMigrations, showStatus, resetDatabase };
