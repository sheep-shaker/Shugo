/**
 * SHUGO Central - Tests unitaires LocalInstance Model
 */

const crypto = require('crypto');

// Mock Sequelize
const mockSequelize = {
  define: jest.fn((modelName, schema, options) => {
    const MockModel = function(data) {
      Object.assign(this, data);
    };

    MockModel.prototype.save = jest.fn();
    MockModel.prototype.update = jest.fn();
    MockModel.schema = schema;
    MockModel.options = options;
    MockModel.findAll = jest.fn();
    MockModel.findOne = jest.fn();
    MockModel.findByPk = jest.fn();
    MockModel.create = jest.fn();
    MockModel.update = jest.fn();
    MockModel.Sequelize = { Op: { lt: Symbol('lt') } };

    return MockModel;
  }),
  Sequelize: {
    Op: { lt: Symbol('lt') }
  }
};

jest.mock('../../src/database/connection', () => ({
  sequelize: mockSequelize
}));

jest.mock('../../src/utils/crypto', () => ({
  hashSHA256: jest.fn(data => `hashed_${data}`),
  constantTimeCompare: jest.fn((a, b) => a === b)
}));

describe('LocalInstance Model', () => {
  let LocalInstance;
  let cryptoManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.isolateModules(() => {
      LocalInstance = require('../../src/models/LocalInstance');
      cryptoManager = require('../../src/utils/crypto');
    });
  });

  describe('Schema Definition', () => {
    test('should define model with correct table name', () => {
      expect(mockSequelize.define).toHaveBeenCalledWith(
        'LocalInstance',
        expect.any(Object),
        expect.objectContaining({
          tableName: 'local_instances'
        })
      );
    });

    test('should have required fields', () => {
      const schema = LocalInstance.schema;

      expect(schema.instance_id).toBeDefined();
      expect(schema.geo_id).toBeDefined();
      expect(schema.server_id).toBeDefined();
      expect(schema.status).toBeDefined();
    });

    test('should have correct geo_id validation pattern', () => {
      const schema = LocalInstance.schema;
      const geoIdPattern = schema.geo_id.validate.is;

      // Pattern: XX-XXX-XX-XX-XX (numeric only)
      expect(geoIdPattern.test('01-075-01-01-01')).toBe(true);
      expect(geoIdPattern.test('12-123-12-12-12')).toBe(true);
      expect(geoIdPattern.test('invalid')).toBe(false);
    });

    test('should have status field defined', () => {
      const schema = LocalInstance.schema;
      expect(schema.status).toBeDefined();
      expect(schema.status.type).toBeDefined();
    });

    test('should define sync-related fields', () => {
      const schema = LocalInstance.schema;

      expect(schema.shared_secret).toBeDefined();
      expect(schema.last_heartbeat).toBeDefined();
      expect(schema.last_full_sync).toBeDefined();
      expect(schema.last_delta_sync).toBeDefined();
      expect(schema.needs_full_sync).toBeDefined();
      expect(schema.sync_queue_size).toBeDefined();
    });

    test('should define metrics fields', () => {
      const schema = LocalInstance.schema;

      expect(schema.cpu_usage).toBeDefined();
      expect(schema.memory_usage).toBeDefined();
      expect(schema.disk_usage).toBeDefined();
      expect(schema.user_count).toBeDefined();
      expect(schema.metrics).toBeDefined();
    });
  });

  describe('Instance Methods', () => {
    let instance;

    beforeEach(() => {
      instance = new LocalInstance({
        instance_id: 'test-uuid',
        geo_id: 'FR-075-01-01-01',
        server_id: 'test-server',
        status: 'active',
        heartbeat_interval: 300,
        last_seen: null,
        shared_secret_hash: 'hashed_secret123'
      });
    });

    describe('isOnline', () => {
      test('should return false when last_seen is null', () => {
        instance.last_seen = null;
        expect(instance.isOnline()).toBe(false);
      });

      test('should return true when recently seen', () => {
        instance.last_seen = new Date();
        expect(instance.isOnline()).toBe(true);
      });

      test('should return false when not seen for too long', () => {
        // Last seen more than 2x heartbeat interval ago
        instance.last_seen = new Date(Date.now() - 700 * 1000);
        expect(instance.isOnline()).toBe(false);
      });
    });

    describe('updateHeartbeat', () => {
      test('should update timestamps and metrics', async () => {
        const metrics = {
          cpu: 25,
          memory: 50,
          disk: 30,
          users: 10
        };

        await instance.updateHeartbeat(metrics);

        expect(instance.last_seen).toBeDefined();
        expect(instance.last_heartbeat).toBeDefined();
        expect(instance.cpu_usage).toBe(25);
        expect(instance.memory_usage).toBe(50);
        expect(instance.disk_usage).toBe(30);
        expect(instance.user_count).toBe(10);
        expect(instance.save).toHaveBeenCalled();
      });
    });

    describe('setSharedSecret', () => {
      test('should set secret and hash', () => {
        instance.setSharedSecret('my-secret');

        expect(instance.shared_secret).toBe('my-secret');
        expect(cryptoManager.hashSHA256).toHaveBeenCalledWith('my-secret');
        expect(instance.shared_secret_hash).toBe('hashed_my-secret');
      });
    });

    describe('verifySharedSecret', () => {
      test('should verify correct secret', () => {
        instance.shared_secret_hash = 'hashed_secret123';

        const result = instance.verifySharedSecret('secret123');

        expect(cryptoManager.hashSHA256).toHaveBeenCalledWith('secret123');
        expect(result).toBe(true);
      });

      test('should reject incorrect secret', () => {
        instance.shared_secret_hash = 'hashed_secret123';
        cryptoManager.constantTimeCompare.mockReturnValue(false);

        const result = instance.verifySharedSecret('wrong-secret');

        expect(result).toBe(false);
      });
    });

    describe('activate', () => {
      test('should set status to active', async () => {
        instance.status = 'inactive';

        await instance.activate();

        expect(instance.status).toBe('active');
        expect(instance.activated_at).toBeDefined();
        expect(instance.save).toHaveBeenCalled();
      });
    });

    describe('deactivate', () => {
      test('should set status to inactive', async () => {
        instance.status = 'active';
        instance.metadata = {};

        await instance.deactivate('maintenance');

        expect(instance.status).toBe('inactive');
        expect(instance.metadata.deactivation_reason).toBe('maintenance');
        expect(instance.save).toHaveBeenCalled();
      });
    });
  });

  describe('Class Methods', () => {
    describe('findActive', () => {
      test('should find all active instances', async () => {
        LocalInstance.findAll.mockResolvedValue([
          { instance_id: '1', status: 'active' },
          { instance_id: '2', status: 'active' }
        ]);

        const result = await LocalInstance.findActive();

        expect(LocalInstance.findAll).toHaveBeenCalledWith({
          where: { status: 'active' },
          order: [['geo_id', 'ASC']]
        });
        expect(result).toHaveLength(2);
      });
    });

    describe('findByGeoId', () => {
      test('should find instance by geo_id', async () => {
        LocalInstance.findOne.mockResolvedValue({ geo_id: 'FR-075-01-01-01' });

        const result = await LocalInstance.findByGeoId('FR-075-01-01-01');

        expect(LocalInstance.findOne).toHaveBeenCalledWith({
          where: { geo_id: 'FR-075-01-01-01' }
        });
        expect(result.geo_id).toBe('FR-075-01-01-01');
      });
    });

    describe('findByServerId', () => {
      test('should find instance by server_id', async () => {
        LocalInstance.findOne.mockResolvedValue({ server_id: 'test-server' });

        const result = await LocalInstance.findByServerId('test-server');

        expect(LocalInstance.findOne).toHaveBeenCalledWith({
          where: { server_id: 'test-server' }
        });
        expect(result.server_id).toBe('test-server');
      });
    });

    describe('findOffline', () => {
      test('should find offline instances', async () => {
        LocalInstance.findAll.mockResolvedValue([]);

        await LocalInstance.findOffline(10);

        expect(LocalInstance.findAll).toHaveBeenCalled();
      });
    });

    describe('getMetrics', () => {
      test('should calculate aggregate metrics', async () => {
        const mockInstances = [
          {
            isOnline: () => true,
            user_count: 10,
            cpu_usage: 20,
            memory_usage: 30,
            disk_usage: 40
          },
          {
            isOnline: () => true,
            user_count: 20,
            cpu_usage: 40,
            memory_usage: 50,
            disk_usage: 60
          },
          {
            isOnline: () => false,
            user_count: 5,
            cpu_usage: 10,
            memory_usage: 20,
            disk_usage: 30
          }
        ];

        LocalInstance.findAll.mockResolvedValue(mockInstances);

        const metrics = await LocalInstance.getMetrics();

        expect(metrics.total).toBe(3);
        expect(metrics.online).toBe(2);
        expect(metrics.offline).toBe(1);
        expect(metrics.totalUsers).toBe(35);
      });
    });
  });

  describe('Indexes', () => {
    test('should define required indexes', () => {
      const options = LocalInstance.options;

      expect(options.indexes).toContainEqual({ fields: ['geo_id'] });
      expect(options.indexes).toContainEqual({ fields: ['status'] });
      expect(options.indexes).toContainEqual({ fields: ['server_id'], unique: true });
      expect(options.indexes).toContainEqual({ fields: ['last_seen'] });
      expect(options.indexes).toContainEqual({ fields: ['last_heartbeat'] });
    });
  });
});
