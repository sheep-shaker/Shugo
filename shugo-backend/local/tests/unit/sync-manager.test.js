/**
 * SHUGO Local - Tests unitaires SyncManager
 */

const crypto = require('crypto');
const EventEmitter = require('events');

// Mock axios
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() }
    }
  }))
}));

// Mock p-queue
jest.mock('p-queue', () => ({
  default: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    start: jest.fn(),
    pause: jest.fn(),
    clear: jest.fn(),
    size: 0,
    isPaused: false
  }))
}));

// Mock models
jest.mock('../../src/models', () => ({
  LocalChange: {
    findAll: jest.fn().mockResolvedValue([]),
    update: jest.fn()
  },
  LocalUser: {
    count: jest.fn().mockResolvedValue(10),
    upsert: jest.fn(),
    destroy: jest.fn()
  },
  LocalGuard: {
    count: jest.fn().mockResolvedValue(5),
    upsert: jest.fn(),
    destroy: jest.fn()
  },
  LocalGroup: {
    upsert: jest.fn(),
    destroy: jest.fn()
  },
  LocalAssignment: {
    upsert: jest.fn(),
    destroy: jest.fn()
  },
  SyncQueue: {
    findAll: jest.fn().mockResolvedValue([]),
    upsert: jest.fn(),
    destroy: jest.fn()
  },
  DeadLetter: {
    create: jest.fn()
  }
}));

// Mock logger
jest.mock('../../src/utils/logger');

const axios = require('axios');
const SyncManager = require('../../src/sync/SyncManager');

