/**
 * SHUGO Local Server - Jest Setup
 * Configuration globale pour les tests
 */

// Timeout plus long pour les tests
jest.setTimeout(30000);

// Variables d'environnement de test
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-local-testing';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-bytes-ok';
process.env.CENTRAL_URL = 'http://localhost:3000';
process.env.SERVER_ID = 'test-local-001';
process.env.GEO_ID = 'FR-075-01-01-01';
process.env.SHARED_SECRET = 'test-shared-secret';
process.env.DATABASE_PATH = ':memory:';
process.env.LOG_LEVEL = 'error';

// Mock du logger
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  http: jest.fn()
}));

// Cleanup après chaque test
afterEach(() => {
  jest.clearAllMocks();
});

// Cleanup global après tous les tests
afterAll(async () => {
  // Fermer les connexions si nécessaires
});
