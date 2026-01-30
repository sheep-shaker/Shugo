import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';
import { authService } from '@/services/auth.service';
import { clearTokens, getTokens } from '@/services/api';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  requires2FA: boolean;
  // Store credentials temporarily for 2FA flow
  pendingCredentials: { email: string; password: string } | null;

  // Actions
  login: (email: string, password: string) => Promise<boolean>;
  verify2FA: (code: string) => Promise<boolean>;
  logout: () => Promise<void>;
  fetchUser: () => Promise<void>;
  clearError: () => void;
  setUser: (user: User) => void;
  reset2FA: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      requires2FA: false,
      pendingCredentials: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });

        try {
          const response = await authService.login({ email, password });

          if (response.requires2FA) {
            // Backend requires 2FA, store credentials for second attempt
            console.log('[AuthStore] 2FA required');
            set({
              isLoading: false,
              requires2FA: true,
              pendingCredentials: { email, password },
            });
            return false; // Needs 2FA
          }

          console.log('[AuthStore] Login successful, setting user:', response.user);
          set({
            user: response.user,
            isAuthenticated: true,
            isLoading: false,
            requires2FA: false,
            pendingCredentials: null,
          });
          console.log('[AuthStore] State updated, returning true');
          return true;
        } catch (error: unknown) {
          let message = 'Erreur de connexion';
          // Handle API error structure: { success: false, error: { code, message } }
          if (error && typeof error === 'object') {
            const apiError = error as { error?: { message?: string }; message?: string };
            if (apiError.error?.message) {
              message = apiError.error.message;
            } else if (apiError.message) {
              message = apiError.message;
            }
          }
          console.error('Login error:', error);
          set({ isLoading: false, error: message });
          return false;
        }
      },

      verify2FA: async (code: string) => {
        const { pendingCredentials } = get();
        if (!pendingCredentials) {
          set({ error: 'Session expirée, veuillez vous reconnecter' });
          return false;
        }

        set({ isLoading: true, error: null });

        try {
          const response = await authService.loginWith2FA(pendingCredentials, code);

          set({
            user: response.user,
            isAuthenticated: true,
            isLoading: false,
            requires2FA: false,
            pendingCredentials: null,
          });
          return true;
        } catch (error: unknown) {
          let message = 'Code 2FA invalide';
          if (error && typeof error === 'object' && 'message' in error) {
            message = (error as { message: string }).message;
          }
          set({ isLoading: false, error: message });
          return false;
        }
      },

      logout: async () => {
        set({ isLoading: true });

        try {
          await authService.logout();
        } catch {
          // Ignore logout errors
        } finally {
          clearTokens();
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            requires2FA: false,
            pendingCredentials: null,
            error: null,
          });
        }
      },

      fetchUser: async () => {
        const { accessToken } = getTokens();
        if (!accessToken) {
          set({ isAuthenticated: false, user: null, isLoading: false });
          return;
        }

        set({ isLoading: true });

        try {
          const user = await authService.getMe();
          set({ user, isAuthenticated: true, isLoading: false });
        } catch {
          clearTokens();
          set({ user: null, isAuthenticated: false, isLoading: false });
        }
      },

      clearError: () => set({ error: null }),

      setUser: (user: User) => set({ user }),

      reset2FA: () => set({ requires2FA: false, pendingCredentials: null, error: null }),
    }),
    {
      name: 'shugo-auth',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