describe('SyncManager', () => {
  let syncManager;
  let mockConfig;
  let mockEventBus;
  let mockApi;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfig = {
      centralUrl: 'http://central.test.com',
      serverId: 'test-server-001',
      geoId: 'FR-075-01-01-01',
      sharedSecret: 'test-secret-32-bytes-long-string',
      heartbeatInterval: 60000,
      interval: 300000,
      mode: 'auto',
      timeout: 10000,
      retryAttempts: 3,
      retryDelay: 1000,
      batchSize: 100,
      queueConcurrency: 2,
      priorities: {
        users: 1,
        guards: 2,
        groups: 3,
        assignments: 4
      }
    };

    mockEventBus = new EventEmitter();

    mockApi = {
      get: jest.fn(),
      post: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() }
      }
    };

    axios.create.mockReturnValue(mockApi);

    syncManager = new SyncManager(mockConfig, mockEventBus);
  });

  describe('Constructor', () => {
    test('should initialize with correct config', () => {
      expect(syncManager.config).toBe(mockConfig);
      expect(syncManager.eventBus).toBe(mockEventBus);
      expect(syncManager.isOnline).toBe(false);
      expect(syncManager.isSyncing).toBe(false);
      expect(syncManager.lastSyncTime).toBeNull();
    });

    test('should create axios client with correct baseURL', () => {
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: mockConfig.centralUrl,
          timeout: mockConfig.timeout,
          headers: {
            'X-Server-ID': mockConfig.serverId,
            'X-Geo-ID': mockConfig.geoId
          }
        })
      );
    });

    test('should setup interceptors', () => {
      expect(mockApi.interceptors.request.use).toHaveBeenCalled();
      expect(mockApi.interceptors.response.use).toHaveBeenCalled();
    });

    test('should initialize stats', () => {
      expect(syncManager.stats).toEqual({
        successful: 0,
        failed: 0,
        pending: 0,
        lastError: null
      });
    });
  });

  describe('generateSignature', () => {
    test('should generate valid HMAC signature', () => {
      const config = {
        method: 'POST',
        url: '/sync/heartbeat',
        headers: { 'X-Timestamp': '2024-01-01T00:00:00.000Z' },
        data: { test: 'data' }
      };

      const signature = syncManager.generateSignature(config);

      expect(typeof signature).toBe('string');
      expect(signature.length).toBe(64); // SHA256 hex
    });

    test('should produce consistent signatures', () => {
      const config = {
        method: 'GET',
        url: '/health',
        headers: { 'X-Timestamp': '2024-01-01T00:00:00.000Z' },
        data: null
      };

      const sig1 = syncManager.generateSignature(config);
      const sig2 = syncManager.generateSignature(config);

      expect(sig1).toBe(sig2);
    });

    test('should produce different signatures for different data', () => {
      const config1 = {
        method: 'POST',
        url: '/sync',
        headers: { 'X-Timestamp': '2024-01-01T00:00:00.000Z' },
        data: { id: 1 }
      };

      const config2 = {
        method: 'POST',
        url: '/sync',
        headers: { 'X-Timestamp': '2024-01-01T00:00:00.000Z' },
        data: { id: 2 }
      };

      const sig1 = syncManager.generateSignature(config1);
      const sig2 = syncManager.generateSignature(config2);

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('checkConnectivity', () => {
    test('should set online when health check succeeds', async () => {
      mockApi.get.mockResolvedValue({ status: 200, data: { status: 'ok' } });

      const result = await syncManager.checkConnectivity();

      expect(result).toBe(true);
      expect(syncManager.isOnline).toBe(true);
      expect(mockApi.get).toHaveBeenCalledWith('/health');
    });

    test('should set offline when health check fails', async () => {
      mockApi.get.mockRejectedValue(new Error('Connection refused'));

      const result = await syncManager.checkConnectivity();

      expect(result).toBe(false);
      expect(syncManager.isOnline).toBe(false);
    });
  });

  describe('setOnline/setOffline', () => {
    test('should emit sync.online event when going online', () => {
      const onlineSpy = jest.fn();
      mockEventBus.on('sync.online', onlineSpy);

      syncManager.setOnline();

      expect(syncManager.isOnline).toBe(true);
      expect(onlineSpy).toHaveBeenCalled();
    });

    test('should not emit event if already online', () => {
      syncManager.isOnline = true;
      const onlineSpy = jest.fn();
      mockEventBus.on('sync.online', onlineSpy);

      syncManager.setOnline();

      expect(onlineSpy).not.toHaveBeenCalled();
    });

    test('should emit sync.offline event when going offline', () => {
      syncManager.isOnline = true;
      const offlineSpy = jest.fn();
      mockEventBus.on('sync.offline', offlineSpy);

      syncManager.setOffline();

      expect(syncManager.isOnline).toBe(false);
      expect(offlineSpy).toHaveBeenCalled();
    });
  });

  describe('performSync', () => {
    test('should not sync if already syncing', async () => {
      syncManager.isSyncing = true;

      await syncManager.performSync();

      expect(mockApi.get).not.toHaveBeenCalled();
    });

    test('should emit sync.started event', async () => {
      const startedSpy = jest.fn();
      mockEventBus.on('sync.started', startedSpy);
      mockApi.get.mockResolvedValue({ data: {} });

      await syncManager.performSync();

      expect(startedSpy).toHaveBeenCalled();
    });

    test('should emit sync.completed on success', async () => {
      const completedSpy = jest.fn();
      mockEventBus.on('sync.completed', completedSpy);

      // Mock pullChanges and pushChanges to avoid real API calls
      syncManager.pullChanges = jest.fn().mockResolvedValue({});
      syncManager.pushChanges = jest.fn().mockResolvedValue(0);
      syncManager.processQueue = jest.fn().mockResolvedValue(undefined);

      await syncManager.performSync();

      expect(completedSpy).toHaveBeenCalled();
      expect(syncManager.stats.successful).toBe(1);
    });

    test('should emit sync.failed on error', async () => {
      const failedSpy = jest.fn();
      mockEventBus.on('sync.failed', failedSpy);
      mockApi.get.mockRejectedValue(new Error('Sync failed'));

      await syncManager.performSync();

      expect(failedSpy).toHaveBeenCalled();
      expect(syncManager.stats.failed).toBe(1);
      expect(syncManager.stats.lastError).toBe('Pull failed: Sync failed');
    });

    test('should set isSyncing to false after completion', async () => {
      mockApi.get.mockResolvedValue({ data: {} });

      await syncManager.performSync();

      expect(syncManager.isSyncing).toBe(false);
    });
  });

  describe('applyChanges', () => {
    test('should apply create/update operations', async () => {
      const models = require('../../src/models');
      const changes = [
        { operation: 'create', data: { id: 1, name: 'Test User' } },
        { operation: 'update', data: { id: 2, name: 'Updated User' } }
      ];

      await syncManager.applyChanges('user', changes);

      expect(models.LocalUser.upsert).toHaveBeenCalledTimes(2);
    });

    test('should apply delete operations', async () => {
      const models = require('../../src/models');
      const changes = [
        { operation: 'delete', data: { id: 1 } }
      ];

      await syncManager.applyChanges('user', changes);

      expect(models.LocalUser.destroy).toHaveBeenCalledWith({
        where: { id: 1 }
      });
    });

    test('should handle unknown entity gracefully', async () => {
      await syncManager.applyChanges('unknown_entity', [{ operation: 'create', data: {} }]);
      // Should not throw
    });
  });

  describe('addToQueue', () => {
    test('should add item to queue', async () => {
      const queueId = await syncManager.addToQueue('create', 'guard', { name: 'Test' });

      expect(typeof queueId).toBe('string');
      expect(queueId.length).toBe(32); // 16 bytes hex
    });
  });

  describe('collectMetrics', () => {
    test('should return system metrics', async () => {
      const metrics = await syncManager.collectMetrics();

      expect(metrics).toHaveProperty('cpu');
      expect(metrics).toHaveProperty('memory');
      expect(metrics).toHaveProperty('uptime');
      expect(metrics).toHaveProperty('users');
      expect(metrics).toHaveProperty('guards');
      expect(metrics).toHaveProperty('syncStats');
    });
  });

  describe('getModel', () => {
    test('should return correct model for entity', () => {
      expect(syncManager.getModel('user')).toBeDefined();
      expect(syncManager.getModel('guard')).toBeDefined();
      expect(syncManager.getModel('group')).toBeDefined();
      expect(syncManager.getModel('assignment')).toBeDefined();
    });

    test('should return undefined for unknown entity', () => {
      expect(syncManager.getModel('unknown')).toBeUndefined();
    });
  });

  describe('groupChangesByEntity', () => {
    test('should group changes correctly', () => {
      const changes = [
        { entity: 'user', data: { id: 1 } },
        { entity: 'guard', data: { id: 1 } },
        { entity: 'user', data: { id: 2 } }
      ];

      const grouped = syncManager.groupChangesByEntity(changes);

      expect(grouped.user).toHaveLength(2);
      expect(grouped.guard).toHaveLength(1);
    });
  });

  describe('delay', () => {
    test('should delay for specified time', async () => {
      const start = Date.now();
      await syncManager.delay(100);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(95);
    });
  });

  describe('subscribeToEvents', () => {
    test('should subscribe to guard events', () => {
      syncManager.subscribeToEvents();

      const addToQueueSpy = jest.spyOn(syncManager, 'addToQueue');

      mockEventBus.emit('guard.created', { data: { id: 1 } });

      expect(addToQueueSpy).toHaveBeenCalledWith('create', 'guard', { id: 1 });
    });
  });

  describe('shutdown', () => {
    test('should pause and clear queue', async () => {
      await syncManager.shutdown();

      expect(syncManager.syncQueue.pause).toHaveBeenCalled();
      expect(syncManager.syncQueue.clear).toHaveBeenCalled();
    });
  });
});
