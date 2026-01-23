/**
 * SHUGO Central - Tests unitaires AuthService
 */

// Mock de la config
jest.mock('../../src/config', () => ({
  security: {
    encryptionKey: 'a'.repeat(64),
    hmacKey: 'b'.repeat(64),
    argon2: {
      memoryCost: 4096,
      timeCost: 3,
      parallelism: 1,
      hashLength: 32
    },
    totp: {
      issuer: 'SHUGO-TEST',
      window: 2
    },
    rateLimit: {
      maxAuthAttempts: 5,
      authLockoutMinutes: 15
    },
    session: {
      maxConcurrent: 3
    }
  },
  jwt: {
    secret: 'test-jwt-secret-32-bytes-minimum',
    refreshSecret: 'test-refresh-secret-32-bytes-min',
    accessExpiresIn: '15m',
    refreshExpiresIn: '7d',
    issuer: 'shugo-test',
    audience: 'shugo-central-test',
    algorithm: 'HS256'
  },
  geo: {
    defaultLanguage: 'fr'
  },
  isDev: true
}));

// Mock du logger
jest.mock('../../src/utils/logger');

// Mock de speakeasy
jest.mock('speakeasy', () => ({
  generateSecret: jest.fn(() => ({
    base32: 'TESTBASE32SECRET',
    otpauth_url: 'otpauth://totp/SHUGO:test@test.com?secret=TESTBASE32SECRET'
  })),
  totp: {
    verify: jest.fn()
  }
}));

// Mock de QRCode
jest.mock('qrcode', () => ({
  toDataURL: jest.fn(() => Promise.resolve('data:image/png;base64,FAKE_QR_CODE'))
}));

const AuthService = require('../../src/services/AuthService');
const { AuthError } = AuthService;
const speakeasy = require('speakeasy');

