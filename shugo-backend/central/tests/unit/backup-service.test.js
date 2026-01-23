/**
 * Tests unitaires pour BackupService
 *
 * Couvre les fonctionnalités de sauvegarde et restauration:
 * - Création de backups (daily, weekly, monthly, manual)
 * - Validation d'intégrité
 * - Restauration
 * - Nettoyage et rétention
 * - Chiffrement des fichiers
 */

'use strict';

// Mock sequelize AVANT tout import
jest.mock('sequelize', () => {
    const mockOp = {
        lt: Symbol('lt'),
        gt: Symbol('gt'),
        in: Symbol('in'),
        notIn: Symbol('notIn')
    };
    return {
        Op: mockOp,
        Sequelize: jest.fn(),
        DataTypes: {
            STRING: 'STRING',
            INTEGER: 'INTEGER',
            BOOLEAN: 'BOOLEAN',
            DATE: 'DATE',
            TEXT: 'TEXT',
            BLOB: 'BLOB',
            BIGINT: 'BIGINT',
            FLOAT: 'FLOAT',
            ENUM: jest.fn()
        }
    };
});

// Mock des dépendances
jest.mock('../../src/config', () => ({
    backup: {
        path: '/tmp/test-backups',
        retention: {
            daily: 30,
            weekly: 90,
            monthly: 365
        }
    },
    database: {
        host: 'localhost',
        port: 5432,
        user: 'test',
        password: 'test',
        database: 'test_db'
    },
    logging: {
        directory: './logs'
    },
    server: {
        serverId: 'test-server',
        serverType: 'central'
    },
    geo: {
        defaultGeoId: '02-33-06-01-00'
    },
    features: {},
    security: {
        encryptionKey: '0'.repeat(64)
    }
}));

jest.mock('fs', () => ({
    promises: {
        mkdir: jest.fn().mockResolvedValue(undefined),
        writeFile: jest.fn().mockResolvedValue(undefined),
        readFile: jest.fn().mockResolvedValue(Buffer.from('test content')),
        stat: jest.fn().mockResolvedValue({ size: 1024 }),
        access: jest.fn().mockResolvedValue(undefined),
        unlink: jest.fn().mockResolvedValue(undefined),
        rm: jest.fn().mockResolvedValue(undefined)
    }
}));

jest.mock('child_process', () => ({
    exec: jest.fn((cmd, callback) => {
        if (callback) callback(null, { stdout: '', stderr: '' });
    })
}));

jest.mock('util', () => ({
    promisify: jest.fn((fn) => jest.fn().mockResolvedValue({ stdout: '', stderr: '' }))
}));

jest.mock('../../src/utils/crypto', () => ({
    encryptToBuffer: jest.fn((data) => Buffer.from('encrypted_' + data)),
    decryptFromBuffer: jest.fn((data) => Buffer.from(data.toString().replace('encrypted_', '')))
}));

const BackupService = require('../../src/services/BackupService');
const { BACKUP_TYPES, BACKUP_LEVELS, FILE_TYPES } = BackupService;

