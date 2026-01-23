import api, { setTokens, clearTokens, apiPost } from './api';
import type { User, LoginCredentials, ApiResponse } from '@/types';

// Auth API endpoints (basé sur le backend SHUGO)
const AUTH_ENDPOINTS = {
  login: '/auth/login',
  register: '/auth/register',
  logout: '/auth/logout',
  refresh: '/auth/refresh',
  me: '/auth/me',
  verify2FA: '/auth/verify-2fa',
  resetPassword: '/auth/reset-password',
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

export const authService = {
  /**
   * Login with email and password
   */
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    const response = await api.post<BackendLoginResponse>(
      AUTH_ENDPOINTS.login,
      {
        email: credentials.email,
        password: credentials.password,
        totp_token: credentials.totp_code,
      }
    );

    // Si 2FA est requis
    if (response.data.require_2fa && !response.data.data) {
      return {
        user: null,
        requires2FA: true,
      };
    }

    // Login réussi
    if (response.data.success && response.data.data) {
      const { access_token, refresh_token, user } = response.data.data;
      setTokens(access_token, refresh_token);

      const now = new Date().toISOString();
      return {
        user: {
          member_id: user.member_id.toString(),
          email: '', // Pas fourni dans la réponse login
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role as User['role'],
          status: 'active',
          geo_id: user.geo_id,
          two_factor_enabled: false,
          created_at: now,
          updated_at: now,
        },
        requires2FA: false,
      };
    }

    throw new Error('Login failed');
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
    await apiPost<ApiResponse<unknown>>(AUTH_ENDPOINTS.resetPassword, {
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
};
