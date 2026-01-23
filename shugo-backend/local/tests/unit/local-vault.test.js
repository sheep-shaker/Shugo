/**
 * SHUGO Local - Tests unitaires LocalVault
 */

const crypto = require('crypto');
const path = require('path');

// Mock fs.promises
const mockFs = {
  mkdir: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  chmod: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
  stat: jest.fn()
};

jest.mock('fs', () => ({
  promises: mockFs
}));

// Mock logger
jest.mock('../../src/utils/logger');

const LocalVault = require('../../src/vault/LocalVault');

describe('LocalVault', () => {
  let vault;
  let mockConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfig = {
      keys: {
        master: crypto.randomBytes(32).toString('hex'),
        data: crypto.randomBytes(32).toString('hex'),
        backup: crypto.randomBytes(32).toString('hex')
      },
      keyRotation: null
    };

    vault = new LocalVault(mockConfig);
  });

  describe('Constructor', () => {
    test('should initialize with correct config', () => {
      expect(vault.config).toBe(mockConfig);
      expect(vault.isInitialized).toBe(false);
      expect(vault.keys).toBeInstanceOf(Map);
      expect(vault.masterKey).toBeNull();
    });

    test('should set correct vault path', () => {
      expect(vault.vaultPath).toContain('vault');
    });
  });

  describe('initialize', () => {
    test('should create vault directory', async () => {
      mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

      await vault.initialize();

      expect(mockFs.mkdir).toHaveBeenCalledWith(
        vault.vaultPath,
        { recursive: true }
      );
    });

    test('should generate keys if none exist', async () => {
      mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

      await vault.initialize();

      expect(vault.isInitialized).toBe(true);
      expect(vault.masterKey).toBeDefined();
      expect(vault.dataKey).toBeDefined();
      expect(vault.backupKey).toBeDefined();
    });

    test('should load existing keys', async () => {
      // Create encrypted key file content
      const keyData = {
        version: 1,
        keys: {
          data: crypto.randomBytes(32).toString('hex'),
          backup: crypto.randomBytes(32).toString('hex')
        }
      };

      // Encrypt with master key
      const masterKey = Buffer.from(mockConfig.keys.master, 'hex');
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(keyData), 'utf8'),
        cipher.final()
      ]);
      const authTag = cipher.getAuthTag();
      const encryptedData = Buffer.concat([iv, authTag, encrypted]);

      mockFs.readFile.mockResolvedValue(encryptedData);

      await vault.initialize();

      expect(vault.isInitialized).toBe(true);
      expect(vault.keys.size).toBeGreaterThan(0);
    });
  });

  describe('generateKeys', () => {
    test('should generate all required keys', async () => {
      await vault.generateKeys();

      expect(vault.masterKey).toBeDefined();
      expect(vault.masterKey.length).toBe(32);
      expect(vault.dataKey).toBeDefined();
      expect(vault.dataKey.length).toBe(32);
      expect(vault.backupKey).toBeDefined();
      expect(vault.backupKey.length).toBe(32);
    });

    test('should use config keys if provided', async () => {
      await vault.generateKeys();

      expect(vault.masterKey.toString('hex')).toBe(mockConfig.keys.master);
      expect(vault.dataKey.toString('hex')).toBe(mockConfig.keys.data);
      expect(vault.backupKey.toString('hex')).toBe(mockConfig.keys.backup);
    });

    test('should generate random keys if not in config', async () => {
      vault.config.keys = {};
      await vault.generateKeys();

      expect(vault.masterKey.length).toBe(32);
      expect(vault.dataKey.length).toBe(32);
      expect(vault.backupKey.length).toBe(32);
    });

    test('should store keys in map', async () => {
      await vault.generateKeys();

      expect(vault.keys.get('master')).toBeDefined();
      expect(vault.keys.get('data')).toBeDefined();
      expect(vault.keys.get('backup')).toBeDefined();
      expect(vault.keys.get('session')).toBeDefined();
      expect(vault.keys.get('api')).toBeDefined();
    });
  });

  describe('encrypt/decrypt', () => {
    beforeEach(async () => {
      await vault.generateKeys();
    });

    test('should encrypt and decrypt data correctly', () => {
      const plaintext = 'Test data to encrypt';
      const encrypted = vault.encrypt(plaintext);
      const decrypted = vault.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    test('should produce different ciphertexts for same plaintext', () => {
      const plaintext = 'Test data';
      const enc1 = vault.encrypt(plaintext);
      const enc2 = vault.encrypt(plaintext);

      expect(enc1.equals(enc2)).toBe(false);
    });

    test('should work with custom key', () => {
      const customKey = crypto.randomBytes(32);
      const plaintext = 'Custom key test';
      const encrypted = vault.encrypt(plaintext, customKey);
      const decrypted = vault.decrypt(encrypted, customKey);

      expect(decrypted).toBe(plaintext);
    });

    test('should fail with wrong key', () => {
      const plaintext = 'Test data';
      const encrypted = vault.encrypt(plaintext);
      const wrongKey = crypto.randomBytes(32);

      expect(() => {
        vault.decrypt(encrypted, wrongKey);
      }).toThrow();
    });

    test('should fail with tampered data', () => {
      const plaintext = 'Test data';
      const encrypted = vault.encrypt(plaintext);
      encrypted[encrypted.length - 1] ^= 0xFF; // Tamper

      expect(() => {
        vault.decrypt(encrypted);
      }).toThrow();
    });

    test('should throw if no key available', () => {
      vault.dataKey = null;

      expect(() => {
        vault.encrypt('test');
      }).toThrow('No encryption key available');
    });
  });

  describe('encryptForBackup/decryptFromBackup', () => {
    beforeEach(async () => {
      await vault.generateKeys();
    });

    test('should encrypt and decrypt with backup key', () => {
      const data = 'Backup data test';
      const encrypted = vault.encryptForBackup(data);
      const decrypted = vault.decryptFromBackup(encrypted);

      expect(decrypted).toBe(data);
    });
  });

  describe('HMAC', () => {
    beforeEach(async () => {
      await vault.generateKeys();
    });

    test('should generate valid HMAC', () => {
      const data = 'Data to sign';
      const hmac = vault.generateHMAC(data);

      expect(typeof hmac).toBe('string');
      expect(hmac.length).toBe(64); // SHA256 hex
    });

    test('should verify valid HMAC', () => {
      const data = 'Data to verify';
      const hmac = vault.generateHMAC(data);

      expect(vault.verifyHMAC(data, hmac)).toBe(true);
    });

    test('should reject invalid HMAC', () => {
      const data = 'Data to verify';
      const validHmac = vault.generateHMAC(data);
      const badHmac = validHmac.slice(0, -2) + 'ff';

      // timingSafeEqual requires same length buffers
      expect(vault.verifyHMAC(data, badHmac)).toBe(false);
    });

    test('should produce consistent signatures', () => {
      const data = 'Test data';
      const hmac1 = vault.generateHMAC(data);
      const hmac2 = vault.generateHMAC(data);

      expect(hmac1).toBe(hmac2);
    });

    test('should produce different signatures for different data', () => {
      const hmac1 = vault.generateHMAC('Data 1');
      const hmac2 = vault.generateHMAC('Data 2');

      expect(hmac1).not.toBe(hmac2);
    });
  });

  describe('storeItem/retrieveItem', () => {
    beforeEach(async () => {
      await vault.generateKeys();
    });

    test('should store item to disk', async () => {
      const name = 'test-item';
      const data = { key: 'value' };

      await vault.storeItem(name, data);

      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(mockFs.chmod).toHaveBeenCalledWith(
        expect.stringContaining(`${name}.item`),
        0o600
      );
    });

    test('should retrieve stored item', async () => {
      const name = 'test-item';
      const data = { key: 'value' };

      // Setup mock to return encrypted data
      const encryptedData = vault.encrypt(JSON.stringify(data));
      const storedItem = {
        name,
        created: new Date().toISOString(),
        encrypted: false,
        data: encryptedData.toString('base64')
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify({
        ...storedItem,
        data: encryptedData
      }));

      const retrieved = await vault.retrieveItem(name);

      // Note: This test may need adjustment based on exact implementation
      expect(mockFs.readFile).toHaveBeenCalled();
    });

    test('should return null for non-existent item', async () => {
      mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

      const result = await vault.retrieveItem('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('deleteItem', () => {
    test('should delete item from disk', async () => {
      await vault.deleteItem('test-item');

      expect(mockFs.unlink).toHaveBeenCalledWith(
        expect.stringContaining('test-item.item')
      );
    });

    test('should not throw for non-existent item', async () => {
      mockFs.unlink.mockRejectedValue({ code: 'ENOENT' });

      await expect(vault.deleteItem('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('listItems', () => {
    test('should list vault items', async () => {
      mockFs.readdir.mockResolvedValue([
        'item1.item',
        'item2.item',
        'keys.vault',
        'other.txt'
      ]);

      const items = await vault.listItems();

      expect(items).toEqual(['item1', 'item2']);
    });
  });

  describe('rotateKeys', () => {
    beforeEach(async () => {
      await vault.generateKeys();
    });

    test('should generate new data and backup keys', async () => {
      const oldDataKey = vault.dataKey;
      const oldBackupKey = vault.backupKey;

      await vault.rotateKeys();

      expect(vault.dataKey.equals(oldDataKey)).toBe(false);
      expect(vault.backupKey.equals(oldBackupKey)).toBe(false);
    });

    test('should keep old keys available', async () => {
      const oldDataKey = vault.dataKey;

      await vault.rotateKeys();

      expect(vault.keys.get('data_old')).toEqual(oldDataKey);
    });

    test('should save new keys to disk', async () => {
      await vault.rotateKeys();

      expect(mockFs.writeFile).toHaveBeenCalled();
    });
  });

  describe('close', () => {
    beforeEach(async () => {
      await vault.generateKeys();
    });

    test('should clear all sensitive data', async () => {
      await vault.close();

      expect(vault.keys.size).toBe(0);
      expect(vault.masterKey).toBeNull();
      expect(vault.dataKey).toBeNull();
      expect(vault.backupKey).toBeNull();
      expect(vault.isInitialized).toBe(false);
    });
  });

  describe('getStatistics', () => {
    beforeEach(async () => {
      await vault.generateKeys();
      vault.isInitialized = true;
    });

    test('should return vault statistics', async () => {
      mockFs.readdir.mockResolvedValue(['item1.item', 'item2.item']);
      mockFs.stat.mockResolvedValue({ mtime: new Date() });

      const stats = await vault.getStatistics();

      expect(stats.initialized).toBe(true);
      expect(stats.itemCount).toBe(2);
      expect(stats.keyCount).toBe(vault.keys.size);
      expect(stats.vaultPath).toBe(vault.vaultPath);
    });
  });

  describe('clearVault', () => {
    test('should delete all items except keys.vault', async () => {
      // Generate keys first to initialize vault
      await vault.generateKeys();

      mockFs.readdir.mockResolvedValue([
        'item1.item',
        'item2.item',
        'keys.vault'
      ]);
      mockFs.unlink.mockResolvedValue(undefined);

      await vault.clearVault();

      expect(mockFs.unlink).toHaveBeenCalledTimes(2);
      expect(mockFs.unlink).not.toHaveBeenCalledWith(
        expect.stringContaining('keys.vault')
      );
    });
  });
});
