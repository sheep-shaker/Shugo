#!/usr/bin/env node
/**
 * SHUGO v7.0 - Script de Migration Central
 *
 * Ce script initialise/synchronise toutes les tables de la base de données centrale.
 * Utilise Sequelize sync() pour créer les tables à partir des modèles.
 *
 * Usage: node scripts/migrate.js [--force] [--alter]
 *   --force : Supprime et recrée toutes les tables (ATTENTION: perte de données)
 *   --alter : Modifie les tables existantes pour correspondre aux modèles
 */

'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');

// Couleurs pour la console
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function migrate() {
    const args = process.argv.slice(2);
    const forceMode = args.includes('--force');
    const alterMode = args.includes('--alter');

    log('\n========================================', 'cyan');
    log('   SHUGO v7.0 - Migration Database', 'cyan');
    log('========================================\n', 'cyan');

    // Import sequelize from connection (which also loads config)
    const { sequelize, testConnection } = require('../src/database/connection');
    const config = require('../src/config');

    // Determine dialect
    const isSQLite = config.database.dialect === 'sqlite';

    log(`Database: ${isSQLite ? 'SQLite' : 'PostgreSQL'}`, 'blue');
    log(`Storage: ${config.database.storage || config.database.name}`, 'blue');
    log(`Mode: ${forceMode ? 'FORCE (drop & recreate)' : alterMode ? 'ALTER (modify existing)' : 'SAFE (create only)'}`, 'yellow');
    log('');

    try {
        // Test connection
        await testConnection();
        log('✅ Database connection established', 'green');

        // Load all models from the models directory
        log('\n📦 Loading models...', 'blue');
        const modelsDir = path.join(__dirname, '../src/models');
        const modelFiles = fs.readdirSync(modelsDir)
            .filter(file => file.endsWith('.js') && file !== 'index.js');

        const models = {};
        const loadedModels = [];

        for (const file of modelFiles) {
            try {
                const exported = require(path.join(modelsDir, file));

                // Handle factory pattern: module.exports = (sequelize, DataTypes) => { ... }
                if (typeof exported === 'function' && !exported.name) {
                    const { DataTypes } = require('sequelize');
                    const model = exported(sequelize, DataTypes);
                    if (model && model.name) {
                        models[model.name] = model;
                        loadedModels.push(model.name);
                    }
                }
                // Handle direct pattern: module.exports = Model
                else if (exported && exported.name) {
                    models[exported.name] = exported;
                    loadedModels.push(exported.name);
                }
            } catch (err) {
                log(`   ⚠️  Error loading ${file}: ${err.message.split('\\n')[0]}`, 'yellow');
            }
        }

        log(`   Found ${loadedModels.length} models`, 'blue');
        const modelNames = loadedModels;

        // List models
        log('\n📋 Models to sync:', 'cyan');
        modelNames.forEach((name, i) => {
            log(`   ${i + 1}. ${name}`, 'reset');
        });

        // Sync options
        const syncOptions = {};
        if (forceMode) {
            syncOptions.force = true;
            log('\n⚠️  WARNING: Force mode will DROP all tables!', 'red');
        } else if (alterMode) {
            syncOptions.alter = true;
            log('\n⚠️  Alter mode will modify existing tables', 'yellow');
        }

        // Sync database
        log('\n🔄 Synchronizing database...', 'blue');
        await sequelize.sync(syncOptions);
        log('✅ Database synchronized successfully!', 'green');

        // Verify tables
        log('\n📊 Verifying tables...', 'blue');
        let query;
        if (isSQLite) {
            query = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
        } else {
            query = "SELECT tablename as name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename";
        }

        const [tables] = await sequelize.query(query);
        log(`   Created ${tables.length} tables:`, 'green');
        tables.forEach(t => {
            log(`   ✓ ${t.name}`, 'green');
        });

        // Summary
        log('\n========================================', 'cyan');
        log('   Migration completed successfully!', 'green');
        log('========================================\n', 'cyan');

        log(`📊 Summary:`, 'blue');
        log(`   - Models loaded: ${modelNames.length}`, 'reset');
        log(`   - Tables created: ${tables.length}`, 'reset');
        log(`   - Database: ${isSQLite ? config.database.storage : config.database.name}`, 'reset');

    } catch (error) {
        log(`\n❌ Migration failed: ${error.message}`, 'red');
        console.error(error);
        process.exit(1);
    } finally {
        await sequelize.close();
    }
}

migrate();
