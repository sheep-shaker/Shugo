import { create } from 'zustand';
import { guardsService, type Guard } from '@/services/guards.service';
import api from '@/services/api';

interface DashboardStats {
  guardsToday: number;
  activeGuards: number;
  upcomingWeek: number;
  alertsCount: number;
}

interface Alert {
  id: string;
  type: 'warning' | 'info' | 'success' | 'error';
  message: string;
  time: Date;
}

interface DashboardState {
  stats: DashboardStats;
  recentGuards: Guard[];
  mySchedule: Guard[];
  alerts: Alert[];
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchDashboardData: () => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchRecentGuards: () => Promise<void>;
  fetchMySchedule: () => Promise<void>;
  fetchAlerts: () => Promise<void>;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  stats: {
    guardsToday: 0,
    activeGuards: 0,
    upcomingWeek: 0,
    alertsCount: 0,
  },
  recentGuards: [],
  mySchedule: [],
  alerts: [],
  isLoading: false,
  error: null,

  fetchDashboardData: async () => {
    set({ isLoading: true, error: null });
    try {
      // Fetch all dashboard data in parallel
      const [upcoming, mySchedule, coverage] = await Promise.all([
        guardsService.getUpcoming(7),
        guardsService.getMySchedule(),
        guardsService.getCoverageStats(),
      ]);

      // Calculate stats
      const today = new Date().toISOString().split('T')[0];
      const guardsToday = upcoming.filter(g => g.guard_date === today).length;

      set({
        stats: {
          guardsToday,
          activeGuards: upcoming.filter(g => g.status === 'full').length,
          upcomingWeek: upcoming.length,
          alertsCount: coverage.empty || 0,
        },
        recentGuards: upcoming.slice(0, 5),
        mySchedule: mySchedule.slice(0, 5),
        isLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors du chargement';
      set({ error: message, isLoading: false });
    }
  },

  fetchStats: async () => {
    try {
      const [upcoming, coverage] = await Promise.all([
        guardsService.getUpcoming(7),
        guardsService.getCoverageStats(),
      ]);

      const today = new Date().toISOString().split('T')[0];

      set((state) => ({
        stats: {
          ...state.stats,
          guardsToday: upcoming.filter(g => g.guard_date === today).length,
          activeGuards: upcoming.filter(g => g.status === 'full').length,
          upcomingWeek: upcoming.length,
          alertsCount: coverage.empty || 0,
        },
      }));
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  },

  fetchRecentGuards: async () => {
    try {
      const guards = await guardsService.getUpcoming(7);
      set({ recentGuards: guards.slice(0, 5) });
    } catch (error) {
      console.error('Error fetching recent guards:', error);
    }
  },

  fetchMySchedule: async () => {
    try {
      const guards = await guardsService.getMySchedule();
      set({ mySchedule: guards.slice(0, 5) });
    } catch (error) {
      console.error('Error fetching my schedule:', error);
    }
  },

  fetchAlerts: async () => {
    try {
      // Fetch notifications from the API
      const response = await api.get<{
        success: boolean;
        data: {
          notifications: Array<{
            notification_id: string;
            type: string;
            title: string;
            message: string;
            priority: string;
            created_at: string;
          }>;
        };
      }>('/notifications', { params: { limit: 5, unreadOnly: true } });

      if (response.data.success) {
        const alerts: Alert[] = response.data.data.notifications.map((n) => ({
          id: n.notification_id,
          type: n.priority === 'urgent' ? 'error' :
                n.priority === 'high' ? 'warning' :
                n.type.includes('success') ? 'success' : 'info',
          message: n.message,
          time: new Date(n.created_at),
        }));
        set({ alerts });
      }
    } catch (error) {
      console.error('Error fetching alerts:', error);
      // Set empty alerts on error (user might not have permissions)
      set({ alerts: [] });
    }
  },
}));
