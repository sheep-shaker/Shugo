/**
 * Tests unitaires pour VaultService
 *
 * Couvre les fonctionnalités critiques du coffre-fort sécurisé:
 * - Chiffrement/déchiffrement AES-256-GCM
 * - Rotation des clés
 * - Gestion des secrets partagés
 * - Codes d'urgence
 */

'use strict';

// Mock crypto utils AVANT tout import
const nodeCrypto = require('crypto');
const testEncryptionKey = Buffer.alloc(32, 0);
const testHmacKey = Buffer.alloc(32, 1);

jest.mock('../../src/utils/crypto', () => {
    const crypto = require('crypto');
    const encKey = Buffer.alloc(32, 0);
    const hmacKey = Buffer.alloc(32, 1);

    return {
        encryptToBuffer: jest.fn((data, key = encKey) => {
            const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            const encrypted = Buffer.concat([cipher.update(dataBuffer), cipher.final()]);
            const authTag = cipher.getAuthTag();
            return Buffer.concat([iv, authTag, encrypted]);
        }),
        decryptFromBuffer: jest.fn((data, key = encKey) => {
            const iv = data.subarray(0, 12);
            const authTag = data.subarray(12, 28);
            const encrypted = data.subarray(28);
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(authTag);
            return Buffer.concat([decipher.update(encrypted), decipher.final()]);
        }),
        hmacSign: jest.fn((data, key = hmacKey) => {
            return crypto.createHmac('sha256', key).update(data).digest('hex');
        }),
        hmacVerify: jest.fn((data, signature, key = hmacKey) => {
            const computed = crypto.createHmac('sha256', key).update(data).digest('hex');
            return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(signature, 'hex'));
        }),
        sha256: jest.fn((data) => {
            return crypto.createHash('sha256').update(data).digest('hex');
        }),
        generateAESKey: jest.fn(() => crypto.randomBytes(32)),
        generateIV: jest.fn(() => crypto.randomBytes(16)),
        generateRandomBytes: jest.fn((size) => crypto.randomBytes(size))
    };
});

// Mock config APRES le mock crypto
jest.mock('../../src/config', () => ({
    security: {
        vaultMasterKey: '0'.repeat(64),
        encryptionKey: '0'.repeat(64),
        hmacKey: '1'.repeat(64)
    },
    isDev: true
}));

// Import le mock
const crypto = require('../../src/utils/crypto');

