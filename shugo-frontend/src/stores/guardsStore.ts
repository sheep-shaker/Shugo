import { create } from 'zustand';
import { guardsService, type Guard, type GuardsListParams, type CreateGuardData } from '@/services/guards.service';

interface GuardsState {
  guards: Guard[];
  currentGuard: Guard | null;
  mySchedule: Guard[];
  upcomingGuards: Guard[];
  emptyGuards: Guard[];
  criticalGuards: Guard[];
  isLoading: boolean;
  error: string | null;
  pagination: {
    total: number;
    page: number;
    pages: number;
    limit: number;
  };
  coverageStats: {
    total_guards: number;
    fully_covered: number;
    partially_covered: number;
    uncovered: number;
    coverage_rate: number;
  } | null;

  // Actions
  fetchGuards: (params?: GuardsListParams) => Promise<void>;
  fetchGuard: (id: string) => Promise<void>;
  fetchMySchedule: (startDate?: string, endDate?: string) => Promise<void>;
  fetchUpcoming: (days?: number, geoId?: string) => Promise<void>;
  fetchEmpty: (days?: number, geoId?: string) => Promise<void>;
  fetchCritical: (hours?: number, geoId?: string) => Promise<void>;
  fetchCoverageStats: (geoId?: string, startDate?: string, endDate?: string) => Promise<void>;
  createGuard: (data: CreateGuardData) => Promise<Guard>;
  updateGuard: (id: string, data: Partial<CreateGuardData>) => Promise<void>;
  cancelGuard: (id: string) => Promise<void>;
  assignToGuard: (guardId: string, memberId?: number, notes?: string) => Promise<void>;
  cancelAssignment: (guardId: string, reason: string, replacementMemberId?: number) => Promise<void>;
  clearError: () => void;
}

export const useGuardsStore = create<GuardsState>((set, get) => ({
  guards: [],
  currentGuard: null,
  mySchedule: [],
  upcomingGuards: [],
  emptyGuards: [],
  criticalGuards: [],
  isLoading: false,
  error: null,
  pagination: {
    total: 0,
    page: 1,
    pages: 1,
    limit: 20,
  },
  coverageStats: null,

  fetchGuards: async (params = {}) => {
    set({ isLoading: true, error: null });
    try {
      const response = await guardsService.getGuards(params);
      set({
        guards: response.data,
        pagination: response.pagination,
        isLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors du chargement des gardes';
      set({ error: message, isLoading: false });
    }
  },

  fetchGuard: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const guard = await guardsService.getGuard(id);
      set({ currentGuard: guard, isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Garde non trouvée';
      set({ error: message, isLoading: false });
    }
  },

  fetchMySchedule: async (startDate?: string, endDate?: string) => {
    set({ isLoading: true, error: null });
    try {
      const guards = await guardsService.getMySchedule(startDate, endDate);
      set({ mySchedule: guards, isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors du chargement du planning';
      set({ error: message, isLoading: false });
    }
  },

  fetchUpcoming: async (days = 7, geoId?: string) => {
    try {
      const guards = await guardsService.getUpcoming(days, geoId);
      set({ upcomingGuards: guards });
    } catch (error) {
      console.error('Error fetching upcoming guards:', error);
    }
  },

  fetchEmpty: async (days = 7, geoId?: string) => {
    try {
      const guards = await guardsService.getEmpty(days, geoId);
      set({ emptyGuards: guards });
    } catch (error) {
      console.error('Error fetching empty guards:', error);
    }
  },

  fetchCritical: async (hours = 72, geoId?: string) => {
    try {
      const guards = await guardsService.getCritical(hours, geoId);
      set({ criticalGuards: guards });
    } catch (error) {
      console.error('Error fetching critical guards:', error);
    }
  },

  fetchCoverageStats: async (geoId?: string, startDate?: string, endDate?: string) => {
    try {
      const stats = await guardsService.getCoverageStats(geoId, startDate, endDate);
      set({ coverageStats: stats });
    } catch (error) {
      console.error('Error fetching coverage stats:', error);
    }
  },

  createGuard: async (data: CreateGuardData) => {
    set({ isLoading: true, error: null });
    try {
      const guard = await guardsService.createGuard(data);
      set((state) => ({
        guards: [guard, ...state.guards],
        isLoading: false,
      }));
      return guard;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la création';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  updateGuard: async (id: string, data: Partial<CreateGuardData>) => {
    set({ isLoading: true, error: null });
    try {
      const updatedGuard = await guardsService.updateGuard(id, data);
      set((state) => ({
        guards: state.guards.map((g) => (g.guard_id === id ? updatedGuard : g)),
        currentGuard: state.currentGuard?.guard_id === id ? updatedGuard : state.currentGuard,
        isLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la mise à jour';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  cancelGuard: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await guardsService.cancelGuard(id);
      set((state) => ({
        guards: state.guards.filter((g) => g.guard_id !== id),
        isLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de l\'annulation';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  assignToGuard: async (guardId: string, memberId?: number, notes?: string) => {
    set({ isLoading: true, error: null });
    try {
      await guardsService.assignToGuard(guardId, memberId, notes);
      // Refresh the guard to get updated assignments
      await get().fetchGuard(guardId);
      set({ isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de l\'inscription';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  cancelAssignment: async (guardId: string, reason: string, replacementMemberId?: number) => {
    set({ isLoading: true, error: null });
    try {
      await guardsService.cancelAssignment(guardId, reason, replacementMemberId);
      await get().fetchGuard(guardId);
      set({ isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de l\'annulation';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
