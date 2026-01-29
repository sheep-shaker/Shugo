import api from './api';

// Types pour les groupes hiérarchiques
export interface Group {
  group_id: string;
  name: string;
  description?: string;
  geo_id: string;
  parent_group_id?: string | null;
  leader_id: string;
  members_count: number;
  active_guards: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Relations
  leader?: {
    member_id: string;
    first_name: string;
    last_name: string;
    role: string;
  };
  members?: GroupMember[];
  children?: Group[];
  parent?: Group;
}

export interface GroupMember {
  membership_id: string;
  group_id: string;
  member_id: string;
  role: 'leader' | 'member';
  joined_at: string;
  // User info
  user?: {
    member_id: string;
    first_name: string;
    last_name: string;
    email: string;
    role: string;
    avatar_url?: string;
  };
}

export interface GroupsListParams {
  geo_id?: string;
  parent_group_id?: string | null;
  is_active?: boolean;
  include_children?: boolean;
  include_members?: boolean;
  page?: number;
  limit?: number;
}

interface GroupsListResponse {
  success: boolean;
  data: Group[];
  pagination?: {
    total: number;
    page: number;
    pages: number;
    limit: number;
  };
}

interface GroupResponse {
  success: boolean;
  data: Group;
}

/**
 * Service pour gérer les groupes hiérarchiques
 * Hiérarchie basée sur les rôles :
 * - Silver: Membres de groupes (pas de gestion)
 * - Gold: Coordinateurs de groupes (1 groupe)
 * - Platinum: Managers de plusieurs groupes
 * - Admin: Gestion complète de tous les groupes
 */
export const groupsService = {
  /**
   * Récupérer tous les groupes (filtrés selon le rôle)
   */
  async getAll(params?: GroupsListParams): Promise<GroupsListResponse> {
    const response = await api.get<GroupsListResponse>('/groups', {
      params,
    });
    return response.data;
  },

  /**
   * Récupérer les groupes de l'utilisateur connecté
   */
  async getMyGroups(): Promise<GroupsListResponse> {
    const response = await api.get<GroupsListResponse>('/groups/my-groups');
    return response.data;
  },

  /**
   * Récupérer un groupe par ID
   */
  async getById(groupId: string): Promise<GroupResponse> {
    const response = await api.get<GroupResponse>(`/groups/${groupId}`);
    return response.data;
  },

  /**
   * Récupérer les membres d'un groupe
   */
  async getMembers(groupId: string): Promise<{
    success: boolean;
    data: GroupMember[];
  }> {
    const response = await api.get(`/groups/${groupId}/members`);
    return response.data;
  },

  /**
   * Récupérer les sous-groupes d'un groupe parent
   */
  async getChildren(parentGroupId: string): Promise<GroupsListResponse> {
    const response = await api.get<GroupsListResponse>(`/groups/${parentGroupId}/children`);
    return response.data;
  },

  /**
   * Créer un nouveau groupe (Admin/Platinum uniquement)
   */
  async create(group: Partial<Group>): Promise<GroupResponse> {
    const response = await api.post<GroupResponse>('/groups', group);
    return response.data;
  },

  /**
   * Mettre à jour un groupe
   */
  async update(groupId: string, group: Partial<Group>): Promise<GroupResponse> {
    const response = await api.put<GroupResponse>(`/groups/${groupId}`, group);
    return response.data;
  },

  /**
   * Supprimer un groupe
   */
  async delete(groupId: string): Promise<{ success: boolean }> {
    const response = await api.delete<{ success: boolean }>(`/groups/${groupId}`);
    return response.data;
  },

  /**
   * Ajouter un membre à un groupe
   */
  async addMember(
    groupId: string,
    memberId: string,
    role: 'leader' | 'member' = 'member'
  ): Promise<{ success: boolean; data: GroupMember }> {
    const response = await api.post(`/groups/${groupId}/members`, {
      member_id: memberId,
      role,
    });
    return response.data;
  },

  /**
   * Retirer un membre d'un groupe
   */
  async removeMember(groupId: string, membershipId: string): Promise<{ success: boolean }> {
    const response = await api.delete(`/groups/${groupId}/members/${membershipId}`);
    return response.data;
  },

  /**
   * Mettre à jour le rôle d'un membre
   */
  async updateMemberRole(
    groupId: string,
    membershipId: string,
    role: 'leader' | 'member'
  ): Promise<{ success: boolean }> {
    const response = await api.patch(`/groups/${groupId}/members/${membershipId}`, {
      role,
    });
    return response.data;
  },

  /**
   * Récupérer les statistiques d'un groupe
   */
  async getStats(groupId: string): Promise<{
    success: boolean;
    data: {
      members_count: number;
      active_guards: number;
      total_guards: number;
      children_count: number;
    };
  }> {
    const response = await api.get(`/groups/${groupId}/stats`);
    return response.data;
  },

  /**
   * Activer/désactiver un groupe
   */
  async toggleActive(groupId: string, isActive: boolean): Promise<GroupResponse> {
    const response = await api.patch<GroupResponse>(`/groups/${groupId}/toggle`, {
      is_active: isActive,
    });
    return response.data;
  },
};

export default groupsService;
