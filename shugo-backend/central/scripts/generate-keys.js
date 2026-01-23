#!/usr/bin/env node
// scripts/generate-keys.js
// Générateur de clés de sécurité pour SHUGO

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log(`
╔══════════════════════════════════════════════╗
║                                              ║
║      SHUGO Security Keys Generator          ║
║                                              ║
╚══════════════════════════════════════════════╝
`);

const generateKeys = () => {
    const keys = {
        JWT_SECRET: crypto.randomBytes(64).toString('hex'),
        JWT_REFRESH_SECRET: crypto.randomBytes(64).toString('hex'),
        ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
        ENCRYPTION_IV: crypto.randomBytes(16).toString('hex'),
        HMAC_KEY: crypto.randomBytes(32).toString('hex'),
        VAULT_MASTER_KEY: crypto.randomBytes(32).toString('hex'),
        COOKIE_SECRET: crypto.randomBytes(32).toString('hex')
    };
    
    return keys;
};

const generateRSAKeyPair = () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 4096,
        publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
        },
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem',
            cipher: 'aes-256-cbc',
            passphrase: crypto.randomBytes(32).toString('hex')
        }
    });
    
    return { publicKey, privateKey };
};

const saveToEnvFile = (keys) => {
    const envPath = path.join(__dirname, '..', '.env');
    const envExamplePath = path.join(__dirname, '..', '.env.example');
    
    // Check if .env already exists
    if (fs.existsSync(envPath)) {
        console.log('\n⚠️  .env file already exists!');
        rl.question('Do you want to backup and overwrite it? (yes/no): ', (answer) => {
            if (answer.toLowerCase() === 'yes') {
                // Backup existing .env
                const backupPath = path.join(__dirname, '..', `.env.backup.${Date.now()}`);
                fs.copyFileSync(envPath, backupPath);
                console.log(`✅ Backup created: ${backupPath}`);
                writeEnvFile(envPath, envExamplePath, keys);
            } else {
                console.log('❌ Operation cancelled. Keys not saved to .env');
                displayKeys(keys);
            }
            rl.close();
        });
    } else {
        writeEnvFile(envPath, envExamplePath, keys);
        rl.close();
    }
};

const writeEnvFile = (envPath, envExamplePath, keys) => {
    let envContent = '';
    
    // Read from .env.example if it exists
    if (fs.existsSync(envExamplePath)) {
        envContent = fs.readFileSync(envExamplePath, 'utf8');
        
        // Replace placeholder values with generated keys
        Object.keys(keys).forEach(key => {
            const regex = new RegExp(`^${key}=.*$`, 'gm');
            if (regex.test(envContent)) {
                envContent = envContent.replace(regex, `${key}=${keys[key]}`);
            } else {
                envContent += `\n${key}=${keys[key]}`;
            }
        });
    } else {
        // Create basic .env content
        envContent = `# SHUGO Environment Variables
# Generated on ${new Date().toISOString()}

NODE_ENV=development
PORT=3000

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=shugo_central
DB_USER=shugo_admin
DB_PASSWORD=your_secure_password_here

# Security Keys (Generated)
${Object.entries(keys).map(([key, value]) => `${key}=${value}`).join('\n')}

# Email
EMAIL_ENABLED=false
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=
EMAIL_PASSWORD=
`;
    }
    
    fs.writeFileSync(envPath, envContent);
    console.log(`\n✅ Keys saved to ${envPath}`);
    console.log('\n⚠️  IMPORTANT: Keep these keys secure and never commit .env to version control!');
};

const displayKeys = (keys) => {
    console.log('\n📋 Generated Keys (copy these to your .env file):');
    console.log('━'.repeat(50));
    Object.entries(keys).forEach(([key, value]) => {
        console.log(`${key}=${value}`);
    });
    console.log('━'.repeat(50));
};

const generateEmergencyTableau = () => {
    console.log('\n📊 Generating Emergency Access Tableau...');
    
    const codes = [];
    for (let i = 0; i < 100; i++) {
        codes.push(crypto.randomBytes(5).toString('hex').toUpperCase());
    }
    
    const tableau = {
        series: `SECOURS-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
        master_code: crypto.randomBytes(8).toString('hex').toUpperCase(),
        codes: codes
    };
    
    // Save to file
    const tableauPath = path.join(__dirname, '..', `emergency-tableau-${Date.now()}.json`);
    fs.writeFileSync(tableauPath, JSON.stringify(tableau, null, 2));
    
    console.log(`✅ Emergency tableau saved to: ${tableauPath}`);
    console.log(`   Series: ${tableau.series}`);
    console.log(`   Master Code: ${tableau.master_code}`);
    console.log(`   Total Codes: ${tableau.codes.length}`);
    
    return tableau;
};

// Main execution
console.log('This tool will generate secure cryptographic keys for SHUGO.\n');

rl.question('Generate keys now? (yes/no): ', (answer) => {
    if (answer.toLowerCase() === 'yes') {
        console.log('\n🔐 Generating security keys...');
        const keys = generateKeys();
        
        console.log('✅ Keys generated successfully!');
        
        rl.question('\nGenerate RSA key pair for server communication? (yes/no): ', (rsaAnswer) => {
            if (rsaAnswer.toLowerCase() === 'yes') {
                console.log('\n🔑 Generating RSA-4096 key pair...');
                const rsaKeys = generateRSAKeyPair();
                
                // Save RSA keys to files
                fs.writeFileSync(path.join(__dirname, '..', 'keys', 'public.pem'), rsaKeys.publicKey);
                fs.writeFileSync(path.join(__dirname, '..', 'keys', 'private.pem'), rsaKeys.privateKey);
                
                console.log('✅ RSA keys saved to keys/ directory');
            }
            
            rl.question('\nGenerate emergency access tableau? (yes/no): ', (tableauAnswer) => {
                if (tableauAnswer.toLowerCase() === 'yes') {
                    generateEmergencyTableau();
                }
                
                rl.question('\nSave keys to .env file? (yes/no): ', (saveAnswer) => {
                    if (saveAnswer.toLowerCase() === 'yes') {
                        saveToEnvFile(keys);
                    } else {
                        displayKeys(keys);
                        rl.close();
                    }
                });
            });
        });
    } else {
        console.log('Operation cancelled.');
        rl.close();
    }
});