describe('AuthService', () => {
  let authService;
  let mockModels;
  let mockUser;
  let mockSession;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock user data
    mockUser = {
      member_id: 1234567890,
      email_hash: 'hashed_email',
      password_hash: '$argon2id$v=19$m=4096,t=3,p=1$salt$hash',
      status: 'active',
      role: 'guard',
      geo_id: 'FR-075-01-01-01',
      scope: 'local:FR-075-01-01-01',
      totp_enabled: true,
      totp_secret_encrypted: Buffer.from('encrypted_secret'),
      failed_login_attempts: 0,
      locked_until: null,
      save: jest.fn(),
      update: jest.fn().mockResolvedValue(true)
    };

    mockSession = {
      session_id: 'session-uuid',
      member_id: mockUser.member_id,
      is_active: true,
      update: jest.fn().mockResolvedValue(true)
    };

    // Mock models
    mockModels = {
      User: {
        findOne: jest.fn(),
        findByPk: jest.fn(),
        create: jest.fn(),
        update: jest.fn()
      },
      Session: {
        findOne: jest.fn(),
        findAll: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0)
      },
      RegistrationToken: {
        findOne: jest.fn(),
        create: jest.fn(),
        update: jest.fn()
      },
      AuditLog: {
        create: jest.fn().mockResolvedValue(true)
      }
    };

    authService = new AuthService(mockModels);
  });

  describe('AuthError', () => {
    test('should create error with correct properties', () => {
      const error = new AuthError('INVALID_CREDENTIALS', 'Test message');

      expect(error.name).toBe('AuthError');
      expect(error.code).toBe('INVALID_CREDENTIALS');
      expect(error.message).toBe('Test message');
      expect(error.statusCode).toBe(401);
    });

    test('should map error codes to correct status codes', () => {
      const testCases = [
        { code: 'INVALID_CREDENTIALS', expectedStatus: 401 },
        { code: 'ACCOUNT_BLOCKED', expectedStatus: 403 },
        { code: 'ACCOUNT_LOCKED', expectedStatus: 423 },
        { code: 'USER_NOT_FOUND', expectedStatus: 404 },
        { code: 'EMAIL_EXISTS', expectedStatus: 409 },
        { code: 'UNKNOWN_CODE', expectedStatus: 500 }
      ];

      testCases.forEach(({ code, expectedStatus }) => {
        const error = new AuthError(code, 'Test');
        expect(error.statusCode).toBe(expectedStatus);
      });
    });
  });

  describe('validateRegistrationToken', () => {
    test('should return token data for valid token', async () => {
      const mockToken = {
        token_id: 'token-uuid',
        geo_id: 'FR-075-01-01-01',
        target_first_name: 'Jean',
        target_last_name: 'Dupont',
        target_role: 'guard',
        target_group_id: 'group-uuid',
        status: 'active',
        expires_at: new Date(Date.now() + 86400000)
      };

      mockModels.RegistrationToken.findOne.mockResolvedValue(mockToken);

      const result = await authService.validateRegistrationToken('valid-token');

      expect(result).toEqual({
        tokenId: 'token-uuid',
        geoId: 'FR-075-01-01-01',
        firstName: 'Jean',
        lastName: 'Dupont',
        role: 'guard',
        groupId: 'group-uuid'
      });
    });

    test('should throw for invalid token', async () => {
      mockModels.RegistrationToken.findOne.mockResolvedValue(null);

      await expect(authService.validateRegistrationToken('invalid-token'))
        .rejects.toThrow(AuthError);
    });

    test('should throw for expired token', async () => {
      const mockToken = {
        status: 'active',
        expires_at: new Date(Date.now() - 86400000), // Expired
        update: jest.fn()
      };

      mockModels.RegistrationToken.findOne.mockResolvedValue(mockToken);

      await expect(authService.validateRegistrationToken('expired-token'))
        .rejects.toThrow(AuthError);
    });
  });

  describe('loginStep1', () => {
    test('should throw for unknown email', async () => {
      mockModels.User.findOne.mockResolvedValue(null);

      await expect(authService.loginStep1('unknown@test.com', 'password'))
        .rejects.toThrow(AuthError);
    });

    test('should throw for blocked account', async () => {
      mockModels.User.findOne.mockResolvedValue({
        ...mockUser,
        status: 'blocked'
      });

      await expect(authService.loginStep1('test@test.com', 'password'))
        .rejects.toThrow('Compte bloqué ou supprimé');
    });

    test('should throw for locked account', async () => {
      mockModels.User.findOne.mockResolvedValue({
        ...mockUser,
        locked_until: new Date(Date.now() + 600000) // 10 min from now
      });

      await expect(authService.loginStep1('test@test.com', 'password'))
        .rejects.toThrow(/Compte verrouillé/);
    });
  });

  describe('loginStep2', () => {
    test('should throw for invalid temp token', async () => {
      await expect(authService.loginStep2('invalid-token', '123456'))
        .rejects.toThrow(AuthError);
    });
  });

  describe('verifyAccessToken', () => {
    test('should throw for invalid token', async () => {
      await expect(authService.verifyAccessToken('invalid-jwt'))
        .rejects.toThrow(AuthError);
    });
  });

  describe('refreshTokens', () => {
    test('should throw for invalid refresh token', async () => {
      await expect(authService.refreshTokens('invalid-token'))
        .rejects.toThrow(AuthError);
    });
  });

  describe('logout', () => {
    test('should deactivate session', async () => {
      await authService.logout(mockUser.member_id, 'test-token');

      expect(mockModels.Session.update).toHaveBeenCalled();
      expect(mockModels.AuditLog.create).toHaveBeenCalled();
    });
  });

  describe('logoutAll', () => {
    test('should deactivate all sessions', async () => {
      mockModels.Session.update.mockResolvedValue([3]);

      const count = await authService.logoutAll(mockUser.member_id);

      expect(count).toBe(3);
      expect(mockModels.Session.update).toHaveBeenCalledWith(
        { is_active: false, logout_reason: 'logout_all' },
        expect.any(Object)
      );
    });
  });

  describe('requestPasswordReset', () => {
    test('should return generic message for unknown email', async () => {
      mockModels.User.findOne.mockResolvedValue(null);

      const result = await authService.requestPasswordReset('unknown@test.com');

      expect(result.message).toBe('Si l\'adresse existe, un email a été envoyé.');
    });

    test('should create reset token for valid email', async () => {
      mockModels.User.findOne.mockResolvedValue(mockUser);
      mockModels.RegistrationToken.create.mockResolvedValue({});

      const result = await authService.requestPasswordReset('test@test.com');

      expect(mockModels.RegistrationToken.create).toHaveBeenCalled();
      expect(result.message).toBe('Si l\'adresse existe, un email a été envoyé.');
      // In dev mode, should return reset token
      expect(result.resetToken).toBeDefined();
    });
  });

  describe('_generateMemberId', () => {
    test('should return 1 when no users exist', async () => {
      mockModels.User.findOne.mockResolvedValue(null);

      const memberId = await authService._generateMemberId();

      expect(memberId).toBe(1);
    });

    test('should increment last member_id', async () => {
      mockModels.User.findOne.mockResolvedValue({ member_id: 100 });

      const memberId = await authService._generateMemberId();

      expect(memberId).toBe(101);
    });
  });

  describe('_generateBackupCodes', () => {
    test('should generate 10 codes', () => {
      const codes = authService._generateBackupCodes();

      expect(codes).toHaveLength(10);
      codes.forEach(code => {
        expect(code).toMatch(/^\d{8}$/);
      });
    });
  });

  describe('_generatePhonetic', () => {
    test('should normalize and return phonetic string', () => {
      expect(authService._generatePhonetic('Éloïse')).toBe('eloise');
      expect(authService._generatePhonetic('JEAN-PIERRE')).toBe('jeanpierre');
      expect(authService._generatePhonetic('François')).toBe('francois');
    });

    test('should handle empty input', () => {
      // Empty string returns empty string (after normalization)
      expect(authService._generatePhonetic('')).toBeFalsy();
      expect(authService._generatePhonetic(null)).toBeNull();
      expect(authService._generatePhonetic(undefined)).toBeNull();
    });
  });

  describe('_parseExpiry', () => {
    test('should parse time strings correctly', () => {
      expect(authService._parseExpiry('30s')).toBe(30000);
      expect(authService._parseExpiry('15m')).toBe(900000);
      expect(authService._parseExpiry('2h')).toBe(7200000);
      expect(authService._parseExpiry('7d')).toBe(604800000);
    });

    test('should return default for invalid format', () => {
      expect(authService._parseExpiry('invalid')).toBe(900000); // 15 min default
    });
  });
});
