'use strict';

/**
 * Utilitaires de cryptographie SHUGO
 * 
 * Implémente AES-256-GCM, Argon2id, HMAC-SHA256, RSA-4096.
 * 
 * @see Document Technique V7.0 - Section 5
 */

const crypto = require('crypto');
const argon2 = require('argon2');
const config = require('../config');

// Constantes
const AES_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits pour GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32;

/**
 * Classe de gestion cryptographique
 */
class CryptoUtils {
  constructor() {
    this.encryptionKey = Buffer.from(config.security.encryptionKey, 'hex');
    this.hmacKey = Buffer.from(config.security.hmacKey, 'hex');
    
    // Validation des clés
    if (this.encryptionKey.length !== 32) {
      throw new Error('ENCRYPTION_KEY doit être de 32 bytes (64 caractères hex)');
    }
  }

  // =========================================
  // AES-256-GCM - Chiffrement symétrique
  // =========================================

  /**
   * Chiffre des données avec AES-256-GCM
   * @param {string|Buffer} plaintext - Données à chiffrer
   * @param {Buffer} [key] - Clé optionnelle (sinon clé par défaut)
   * @returns {{encrypted: Buffer, iv: Buffer, authTag: Buffer}}
   */
  encrypt(plaintext, key = this.encryptionKey) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(AES_ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH
    });

    const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return { encrypted, iv, authTag };
  }

  /**
   * Chiffre et retourne un buffer combiné (IV + authTag + encrypted)
   * @param {string|Buffer} plaintext
   * @param {Buffer} [key]
   * @returns {Buffer}
   */
  encryptToBuffer(plaintext, key = this.encryptionKey) {
    const { encrypted, iv, authTag } = this.encrypt(plaintext, key);
    return Buffer.concat([iv, authTag, encrypted]);
  }

  /**
   * Chiffre et retourne en base64
   * @param {string} plaintext
   * @param {Buffer} [key]
   * @returns {string}
   */
  encryptToBase64(plaintext, key = this.encryptionKey) {
    return this.encryptToBuffer(plaintext, key).toString('base64');
  }

  /**
   * Déchiffre des données AES-256-GCM
   * @param {Buffer} encrypted
   * @param {Buffer} iv
   * @param {Buffer} authTag
   * @param {Buffer} [key]
   * @returns {Buffer}
   */
  decrypt(encrypted, iv, authTag, key = this.encryptionKey) {
    const decipher = crypto.createDecipheriv(AES_ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH
    });
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  /**
   * Déchiffre depuis un buffer combiné (IV + authTag + encrypted)
   * @param {Buffer} combined
   * @param {Buffer} [key]
   * @returns {Buffer}
   */
  decryptFromBuffer(combined, key = this.encryptionKey) {
    const iv = combined.slice(0, IV_LENGTH);
    const authTag = combined.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.slice(IV_LENGTH + AUTH_TAG_LENGTH);

    return this.decrypt(encrypted, iv, authTag, key);
  }

  /**
   * Déchiffre depuis base64
   * @param {string} base64Data
   * @param {Buffer} [key]
   * @returns {string}
   */
  decryptFromBase64(base64Data, key = this.encryptionKey) {
    const combined = Buffer.from(base64Data, 'base64');
    return this.decryptFromBuffer(combined, key).toString('utf8');
  }

  // =========================================
  // Argon2id - Hachage mot de passe
  // =========================================

  /**
   * Hache un mot de passe avec Argon2id
   * @param {string} password
   * @returns {Promise<string>}
   */
  async hashPassword(password) {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: config.security.argon2.memoryCost,
      timeCost: config.security.argon2.timeCost,
      parallelism: config.security.argon2.parallelism,
      hashLength: config.security.argon2.hashLength
    });
  }

  /**
   * Vérifie un mot de passe contre son hash Argon2
   * @param {string} hash
   * @param {string} password
   * @returns {Promise<boolean>}
   */
  async verifyPassword(hash, password) {
    try {
      return await argon2.verify(hash, password);
    } catch (error) {
      return false;
    }
  }

  /**
   * Vérifie si un hash Argon2 doit être rehashé
   * @param {string} hash
   * @returns {boolean}
   */
  needsRehash(hash) {
    return argon2.needsRehash(hash, {
      type: argon2.argon2id,
      memoryCost: config.security.argon2.memoryCost,
      timeCost: config.security.argon2.timeCost
    });
  }

  // =========================================
  // SHA-256 - Hachage
  // =========================================

  /**
   * Calcule un hash SHA-256
   * @param {string|Buffer} data
   * @returns {string} Hash en hexadécimal
   */
  sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Hash pour recherche (email, nom) - normalisé
   * @param {string} value
   * @returns {string}
   */
  hashForSearch(value) {
    if (!value) return null;
    const normalized = value.toLowerCase().trim();
    return this.sha256(normalized);
  }

  // =========================================
  // HMAC-SHA256 - Signature
  // =========================================

  /**
   * Crée une signature HMAC-SHA256
   * @param {string|Buffer} data
   * @param {Buffer} [key]
   * @returns {string}
   */
  hmacSign(data, key = this.hmacKey) {
    return crypto.createHmac('sha256', key).update(data).digest('hex');
  }

  /**
   * Vérifie une signature HMAC
   * @param {string|Buffer} data
   * @param {string} signature
   * @param {Buffer} [key]
   * @returns {boolean}
   */
  hmacVerify(data, signature, key = this.hmacKey) {
    const expected = this.hmacSign(data, key);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    );
  }

  // =========================================
  // Génération aléatoire
  // =========================================

  /**
   * Génère des bytes aléatoires cryptographiquement sûrs
   * @param {number} length
   * @returns {Buffer}
   */
  randomBytes(length) {
    return crypto.randomBytes(length);
  }

  /**
   * Génère une chaîne hexadécimale aléatoire
   * @param {number} length - Longueur en bytes
   * @returns {string}
   */
  randomHex(length) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Génère un UUID v4
   * @returns {string}
   */
  generateUUID() {
    return crypto.randomUUID();
  }

  /**
   * Génère un token sécurisé (URL-safe base64)
   * @param {number} length - Longueur en bytes
   * @returns {string}
   */
  generateToken(length = 32) {
    return crypto.randomBytes(length)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Génère un code numérique (pour OTP, etc.)
   * @param {number} digits
   * @returns {string}
   */
  generateNumericCode(digits = 6) {
    const max = Math.pow(10, digits);
    const randomValue = crypto.randomInt(0, max);
    return randomValue.toString().padStart(digits, '0');
  }

  // =========================================
  // Clés AES
  // =========================================

  /**
   * Génère une nouvelle clé AES-256
   * @returns {Buffer}
   */
  generateAESKey() {
    return crypto.randomBytes(32);
  }

  /**
   * Génère un IV pour AES-GCM
   * @returns {Buffer}
   */
  generateIV() {
    return crypto.randomBytes(IV_LENGTH);
  }

  // =========================================
  // Double chiffrement (local + central)
  // =========================================

  /**
   * Double chiffrement: d'abord avec clé locale, puis centrale
   * @param {string|Buffer} plaintext
   * @param {Buffer} localKey
   * @param {Buffer} centralKey
   * @returns {Buffer}
   */
  doubleEncrypt(plaintext, localKey, centralKey) {
    // Premier chiffrement avec clé locale
    const firstPass = this.encryptToBuffer(plaintext, localKey);
    // Second chiffrement avec clé centrale
    return this.encryptToBuffer(firstPass, centralKey);
  }

  /**
   * Double déchiffrement
   * @param {Buffer} encrypted
   * @param {Buffer} localKey
   * @param {Buffer} centralKey
   * @returns {Buffer}
   */
  doubleDecrypt(encrypted, localKey, centralKey) {
    // Premier déchiffrement avec clé centrale
    const firstPass = this.decryptFromBuffer(encrypted, centralKey);
    // Second déchiffrement avec clé locale
    return this.decryptFromBuffer(firstPass, localKey);
  }

  // =========================================
  // Utilitaires
  // =========================================

  /**
   * Compare deux buffers de manière time-safe
   * @param {Buffer|string} a
   * @param {Buffer|string} b
   * @returns {boolean}
   */
  timingSafeEqual(a, b) {
    const bufA = Buffer.isBuffer(a) ? a : Buffer.from(a);
    const bufB = Buffer.isBuffer(b) ? b : Buffer.from(b);
    
    if (bufA.length !== bufB.length) {
      return false;
    }
    
    return crypto.timingSafeEqual(bufA, bufB);
  }

  /**
   * Dérive une clé depuis un mot de passe (PBKDF2)
   * @param {string} password
   * @param {Buffer} salt
   * @param {number} iterations
   * @param {number} keyLength
   * @returns {Promise<Buffer>}
   */
  deriveKey(password, salt, iterations = 100000, keyLength = 32) {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(password, salt, iterations, keyLength, 'sha512', (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
  }

  /**
   * Génère un salt
   * @param {number} length
   * @returns {Buffer}
   */
  generateSalt(length = SALT_LENGTH) {
    return crypto.randomBytes(length);
  }

  // =========================================
  // Alias pour compatibilité avec les modèles
  // =========================================

  /**
   * Chiffre un champ (alias pour encryptToBase64)
   * @param {string} value
   * @returns {string}
   */
  encryptField(value) {
    if (!value) return null;
    return this.encryptToBase64(value);
  }

  /**
   * Déchiffre un champ (alias pour decryptFromBase64)
   * @param {string} encrypted
   * @returns {string}
   */
  decryptField(encrypted) {
    if (!encrypted) return null;
    try {
      return this.decryptFromBase64(encrypted);
    } catch (e) {
      console.error('[CryptoUtils] Decryption failed:', e.message, 'Data prefix:', encrypted.substring(0, 20));
      return encrypted; // Retourner la valeur originale si déchiffrement échoue
    }
  }

  /**
   * Génère un hash phonétique (Soundex simplifié)
   * @param {string} value
   * @returns {string}
   */
  generatePhoneticHash(value) {
    if (!value) return null;
    // Soundex simplifié
    const str = value.toUpperCase().replace(/[^A-Z]/g, '');
    if (!str) return null;

    const codes = { B: 1, F: 1, P: 1, V: 1, C: 2, G: 2, J: 2, K: 2, Q: 2, S: 2, X: 2, Z: 2,
                    D: 3, T: 3, L: 4, M: 5, N: 5, R: 6 };

    let result = str[0];
    let lastCode = codes[str[0]] || 0;

    for (let i = 1; i < str.length && result.length < 4; i++) {
      const code = codes[str[i]];
      if (code && code !== lastCode) {
        result += code;
        lastCode = code;
      } else if (!code) {
        lastCode = 0;
      }
    }

    return result.padEnd(4, '0');
  }

  /**
   * Hash SHA-256 (alias pour sha256)
   * @param {string} value
   * @returns {string}
   */
  hashSHA256(value) {
    return this.sha256(value);
  }

  /**
   * Comparaison constante (alias pour timingSafeEqual)
   * @param {string} a
   * @param {string} b
   * @returns {boolean}
   */
  constantTimeCompare(a, b) {
    if (!a || !b) return false;
    return this.timingSafeEqual(a, b);
  }
}

// Export singleton
module.exports = new CryptoUtils();