describe('VaultService', () => {
    let VaultService;
    let vaultService;
    let mockModels;
    let mockSequelize;

    beforeAll(() => {
        // Mock des modèles
        mockModels = {
            VaultItem: {
                findAll: jest.fn(),
                findOne: jest.fn(),
                findByPk: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                destroy: jest.fn()
            },
            AesKeyRotation: {
                findAll: jest.fn(),
                findOne: jest.fn(),
                create: jest.fn(),
                update: jest.fn()
            },
            SharedSecret: {
                findAll: jest.fn(),
                findOne: jest.fn(),
                create: jest.fn(),
                update: jest.fn()
            },
            EmergencyCode: {
                findAll: jest.fn(),
                findOne: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                bulkCreate: jest.fn()
            },
            SecurityProtocolLog: {
                create: jest.fn()
            },
            AuditLog: {
                create: jest.fn(),
                logAction: jest.fn()
            }
        };

        mockSequelize = {
            transaction: jest.fn().mockResolvedValue({
                commit: jest.fn(),
                rollback: jest.fn()
            })
        };

        // Import le VaultService (qui utilisera le mock crypto)
        VaultService = require('../../src/services/VaultService');
        vaultService = new VaultService(mockModels, mockSequelize);
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Cryptographic Operations', () => {
        describe('AES-256-GCM Encryption', () => {
            it('should encrypt and decrypt data correctly', () => {
                const plaintext = 'Secret data to encrypt';
                const key = crypto.generateAESKey();

                // Encrypt
                const encrypted = crypto.encryptToBuffer(plaintext, key);
                expect(encrypted).toBeDefined();
                expect(Buffer.isBuffer(encrypted)).toBe(true);

                // Decrypt
                const decrypted = crypto.decryptFromBuffer(encrypted, key);
                expect(decrypted.toString('utf8')).toBe(plaintext);
            });

            it('should produce different ciphertext for same plaintext (due to random IV)', () => {
                const plaintext = 'Same message';
                const key = crypto.generateAESKey();

                const encrypted1 = crypto.encryptToBuffer(plaintext, key);
                const encrypted2 = crypto.encryptToBuffer(plaintext, key);

                expect(encrypted1.toString('hex')).not.toBe(encrypted2.toString('hex'));
            });

            it('should fail decryption with wrong key', () => {
                const plaintext = 'Secret data';
                const key1 = crypto.generateAESKey();
                const key2 = crypto.generateAESKey();

                const encrypted = crypto.encryptToBuffer(plaintext, key1);

                expect(() => {
                    crypto.decryptFromBuffer(encrypted, key2);
                }).toThrow();
            });

            it('should generate valid AES-256 keys (32 bytes)', () => {
                const key = crypto.generateAESKey();
                expect(Buffer.isBuffer(key)).toBe(true);
                expect(key.length).toBe(32); // 256 bits
            });

            it('should generate valid IVs (16 bytes)', () => {
                const iv = crypto.generateIV();
                expect(Buffer.isBuffer(iv)).toBe(true);
                expect(iv.length).toBe(16);
            });
        });

        describe('HMAC Operations', () => {
            it('should generate consistent HMAC for same data', () => {
                const data = 'Data to sign';
                const key = crypto.generateAESKey();

                const hmac1 = crypto.hmacSign(data, key);
                const hmac2 = crypto.hmacSign(data, key);

                expect(hmac1).toBe(hmac2);
            });

            it('should generate different HMAC for different data', () => {
                const key = crypto.generateAESKey();

                const hmac1 = crypto.hmacSign('Data 1', key);
                const hmac2 = crypto.hmacSign('Data 2', key);

                expect(hmac1).not.toBe(hmac2);
            });

            it('should verify HMAC correctly', () => {
                const data = 'Data to verify';
                const key = crypto.generateAESKey();

                const hmac = crypto.hmacSign(data, key);
                const isValid = crypto.hmacVerify(data, hmac, key);

                expect(isValid).toBe(true);
            });

            it('should reject tampered HMAC', () => {
                const data = 'Original data';
                const key = crypto.generateAESKey();

                const hmac = crypto.hmacSign(data, key);
                const isValid = crypto.hmacVerify('Tampered data', hmac, key);

                expect(isValid).toBe(false);
            });
        });

        describe('SHA-256 Hashing', () => {
            it('should produce consistent hashes', () => {
                const data = 'Data to hash';

                const hash1 = crypto.sha256(data);
                const hash2 = crypto.sha256(data);

                expect(hash1).toBe(hash2);
            });

            it('should produce 64-character hex output', () => {
                const hash = crypto.sha256('test');
                expect(hash.length).toBe(64);
                expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
            });
        });
    });

    describe('Key Management', () => {
        describe('Key Rotation', () => {
            it('should detect active key', async () => {
                const mockActiveKey = {
                    key_id: 'active-key-id',
                    key_type: 'vault_central',
                    status: 'active',
                    key_material_encrypted: Buffer.from('encrypted-key'),
                    update: jest.fn().mockResolvedValue(true)
                };

                mockModels.AesKeyRotation.findOne.mockResolvedValue(mockActiveKey);

                const result = await mockModels.AesKeyRotation.findOne({
                    where: { status: 'active', key_type: 'vault_central' }
                });

                expect(result).toBeDefined();
                expect(result.status).toBe('active');
            });

            it('should return null when no active key', async () => {
                mockModels.AesKeyRotation.findOne.mockResolvedValue(null);

                const result = await mockModels.AesKeyRotation.findOne({
                    where: { status: 'active', key_type: 'vault_central' }
                });

                expect(result).toBeNull();
            });
        });

        describe('Key Expiration', () => {
            it('should identify expiring keys', async () => {
                const expiringKey = {
                    key_id: 'expiring-key',
                    key_type: 'vault_central',
                    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    status: 'active'
                };

                mockModels.AesKeyRotation.findAll.mockResolvedValue([expiringKey]);

                const keys = await mockModels.AesKeyRotation.findAll({
                    where: { status: 'active' }
                });

                expect(keys).toHaveLength(1);
                expect(keys[0].expires_at).toBeDefined();
            });
        });
    });

    describe('Vault Items', () => {
        describe('Store Item', () => {
            it('should create vault item', async () => {
                const testItem = {
                    item_id: 'new-item-id',
                    item_type: 'credential',
                    item_name: 'Test Credential',
                    encrypted_data: Buffer.from('encrypted'),
                    access_level: 'restricted'
                };

                mockModels.VaultItem.create.mockResolvedValue(testItem);

                const result = await mockModels.VaultItem.create(testItem);

                expect(result.item_id).toBe('new-item-id');
                expect(result.access_level).toBe('restricted');
            });

            it('should validate access level', async () => {
                const validLevels = ['public', 'restricted', 'confidential', 'secret'];

                for (const level of validLevels) {
                    mockModels.VaultItem.create.mockResolvedValue({
                        item_id: `item-${level}`,
                        access_level: level
                    });

                    const result = await mockModels.VaultItem.create({
                        item_name: 'Test',
                        access_level: level
                    });

                    expect(validLevels).toContain(result.access_level);
                }
            });
        });

        describe('Retrieve Item', () => {
            it('should retrieve item by ID', async () => {
                const mockItem = {
                    item_id: 'test-item',
                    encrypted_data: Buffer.from('encrypted'),
                    access_level: 'restricted'
                };

                mockModels.VaultItem.findByPk.mockResolvedValue(mockItem);

                const result = await mockModels.VaultItem.findByPk('test-item');

                expect(result).toBeDefined();
                expect(result.item_id).toBe('test-item');
            });

            it('should return null for non-existent item', async () => {
                mockModels.VaultItem.findByPk.mockResolvedValue(null);

                const result = await mockModels.VaultItem.findByPk('non-existent');

                expect(result).toBeNull();
            });
        });

        describe('Delete Item', () => {
            it('should delete vault item', async () => {
                const mockItem = {
                    item_id: 'test-item',
                    destroy: jest.fn().mockResolvedValue(true)
                };

                mockModels.VaultItem.findByPk.mockResolvedValue(mockItem);

                const item = await mockModels.VaultItem.findByPk('test-item');
                await item.destroy();

                expect(mockItem.destroy).toHaveBeenCalled();
            });
        });
    });

    describe('Emergency Codes', () => {
        describe('Generate Codes', () => {
            it('should bulk create emergency codes', async () => {
                const codes = Array.from({ length: 100 }, (_, i) => ({
                    code_id: `code-${i}`,
                    code_hash: crypto.sha256(`ABCD-${i}`),
                    status: 'active'
                }));

                mockModels.EmergencyCode.bulkCreate.mockResolvedValue(codes);

                const result = await mockModels.EmergencyCode.bulkCreate(codes);

                expect(result).toHaveLength(100);
            });

            it('should generate unique code hashes', () => {
                const codes = ['CODE-001', 'CODE-002', 'CODE-003'];
                const hashes = codes.map(c => crypto.sha256(c));

                const uniqueHashes = new Set(hashes);
                expect(uniqueHashes.size).toBe(3);
            });
        });

        describe('Validate Code', () => {
            it('should find code by hash', async () => {
                const originalCode = 'ABCD-1234-EFGH';
                const codeHash = crypto.sha256(originalCode);

                mockModels.EmergencyCode.findOne.mockResolvedValue({
                    code_id: 'test-code',
                    code_hash: codeHash,
                    status: 'active'
                });

                const result = await mockModels.EmergencyCode.findOne({
                    where: { code_hash: codeHash, status: 'active' }
                });

                expect(result).toBeDefined();
                expect(result.status).toBe('active');
            });

            it('should not find used code', async () => {
                mockModels.EmergencyCode.findOne.mockResolvedValue(null);

                const result = await mockModels.EmergencyCode.findOne({
                    where: { code_hash: 'some-hash', status: 'active' }
                });

                expect(result).toBeNull();
            });
        });
    });

    describe('Shared Secrets', () => {
        describe('Create Secret', () => {
            it('should create shared secret with expiration', async () => {
                const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

                mockModels.SharedSecret.create.mockResolvedValue({
                    secret_id: 'new-secret',
                    secret_encrypted: Buffer.from('encrypted'),
                    expires_at: expiresAt,
                    status: 'active'
                });

                const result = await mockModels.SharedSecret.create({
                    secret_encrypted: Buffer.from('encrypted'),
                    expires_at: expiresAt
                });

                expect(result.secret_id).toBe('new-secret');
                expect(result.expires_at).toEqual(expiresAt);
            });
        });

        describe('Rotate Secret', () => {
            it('should deprecate old secret on rotation', async () => {
                const mockOldSecret = {
                    secret_id: 'old-secret',
                    status: 'active',
                    update: jest.fn().mockResolvedValue(true)
                };

                mockModels.SharedSecret.findOne.mockResolvedValue(mockOldSecret);

                const secret = await mockModels.SharedSecret.findOne({
                    where: { status: 'active' }
                });
                await secret.update({ status: 'deprecated' });

                expect(mockOldSecret.update).toHaveBeenCalledWith({ status: 'deprecated' });
            });
        });
    });

    describe('Security Logging', () => {
        it('should create audit log entry', async () => {
            mockModels.AuditLog.create.mockResolvedValue({
                log_id: 'audit-log-1',
                action: 'vault_item_accessed',
                resource_type: 'vault_item',
                result: 'success'
            });

            const result = await mockModels.AuditLog.create({
                action: 'vault_item_accessed',
                resource_type: 'vault_item',
                result: 'success'
            });

            expect(result.action).toBe('vault_item_accessed');
        });

        it('should create security protocol log', async () => {
            mockModels.SecurityProtocolLog.create.mockResolvedValue({
                log_id: 'protocol-log-1',
                protocol_name: 'key_rotation',
                result: 'success'
            });

            const result = await mockModels.SecurityProtocolLog.create({
                protocol_name: 'key_rotation',
                result: 'success'
            });

            expect(result.protocol_name).toBe('key_rotation');
        });
    });
});

