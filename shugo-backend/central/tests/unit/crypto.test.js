/**
 * SHUGO Central - Tests unitaires CryptoUtils
 */

// Mock de la config avant l'import du module
jest.mock('../../src/config', () => ({
  security: {
    encryptionKey: 'a'.repeat(64), // 32 bytes en hex
    hmacKey: 'b'.repeat(64), // 32 bytes en hex
    argon2: {
      memoryCost: 4096,
      timeCost: 3,
      parallelism: 1,
      hashLength: 32
    }
  }
}));

const crypto = require('crypto');
const cryptoUtils = require('../../src/utils/crypto');

describe('CryptoUtils', () => {
  describe('AES-256-GCM Encryption', () => {
    const testData = 'Données sensibles de test SHUGO';

    test('encrypt() should return encrypted data with iv and authTag', () => {
      const result = cryptoUtils.encrypt(testData);

      expect(result).toHaveProperty('encrypted');
      expect(result).toHaveProperty('iv');
      expect(result).toHaveProperty('authTag');
      expect(Buffer.isBuffer(result.encrypted)).toBe(true);
      expect(Buffer.isBuffer(result.iv)).toBe(true);
      expect(Buffer.isBuffer(result.authTag)).toBe(true);
      expect(result.iv.length).toBe(12); // 96 bits
      expect(result.authTag.length).toBe(16); // 128 bits
    });

    test('decrypt() should correctly decrypt data', () => {
      const { encrypted, iv, authTag } = cryptoUtils.encrypt(testData);
      const decrypted = cryptoUtils.decrypt(encrypted, iv, authTag);

      expect(decrypted.toString('utf8')).toBe(testData);
    });

    test('encryptToBuffer() and decryptFromBuffer() roundtrip', () => {
      const buffer = cryptoUtils.encryptToBuffer(testData);
      const decrypted = cryptoUtils.decryptFromBuffer(buffer);

      expect(decrypted.toString('utf8')).toBe(testData);
    });

    test('encryptToBase64() and decryptFromBase64() roundtrip', () => {
      const base64 = cryptoUtils.encryptToBase64(testData);
      const decrypted = cryptoUtils.decryptFromBase64(base64);

      expect(typeof base64).toBe('string');
      expect(decrypted).toBe(testData);
    });

    test('should produce different ciphertexts for same plaintext (random IV)', () => {
      const result1 = cryptoUtils.encryptToBase64(testData);
      const result2 = cryptoUtils.encryptToBase64(testData);

      expect(result1).not.toBe(result2);
    });

    test('should fail decryption with wrong key', () => {
      const wrongKey = crypto.randomBytes(32);
      const buffer = cryptoUtils.encryptToBuffer(testData);

      expect(() => {
        cryptoUtils.decryptFromBuffer(buffer, wrongKey);
      }).toThrow();
    });

    test('should fail decryption with tampered data', () => {
      const buffer = cryptoUtils.encryptToBuffer(testData);
      // Tamper with the encrypted data
      buffer[buffer.length - 1] ^= 0xFF;

      expect(() => {
        cryptoUtils.decryptFromBuffer(buffer);
      }).toThrow();
    });
  });

  describe('Argon2id Password Hashing', () => {
    const password = 'MotDePasse$écurisé123!';

    test('hashPassword() should return a hash string', async () => {
      const hash = await cryptoUtils.hashPassword(password);

      expect(typeof hash).toBe('string');
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    test('verifyPassword() should verify correct password', async () => {
      const hash = await cryptoUtils.hashPassword(password);
      const isValid = await cryptoUtils.verifyPassword(hash, password);

      expect(isValid).toBe(true);
    });

    test('verifyPassword() should reject wrong password', async () => {
      const hash = await cryptoUtils.hashPassword(password);
      const isValid = await cryptoUtils.verifyPassword(hash, 'mauvais_mot_de_passe');

      expect(isValid).toBe(false);
    });

    test('hashPassword() should produce different hashes for same password', async () => {
      const hash1 = await cryptoUtils.hashPassword(password);
      const hash2 = await cryptoUtils.hashPassword(password);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('SHA-256 Hashing', () => {
    test('sha256() should return consistent hash', () => {
      const data = 'test data';
      const hash1 = cryptoUtils.sha256(data);
      const hash2 = cryptoUtils.sha256(data);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // 256 bits in hex
    });

    test('hashForSearch() should normalize input', () => {
      const hash1 = cryptoUtils.hashForSearch('Test@Email.COM');
      const hash2 = cryptoUtils.hashForSearch('test@email.com');
      const hash3 = cryptoUtils.hashForSearch('  test@email.com  ');

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    test('hashForSearch() should return null for empty value', () => {
      expect(cryptoUtils.hashForSearch('')).toBeNull();
      expect(cryptoUtils.hashForSearch(null)).toBeNull();
      expect(cryptoUtils.hashForSearch(undefined)).toBeNull();
    });
  });

  describe('HMAC-SHA256 Signatures', () => {
    const data = 'Données à signer';

    test('hmacSign() should return hex signature', () => {
      const signature = cryptoUtils.hmacSign(data);

      expect(typeof signature).toBe('string');
      expect(signature.length).toBe(64);
    });

    test('hmacVerify() should verify valid signature', () => {
      const signature = cryptoUtils.hmacSign(data);
      const isValid = cryptoUtils.hmacVerify(data, signature);

      expect(isValid).toBe(true);
    });

    test('hmacVerify() should reject invalid signature', () => {
      const signature = cryptoUtils.hmacSign(data);
      const tamperedSignature = signature.slice(0, -2) + 'ff';

      expect(() => {
        cryptoUtils.hmacVerify(data, tamperedSignature);
      }).not.toThrow();

      const isValid = cryptoUtils.hmacVerify(data, tamperedSignature);
      expect(isValid).toBe(false);
    });

    test('hmacSign() should produce consistent signatures', () => {
      const sig1 = cryptoUtils.hmacSign(data);
      const sig2 = cryptoUtils.hmacSign(data);

      expect(sig1).toBe(sig2);
    });
  });

  describe('Random Generation', () => {
    test('randomBytes() should return buffer of correct length', () => {
      const bytes = cryptoUtils.randomBytes(16);

      expect(Buffer.isBuffer(bytes)).toBe(true);
      expect(bytes.length).toBe(16);
    });

    test('randomHex() should return hex string of correct length', () => {
      const hex = cryptoUtils.randomHex(16);

      expect(typeof hex).toBe('string');
      expect(hex.length).toBe(32); // 16 bytes = 32 hex chars
      expect(hex).toMatch(/^[0-9a-f]+$/);
    });

    test('generateUUID() should return valid UUID v4', () => {
      const uuid = cryptoUtils.generateUUID();

      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    test('generateToken() should return URL-safe string', () => {
      const token = cryptoUtils.generateToken(32);

      expect(typeof token).toBe('string');
      expect(token).not.toMatch(/[+/=]/);
    });

    test('generateNumericCode() should return numeric string of correct length', () => {
      const code = cryptoUtils.generateNumericCode(6);

      expect(code.length).toBe(6);
      expect(code).toMatch(/^[0-9]+$/);
    });

    test('generateNumericCode() should pad with zeros if needed', () => {
      // Run multiple times to check padding
      for (let i = 0; i < 10; i++) {
        const code = cryptoUtils.generateNumericCode(6);
        expect(code.length).toBe(6);
      }
    });
  });

  describe('Key Generation', () => {
    test('generateAESKey() should return 32-byte buffer', () => {
      const key = cryptoUtils.generateAESKey();

      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key.length).toBe(32);
    });

    test('generateIV() should return 12-byte buffer', () => {
      const iv = cryptoUtils.generateIV();

      expect(Buffer.isBuffer(iv)).toBe(true);
      expect(iv.length).toBe(12);
    });

    test('generateSalt() should return buffer of default length', () => {
      const salt = cryptoUtils.generateSalt();

      expect(Buffer.isBuffer(salt)).toBe(true);
      expect(salt.length).toBe(32);
    });

    test('generateSalt() should accept custom length', () => {
      const salt = cryptoUtils.generateSalt(16);

      expect(salt.length).toBe(16);
    });
  });

  describe('Double Encryption', () => {
    const plaintext = 'Données double-chiffrées';
    const localKey = crypto.randomBytes(32);
    const centralKey = crypto.randomBytes(32);

    test('doubleEncrypt() and doubleDecrypt() roundtrip', () => {
      const encrypted = cryptoUtils.doubleEncrypt(plaintext, localKey, centralKey);
      const decrypted = cryptoUtils.doubleDecrypt(encrypted, localKey, centralKey);

      expect(decrypted.toString('utf8')).toBe(plaintext);
    });

    test('should fail with wrong local key', () => {
      const encrypted = cryptoUtils.doubleEncrypt(plaintext, localKey, centralKey);
      const wrongLocalKey = crypto.randomBytes(32);

      expect(() => {
        cryptoUtils.doubleDecrypt(encrypted, wrongLocalKey, centralKey);
      }).toThrow();
    });

    test('should fail with wrong central key', () => {
      const encrypted = cryptoUtils.doubleEncrypt(plaintext, localKey, centralKey);
      const wrongCentralKey = crypto.randomBytes(32);

      expect(() => {
        cryptoUtils.doubleDecrypt(encrypted, localKey, wrongCentralKey);
      }).toThrow();
    });
  });

  describe('Timing Safe Comparison', () => {
    test('timingSafeEqual() should return true for equal values', () => {
      const a = 'test_value';
      const b = 'test_value';

      expect(cryptoUtils.timingSafeEqual(a, b)).toBe(true);
    });

    test('timingSafeEqual() should return false for different values', () => {
      const a = 'test_value';
      const b = 'other_value';

      expect(cryptoUtils.timingSafeEqual(a, b)).toBe(false);
    });

    test('timingSafeEqual() should return false for different lengths', () => {
      const a = 'short';
      const b = 'much_longer_string';

      expect(cryptoUtils.timingSafeEqual(a, b)).toBe(false);
    });

    test('timingSafeEqual() should work with buffers', () => {
      const a = Buffer.from('test');
      const b = Buffer.from('test');

      expect(cryptoUtils.timingSafeEqual(a, b)).toBe(true);
    });
  });

  describe('Key Derivation', () => {
    test('deriveKey() should derive consistent key', async () => {
      const password = 'test_password';
      const salt = cryptoUtils.generateSalt();

      const key1 = await cryptoUtils.deriveKey(password, salt);
      const key2 = await cryptoUtils.deriveKey(password, salt);

      expect(key1.equals(key2)).toBe(true);
      expect(key1.length).toBe(32);
    });

    test('deriveKey() should produce different keys for different salts', async () => {
      const password = 'test_password';
      const salt1 = cryptoUtils.generateSalt();
      const salt2 = cryptoUtils.generateSalt();

      const key1 = await cryptoUtils.deriveKey(password, salt1);
      const key2 = await cryptoUtils.deriveKey(password, salt2);

      expect(key1.equals(key2)).toBe(false);
    });
  });
});
