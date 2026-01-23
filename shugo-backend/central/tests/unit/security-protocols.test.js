/**
 * Tests unitaires pour les Protocoles de Sécurité SHUGO
 *
 * Couvre les protocoles:
 * - DataIntegrityManager (Système d'Intégrité - SYS-INT)
 * - CendreBlanche (Suppression Définitive)
 * - GuiltySparkService (Verrouillage d'Urgence)
 * - PorteDeGrange (Isolation Réseau)
 *
 * @see Document Technique V7.0 - Chapitre 8
 */

'use strict';

// Mock config
jest.mock('../../src/config', () => ({
    security: { encryptionKey: '0'.repeat(64) }
}));

// ============================================
// TESTS DATA INTEGRITY MANAGER (SYS-INT)
// ============================================
describe('DataIntegrityManager', () => {
    const DataIntegrityManager = require('../../src/core/integrity/DataIntegrityManager');

    let integrityManager;
    let mockModels;
    let mockSequelize;

    beforeAll(() => {
        mockModels = {
            SecurityProtocolLog: {
                create: jest.fn()
            },
            LocalInstance: {
                update: jest.fn().mockResolvedValue([1]),
                findAll: jest.fn().mockResolvedValue([])
            },
            Session: {
                update: jest.fn().mockResolvedValue([5])
            },
            RegistrationToken: {
                update: jest.fn().mockResolvedValue([3])
            },
            User: {
                findByPk: jest.fn(),
                findAll: jest.fn().mockResolvedValue([])
            }
        };
        mockSequelize = {};
    });

    beforeEach(() => {
        jest.clearAllMocks();
        integrityManager = new DataIntegrityManager(mockModels, mockSequelize);
        delete global.SHUGO_READ_ONLY;
        delete global.SHUGO_MAINTENANCE_MODE;
    });

    describe('Initialization', () => {
        it('should initialize in passive mode', async () => {
            const mockProtocolLog = {
                protocol_log_id: 'log-1',
                update: jest.fn().mockResolvedValue(true)
            };
            mockModels.SecurityProtocolLog.create.mockResolvedValue(mockProtocolLog);

            const result = await integrityManager.initialize();

            expect(result.status).toBe('initialized');
            expect(result.mode).toBe('passive');
        });
    });

    describe('Status', () => {
        it('should return current status', () => {
            const status = integrityManager.getStatus();

            expect(status).toHaveProperty('mode');
            expect(status).toHaveProperty('metrics');
            expect(status).toHaveProperty('isolated_count');
        });
    });

    describe('Level Activation', () => {
        beforeEach(() => {
            const mockProtocolLog = {
                protocol_log_id: 'log-1',
                update: jest.fn().mockResolvedValue(true)
            };
            mockModels.SecurityProtocolLog.create.mockResolvedValue(mockProtocolLog);
        });

        it('should activate level 1 (passive surveillance)', async () => {
            const result = await integrityManager.activateLevel(1);

            expect(result.activated).toBe(true);
            expect(result.mode).toBe('active');
            expect(global.SHUGO_READ_ONLY).toBe(true);
        });

        it('should activate level 2 with admin rights', async () => {
            mockModels.User.findByPk.mockResolvedValue({ role: 'Admin_N1' });

            const result = await integrityManager.activateLevel(2, {
                adminId: 1,
                password: 'pw',
                totpCode: '123456'
            });

            expect(result.activated).toBe(true);
        });

        it('should reject level 2 without admin rights', async () => {
            mockModels.User.findByPk.mockResolvedValue({ role: 'Silver' });

            await expect(
                integrityManager.activateLevel(2, { adminId: 1 })
            ).rejects.toThrow();
        });

        it('should activate level 3 (recovery) with token', async () => {
            const result = await integrityManager.activateLevel(3, {
                usbToken: 'valid-token',
                originServer: 'srv-1'
            });

            expect(result.activated).toBe(true);
        });

        it('should reject level 3 without token', async () => {
            await expect(
                integrityManager.activateLevel(3, {})
            ).rejects.toThrow();
        });
    });

    describe('Restoration', () => {
        it('should restore to passive mode', async () => {
            // First activate
            const mockProtocolLog = {
                protocol_log_id: 'log-1',
                update: jest.fn().mockResolvedValue(true)
            };
            mockModels.SecurityProtocolLog.create.mockResolvedValue(mockProtocolLog);
            await integrityManager.activateLevel(1);

            const result = await integrityManager.restore();

            expect(result.restored).toBe(true);
            expect(result.mode).toBe('passive');
            expect(global.SHUGO_READ_ONLY).toBe(false);
        });
    });
});

