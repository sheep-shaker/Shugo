// scripts/migrate-database.js
// Script de migration de la base de données

const { sequelize } = require('../src/database/connection');
const logger = require('../src/utils/logger');
const config = require('../src/config');

async function migrate() {
    try {
        console.log('🔄 Starting database migration...\n');
        
        // Tester la connexion
        await sequelize.authenticate();
        console.log('✅ Database connection established');
        
        // Synchroniser les modèles
        console.log('📦 Synchronizing models...');
        
        // Importer tous les modèles
        const models = [
            require('../src/models/User'),
            require('../src/models/Location'),
            require('../src/models/LocalInstance'),
            require('../src/models/Session'),
            require('../src/models/AuditLog'),
            require('../src/models/Guard'),
            require('../src/models/GuardAssignment'),
            require('../src/models/Group'),
            require('../src/models/GroupMembership'),
            require('../src/models/Notification'),
            require('../src/models/RegistrationToken')
        ];
        
        console.log(`📊 Found ${models.length} models to migrate`);
        
        // Options de synchronisation
        const syncOptions = {
            alter: process.argv.includes('--alter'), // Modifier les tables existantes
            force: process.argv.includes('--force')  // Recréer toutes les tables (DANGER!)
        };
        
        if (syncOptions.force) {
            console.warn('\n⚠️  WARNING: Force mode will DROP all existing tables!');
            console.warn('⚠️  All data will be LOST!');
            console.log('\nPress Ctrl+C to cancel, or wait 5 seconds to continue...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        // Synchroniser
        await sequelize.sync(syncOptions);
        
        console.log('\n✅ Database migration completed successfully!');
        
        // Afficher les statistiques
        const [tables] = await sequelize.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);
        
        console.log('\n📋 Database tables:');
        tables.forEach(t => console.log(`   - ${t.table_name}`));
        console.log(`\nTotal: ${tables.length} tables`);
        
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Afficher l'aide
if (process.argv.includes('--help')) {
    console.log(`
SHUGO Database Migration Script
================================

Usage: npm run migrate [options]

Options:
  --alter     Alter existing tables to match models (safe)
  --force     Drop and recreate all tables (DANGEROUS!)
  --help      Show this help message

Examples:
  npm run migrate           # Safe migration (create new tables only)
  npm run migrate --alter   # Update existing tables
  npm run migrate --force   # Reset database (LOSES ALL DATA!)
    `);
    process.exit(0);
}

// Exécuter la migration
migrate();
