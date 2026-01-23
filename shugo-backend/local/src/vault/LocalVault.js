// packages/local/src/vault/LocalVault.js
// Local vault for secure key management

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class LocalVault {
    constructor(config) {
        this.config = config;
        this.vaultPath = path.join(__dirname, '../../data/vault');
        this.keys = new Map();
        this.isInitialized = false;
        this.masterKey = null;
        this.dataKey = null;
        this.backupKey = null;
    }
    
    /**
     * Initialize the vault
     */
    async initialize() {
        try {
            // Create vault directory
            await fs.mkdir(this.vaultPath, { recursive: true });
            
            // Load or generate keys
            await this.loadOrGenerateKeys();
            
            // Setup key rotation if enabled
            if (this.config.keyRotation) {
                this.setupKeyRotation();
            }
            
            this.isInitialized = true;
            logger.info('LocalVault initialized successfully');
            
        } catch (error) {
            logger.error('Failed to initialize LocalVault:', error);
            throw error;
        }
    }
    
    /**
     * Load existing keys or generate new ones
     */
    async loadOrGenerateKeys() {
        const keyFile = path.join(this.vaultPath, 'keys.vault');
        
        try {
            // Try to load existing keys
            const encryptedKeys = await fs.readFile(keyFile);
            await this.loadKeys(encryptedKeys);
            logger.info('Vault keys loaded from disk');
            
        } catch (error) {
            // Generate new keys if not found
            logger.info('Generating new vault keys');
            await this.generateKeys();
            await this.saveKeys();
        }
    }
    
    /**
     * Generate new encryption keys
     */
    async generateKeys() {
        // Generate master key from environment or random
        this.masterKey = this.config.keys?.master 
            ? Buffer.from(this.config.keys.master, 'hex')
            : crypto.randomBytes(32);
        
        // Generate data encryption key
        this.dataKey = this.config.keys?.data
            ? Buffer.from(this.config.keys.data, 'hex')
            : crypto.randomBytes(32);
        
        // Generate backup encryption key
        this.backupKey = this.config.keys?.backup
            ? Buffer.from(this.config.keys.backup, 'hex')
            : crypto.randomBytes(32);
        
        // Store in memory map
        this.keys.set('master', this.masterKey);
        this.keys.set('data', this.dataKey);
        this.keys.set('backup', this.backupKey);
        
        // Generate additional keys
        this.keys.set('session', crypto.randomBytes(32));
        this.keys.set('api', crypto.randomBytes(32));
        
        logger.info('New vault keys generated');
    }
    
    /**
     * Save keys to disk (encrypted)
     */
    async saveKeys() {
        const keyFile = path.join(this.vaultPath, 'keys.vault');
        
        // Prepare key data
        const keyData = {
            version: 1,
            created: new Date().toISOString(),
            keys: {}
        };
        
        // Convert keys to hex strings
        for (const [name, key] of this.keys) {
            if (name !== 'master') { // Don't save master key
                keyData.keys[name] = key.toString('hex');
            }
        }
        
        // Encrypt with master key
        const encrypted = this.encrypt(
            JSON.stringify(keyData),
            this.masterKey
        );
        
        // Save to disk
        await fs.writeFile(keyFile, encrypted);
        
        // Set restrictive permissions (owner read/write only)
        await fs.chmod(keyFile, 0o600);
        
        logger.info('Vault keys saved to disk');
    }
    
    /**
     * Load keys from encrypted file
     */
    async loadKeys(encryptedData) {
        // Get master key from environment
        if (!this.config.keys?.master) {
            throw new Error('Master key required to decrypt vault');
        }
        
        this.masterKey = Buffer.from(this.config.keys.master, 'hex');
        
        // Decrypt key data
        const decrypted = this.decrypt(encryptedData, this.masterKey);
        const keyData = JSON.parse(decrypted);
        
        // Load keys
        this.keys.set('master', this.masterKey);
        
        for (const [name, hexKey] of Object.entries(keyData.keys)) {
            this.keys.set(name, Buffer.from(hexKey, 'hex'));
        }
        
        // Set main keys
        this.dataKey = this.keys.get('data');
        this.backupKey = this.keys.get('backup');
    }
    
    /**
     * Encrypt data with AES-256-GCM
     */
    encrypt(data, key = null) {
        const encKey = key || this.dataKey;
        if (!encKey) {
            throw new Error('No encryption key available');
        }
        
        // Generate IV
        const iv = crypto.randomBytes(16);
        
        // Create cipher
        const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
        
        // Encrypt data
        const encrypted = Buffer.concat([
            cipher.update(data, 'utf8'),
            cipher.final()
        ]);
        
        // Get auth tag
        const authTag = cipher.getAuthTag();
        
        // Combine IV + authTag + encrypted
        return Buffer.concat([iv, authTag, encrypted]);
    }
    
    /**
     * Decrypt data with AES-256-GCM
     */
    decrypt(encryptedData, key = null) {
        const decKey = key || this.dataKey;
        if (!decKey) {
            throw new Error('No decryption key available');
        }
        
        // Ensure buffer
        const buffer = Buffer.isBuffer(encryptedData) 
            ? encryptedData 
            : Buffer.from(encryptedData);
        
        // Extract components
        const iv = buffer.slice(0, 16);
        const authTag = buffer.slice(16, 32);
        const encrypted = buffer.slice(32);
        
        // Create decipher
        const decipher = crypto.createDecipheriv('aes-256-gcm', decKey, iv);
        decipher.setAuthTag(authTag);
        
        // Decrypt
        const decrypted = Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]);
        
        return decrypted.toString('utf8');
    }
    
    /**
     * Encrypt for backup
     */
    encryptForBackup(data) {
        return this.encrypt(data, this.backupKey);
    }
    
    /**
     * Decrypt from backup
     */
    decryptFromBackup(encryptedData) {
        return this.decrypt(encryptedData, this.backupKey);
    }
    
    /**
     * Generate HMAC signature
     */
    generateHMAC(data, secret = null) {
        const key = secret || this.keys.get('api');
        if (!key) {
            throw new Error('No HMAC key available');
        }
        
        return crypto
            .createHmac('sha256', key)
            .update(data)
            .digest('hex');
    }
    
    /**
     * Verify HMAC signature
     */
    verifyHMAC(data, signature, secret = null) {
        const expected = this.generateHMAC(data, secret);
        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expected)
        );
    }
    
    /**
     * Rotate keys
     */
    async rotateKeys() {
        logger.info('Starting key rotation');
        
        // Generate new keys
        const newDataKey = crypto.randomBytes(32);
        const newBackupKey = crypto.randomBytes(32);
        
        // Re-encrypt existing data with new keys
        // This would involve re-encrypting all vault items
        
        // Update keys
        this.keys.set('data_old', this.dataKey);
        this.keys.set('backup_old', this.backupKey);
        this.keys.set('data', newDataKey);
        this.keys.set('backup', newBackupKey);
        
        this.dataKey = newDataKey;
        this.backupKey = newBackupKey;
        
        // Save new keys
        await this.saveKeys();
        
        logger.info('Key rotation completed');
    }
    
    /**
     * Setup automatic key rotation
     */
    setupKeyRotation() {
        const rotationInterval = this.config.keyRotation;
        
        setInterval(async () => {
            try {
                await this.rotateKeys();
            } catch (error) {
                logger.error('Key rotation failed:', error);
            }
        }, rotationInterval);
        
        logger.info(`Key rotation scheduled every ${rotationInterval / (24*60*60*1000)} days`);
    }
    
    /**
     * Store item in vault
     */
    async storeItem(name, data, encrypted = false) {
        const itemPath = path.join(this.vaultPath, `${name}.item`);
        
        const item = {
            name,
            created: new Date().toISOString(),
            encrypted,
            data: encrypted ? data : this.encrypt(JSON.stringify(data))
        };
        
        await fs.writeFile(itemPath, JSON.stringify(item));
        await fs.chmod(itemPath, 0o600);
        
        logger.debug(`Vault item stored: ${name}`);
    }
    
    /**
     * Retrieve item from vault
     */
    async retrieveItem(name) {
        const itemPath = path.join(this.vaultPath, `${name}.item`);
        
        try {
            const content = await fs.readFile(itemPath, 'utf8');
            const item = JSON.parse(content);
            
            if (item.encrypted) {
                return item.data;
            } else {
                return JSON.parse(this.decrypt(item.data));
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }
    
    /**
     * Delete item from vault
     */
    async deleteItem(name) {
        const itemPath = path.join(this.vaultPath, `${name}.item`);
        
        try {
            await fs.unlink(itemPath);
            logger.debug(`Vault item deleted: ${name}`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }
    
    /**
     * List vault items
     */
    async listItems() {
        const files = await fs.readdir(this.vaultPath);
        return files
            .filter(f => f.endsWith('.item'))
            .map(f => f.replace('.item', ''));
    }
    
    /**
     * Clear vault (danger!)
     */
    async clearVault() {
        const files = await fs.readdir(this.vaultPath);
        
        for (const file of files) {
            if (file !== 'keys.vault') {
                await fs.unlink(path.join(this.vaultPath, file));
            }
        }
        
        logger.warn('Vault cleared (except keys)');
    }
    
    /**
     * Close vault
     */
    async close() {
        // Clear sensitive data from memory
        this.keys.clear();
        this.masterKey = null;
        this.dataKey = null;
        this.backupKey = null;
        this.isInitialized = false;
        
        logger.info('LocalVault closed');
    }
    
    /**
     * Get vault statistics
     */
    async getStatistics() {
        const items = await this.listItems();
        const keyFile = path.join(this.vaultPath, 'keys.vault');
        const keyStats = await fs.stat(keyFile).catch(() => null);
        
        return {
            initialized: this.isInitialized,
            itemCount: items.length,
            keyCount: this.keys.size,
            keysLastModified: keyStats?.mtime,
            vaultPath: this.vaultPath
        };
    }
}

module.exports = LocalVault;
