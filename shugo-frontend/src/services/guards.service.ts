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

  // =========================================
  // SLOT MANAGEMENT (30-minute blocks)
  // =========================================

  /**
   * Get available guard scenarios for a location
   */
  async getScenarios(geoId?: string): Promise<GuardScenario[]> {
    const response = await api.get<{ success: boolean; data: GuardScenario[] }>('/guards/scenarios', {
      params: { geo_id: geoId }
    });
    return response.data.data;
  },

  /**
   * Get guard slots for a date range
   */
  async getSlots(startDate: string, endDate: string, geoId?: string): Promise<SlotsResponse> {
    const response = await api.get<{ success: boolean; data: SlotsResponse }>('/guards/slots', {
      params: { start_date: startDate, end_date: endDate, geo_id: geoId }
    });
    return response.data.data;
  },

  /**
   * Activate guard slots for a date range
   */
  async activateSlots(params: {
    startDate: string;
    endDate: string;
    geoId: string;
    slotIndices?: number[];
    includeNight?: boolean;
  }): Promise<Guard[]> {
    const response = await api.post<{ success: boolean; data: Guard[] }>('/guards/slots/activate', {
      start_date: params.startDate,
      end_date: params.endDate,
      geo_id: params.geoId,
      slot_indices: params.slotIndices,
      include_night: params.includeNight
    });
    return response.data.data;
  },

  /**
   * Deactivate guard slots for a date range
   */
  async deactivateSlots(params: {
    startDate: string;
    endDate: string;
    geoId: string;
    slotIndices?: number[];
    includeNight?: boolean;
    reason?: string;
  }): Promise<{ cancelled_count: number; skipped_count: number; skipped: Array<{ guard_id: string; participants: number }> }> {
    const response = await api.post<{ success: boolean; data: { cancelled_count: number; skipped_count: number; skipped: Array<{ guard_id: string; participants: number }> } }>('/guards/slots/deactivate', {
      start_date: params.startDate,
      end_date: params.endDate,
      geo_id: params.geoId,
      slot_indices: params.slotIndices,
      include_night: params.includeNight,
      reason: params.reason
    });
    return response.data.data;
  },

  /**
   * Toggle a single guard slot
   */
  async toggleSlot(date: string, startTime: string, geoId: string, activate: boolean): Promise<Guard | null> {
    const response = await api.post<{ success: boolean; data?: Guard }>('/guards/slots/toggle', {
      date,
      start_time: startTime,
      geo_id: geoId,
      activate
    });
    return response.data.data || null;
  },
};

// Additional types for slot management
export interface GuardScenario {
  scenario_id: string;
  name: string;
  description?: string;
  geo_id: string;
  scenario_type: 'daily' | 'weekly' | 'monthly' | 'special';
  code: string;
  template_data: {
    slot_duration: number;
    day_start: string;
    day_end: string;
    night_start: string;
    night_end: string;
    slots: SlotTemplate[];
    night_slot?: SlotTemplate;
    weekday_config: Record<number, { enabled: boolean; label: string }>;
  };
  is_default: boolean;
  is_active: boolean;
}

export interface SlotTemplate {
  slot_index: number;
  start_time: string;
  end_time: string;
  guard_type: string;
  duration_minutes: number;
  max_participants: number;
  min_participants: number;
  enabled: boolean;
  is_night?: boolean;
  description?: string;
}

export interface SlotWithStatus extends SlotTemplate {
  activated: boolean;
  guard_id: string | null;
  current_participants: number;
  status: 'open' | 'full' | 'closed' | 'cancelled' | 'inactive';
}

export interface DaySlots {
  date: string;
  day_of_week: number;
  day_label: string;
  slots: SlotWithStatus[];
  night_slot: SlotWithStatus | null;
}

export interface SlotsResponse {
  scenario: GuardScenario;
  slots_by_date: Record<string, DaySlots>;
  total_days: number;
}
