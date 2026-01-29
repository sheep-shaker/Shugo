import api from './api';

// Types pour les gardes
export interface Guard {
  guard_id: string;
  geo_id: string;
  guard_date: string;
  start_time: string;
  end_time: string;
  guard_type: 'standard' | 'preparation' | 'closure' | 'special' | 'maintenance';
  status: 'open' | 'full' | 'closed' | 'cancelled';
  max_participants: number;
  min_participants: number;
  current_participants: number;
  priority: number;
  description?: string;
  created_at: string;
  updated_at: string;
  GuardAssignments?: GuardAssignment[];
}

export interface GuardAssignment {
  assignment_id: string;
  guard_id: string;
  member_id: number;
  status: 'pending' | 'confirmed' | 'cancelled';
  assigned_by: number;
  notes?: string;
  created_at: string;
}

export interface GuardsListParams {
  geo_id?: string;
  start_date?: string;
  end_date?: string;
  status?: Guard['status'];
  type?: Guard['guard_type'];
  page?: number;
  limit?: number;
}

interface GuardsListResponse {
  success: boolean;
  data: Guard[];
  pagination: {
    total: number;
    page: number;
    pages: number;
    limit: number;
  };
}

interface GuardResponse {
  success: boolean;
  data: Guard;
}

interface GuardsCountResponse {
  success: boolean;
  data: Guard[];
  count: number;
}

interface CoverageStats {
  total: number;
  covered: number;
  partial: number;
  empty: number;
  cancelled: number;
  byDay: Record<string, { total: number; covered: number; partial: number; empty: number }>;
  coverageRate: number;
}

interface CoverageStatsResponse {
  success: boolean;
  data: CoverageStats;
}

export interface CreateGuardData {
  geo_id: string;
  guard_date: string;
  start_time: string;
  end_time: string;
  guard_type?: Guard['guard_type'];
  max_participants?: number;
  min_participants?: number;
  priority?: number;
  description?: string;
}

export const guardsService = {
  /**
   * Get list of guards with filters
   */
  async getGuards(params: GuardsListParams = {}): Promise<GuardsListResponse> {
    const response = await api.get<GuardsListResponse>('/guards', { params });
    return response.data;
  },

  /**
   * Get upcoming guards
   */
  async getUpcoming(days: number = 7, geo_id?: string): Promise<Guard[]> {
    const response = await api.get<GuardsCountResponse>('/guards/upcoming', {
      params: { days, geo_id },
    });
    return response.data.data;
  },

  /**
   * Get empty guards (no participants)
   */
  async getEmpty(days: number = 7, geo_id?: string): Promise<Guard[]> {
    const response = await api.get<GuardsCountResponse>('/guards/empty', {
      params: { days, geo_id },
    });
    return response.data.data;
  },

  /**
   * Get critical guards (understaffed)
   */
  async getCritical(hours: number = 72, geo_id?: string): Promise<Guard[]> {
    const response = await api.get<GuardsCountResponse>('/guards/critical', {
      params: { hours, geo_id },
    });
    return response.data.data;
  },

  /**
   * Get my schedule
   */
  async getMySchedule(start_date?: string, end_date?: string): Promise<Guard[]> {
    const response = await api.get<GuardsCountResponse>('/guards/my-schedule', {
      params: { start_date, end_date },
    });
    return response.data.data;
  },

  /**
   * Get coverage statistics
   */
  async getCoverageStats(geo_id?: string, start_date?: string, end_date?: string): Promise<CoverageStats> {
    const response = await api.get<CoverageStatsResponse>('/guards/coverage-stats', {
      params: { geo_id, start_date, end_date },
    });
    return response.data.data;
  },

  /**
   * Get a specific guard by ID
   */
  async getGuard(id: string): Promise<Guard> {
    const response = await api.get<GuardResponse>(`/guards/${id}`);
    return response.data.data;
  },

  /**
   * Create a new guard
   */
  async createGuard(data: CreateGuardData): Promise<Guard> {
    const response = await api.post<GuardResponse>('/guards', data);
    return response.data.data;
  },

  /**
   * Update a guard
   */
  async updateGuard(id: string, data: Partial<CreateGuardData>): Promise<Guard> {
    const response = await api.put<GuardResponse>(`/guards/${id}`, data);
    return response.data.data;
  },

  /**
   * Cancel a guard
   */
  async cancelGuard(id: string): Promise<void> {
    await api.delete(`/guards/${id}`);
  },

  /**
   * Assign to a guard
   */
  async assignToGuard(guardId: string, memberId?: number, notes?: string): Promise<GuardAssignment> {
    const response = await api.post<{ success: boolean; data: GuardAssignment }>(
      `/guards/${guardId}/assign`,
      { member_id: memberId, notes }
    );
    return response.data.data;
  },

  /**
   * Cancel assignment from a guard
   */
  async cancelAssignment(guardId: string, reason: string, replacementMemberId?: number): Promise<void> {
    await api.post(`/guards/${guardId}/cancel-assignment`, {
      reason,
      replacement_member_id: replacementMemberId,
    });
  },

  /**
   * Generate guards from scenario
   */
  async generateGuards(scenarioId: string, startDate: string, endDate: string, geoId: string): Promise<Guard[]> {
    const response = await api.post<{ success: boolean; data: Guard[] }>('/guards/generate', {
      scenario_id: scenarioId,
      start_date: startDate,
      end_date: endDate,
      geo_id: geoId,
    });
    return response.data.data;
  },
};
