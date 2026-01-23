// ============================================
// SHUGO V7 - Types TypeScript
// ============================================

// User & Auth Types
export type UserRole = 'Admin_N1' | 'Admin' | 'Platinum' | 'Gold' | 'Silver';

export interface User {
  member_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  status: 'active' | 'inactive' | 'suspended' | 'deleted';
  geo_id: string;
  phone?: string;
  avatar_url?: string;
  two_factor_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
  totp_code?: string;
}

export interface RegisterData {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
  registration_token?: string;
}

// Guard Types
export type GuardStatus = 'pending' | 'confirmed' | 'active' | 'completed' | 'cancelled';

export interface Guard {
  guard_id: string;
  guard_type: 'standard' | 'special' | 'emergency' | 'training';
  title: string;
  description?: string;
  location: Location;
  start_time: string;
  end_time: string;
  status: GuardStatus;
  required_agents: number;
  assigned_agents: GuardAssignment[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface GuardAssignment {
  assignment_id: string;
  guard_id: string;
  member_id: string;
  user?: User;
  role: 'leader' | 'agent' | 'backup';
  status: 'assigned' | 'confirmed' | 'declined' | 'present' | 'absent';
  assigned_at: string;
  confirmed_at?: string;
}

// Location Types
export interface Location {
  location_id: string;
  name: string;
  address: string;
  geo_id: string;
  latitude?: number;
  longitude?: number;
  capacity?: number;
  is_active: boolean;
}

// Group Types
export interface Group {
  group_id: string;
  name: string;
  description?: string;
  geo_id: string;
  parent_group_id?: string;
  members_count: number;
  is_active: boolean;
  created_at: string;
}

export interface GroupMembership {
  membership_id: string;
  group_id: string;
  member_id: string;
  role: 'leader' | 'member';
  joined_at: string;
}

// Notification Types
export type NotificationType =
  | 'guard_assignment'
  | 'guard_reminder'
  | 'guard_update'
  | 'system_alert'
  | 'message'
  | 'security_alert';

export interface Notification {
  notification_id: string;
  member_id: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

// Dashboard Stats
export interface DashboardStats {
  total_users: number;
  active_guards: number;
  pending_guards: number;
  completed_guards_month: number;
  user_growth: number;
  guard_completion_rate: number;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// Form Types
export interface SelectOption {
  value: string;
  label: string;
}

// Calendar Types
export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  type: 'guard' | 'meeting' | 'training' | 'other';
  status?: GuardStatus;
  data?: Guard;
}

// Audit Log Types
export interface AuditLog {
  log_id: string;
  member_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  result: 'success' | 'failure';
  created_at: string;
}
