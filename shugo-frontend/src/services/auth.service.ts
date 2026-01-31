import api, { setTokens, clearTokens, apiPost } from './api';
import type { User, LoginCredentials, ApiResponse } from '@/types';

// Auth API endpoints (basé sur le backend SHUGO)
const AUTH_ENDPOINTS = {
  login: '/auth/login',
  register: '/auth/register',
  validateToken: '/auth/validate-token',
  verifyEmail: '/auth/verify-email',
  resendVerification: '/auth/resend-verification',
  completeRegistration: '/auth/complete-registration',
  logout: '/auth/logout',
  refresh: '/auth/refresh',
  me: '/auth/me',
  verify2FA: '/auth/verify-2fa',
  resetPassword: '/auth/reset-password',
  resetPasswordConfirm: '/auth/reset-password-confirm',
  // Self-service endpoints
  requestPasswordResetSelf: '/auth/request-password-reset-self',
  request2FAReset: '/auth/request-2fa-reset',
  reset2FAConfirm: '/auth/reset-2fa-confirm',
};

// Interface pour la réponse de login du backend
interface BackendLoginResponse {
  success: boolean;
  message: string;
  require_2fa?: boolean;
  data?: {
    access_token: string;
    refresh_token: string;
    expires_in: string;
    user: {
      member_id: number;
      first_name: string;
      last_name: string;
      role: string;
      geo_id: string;
    };
  };
}

// Interface pour la réponse de /me
interface BackendMeResponse {
  success: boolean;
  data: {
    member_id: number;
    email: string;
    first_name: string;
    last_name: string;
    role: string;
    geo_id: string;
    group_id: number | null;
    status: string;
    preferred_language: string;
    notification_channel: string;
    totp_enabled: boolean;
    last_login: string;
  };
}

interface LoginResponse {
  user: User | null;
  requires2FA?: boolean;
}

// Interface pour la validation de jeton
interface TokenValidationResponse {
  success: boolean;
  data: {
    first_name: string;
    last_name: string;
    role: string;
    geo_id: string;
    expires_at: string;
  };
}

// Interface pour la réponse d'inscription (étape 1 - envoi email)
interface RegisterResponse {
  success: boolean;
  message: string;
  data: {
    member_id: number;
    email: string;
    requires_email_verification: boolean;
  };
}

// Interface pour la réponse de vérification email (étape 2 - retourne QR code)
interface VerifyEmailResponse {
  success: boolean;
  message: string;
  data: {
    qr_code: string;
    secret: string;
    backup_codes: string[];
  };
}

// Interface pour la réponse de completion (étape 3)
interface CompleteRegistrationResponse {
  success: boolean;
  message: string;
}

// Données d'inscription
export interface RegisterData {
  token: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
}

