import { create } from 'zustand';
import { usersService, type UserListItem, type UserDetails, type UsersListParams, type UpdateUserData } from '@/services/users.service';

interface UsersState {
  users: UserListItem[];
  currentUser: UserDetails | null;
  isLoading: boolean;
  error: string | null;
  pagination: {
    total: number;
    page: number;
    pages: number;
    limit: number;
  };

  // Actions
  fetchUsers: (params?: UsersListParams) => Promise<void>;
  fetchUser: (id: string | number) => Promise<void>;
  updateUser: (id: string | number, data: UpdateUserData) => Promise<void>;
  deleteUser: (id: string | number) => Promise<void>;
  deleteUserPermanent: (id: string | number) => Promise<void>;
  restoreUser: (id: string | number) => Promise<void>;
  suspendUser: (id: string | number) => Promise<void>;
  activateUser: (id: string | number) => Promise<void>;
  deactivateUser: (id: string | number) => Promise<void>;
  clearError: () => void;
  clearCurrentUser: () => void;
}

export const useUsersStore = create<UsersState>((set) => ({
  users: [],
  currentUser: null,
  isLoading: false,
  error: null,
  pagination: {
    total: 0,
    page: 1,
    pages: 1,
    limit: 20,
  },

  fetchUsers: async (params = {}) => {
    set({ isLoading: true, error: null });
    try {
      const response = await usersService.getUsers(params);
      console.log('[UsersStore] Fetched users:', response);
      set({
        users: response.users || [],
        pagination: response.pagination || { total: 0, page: 1, pages: 1, limit: 20 },
        isLoading: false,
      });
    } catch (error: unknown) {
      console.error('[UsersStore] Error fetching users:', error);
      const apiError = error as { message?: string; error?: { message?: string } };
      const message = apiError?.message || apiError?.error?.message || 'Erreur lors du chargement des utilisateurs';
      set({ error: message, isLoading: false });
    }
  },

  fetchUser: async (id: string | number) => {
    set({ isLoading: true, error: null });
    try {
      const user = await usersService.getUser(String(id));
      set({ currentUser: user, isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Utilisateur non trouvé';
      set({ error: message, isLoading: false });
    }
  },

  updateUser: async (id: string | number, data: UpdateUserData) => {
    set({ isLoading: true, error: null });
    try {
      await usersService.updateUser(String(id), data);
      // Refresh users list after update
      const response = await usersService.getUsers({});
      set({
        users: response.users,
        pagination: response.pagination,
        isLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la mise à jour';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  deleteUser: async (id: number | string) => {
    set({ isLoading: true, error: null });
    try {
      await usersService.deleteUser(String(id));
      const numId = typeof id === 'string' ? parseInt(id) : id;
      set((state) => ({
        users: state.users.filter((u) => u.member_id !== numId),
        isLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la suppression';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  restoreUser: async (id: string | number) => {
    set({ isLoading: true, error: null });
    try {
      await usersService.restoreUser(String(id));
      // Refresh users list after restore
      const response = await usersService.getUsers({});
      set({
        users: response.users,
        pagination: response.pagination,
        isLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la restauration';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  suspendUser: async (id: string | number) => {
    set({ isLoading: true, error: null });
    try {
      await usersService.suspendUser(String(id));
      // Update user status in local state
      const numId = typeof id === 'string' ? parseInt(id) : id;
      set((state) => ({
        users: state.users.map((u) =>
          u.member_id === numId ? { ...u, status: 'suspended' as const } : u
        ),
        isLoading: false,
      }));
    } catch (error: unknown) {
      const apiError = error as { message?: string; error?: { message?: string } };
      const message = apiError?.message || apiError?.error?.message || 'Erreur lors de la suspension';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  activateUser: async (id: string | number) => {
    set({ isLoading: true, error: null });
    try {
      await usersService.activateUser(String(id));
      const numId = typeof id === 'string' ? parseInt(id) : id;
      set((state) => ({
        users: state.users.map((u) =>
          u.member_id === numId ? { ...u, status: 'active' as const } : u
        ),
        isLoading: false,
      }));
    } catch (error: unknown) {
      const apiError = error as { message?: string; error?: { message?: string } };
      const message = apiError?.message || apiError?.error?.message || 'Erreur lors de l\'activation';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  deactivateUser: async (id: string | number) => {
    set({ isLoading: true, error: null });
    try {
      await usersService.deactivateUser(String(id));
      const numId = typeof id === 'string' ? parseInt(id) : id;
      set((state) => ({
        users: state.users.map((u) =>
          u.member_id === numId ? { ...u, status: 'inactive' as const } : u
        ),
        isLoading: false,
      }));
    } catch (error: unknown) {
      const apiError = error as { message?: string; error?: { message?: string } };
      const message = apiError?.message || apiError?.error?.message || 'Erreur lors de la désactivation';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  deleteUserPermanent: async (id: string | number) => {
    set({ isLoading: true, error: null });
    try {
      await usersService.deleteUserPermanent(String(id));
      const numId = typeof id === 'string' ? parseInt(id) : id;
      set((state) => ({
        users: state.users.filter((u) => u.member_id !== numId),
        isLoading: false,
      }));
    } catch (error: unknown) {
      const apiError = error as { message?: string; error?: { message?: string } };
      const message = apiError?.message || apiError?.error?.message || 'Erreur lors de la suppression définitive';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
  clearCurrentUser: () => set({ currentUser: null }),
}));