// ============================================
// TESTS CENDRE BLANCHE SERVICE
// ============================================
describe('CendreBlancheService', () => {
    const CendreBlancheService = require('../../src/services/protocols/CendreBlancheService');
    const { CendreBlancheError, ACTIVATION_CONDITIONS } = CendreBlancheService;

    let cendreBlancheService;
    let mockModels;
    let mockSequelize;
    let mockTransaction;

    beforeAll(() => {
        mockTransaction = {
            commit: jest.fn().mockResolvedValue(undefined),
            rollback: jest.fn().mockResolvedValue(undefined)
        };

        mockModels = {
            SecurityProtocolLog: {
                create: jest.fn()
            },
            Session: {
                update: jest.fn().mockResolvedValue([1]),
                destroy: jest.fn().mockResolvedValue(1)
            },
            GuardAssignment: {
                destroy: jest.fn().mockResolvedValue(1)
            },
            GroupMembership: {
                destroy: jest.fn().mockResolvedValue(1)
            },
            UserMission: {
                destroy: jest.fn().mockResolvedValue(1)
            },
            Notification: {
                destroy: jest.fn().mockResolvedValue(1)
            },
            User: {
                findByPk: jest.fn()
            },
            AuditLog: {
                create: jest.fn().mockResolvedValue({})
            }
        };

        mockSequelize = {
            transaction: jest.fn().mockResolvedValue(mockTransaction)
        };
    });

    beforeEach(() => {
        jest.clearAllMocks();
        cendreBlancheService = new CendreBlancheService(mockModels, mockSequelize);
    });

    describe('Constants', () => {
        it('should export ACTIVATION_CONDITIONS', () => {
            expect(ACTIVATION_CONDITIONS.COMPROMISSION).toBe('compromission');
            expect(ACTIVATION_CONDITIONS.VIOLATION).toBe('violation');
            expect(ACTIVATION_CONDITIONS.USER_REQUEST).toBe('user_request');
            expect(ACTIVATION_CONDITIONS.INACTIVITY).toBe('inactivity');
        });
    });

    describe('Authorization Validation', () => {
        it('should reject if target user not found', async () => {
            mockModels.User.findByPk.mockResolvedValue(null);

            await expect(
                cendreBlancheService.execute(999, 1)
            ).rejects.toThrow('Utilisateur non trouve');
        });

        it('should reject if admin not found', async () => {
            mockModels.User.findByPk
                .mockResolvedValueOnce({ member_id: 2, role: 'Silver' }) // target
                .mockResolvedValueOnce(null); // admin

            await expect(
                cendreBlancheService.execute(2, 1)
            ).rejects.toThrow('Admin non trouve');
        });

        it('should reject Silver deleting Silver without proper role', async () => {
            mockModels.User.findByPk
                .mockResolvedValueOnce({ member_id: 2, role: 'Silver' })
                .mockResolvedValueOnce({ member_id: 1, role: 'Silver' });

            await expect(
                cendreBlancheService.execute(2, 1)
            ).rejects.toThrow('Droits insuffisants');
        });

        it('should reject non-Admin_N1 deleting Platinum', async () => {
            mockModels.User.findByPk
                .mockResolvedValueOnce({ member_id: 2, role: 'Platinum' })
                .mockResolvedValueOnce({ member_id: 1, role: 'Admin' });

            await expect(
                cendreBlancheService.execute(2, 1)
            ).rejects.toThrow('Admin N1 requis pour Platinum');
        });

        it('should require collegial validation for Admin_N1 deletion', async () => {
            mockModels.User.findByPk
                .mockResolvedValueOnce({ member_id: 2, role: 'Admin_N1' })
                .mockResolvedValueOnce({ member_id: 1, role: 'Admin_N1' });

            await expect(
                cendreBlancheService.execute(2, 1)
            ).rejects.toThrow('Validation collegiale requise');
        });

        it('should allow Admin_N1 deletion with force flag', async () => {
            const mockUser = {
                member_id: 2,
                role: 'Admin_N1',
                email_encrypted: Buffer.from('enc'),
                update: jest.fn().mockResolvedValue(true),
                destroy: jest.fn().mockResolvedValue(true)
            };
            mockModels.User.findByPk
                .mockResolvedValueOnce(mockUser)
                .mockResolvedValueOnce({ member_id: 1, role: 'Admin_N1' });

            const mockLog = { protocol_log_id: 'log-1', update: jest.fn().mockResolvedValue(true) };
            mockModels.SecurityProtocolLog.create.mockResolvedValue(mockLog);

            const result = await cendreBlancheService.execute(2, 1, { force: true });

            expect(result.success).toBe(true);
        });
    });

    describe('Execution', () => {
        let mockUser;
        let mockProtocolLog;

        beforeEach(() => {
            mockUser = {
                member_id: 2,
                role: 'Silver',
                geo_id: '02-33-06-01-00',
                email_hash: 'hash123',
                created_at: new Date(),
                update: jest.fn().mockResolvedValue(true),
                destroy: jest.fn().mockResolvedValue(true)
            };
            mockProtocolLog = {
                protocol_log_id: 'log-1',
                update: jest.fn().mockResolvedValue(true)
            };

            mockModels.User.findByPk
                .mockResolvedValueOnce(mockUser)
                .mockResolvedValueOnce({ member_id: 1, role: 'Admin_N1' });
            mockModels.SecurityProtocolLog.create.mockResolvedValue(mockProtocolLog);
        });

        it('should execute all 5 phases successfully', async () => {
            const result = await cendreBlancheService.execute(2, 1);

            expect(result.success).toBe(true);
            expect(result.actions).toHaveLength(5);
            expect(result.actions.map(a => a.phase)).toEqual([1, 2, 3, 4, 5]);
        });

        it('should block user sessions in phase 2', async () => {
            await cendreBlancheService.execute(2, 1);

            expect(mockModels.Session.update).toHaveBeenCalledWith(
                { is_active: false, logout_reason: 'security' },
                expect.objectContaining({ where: { member_id: 2 } })
            );
        });

        it('should delete related data in phase 3', async () => {
            await cendreBlancheService.execute(2, 1);

            expect(mockModels.Session.destroy).toHaveBeenCalled();
            expect(mockModels.GuardAssignment.destroy).toHaveBeenCalled();
            expect(mockModels.GroupMembership.destroy).toHaveBeenCalled();
        });

        it('should perform cryptographic erase in phase 4', async () => {
            await cendreBlancheService.execute(2, 1);

            expect(mockUser.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'deleted',
                    first_name_hash: null,
                    last_name_hash: null
                }),
                expect.any(Object)
            );
        });

        it('should force delete user in phase 5', async () => {
            await cendreBlancheService.execute(2, 1);

            expect(mockUser.destroy).toHaveBeenCalledWith({ transaction: mockTransaction, force: true });
        });

        it('should commit transaction on success', async () => {
            await cendreBlancheService.execute(2, 1);

            expect(mockTransaction.commit).toHaveBeenCalled();
            expect(mockTransaction.rollback).not.toHaveBeenCalled();
        });

        it('should rollback transaction on failure', async () => {
            mockModels.Session.destroy.mockRejectedValueOnce(new Error('DB error'));

            await expect(cendreBlancheService.execute(2, 1)).rejects.toThrow();

            expect(mockTransaction.rollback).toHaveBeenCalled();
        });

        it('should create audit backup', async () => {
            await cendreBlancheService.execute(2, 1);

            expect(mockModels.AuditLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: 'cendre_blanche_backup',
                    resource_type: 'user'
                }),
                expect.any(Object)
            );
        });
    });

    describe('canRecover', () => {
        it('should always return not recoverable', async () => {
            const result = await cendreBlancheService.canRecover(123);

            expect(result.recoverable).toBe(false);
            expect(result.reason).toContain('irreversible');
        });
    });

    describe('CendreBlancheError', () => {
        it('should create error with code', () => {
            const error = new CendreBlancheError('TEST_CODE', 'Test message');

            expect(error.name).toBe('CendreBlancheError');
            expect(error.code).toBe('TEST_CODE');
            expect(error.message).toBe('Test message');
        });
    });
});