export const authService = {
  /**
   * Login with email and password
   */
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    console.log('[AuthService] Attempting login for:', credentials.email);

    try {
      const response = await api.post<BackendLoginResponse>(
        AUTH_ENDPOINTS.login,
        {
          email: credentials.email,
          password: credentials.password,
          totp_token: credentials.totp_code,
        }
      );

      console.log('[AuthService] Login response:', response.data);

      // Si 2FA est requis
      if (response.data.require_2fa && !response.data.data) {
        console.log('[AuthService] 2FA required');
        return {
          user: null,
          requires2FA: true,
        };
      }

      // Login réussi
      if (response.data.success && response.data.data) {
        const { access_token, refresh_token, user } = response.data.data;
        console.log('[AuthService] Login successful, storing tokens');
        setTokens(access_token, refresh_token);

        const now = new Date().toISOString();
        const userData = {
          member_id: user.member_id.toString(),
          email: '', // Pas fourni dans la réponse login
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role as User['role'],
          status: 'active' as const,
          geo_id: user.geo_id,
          two_factor_enabled: false,
          created_at: now,
          updated_at: now,
        };
        console.log('[AuthService] User data:', userData);
        return {
          user: userData,
          requires2FA: false,
        };
      }

      console.error('[AuthService] Unexpected response structure');
      throw new Error('Login failed');
    } catch (error) {
      console.error('[AuthService] Login error:', error);
      throw error;
    }
  },

  /**
   * Verify 2FA code after initial login
   */
  async loginWith2FA(credentials: LoginCredentials, totpCode: string): Promise<LoginResponse> {
    const response = await api.post<BackendLoginResponse>(
      AUTH_ENDPOINTS.login,
      {
        email: credentials.email,
        password: credentials.password,
        totp_token: totpCode,
      }
    );

    if (response.data.success && response.data.data) {
      const { access_token, refresh_token, user } = response.data.data;
      setTokens(access_token, refresh_token);

      const now = new Date().toISOString();
      return {
        user: {
          member_id: user.member_id.toString(),
          email: '',
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role as User['role'],
          status: 'active',
          geo_id: user.geo_id,
          two_factor_enabled: true,
          created_at: now,
          updated_at: now,
        },
      };
    }

    throw new Error('2FA verification failed');
  },

  /**
   * Logout current user
   */
  async logout(): Promise<void> {
    try {
      await apiPost(AUTH_ENDPOINTS.logout);
    } finally {
      clearTokens();
    }
  },

  /**
   * Get current user profile
   */
  async getMe(): Promise<User> {
    const response = await api.get<BackendMeResponse>(AUTH_ENDPOINTS.me);

    if (!response.data.success) {
      throw new Error('Failed to fetch user profile');
    }

    const userData = response.data.data;
    const now = new Date().toISOString();

    return {
      member_id: userData.member_id.toString(),
      email: userData.email,
      first_name: userData.first_name,
      last_name: userData.last_name,
      role: userData.role as User['role'],
      status: userData.status as User['status'],
      geo_id: userData.geo_id,
      two_factor_enabled: userData.totp_enabled,
      avatar_url: undefined,
      created_at: now,
      updated_at: now,
    };
  },

  /**
   * Request password reset email
   */
  async forgotPassword(email: string): Promise<void> {
    await apiPost<ApiResponse<unknown>>(AUTH_ENDPOINTS.resetPassword, { email });
  },

  /**
   * Reset password with token
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    await apiPost<ApiResponse<unknown>>(AUTH_ENDPOINTS.resetPasswordConfirm, {
      token,
      password: newPassword
    });
  },

  /**
   * Verify 2FA setup
   */
  async verify2FASetup(totpToken: string): Promise<void> {
    await apiPost<ApiResponse<unknown>>(AUTH_ENDPOINTS.verify2FA, { totp_token: totpToken });
  },

  /**
   * Validate registration token
   */
  async validateToken(token: string): Promise<TokenValidationResponse['data']> {
    const response = await api.post<TokenValidationResponse>(AUTH_ENDPOINTS.validateToken, { token });
    if (!response.data.success) {
      throw new Error('Invalid token');
    }
    return response.data.data;
  },

  /**
   * Register new user with token (Step 1 - sends verification email)
   */
  async register(data: RegisterData): Promise<RegisterResponse['data']> {
    const response = await api.post<RegisterResponse>(AUTH_ENDPOINTS.register, data);
    if (!response.data.success) {
      throw new Error('Registration failed');
    }
    return response.data.data;
  },

  /**
   * Verify email with 6-digit code (Step 2 - returns QR code)
   */
  async verifyEmail(memberId: number, code: string): Promise<VerifyEmailResponse['data']> {
    const response = await api.post<VerifyEmailResponse>(AUTH_ENDPOINTS.verifyEmail, {
      member_id: memberId,
      code
    });
    if (!response.data.success) {
      throw new Error(response.data.message || 'Email verification failed');
    }
    return response.data.data;
  },

  /**
   * Resend email verification code
   */
  async resendVerification(memberId: number): Promise<void> {
    const response = await api.post<{ success: boolean; message: string }>(
      AUTH_ENDPOINTS.resendVerification,
      { member_id: memberId }
    );
    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to resend code');
    }
  },

  /**
   * Complete registration by verifying 2FA setup (Step 3 - final)
   */
  async completeRegistration(memberId: number, totpToken: string): Promise<void> {
    const response = await api.post<CompleteRegistrationResponse>(
      AUTH_ENDPOINTS.completeRegistration,
      { member_id: memberId, totp_token: totpToken }
    );
    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to complete registration');
    }
  },

  /**
   * Request password reset for self (authenticated user)
   */
  async requestPasswordResetSelf(): Promise<void> {
    await apiPost<ApiResponse<unknown>>(AUTH_ENDPOINTS.requestPasswordResetSelf);
  },

  /**
   * Request 2FA reset for self (authenticated user)
   */
  async request2FAReset(): Promise<void> {
    await apiPost<ApiResponse<unknown>>(AUTH_ENDPOINTS.request2FAReset);
  },

  /**
   * Confirm 2FA reset with token
   */
  async reset2FAConfirm(token: string, password: string): Promise<{
    qr_code: string;
    secret: string;
    backup_codes: string[];
  }> {
    const response = await apiPost<{
      success: boolean;
      data: {
        qr_code: string;
        secret: string;
        backup_codes: string[];
      };
    }>(AUTH_ENDPOINTS.reset2FAConfirm, { token, password });
    return response.data;
  },
};
