/**
 * SHUGO Central Server - Jest Setup
 * Configuration globale pour les tests
 */

// Timeout plus long pour les tests d'intégration
jest.setTimeout(30000);

// Variables d'environnement de test
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-testing-only';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-bytes-ok';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/shugo_test';
process.env.REDIS_URL = 'redis://localhost:6379/1';
process.env.LOG_LEVEL = 'error';

// Mock des modules externes
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