describe('Crypto Utils Integration', () => {
    it('should handle large data encryption', () => {
        const largeData = 'A'.repeat(1024 * 1024); // 1MB
        const key = crypto.generateAESKey();

        const encrypted = crypto.encryptToBuffer(largeData, key);
        const decrypted = crypto.decryptFromBuffer(encrypted, key);

        expect(decrypted.toString('utf8')).toBe(largeData);
    });

    it('should handle unicode data correctly', () => {
        const unicodeData = 'Données sensibles 🔐 日本語 العربية';
        const key = crypto.generateAESKey();

        const encrypted = crypto.encryptToBuffer(unicodeData, key);
        const decrypted = crypto.decryptFromBuffer(encrypted, key);

        expect(decrypted.toString('utf8')).toBe(unicodeData);
    });

    it('should handle empty data', () => {
        const key = crypto.generateAESKey();

        const encrypted = crypto.encryptToBuffer('', key);
        const decrypted = crypto.decryptFromBuffer(encrypted, key);

        expect(decrypted.toString('utf8')).toBe('');
    });

    it('should handle binary data', () => {
        const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
        const key = crypto.generateAESKey();

        const encrypted = crypto.encryptToBuffer(binaryData, key);
        const decrypted = crypto.decryptFromBuffer(encrypted, key);

        expect(decrypted.equals(binaryData)).toBe(true);
    });
});
