/**
 * SHUGO Central - Tests unitaires Sync Routes
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

// Mock des modèles
const mockLocalInstance = {
  instance_id: 'test-instance-uuid',
  server_id: 'test-server-001',
  geo_id: 'FR-075-01-01-01',
  status: 'active',
  shared_secret: 'test-shared-secret-32-bytes-long',
  needs_full_sync: false,
  update: jest.fn().mockResolvedValue(true),
  toJSON: jest.fn().mockReturnValue({})
};

// Mock des dépendances avant import
jest.mock('../../src/models/LocalInstance', () => ({
  findOne: jest.fn()
}));

jest.mock('../../src/models', () => ({
  LocalInstance: {
    findOne: jest.fn(),
    create: jest.fn()
  },
  PendingCommand: {
    findAll: jest.fn().mockResolvedValue([])
  },
  SystemConfig: {
    findOne: jest.fn()
  },
  User: {
    findAll: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn()
  },
  Guard: {
    findAll: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn()
  },
  Group: {
    findAll: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn()
  },
  Assignment: {
    findAll: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn()
  }
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const LocalInstance = require('../../src/models/LocalInstance');
const models = require('../../src/models');

describe('Sync Routes', () => {
  let app;
  let syncRouter;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup LocalInstance mock
    LocalInstance.findOne.mockResolvedValue(mockLocalInstance);
    models.LocalInstance.findOne.mockResolvedValue(mockLocalInstance);

    // Create express app for testing
    app = express();
    app.use(express.json());

    // Load sync router
    jest.isolateModules(() => {
      syncRouter = require('../../src/routes/sync');
    });

    app.use('/api/sync', syncRouter);
  });

  function generateSignature(method, url, timestamp, body = null) {
    const data = JSON.stringify({ method, url, timestamp, body });
    return crypto
      .createHmac('sha256', mockLocalInstance.shared_secret)
      .update(data)
      .digest('hex');
  }

  describe('Authentication Middleware', () => {
    test('should reject request without headers', async () => {
      const response = await request(app)
        .post('/api/sync/heartbeat')
        .send({});

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Missing authentication headers');
    });

    test('should reject request with invalid server ID', async () => {
      LocalInstance.findOne.mockResolvedValue(null);

      const timestamp = new Date().toISOString();
      const signature = generateSignature('POST', '/api/sync/heartbeat', timestamp, {});

      const response = await request(app)
        .post('/api/sync/heartbeat')
        .set('X-Server-ID', 'unknown-server')
        .set('X-Geo-ID', 'FR-075-01-01-01')
        .set('X-Timestamp', timestamp)
        .set('X-Signature', signature)
        .send({});

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Unknown or inactive server');
    });

    test('should reject request with old timestamp', async () => {
      const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
      const signature = generateSignature('POST', '/api/sync/heartbeat', oldTimestamp, {});

      const response = await request(app)
        .post('/api/sync/heartbeat')
        .set('X-Server-ID', mockLocalInstance.server_id)
        .set('X-Geo-ID', mockLocalInstance.geo_id)
        .set('X-Timestamp', oldTimestamp)
        .set('X-Signature', signature)
        .send({});

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Request timestamp too old');
    });

    test('should reject request with invalid signature', async () => {
      const timestamp = new Date().toISOString();

      const response = await request(app)
        .post('/api/sync/heartbeat')
        .set('X-Server-ID', mockLocalInstance.server_id)
        .set('X-Geo-ID', mockLocalInstance.geo_id)
        .set('X-Timestamp', timestamp)
        .set('X-Signature', 'invalid-signature')
        .send({});

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid signature');
    });
  });

  describe('POST /heartbeat', () => {
    test('should process heartbeat successfully', async () => {
      const timestamp = new Date().toISOString();
      const body = {
        metrics: { cpu: 25, memory: 50 },
        queueSize: 0,
        timestamp: new Date().toISOString()
      };
      const signature = generateSignature('POST', '/api/sync/heartbeat', timestamp, body);

      const response = await request(app)
        .post('/api/sync/heartbeat')
        .set('X-Server-ID', mockLocalInstance.server_id)
        .set('X-Geo-ID', mockLocalInstance.geo_id)
        .set('X-Timestamp', timestamp)
        .set('X-Signature', signature)
        .send(body);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.commands).toBeDefined();
      expect(mockLocalInstance.update).toHaveBeenCalled();
    });
  });

  describe('GET /status', () => {
    test('should require authentication headers', async () => {
      const response = await request(app)
        .get('/api/sync/status');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Missing authentication headers');
    });
  });

  describe('GET /changes', () => {
    test('should require authentication headers', async () => {
      const response = await request(app)
        .get('/api/sync/changes?since=2024-01-01');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Missing authentication headers');
    });
  });

  describe('POST /push', () => {
    test('should reject invalid push request', async () => {
      const timestamp = new Date().toISOString();
      const body = { invalid: 'data' };
      const signature = generateSignature('POST', '/api/sync/push', timestamp, body);

      const response = await request(app)
        .post('/api/sync/push')
        .set('X-Server-ID', mockLocalInstance.server_id)
        .set('X-Geo-ID', mockLocalInstance.geo_id)
        .set('X-Timestamp', timestamp)
        .set('X-Signature', signature)
        .send(body);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid push request');
    });

    test('should process valid push request', async () => {
      const timestamp = new Date().toISOString();
      const body = {
        entity: 'users',
        changes: [],
        geoId: mockLocalInstance.geo_id
      };
      const signature = generateSignature('POST', '/api/sync/push', timestamp, body);

      const response = await request(app)
        .post('/api/sync/push')
        .set('X-Server-ID', mockLocalInstance.server_id)
        .set('X-Geo-ID', mockLocalInstance.geo_id)
        .set('X-Timestamp', timestamp)
        .set('X-Signature', signature)
        .send(body);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.results).toBeDefined();
    });
  });

  describe('POST /full', () => {
    test('should return full sync data', async () => {
      const timestamp = new Date().toISOString();
      const body = { entities: ['users', 'guards'] };
      const signature = generateSignature('POST', '/api/sync/full', timestamp, body);

      const response = await request(app)
        .post('/api/sync/full')
        .set('X-Server-ID', mockLocalInstance.server_id)
        .set('X-Geo-ID', mockLocalInstance.geo_id)
        .set('X-Timestamp', timestamp)
        .set('X-Signature', signature)
        .send(body);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(mockLocalInstance.update).toHaveBeenCalledWith({
        last_full_sync: expect.any(Date),
        needs_full_sync: false
      });
    });
  });

  describe('POST /register', () => {
    test('should reject invalid registration token', async () => {
      models.SystemConfig.findOne.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/sync/register')
        .set('X-Registration-Token', 'invalid-token')
        .send({
          serverId: 'new-server',
          geoId: 'FR-075-01-01-01',
          serverName: 'Test Server'
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid registration token');
    });

    test('should register new server with valid token', async () => {
      models.SystemConfig.findOne.mockResolvedValue({
        key: 'local_registration_token',
        value: 'valid-registration-token'
      });

      models.LocalInstance.create.mockResolvedValue({
        instance_id: 'new-instance-uuid',
        server_id: 'new-server'
      });

      const response = await request(app)
        .post('/api/sync/register')
        .set('X-Registration-Token', 'valid-registration-token')
        .send({
          serverId: 'new-server',
          geoId: 'FR-075-01-01-01',
          serverName: 'Test Server',
          publicKey: 'test-public-key'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.sharedSecret).toBeDefined();
      expect(response.body.data.syncConfig).toBeDefined();
    });
  });

  describe('POST /item', () => {
    test('should sync single item', async () => {
      const timestamp = new Date().toISOString();
      const body = {
        operation: 'create',
        entity: 'users',
        data: { name: 'Test User' },
        id: 'test-id'
      };
      const signature = generateSignature('POST', '/api/sync/item', timestamp, body);

      models.User.create.mockResolvedValue({ id: 'test-id' });

      const response = await request(app)
        .post('/api/sync/item')
        .set('X-Server-ID', mockLocalInstance.server_id)
        .set('X-Geo-ID', mockLocalInstance.geo_id)
        .set('X-Timestamp', timestamp)
        .set('X-Signature', signature)
        .send(body);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
