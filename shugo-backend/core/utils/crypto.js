// packages/core/utils/crypto.js
// Shared cryptographic utilities

const crypto = require('crypto');

/**
 * Generate random string
 */
function generateRandomString(length = 32) {
    return crypto.randomBytes(length).toString('hex');
}

/**
 * Hash data with SHA256
 */
function hash(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Generate HMAC
 */
function generateHMAC(data, secret) {
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Verify HMAC
 */
function verifyHMAC(data, signature, secret) {
    const expected = generateHMAC(data, secret);
    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
    );
}

/**
 * Encrypt with AES-256-GCM
 */
function encrypt(text, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    const encrypted = Buffer.concat([
        cipher.update(text, 'utf8'),
        cipher.final()
    ]);
    
    const authTag = cipher.getAuthTag();
    
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypt with AES-256-GCM
 */
function decrypt(encrypted, key) {
    const buffer = Buffer.from(encrypted, 'base64');
    
    const iv = buffer.slice(0, 16);
    const authTag = buffer.slice(16, 32);
    const ciphertext = buffer.slice(32);
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
    ]);
    
    return decrypted.toString('utf8');
}

module.exports = {
    generateRandomString,
    hash,
    generateHMAC,
    verifyHMAC,
    encrypt,
    decrypt
};
