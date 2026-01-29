import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combine Tailwind CSS classes with clsx and tailwind-merge
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a date to French locale
 */
export function formatDate(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...options,
  });
}

/**
 * Format a time to French locale
 */
export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a datetime to French locale
 */
export function formatDateTime(date: Date | string): string {
  return `${formatDate(date)} à ${formatTime(date)}`;
}

/**
 * Get initials from a name
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.slice(0, length) + '...';
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Sleep function for async/await
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a random ID
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * Check if we're on mobile
 */
export function isMobile(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 768;
}

/**
 * Format role to display name
 */
export function formatRole(role: string): string {
  const roles: Record<string, string> = {
    Admin_N1: 'Administrateur N1',
    Admin: 'Administrateur',
    Platinum: 'Platinum',
    Gold: 'Gold',
    Silver: 'Silver',
  };
  return roles[role] || role;
}

/**
 * Get role badge color
 */
export function getRoleBadgeColor(role: string): string {
  const colors: Record<string, string> = {
    Admin_N1: 'badge-error',
    Admin: 'badge-warning',
    Platinum: 'badge-info',
    Gold: 'badge-gold',
    Silver: 'badge-success',
  };
  return colors[role] || 'badge-gold';
}

/**
 * Format guard status
 */
export function formatGuardStatus(status: string): { label: string; color: string } {
  const statuses: Record<string, { label: string; color: string }> = {
    active: { label: 'En service', color: 'badge-success' },
    pending: { label: 'En attente', color: 'badge-warning' },
    completed: { label: 'Terminée', color: 'badge-info' },
    cancelled: { label: 'Annulée', color: 'badge-error' },
  };
  return statuses[status] || { label: status, color: 'badge-gold' };
}

/**
 * Get full name from User object
 */
export function getFullName(user: { first_name?: string; last_name?: string } | null | undefined): string {
  if (!user) return '';
  return [user.first_name, user.last_name].filter(Boolean).join(' ');
}

/**
 * Format relative time (e.g., "il y a 2 heures")
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins < 0) {
    const futureMins = Math.abs(diffMins);
    if (futureMins < 60) return `Dans ${futureMins} min`;
    const futureHours = Math.round(futureMins / 60);
    if (futureHours < 24) return `Dans ${futureHours}h`;
    return `Dans ${Math.round(futureHours / 24)}j`;
  }

  if (diffMins < 1) return 'À l\'instant';
  if (diffMins < 60) return `Il y a ${diffMins} min`;
  const diffHours = Math.round(diffMins / 60);
  if (diffHours < 24) return `Il y a ${diffHours}h`;
  return `Il y a ${Math.round(diffHours / 24)}j`;
}

/**
 * Role hierarchy for SHUGO
 * Higher number = higher privileges
 */
export const ROLE_HIERARCHY = {
  Silver: 1,
  Gold: 2,
  Platinum: 3,
  Admin: 4,
  Admin_N1: 5,
} as const;

export type UserRole = keyof typeof ROLE_HIERARCHY;

/**
 * Check if user has minimum required role
 */
export function hasMinimumRole(userRole: string | undefined, requiredRole: UserRole): boolean {
  if (!userRole) return false;
  const userLevel = ROLE_HIERARCHY[userRole as UserRole] || 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole];
  return userLevel >= requiredLevel;
}

/**
 * Check if user has exact role
 */
export function hasRole(userRole: string | undefined, role: UserRole): boolean {
  return userRole === role;
}

/**
 * Check if user is admin (Admin or Admin_N1)
 */
export function isAdmin(userRole: string | undefined): boolean {
  return hasMinimumRole(userRole, 'Admin');
}

/**
 * Check if user can manage groups (Gold and above)
 */
export function canManageGroups(userRole: string | undefined): boolean {
  return hasMinimumRole(userRole, 'Gold');
}

/**
 * Check if user can create guards (Gold and above)
 */
export function canCreateGuards(userRole: string | undefined): boolean {
  return hasMinimumRole(userRole, 'Gold');
}

/**
 * Check if user can view all locations (Platinum and above)
 */
export function canViewAllLocations(userRole: string | undefined): boolean {
  return hasMinimumRole(userRole, 'Platinum');
}

/**
 * Check if user can manage users (Admin and above)
 */
export function canManageUsers(userRole: string | undefined): boolean {
  return hasMinimumRole(userRole, 'Admin');
}

/**
 * Get role-based dashboard features
 */
export function getDashboardFeatures(userRole: string | undefined) {
  return {
    canCreateGuards: canCreateGuards(userRole),
    canManageGroups: canManageGroups(userRole),
    canViewAllLocations: canViewAllLocations(userRole),
    canManageUsers: canManageUsers(userRole),
    canViewReports: hasMinimumRole(userRole, 'Gold'),
    canViewStatistics: hasMinimumRole(userRole, 'Gold'),
    canAccessAdmin: isAdmin(userRole),
  };
}
