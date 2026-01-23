#!/usr/bin/env node
// scripts/create-admin.js
// Script pour créer un administrateur SHUGO

require('dotenv').config();
const readline = require('readline');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

// Import models and utils
const { sequelize } = require('../src/database/connection');
const User = require('../src/models/User');
const RegistrationToken = require('../src/models/RegistrationToken');
const cryptoManager = require('../src/utils/crypto');
const logger = require('../src/utils/logger');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log(`
╔══════════════════════════════════════════════╗
║                                              ║
║      SHUGO Admin Creation Tool              ║
║                                              ║
╚══════════════════════════════════════════════╝
`);

const question = (query) => new Promise(resolve => rl.question(query, resolve));

async function createAdmin() {
    try {
        // Test database connection
        await sequelize.authenticate();
        console.log('✅ Database connected\n');
        
        // Get admin details
        const email = await question('Admin email: ');
        const firstName = await question('First name: ');
        const lastName = await question('Last name: ');
        const password = await question('Password (min 8 chars): ');
        const geoId = await question('Geo ID (format: XX-XXX-XX-XX-XX): ') || '02-33-06-01-00';
        const role = await question('Role (Admin/Admin_N1): ') || 'Admin';
        
        // Validate inputs
        if (password.length < 8) {
            throw new Error('Password must be at least 8 characters');
        }
        
        if (!['Admin', 'Admin_N1'].includes(role)) {
            throw new Error('Role must be Admin or Admin_N1');
        }
        
        // Check if email already exists
        const existingUser = await User.findByEmail(email);
        if (existingUser) {
            throw new Error('Email already exists');
        }
        
        console.log('\n🔄 Creating admin account...');
        
        // Start transaction
        const transaction = await sequelize.transaction();
        
        try {
            // Get next member ID
            const memberId = await User.getNextAvailableId();
            
            // Create user
            const user = await User.create({
                member_id: memberId,
                email_encrypted: email,
                password_hash: await cryptoManager.hashPassword(password),
                first_name_encrypted: firstName,
                last_name_encrypted: lastName,
                role: role,
                geo_id: geoId,
                scope: role === 'Admin_N1' ? 'central' : 'local:' + geoId,
                status: 'active'
            }, { transaction });
            
            // Generate 2FA secret
            const secret = speakeasy.generateSecret({
                name: `SHUGO Admin (${email})`,
                issuer: 'SHUGO System'
            });
            
            user.totp_secret_encrypted = secret.base32;
            user.totp_enabled = true;
            user.totp_verified = false; // Will be verified on first login
            
            // Generate backup codes
            const backupCodes = [];
            for (let i = 0; i < 10; i++) {
                backupCodes.push(cryptoManager.generateToken(4).toUpperCase());
            }
            user.totp_backup_codes = backupCodes;
            
            await user.save({ transaction });
            
            // Generate QR code
            const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);
            
            await transaction.commit();
            
            console.log('\n✅ Admin account created successfully!\n');
            console.log('━'.repeat(50));
            console.log('Member ID:', memberId);
            console.log('Email:', email);
            console.log('Role:', role);
            console.log('Geo ID:', geoId);
            console.log('Scope:', user.scope);
            console.log('━'.repeat(50));
            console.log('\n🔐 2FA Setup Required:');
            console.log('Secret:', secret.base32);
            console.log('\n📱 Scan this QR code with Google Authenticator:');
            console.log(qrCodeUrl);
            console.log('\n📋 Backup Codes (save these securely):');
            backupCodes.forEach((code, i) => {
                console.log(`  ${i + 1}. ${code}`);
            });
            console.log('━'.repeat(50));
            console.log('\n⚠️  IMPORTANT:');
            console.log('1. Save the backup codes in a secure location');
            console.log('2. Set up 2FA using the QR code or secret');
            console.log('3. You will need to verify 2FA on first login');
            
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    } finally {
        rl.close();
        await sequelize.close();
    }
}

async function listAdmins() {
    try {
        await sequelize.authenticate();
        
        const admins = await User.findAll({
            where: {
                role: ['Admin', 'Admin_N1'],
                status: 'active'
            },
            attributes: ['member_id', 'email_encrypted', 'first_name_encrypted', 'last_name_encrypted', 'role', 'geo_id', 'created_at']
        });
        
        if (admins.length === 0) {
            console.log('\nNo admin accounts found.');
        } else {
            console.log('\n📋 Existing Admin Accounts:');
            console.log('━'.repeat(80));
            admins.forEach(admin => {
                console.log(`ID: ${admin.member_id} | ${admin.first_name_encrypted} ${admin.last_name_encrypted} | ${admin.email_encrypted} | ${admin.role} | ${admin.geo_id}`);
            });
            console.log('━'.repeat(80));
        }
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
    }
}

// Main execution
async function main() {
    const action = process.argv[2];
    
    if (action === 'list') {
        await listAdmins();
        process.exit(0);
    }
    
    console.log('This tool will create an admin account for SHUGO.\n');
    
    const answer = await question('Do you want to create a new admin? (yes/no): ');
    
    if (answer.toLowerCase() === 'yes') {
        await createAdmin();
    } else {
        console.log('Operation cancelled.');
        rl.close();
        process.exit(0);
    }
}

// Run the script
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
