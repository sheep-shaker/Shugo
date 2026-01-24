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
  fetchUser: (id: string) => Promise<void>;
  updateUser: (id: string, data: UpdateUserData) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  restoreUser: (id: string) => Promise<void>;
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
      set({
        users: response.users,
        pagination: response.pagination,
        isLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors du chargement des utilisateurs';
      set({ error: message, isLoading: false });
    }
  },

  fetchUser: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const user = await usersService.getUser(id);
      set({ currentUser: user, isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Utilisateur non trouvé';
      set({ error: message, isLoading: false });
    }
  },

  updateUser: async (id: string, data: UpdateUserData) => {
    set({ isLoading: true, error: null });
    try {
      await usersService.updateUser(id, data);
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

  deleteUser: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await usersService.deleteUser(id);
      set((state) => ({
        users: state.users.filter((u) => u.member_id !== id),
        isLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la suppression';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  restoreUser: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await usersService.restoreUser(id);
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

  clearError: () => set({ error: null }),
  clearCurrentUser: () => set({ currentUser: null }),
}));