// ============================================
// TESTS GUILTY SPARK SERVICE
// ============================================
describe('GuiltySparkService', () => {
    const GuiltySparkService = require('../../src/services/protocols/GuiltySparkService');
    const { GuiltySparkError, LOCKDOWN_LEVELS, TRIGGER_REASONS } = GuiltySparkService;

    let guiltySparkService;
    let mockModels;
    let mockSequelize;

    beforeAll(() => {
        mockModels = {
            SecurityProtocolLog: {
                create: jest.fn()
            },
            Session: {
                update: jest.fn().mockResolvedValue([10])
            },
            RegistrationToken: {
                update: jest.fn().mockResolvedValue([5])
            },
            SharedSecret: {
                update: jest.fn().mockResolvedValue([3])
            },
            User: {
                findByPk: jest.fn(),
                findAll: jest.fn().mockResolvedValue([])
            },
            AuditLog: {
                create: jest.fn().mockResolvedValue({})
            }
        };

        mockSequelize = {
            literal: jest.fn(str => str)
        };
    });

    beforeEach(() => {
        jest.clearAllMocks();
        guiltySparkService = new GuiltySparkService(mockModels, mockSequelize);
        delete global.SHUGO_LOGIN_BLOCKED;
        delete global.SHUGO_API_BLOCKED;
        delete global.SHUGO_MAINTENANCE_MODE;
    });

    describe('Constants', () => {
        it('should export LOCKDOWN_LEVELS', () => {
            expect(LOCKDOWN_LEVELS.PARTIAL).toBe('partial');
            expect(LOCKDOWN_LEVELS.FULL).toBe('full');
            expect(LOCKDOWN_LEVELS.EMERGENCY).toBe('emergency');
        });

        it('should export TRIGGER_REASONS', () => {
            expect(TRIGGER_REASONS.INTRUSION_ATTEMPT).toBe('intrusion_attempt');
            expect(TRIGGER_REASONS.BRUTE_FORCE).toBe('brute_force');
            expect(TRIGGER_REASONS.ADMIN_REQUEST).toBe('admin_request');
        });
    });

    describe('getStatus', () => {
        it('should return inactive status initially', () => {
            const status = guiltySparkService.getStatus();

            expect(status.isActive).toBe(false);
            expect(status.level).toBeNull();
            expect(status.startedAt).toBeNull();
        });
    });

    describe('Partial Lockdown', () => {
        beforeEach(() => {
            const mockProtocolLog = {
                protocol_log_id: 'log-1',
                started_at: new Date(),
                update: jest.fn().mockResolvedValue(true)
            };
            mockModels.SecurityProtocolLog.create.mockResolvedValue(mockProtocolLog);
        });

        it('should activate partial lockdown', async () => {
            const result = await guiltySparkService.activatePartialLockdown({
                reason: TRIGGER_REASONS.ANOMALY_DETECTED
            });

            expect(result.success).toBe(true);
            expect(result.level).toBe(LOCKDOWN_LEVELS.PARTIAL);
            expect(global.SHUGO_LOGIN_BLOCKED).toBe(true);
        });

        it('should revoke registration tokens', async () => {
            await guiltySparkService.activatePartialLockdown({});

            expect(mockModels.RegistrationToken.update).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'revoked' }),
                expect.any(Object)
            );
        });

        it('should update service state', async () => {
            await guiltySparkService.activatePartialLockdown({});

            const status = guiltySparkService.getStatus();
            expect(status.isActive).toBe(true);
            expect(status.level).toBe(LOCKDOWN_LEVELS.PARTIAL);
            expect(status.startedAt).toBeInstanceOf(Date);
        });
    });

    describe('Full Lockdown', () => {
        beforeEach(() => {
            const mockProtocolLog = {
                protocol_log_id: 'log-2',
                started_at: new Date(),
                update: jest.fn().mockResolvedValue(true)
            };
            mockModels.SecurityProtocolLog.create.mockResolvedValue(mockProtocolLog);
            mockModels.User.findByPk.mockResolvedValue({ role: 'Admin_N1' });
        });

        it('should require Admin N1 role', async () => {
            mockModels.User.findByPk.mockResolvedValue({ role: 'Gold' });

            await expect(
                guiltySparkService.activateFullLockdown(1)
            ).rejects.toThrow('Droits Admin N1 requis');
        });

        it('should block all access', async () => {
            await guiltySparkService.activateFullLockdown(1);

            expect(global.SHUGO_LOGIN_BLOCKED).toBe(true);
            expect(global.SHUGO_API_BLOCKED).toBe(true);
        });

        it('should terminate non-admin sessions', async () => {
            await guiltySparkService.activateFullLockdown(1);

            expect(mockModels.Session.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    is_active: false,
                    logout_reason: 'guilty_spark_full_lockdown'
                }),
                expect.any(Object)
            );
        });

        it('should return sessions terminated count', async () => {
            mockModels.Session.update.mockResolvedValue([15]);

            const result = await guiltySparkService.activateFullLockdown(1);

            expect(result.sessionsTerminated).toBe(15);
        });
    });

    describe('Emergency Lockdown', () => {
        beforeEach(() => {
            const mockProtocolLog = {
                protocol_log_id: 'log-3',
                started_at: new Date(),
                update: jest.fn().mockResolvedValue(true)
            };
            mockModels.SecurityProtocolLog.create.mockResolvedValue(mockProtocolLog);
            mockModels.User.findByPk.mockResolvedValue({ role: 'Admin_N1' });
        });

        it('should require credentials', async () => {
            await expect(
                guiltySparkService.activateEmergencyLockdown(1, {})
            ).rejects.toThrow('Authentification incomplète');
        });

        it('should activate maintenance mode', async () => {
            await guiltySparkService.activateEmergencyLockdown(1, {
                password: 'pw',
                totpCode: '123456'
            });

            expect(global.SHUGO_MAINTENANCE_MODE).toBe(true);
        });

        it('should terminate ALL sessions including admins', async () => {
            await guiltySparkService.activateEmergencyLockdown(1, {
                password: 'pw',
                totpCode: '123456'
            });

            // Should not have the NOT IN admins clause
            expect(mockModels.Session.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    logout_reason: 'guilty_spark_emergency'
                }),
                expect.objectContaining({
                    where: { is_active: true }
                })
            );
        });

        it('should rotate keys if vaultService available', async () => {
            const mockVault = {
                rotateKey: jest.fn().mockResolvedValue({})
            };
            const serviceWithVault = new GuiltySparkService(mockModels, mockSequelize, { vault: mockVault });

            await serviceWithVault.activateEmergencyLockdown(1, {
                password: 'pw',
                totpCode: '123456'
            });

            expect(mockVault.rotateKey).toHaveBeenCalledTimes(4); // 4 key types
        });

        it('should invalidate shared secrets', async () => {
            await guiltySparkService.activateEmergencyLockdown(1, {
                password: 'pw',
                totpCode: '123456'
            });

            expect(mockModels.SharedSecret.update).toHaveBeenCalledWith(
                { is_active: false },
                { where: { is_active: true } }
            );
        });

        it('should indicate follow-up required', async () => {
            const result = await guiltySparkService.activateEmergencyLockdown(1, {
                password: 'pw',
                totpCode: '123456'
            });

            expect(result.requiresFollowUp).toBe(true);
        });
    });

    describe('Deactivate', () => {
        beforeEach(() => {
            const mockProtocolLog = {
                protocol_log_id: 'log-4',
                update: jest.fn().mockResolvedValue(true)
            };
            mockModels.SecurityProtocolLog.create.mockResolvedValue(mockProtocolLog);
            mockModels.User.findByPk.mockResolvedValue({ role: 'Admin_N1' });
        });

        it('should return success if no lockdown active', async () => {
            const result = await guiltySparkService.deactivate(1, {
                password: 'pw',
                totpCode: '123456'
            });

            expect(result.success).toBe(true);
            expect(result.message).toContain('Aucun verrouillage actif');
        });

        it('should deactivate active lockdown', async () => {
            // First activate
            guiltySparkService._isActive = true;
            guiltySparkService._currentLevel = LOCKDOWN_LEVELS.FULL;
            guiltySparkService._lockdownStartedAt = new Date(Date.now() - 60000);
            global.SHUGO_LOGIN_BLOCKED = true;
            global.SHUGO_API_BLOCKED = true;

            const result = await guiltySparkService.deactivate(1, {
                password: 'pw',
                totpCode: '123456'
            });

            expect(result.success).toBe(true);
            expect(result.previousLevel).toBe(LOCKDOWN_LEVELS.FULL);
            expect(result.lockdownDuration).toBeGreaterThan(0);
            expect(global.SHUGO_LOGIN_BLOCKED).toBe(false);
            expect(global.SHUGO_API_BLOCKED).toBe(false);
        });
    });

    describe('GuiltySparkError', () => {
        it('should create error with code', () => {
            const error = new GuiltySparkError('LOCKDOWN_FAILED', 'Test message');

            expect(error.name).toBe('GuiltySparkError');
            expect(error.code).toBe('LOCKDOWN_FAILED');
            expect(error.message).toBe('Test message');
        });
    });
});