describe('BackupService', () => {
    let backupService;
    let mockModels;
    let mockSequelize;

    beforeAll(() => {
        mockModels = {
            BackupJob: {
                create: jest.fn(),
                findByPk: jest.fn(),
                findAll: jest.fn(),
                findAndCountAll: jest.fn()
            },
            BackupFile: {
                create: jest.fn(),
                destroy: jest.fn()
            },
            RestoreOperation: {
                create: jest.fn()
            },
            AuditLog: {
                create: jest.fn()
            },
            AesKeyRotation: {
                findAll: jest.fn().mockResolvedValue([])
            },
            SharedSecret: {
                findAll: jest.fn().mockResolvedValue([])
            },
            VaultItem: {
                findAll: jest.fn().mockResolvedValue([])
            }
        };

        mockSequelize = {
            query: jest.fn().mockResolvedValue([[
                { job_type: 'daily', count: 10, total_size: 10240, avg_size: 1024, last_backup: new Date() }
            ]])
        };

        backupService = new BackupService(mockModels, mockSequelize);
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Constants', () => {
        it('should export BACKUP_TYPES', () => {
            expect(BACKUP_TYPES.DAILY).toBe('daily');
            expect(BACKUP_TYPES.WEEKLY).toBe('weekly');
            expect(BACKUP_TYPES.MONTHLY).toBe('monthly');
            expect(BACKUP_TYPES.MANUAL).toBe('manual');
            expect(BACKUP_TYPES.EMERGENCY).toBe('emergency');
        });

        it('should export BACKUP_LEVELS', () => {
            expect(BACKUP_LEVELS.FULL).toBe('full');
            expect(BACKUP_LEVELS.INCREMENTAL).toBe('incremental');
            expect(BACKUP_LEVELS.DIFFERENTIAL).toBe('differential');
        });

        it('should export FILE_TYPES', () => {
            expect(FILE_TYPES.DATABASE).toBe('database');
            expect(FILE_TYPES.VAULT).toBe('vault');
            expect(FILE_TYPES.LOGS).toBe('logs');
            expect(FILE_TYPES.CONFIG).toBe('config');
            expect(FILE_TYPES.ARCHIVE).toBe('archive');
        });
    });

    describe('Backup ID Generation', () => {
        it('should generate backup ID with correct format', () => {
            const id = backupService._generateBackupId('daily');
            expect(id).toMatch(/^backup_daily_\d{8}T\d{6}$/);
        });

        it('should generate unique IDs for different types', () => {
            const dailyId = backupService._generateBackupId('daily');
            const weeklyId = backupService._generateBackupId('weekly');

            expect(dailyId).toContain('daily');
            expect(weeklyId).toContain('weekly');
        });
    });

    describe('Retention Calculation', () => {
        it('should calculate daily retention (30 days)', () => {
            const retention = backupService._calculateRetention(BACKUP_TYPES.DAILY);
            const expected = new Date();
            expected.setDate(expected.getDate() + 30);

            // Comparer les dates (sans les millisecondes)
            expect(retention.toDateString()).toBe(expected.toDateString());
        });

        it('should calculate weekly retention (90 days)', () => {
            const retention = backupService._calculateRetention(BACKUP_TYPES.WEEKLY);
            const expected = new Date();
            expected.setDate(expected.getDate() + 90);

            expect(retention.toDateString()).toBe(expected.toDateString());
        });

        it('should calculate monthly retention (365 days)', () => {
            const retention = backupService._calculateRetention(BACKUP_TYPES.MONTHLY);
            const expected = new Date();
            expected.setDate(expected.getDate() + 365);

            expect(retention.toDateString()).toBe(expected.toDateString());
        });

        it('should default to daily retention for unknown types', () => {
            const retention = backupService._calculateRetention('unknown');
            const expected = new Date();
            expected.setDate(expected.getDate() + 30);

            expect(retention.toDateString()).toBe(expected.toDateString());
        });
    });

    describe('Compression Ratio', () => {
        it('should calculate compression ratio correctly', () => {
            const files = [
                { size: 1000 },
                { size: 2000 },
                { size: 3000 }
            ];
            const archiveSize = 3000; // 50% compression

            const ratio = backupService._calculateCompressionRatio(files, archiveSize);
            expect(ratio).toBe(0.5);
        });

        it('should handle zero original size', () => {
            const files = [];
            const ratio = backupService._calculateCompressionRatio(files, 1000);
            expect(ratio).toBe(1);
        });

        it('should handle files without size', () => {
            const files = [{ size: undefined }, { size: null }];
            const ratio = backupService._calculateCompressionRatio(files, 1000);
            expect(ratio).toBe(1);
        });
    });

    describe('Checksum Calculation', () => {
        it('should calculate MD5 and SHA256 checksums', async () => {
            const fs = require('fs').promises;
            fs.readFile.mockResolvedValue(Buffer.from('test content'));

            const checksums = await backupService._calculateChecksums('/test/file.txt');

            expect(checksums).toHaveProperty('md5');
            expect(checksums).toHaveProperty('sha256');
            expect(checksums.md5).toMatch(/^[a-f0-9]{32}$/);
            expect(checksums.sha256).toMatch(/^[a-f0-9]{64}$/);
        });

        it('should produce consistent checksums for same content', async () => {
            const fs = require('fs').promises;
            fs.readFile.mockResolvedValue(Buffer.from('same content'));

            const checksums1 = await backupService._calculateChecksums('/test/file1.txt');
            const checksums2 = await backupService._calculateChecksums('/test/file2.txt');

            expect(checksums1.md5).toBe(checksums2.md5);
            expect(checksums1.sha256).toBe(checksums2.sha256);
        });
    });

    describe('Create Backup', () => {
        beforeEach(() => {
            const mockJob = {
                job_id: 'test-job-id',
                update: jest.fn().mockResolvedValue(true)
            };
            mockModels.BackupJob.create.mockResolvedValue(mockJob);
            mockModels.BackupFile.create.mockResolvedValue({});
        });

        it('should create backup job with correct type', async () => {
            await backupService.createBackup(BACKUP_TYPES.DAILY);

            expect(mockModels.BackupJob.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    job_type: 'daily',
                    status: 'running'
                })
            );
        });

        it('should default to DAILY type', async () => {
            await backupService.createBackup();

            expect(mockModels.BackupJob.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    job_type: 'daily'
                })
            );
        });

        it('should default to FULL level', async () => {
            await backupService.createBackup(BACKUP_TYPES.DAILY);

            expect(mockModels.BackupJob.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    backup_level: 'full'
                })
            );
        });

        it('should return backup result on success', async () => {
            const result = await backupService.createBackup(BACKUP_TYPES.MANUAL);

            expect(result).toHaveProperty('success', true);
            expect(result).toHaveProperty('jobId');
            expect(result).toHaveProperty('backupId');
            expect(result).toHaveProperty('size');
            expect(result).toHaveProperty('files');
            expect(result).toHaveProperty('duration');
            expect(result).toHaveProperty('location');
            expect(result).toHaveProperty('checksums');
        });

        it('should handle backup failure gracefully', async () => {
            const mockJob = {
                job_id: 'test-job-id',
                update: jest.fn().mockResolvedValue(true)
            };
            mockModels.BackupJob.create.mockResolvedValue(mockJob);

            const fs = require('fs').promises;
            fs.mkdir.mockRejectedValueOnce(new Error('Permission denied'));

            await expect(backupService.createBackup()).rejects.toThrow();
            expect(mockJob.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'failed'
                })
            );
        });
    });

    describe('Validate Backup', () => {
        it('should validate existing backup file', async () => {
            const mockJob = {
                backup_location: '/backups/test.tar.gz'
            };

            const validation = await backupService._validateBackup(mockJob);

            expect(validation.valid).toBe(true);
            expect(validation.checks).toContainEqual(
                expect.objectContaining({ name: 'file_exists', status: 'ok' })
            );
        });

        it('should fail validation for missing file', async () => {
            const fs = require('fs').promises;
            fs.access.mockRejectedValueOnce(new Error('ENOENT'));

            const mockJob = {
                backup_location: '/backups/missing.tar.gz'
            };

            const validation = await backupService._validateBackup(mockJob);

            expect(validation.valid).toBe(false);
            expect(validation.checks).toContainEqual(
                expect.objectContaining({ name: 'file_exists', status: 'failed' })
            );
        });
    });

    describe('Restore', () => {
        it('should reject restore for non-existent backup', async () => {
            mockModels.BackupJob.findByPk.mockResolvedValue(null);

            await expect(
                backupService.restore('non-existent-id', 1)
            ).rejects.toThrow('Backup non trouvé ou incomplet');
        });

        it('should reject restore for incomplete backup', async () => {
            mockModels.BackupJob.findByPk.mockResolvedValue({
                job_id: 'test-id',
                status: 'running'
            });

            await expect(
                backupService.restore('test-id', 1)
            ).rejects.toThrow('Backup non trouvé ou incomplet');
        });

        it('should create restore operation on validate-only', async () => {
            const mockJob = {
                job_id: 'test-id',
                status: 'completed',
                backup_location: '/backups/test.tar.gz',
                files: []
            };
            mockModels.BackupJob.findByPk.mockResolvedValue(mockJob);

            const mockRestore = {
                restore_id: 'restore-id',
                update: jest.fn().mockResolvedValue(true)
            };
            mockModels.RestoreOperation.create.mockResolvedValue(mockRestore);

            const result = await backupService.restore('test-id', 1, { validateOnly: true });

            expect(mockModels.RestoreOperation.create).toHaveBeenCalled();
            expect(result).toHaveProperty('validation');
        });
    });

    describe('Cleanup Expired Backups', () => {
        it('should delete expired backups', async () => {
            const expiredJobs = [
                {
                    job_id: 'expired-1',
                    backup_location: '/backups/expired1.tar.gz',
                    update: jest.fn().mockResolvedValue(true)
                },
                {
                    job_id: 'expired-2',
                    backup_location: '/backups/expired2.tar.gz',
                    update: jest.fn().mockResolvedValue(true)
                }
            ];
            mockModels.BackupJob.findAll.mockResolvedValue(expiredJobs);
            mockModels.BackupFile.destroy.mockResolvedValue(1);

            const result = await backupService.cleanupExpiredBackups();

            expect(result.deleted).toBe(2);
            expect(mockModels.BackupFile.destroy).toHaveBeenCalledTimes(2);
        });

        it('should handle cleanup errors gracefully', async () => {
            const expiredJobs = [
                {
                    job_id: 'expired-1',
                    backup_location: '/backups/expired1.tar.gz',
                    update: jest.fn().mockResolvedValue(true)
                }
            ];
            mockModels.BackupJob.findAll.mockResolvedValue(expiredJobs);

            const fs = require('fs').promises;
            fs.stat.mockRejectedValueOnce(new Error('File not found'));

            // Should not throw
            const result = await backupService.cleanupExpiredBackups();
            expect(result.deleted).toBe(0);
        });
    });

    describe('List Backups', () => {
        it('should list backups with pagination', async () => {
            mockModels.BackupJob.findAndCountAll.mockResolvedValue({
                count: 50,
                rows: [{ job_id: '1' }, { job_id: '2' }]
            });

            const result = await backupService.list({ page: 1, limit: 20 });

            expect(result.backups).toHaveLength(2);
            expect(result.pagination.total).toBe(50);
            expect(result.pagination.page).toBe(1);
            expect(result.pagination.limit).toBe(20);
            expect(result.pagination.totalPages).toBe(3);
        });

        it('should filter by type', async () => {
            await backupService.list({ type: 'weekly' });

            expect(mockModels.BackupJob.findAndCountAll).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ job_type: 'weekly' })
                })
            );
        });

        it('should limit max results to 100', async () => {
            await backupService.list({ limit: 200 });

            expect(mockModels.BackupJob.findAndCountAll).toHaveBeenCalledWith(
                expect.objectContaining({
                    limit: 100
                })
            );
        });
    });

    describe('Get Statistics', () => {
        it('should return backup statistics', async () => {
            mockSequelize.query.mockResolvedValue([[
                { job_type: 'daily', count: 30, total_size: 30720000, avg_size: 1024000, last_backup: new Date() },
                { job_type: 'weekly', count: 12, total_size: 122880000, avg_size: 10240000, last_backup: new Date() }
            ]]);

            const stats = await backupService.getStats();

            expect(stats).toHaveProperty('byType');
            expect(stats).toHaveProperty('totalSize');
            expect(stats).toHaveProperty('totalSizeMB');
            expect(stats.byType).toHaveLength(2);
        });
    });

    describe('Verify All Backups', () => {
        it('should verify recent backups', async () => {
            const mockJobs = [
                {
                    job_id: 'job-1',
                    backup_location: '/backups/job1.tar.gz',
                    update: jest.fn().mockResolvedValue(true)
                },
                {
                    job_id: 'job-2',
                    backup_location: '/backups/job2.tar.gz',
                    update: jest.fn().mockResolvedValue(true)
                }
            ];
            mockModels.BackupJob.findAll.mockResolvedValue(mockJobs);

            const results = await backupService.verifyAllBackups();

            expect(results).toHaveLength(2);
            expect(mockJobs[0].update).toHaveBeenCalledWith({ verification_status: 'verified' });
            expect(mockJobs[1].update).toHaveBeenCalledWith({ verification_status: 'verified' });
        });
    });

    describe('File Encryption', () => {
        it('should encrypt files using AES-256-GCM', async () => {
            const crypto = require('../../src/utils/crypto');

            const encryptedPath = await backupService._encryptFile('/test/file.txt');

            expect(crypto.encryptToBuffer).toHaveBeenCalled();
            expect(encryptedPath).toBe('/test/file.txt.enc');
        });

        it('should decrypt files correctly', async () => {
            const crypto = require('../../src/utils/crypto');

            const decryptedPath = await backupService._decryptFile('/test/file.txt.enc');

            expect(crypto.decryptFromBuffer).toHaveBeenCalled();
            expect(decryptedPath).toBe('/test/file.txt');
        });
    });

    describe('Vault Export', () => {
        it('should export vault data', async () => {
            mockModels.AesKeyRotation.findAll.mockResolvedValue([
                { toJSON: () => ({ key_id: 'key-1', is_active: true }) }
            ]);
            mockModels.SharedSecret.findAll.mockResolvedValue([
                { toJSON: () => ({ secret_id: 'secret-1', is_active: true }) }
            ]);
            mockModels.VaultItem.findAll.mockResolvedValue([
                {
                    item_id: 'item-1',
                    item_type: 'password',
                    item_name: 'test',
                    item_data_encrypted: Buffer.from('encrypted')
                }
            ]);

            const vaultData = await backupService._exportVaultData();

            expect(vaultData).toHaveProperty('exportedAt');
            expect(vaultData).toHaveProperty('keys');
            expect(vaultData).toHaveProperty('secrets');
            expect(vaultData).toHaveProperty('items');
            expect(vaultData.keys).toHaveLength(1);
            expect(vaultData.secrets).toHaveLength(1);
            expect(vaultData.items).toHaveLength(1);
        });
    });
});

describe('BackupError', () => {
    const { BackupError } = require('../../src/services/BackupService');

    it('should create error with code and message', () => {
        const error = new BackupError('BACKUP_FAILED', 'Test error');

        expect(error.name).toBe('BackupError');
        expect(error.code).toBe('BACKUP_FAILED');
        expect(error.message).toBe('Test error');
    });

    it('should be an instance of Error', () => {
        const error = new BackupError('TEST', 'message');
        expect(error instanceof Error).toBe(true);
    });
});
