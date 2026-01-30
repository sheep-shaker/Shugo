import api from './api';
import type { User, UserRole } from '@/types';

// Types pour les utilisateurs
export interface UserListItem {
  member_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  geo_id: string;
  status: 'active' | 'inactive' | 'suspended' | 'deleted';
  created_at: string;
}

export interface UserDetails extends UserListItem {
  phone?: string;
  scope?: string;
  preferred_language: string;
  notification_channel: string;
  groups: Array<{
    group_id: string;
    name: string;
    role: string;
  }>;
  totp_enabled: boolean;
  last_login: string;
  updated_at: string;
}

export interface UsersListParams {
  page?: number;
  limit?: number;
  role?: UserRole;
  status?: string;
  geo_id?: string;
  search?: string;
}

interface UsersListResponse {
  success: boolean;
  data: {
    users: UserListItem[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      pages: number;
    };
  };
}

interface UserResponse {
  success: boolean;
  data: UserDetails;
}

export interface UpdateUserData {
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  role?: UserRole;
  geo_id?: string;
  status?: string;
  preferred_language?: string;
  notification_channel?: string;
}

export interface Session {
  session_id: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  last_activity: string;
  expires_at: string;
  is_current: boolean;
}

export interface RegistrationToken {
  token_id: string;
  token_code: string;
  token_type: string;
  geo_id: string;
  target_first_name?: string;
  target_last_name?: string;
  target_role: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
  expires_at: string;
  created_at: string;
  created_by_member_id: number;
}

export interface CreateTokenData {
  first_name?: string;
  last_name?: string;
  role?: string;
  geo_id: string;
  group_id?: string;
  expires_days?: number;
  notes?: string;
}

export interface Reset2FAResponse {
  qr_code: string;
  secret: string;
  reset_token: string;
}

export interface ResetPasswordResponse {
  reset_token: string;
}

export const usersService = {
  /**
   * Get list of users (admin only)
   */
  async getUsers(params: UsersListParams = {}): Promise<UsersListResponse['data']> {
    const response = await api.get<UsersListResponse>('/users', { params });
    return response.data.data;
  },

  /**
   * Get a specific user by ID
   */
  async getUser(id: string): Promise<UserDetails> {
    const response = await api.get<UserResponse>(`/users/${id}`);
    return response.data.data;
  },

  /**
   * Update a user
   */
  async updateUser(id: string, data: UpdateUserData): Promise<User> {
    const response = await api.put<{ success: boolean; data: User }>(`/users/${id}`, data);
    return response.data.data;
  },

  /**
   * Change password
   */
  async changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
    await api.post(`/users/${id}/change-password`, {
      current_password: currentPassword,
      password: newPassword,
    });
  },

  /**
   * Delete user (soft delete)
   */
  async deleteUser(id: string, permanent: boolean = false): Promise<void> {
    await api.delete(`/users/${id}`, { params: { permanent } });
  },

  /**
   * Restore deleted user
   */
  async restoreUser(id: string): Promise<User> {
    const response = await api.post<{ success: boolean; data: User }>(`/users/${id}/restore`);
    return response.data.data;
  },

  /**
   * Get user's active sessions
   */
  async getSessions(id: string): Promise<Session[]> {
    const response = await api.get<{ success: boolean; data: Session[] }>(`/users/${id}/sessions`);
    return response.data.data;
  },

  /**
   * Invalidate all user sessions
   */
  async invalidateSessions(id: string): Promise<number> {
    const response = await api.post<{ success: boolean; message: string }>(`/users/${id}/invalidate-sessions`);
    // Extract number from message like "5 sessions invalidated"
    const match = response.data.message.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  },

  /**
   * Create a registration token (admin only)
   */
  async createRegistrationToken(data: CreateTokenData): Promise<RegistrationToken> {
    const response = await api.post<{ success: boolean; data: RegistrationToken }>(
      '/users/registration-tokens',
      data
    );
    return response.data.data;
  },

  /**
   * Get all registration tokens (admin only)
   */
  async getRegistrationTokens(params: { status?: string; page?: number; limit?: number } = {}): Promise<{
    tokens: RegistrationToken[];
    pagination: { total: number; page: number; limit: number; pages: number };
  }> {
    const response = await api.get<{
      success: boolean;
      data: RegistrationToken[];
      pagination: { total: number; page: number; limit: number; pages: number };
    }>('/users/registration-tokens', { params });
    return {
      tokens: response.data.data,
      pagination: response.data.pagination,
    };
  },

  /**
   * Revoke a registration token (admin only)
   */
  async revokeRegistrationToken(tokenId: string): Promise<void> {
    await api.delete(`/users/registration-tokens/${tokenId}`);
  },

  /**
   * Admin reset password for a user
   */
  async adminResetPassword(userId: string): Promise<ResetPasswordResponse> {
    const response = await api.post<{ success: boolean; data: ResetPasswordResponse }>(
      `/users/${userId}/reset-password-admin`
    );
    return response.data.data;
  },

  /**
   * Admin reset 2FA for a user
   */
  async adminReset2FA(userId: string): Promise<Reset2FAResponse> {
    const response = await api.post<{ success: boolean; data: Reset2FAResponse }>(
      `/users/${userId}/reset-2fa`
    );
    return response.data.data;
  },
};