// ============================================
// TESTS PORTE DE GRANGE SERVICE
// ============================================
describe('PorteDeGrangeService', () => {
    const PorteDeGrangeService = require('../../src/services/protocols/PorteDeGrangeService');
    const { PorteDeGrangeError, ISOLATION_STATUS } = PorteDeGrangeService;

    let porteDeGrangeService;
    let mockModels;
    let mockSequelize;

    beforeAll(() => {
        mockModels = {
            SecurityProtocolLog: {
                create: jest.fn()
            },
            LocalInstance: {
                findOne: jest.fn(),
                findAll: jest.fn(),
                update: jest.fn().mockResolvedValue([1])
            },
            Session: {
                update: jest.fn().mockResolvedValue([5])
            },
            User: {
                findAll: jest.fn().mockResolvedValue([])
            },
            AuditLog: {
                create: jest.fn().mockResolvedValue({})
            }
        };
        mockSequelize = {};
    });

    beforeEach(() => {
        jest.clearAllMocks();
        porteDeGrangeService = new PorteDeGrangeService(mockModels, mockSequelize);
        // Clean up global variables
        for (const key of Object.keys(global)) {
            if (key.startsWith('SHUGO_SERVER_ISOLATED_')) {
                delete global[key];
            }
        }
    });

    describe('Constants', () => {
        it('should export ISOLATION_STATUS', () => {
            expect(ISOLATION_STATUS.ACTIVE).toBe('active');
            expect(ISOLATION_STATUS.ISOLATED).toBe('isolated');
            expect(ISOLATION_STATUS.MAINTENANCE).toBe('maintenance');
            expect(ISOLATION_STATUS.RECONNECTING).toBe('reconnecting');
        });
    });

    describe('isolateServer', () => {
        beforeEach(() => {
            const mockServer = {
                server_id: 'srv-1',
                update: jest.fn().mockResolvedValue(true)
            };
            mockModels.LocalInstance.findOne.mockResolvedValue(mockServer);

            const mockProtocolLog = {
                protocol_log_id: 'log-1',
                update: jest.fn().mockResolvedValue(true)
            };
            mockModels.SecurityProtocolLog.create.mockResolvedValue(mockProtocolLog);
        });

        it('should reject if server not found', async () => {
            mockModels.LocalInstance.findOne.mockResolvedValue(null);

            await expect(
                porteDeGrangeService.isolateServer('unknown', 1)
            ).rejects.toThrow('Serveur non trouvé');
        });

        it('should isolate server successfully', async () => {
            const result = await porteDeGrangeService.isolateServer('srv-1', 1);

            expect(result.success).toBe(true);
            expect(result.serverId).toBe('srv-1');
            expect(result.status).toBe(ISOLATION_STATUS.ISOLATED);
        });

        it('should disconnect users by default', async () => {
            await porteDeGrangeService.isolateServer('srv-1', 1);

            expect(mockModels.Session.update).toHaveBeenCalledWith(
                { is_active: false, logout_reason: 'maintenance' },
                expect.any(Object)
            );
        });

        it('should skip user disconnection if option is false', async () => {
            await porteDeGrangeService.isolateServer('srv-1', 1, { disconnectUsers: false });

            expect(mockModels.Session.update).not.toHaveBeenCalled();
        });

        it('should set global isolation flag', async () => {
            await porteDeGrangeService.isolateServer('srv-1', 1);

            expect(global['SHUGO_SERVER_ISOLATED_srv-1']).toBe(true);
        });

        it('should track isolated server internally', async () => {
            await porteDeGrangeService.isolateServer('srv-1', 1, { reason: 'Test isolation' });

            const isolated = porteDeGrangeService.getIsolatedServers();
            expect(isolated).toHaveLength(1);
            expect(isolated[0].serverId).toBe('srv-1');
            expect(isolated[0].reason).toBe('Test isolation');
        });

        it('should create audit log', async () => {
            await porteDeGrangeService.isolateServer('srv-1', 1);

            expect(mockModels.AuditLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: 'server_isolated',
                    resource_type: 'server',
                    resource_id: 'srv-1'
                })
            );
        });
    });

    describe('isolateMultiple', () => {
        it('should isolate multiple servers', async () => {
            const mockServer = {
                server_id: 'srv-1',
                update: jest.fn().mockResolvedValue(true)
            };
            mockModels.LocalInstance.findOne.mockResolvedValue(mockServer);

            const mockProtocolLog = {
                protocol_log_id: 'log-1',
                update: jest.fn().mockResolvedValue(true)
            };
            mockModels.SecurityProtocolLog.create.mockResolvedValue(mockProtocolLog);

            const result = await porteDeGrangeService.isolateMultiple(['srv-1', 'srv-2'], 1);

            expect(result.totalRequested).toBe(2);
            expect(result.isolated).toBe(2);
        });

        it('should handle partial failures', async () => {
            mockModels.LocalInstance.findOne
                .mockResolvedValueOnce({ server_id: 'srv-1', update: jest.fn() })
                .mockResolvedValueOnce(null); // srv-2 not found

            const mockProtocolLog = {
                protocol_log_id: 'log-1',
                update: jest.fn().mockResolvedValue(true)
            };
            mockModels.SecurityProtocolLog.create.mockResolvedValue(mockProtocolLog);

            const result = await porteDeGrangeService.isolateMultiple(['srv-1', 'srv-2'], 1);

            expect(result.totalRequested).toBe(2);
            expect(result.isolated).toBe(1);
            expect(result.results[1].success).toBe(false);
        });
    });

    describe('reconnectServer', () => {
        it('should reject if server not found', async () => {
            mockModels.LocalInstance.findOne.mockResolvedValue(null);

            await expect(
                porteDeGrangeService.reconnectServer('unknown', 1)
            ).rejects.toThrow('Serveur non trouvé');
        });

        it('should reject if server not isolated', async () => {
            mockModels.LocalInstance.findOne.mockResolvedValue({
                server_id: 'srv-1',
                status: ISOLATION_STATUS.ACTIVE
            });

            await expect(
                porteDeGrangeService.reconnectServer('srv-1', 1)
            ).rejects.toThrow('n\'est pas isolé');
        });

        it('should reconnect isolated server', async () => {
            const mockServer = {
                server_id: 'srv-1',
                status: ISOLATION_STATUS.ISOLATED,
                update: jest.fn().mockResolvedValue(true)
            };
            mockModels.LocalInstance.findOne.mockResolvedValue(mockServer);

            // Pre-isolate
            porteDeGrangeService._isolatedServers.set('srv-1', { isolatedAt: new Date() });
            global['SHUGO_SERVER_ISOLATED_srv-1'] = true;

            const result = await porteDeGrangeService.reconnectServer('srv-1', 1);

            expect(result.success).toBe(true);
            expect(result.status).toBe(ISOLATION_STATUS.ACTIVE);
            expect(global['SHUGO_SERVER_ISOLATED_srv-1']).toBeUndefined();
        });

        it('should go through RECONNECTING state', async () => {
            const mockServer = {
                server_id: 'srv-1',
                status: ISOLATION_STATUS.ISOLATED,
                update: jest.fn().mockResolvedValue(true)
            };
            mockModels.LocalInstance.findOne.mockResolvedValue(mockServer);

            await porteDeGrangeService.reconnectServer('srv-1', 1);

            // First call should be RECONNECTING, second should be ACTIVE
            expect(mockServer.update).toHaveBeenCalledWith({ status: ISOLATION_STATUS.RECONNECTING });
            expect(mockServer.update).toHaveBeenCalledWith({ status: ISOLATION_STATUS.ACTIVE, last_seen: expect.any(Date) });
        });
    });

    describe('isIsolated', () => {
        it('should return true for tracked isolated server', () => {
            porteDeGrangeService._isolatedServers.set('srv-1', { isolatedAt: new Date() });

            expect(porteDeGrangeService.isIsolated('srv-1')).toBe(true);
        });

        it('should return true for global flag isolated server', () => {
            global['SHUGO_SERVER_ISOLATED_srv-2'] = true;

            expect(porteDeGrangeService.isIsolated('srv-2')).toBe(true);
        });

        it('should return false for non-isolated server', () => {
            expect(porteDeGrangeService.isIsolated('srv-3')).toBe(false);
        });
    });

    describe('getStatus', () => {
        it('should return isolated servers from database', async () => {
            mockModels.LocalInstance.findAll.mockResolvedValue([
                { server_id: 'srv-1', geo_id: '02-33-06-01-00' },
                { server_id: 'srv-2', geo_id: '02-33-06-02-00' }
            ]);

            const status = await porteDeGrangeService.getStatus();

            expect(status.isolatedCount).toBe(2);
            expect(status.servers).toHaveLength(2);
        });
    });

    describe('PorteDeGrangeError', () => {
        it('should create error with code', () => {
            const error = new PorteDeGrangeError('ISOLATION_FAILED', 'Test message');

            expect(error.name).toBe('PorteDeGrangeError');
            expect(error.code).toBe('ISOLATION_FAILED');
            expect(error.message).toBe('Test message');
        });
    });
});
