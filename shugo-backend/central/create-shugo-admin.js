// Script pour créer l'admin SHUGO
require('dotenv').config();
const { sequelize } = require('./src/database/connection');
const User = require('./src/models/User');
const cryptoManager = require('./src/utils/crypto');

async function createAdmin() {
    try {
        await sequelize.authenticate();
        console.log('✅ DB connectée');

        // Check if email exists
        const existing = await User.findByEmail('shugopaca@gmail.com');
        if (existing) {
            console.log('⚠️  Cet email existe déjà!');
            console.log('Member ID:', existing.member_id);
            console.log('Mot de passe: ShugoAdmin2024!');
            process.exit(0);
        }

        // Get next ID
        const memberId = await User.getNextAvailableId();

        // Create admin
        const user = await User.create({
            member_id: memberId,
            email_encrypted: 'shugopaca@gmail.com',
            password_hash: await cryptoManager.hashPassword('ShugoAdmin2024!'),
            first_name_encrypted: 'Admin',
            last_name_encrypted: 'SHUGO',
            role: 'Admin_N1',
            geo_id: '02-033-04-00-00',
            scope: 'central',
            status: 'active',
            totp_enabled: false,
            preferred_language: 'fr',
            notification_channel: 'email'
        });

        console.log('');
        console.log('✅ Admin créé avec succès!');
        console.log('══════════════════════════════════════');
        console.log('  Member ID:     ', memberId);
        console.log('  Email:          shugopaca@gmail.com');
        console.log('  Mot de passe:   ShugoAdmin2024!');
        console.log('  Rôle:           Admin N1 (Super Admin)');
        console.log('  Geo ID:         02-033-04-00');
        console.log('══════════════════════════════════════');
        console.log('');
        console.log('🌐 Connectez-vous sur http://localhost:5173');

    } catch (e) {
        console.error('❌ Erreur:', e.message);
        if (e.errors) {
            e.errors.forEach(err => console.error('  -', err.message));
        }
    } finally {
        await sequelize.close();
        process.exit(0);
    }
}

createAdmin();
