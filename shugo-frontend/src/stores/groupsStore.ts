import { create } from 'zustand';
import { groupsService, type Group, type GroupMember, type GroupsListParams } from '@/services/groups.service';

interface GroupsState {
  groups: Group[];
  myGroups: Group[];
  currentGroup: Group | null;
  members: GroupMember[];
  isLoading: boolean;
  error: string | null;
  pagination: {
    total: number;
    page: number;
    pages: number;
    limit: number;
  };

  // Actions
  fetchGroups: (params?: GroupsListParams) => Promise<void>;
  fetchMyGroups: () => Promise<void>;
  fetchGroup: (groupId: string) => Promise<void>;
  fetchGroupMembers: (groupId: string) => Promise<void>;
  fetchGroupChildren: (parentGroupId: string) => Promise<void>;
  createGroup: (group: Partial<Group>) => Promise<Group>;
  updateGroup: (groupId: string, group: Partial<Group>) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  addMember: (groupId: string, memberId: string, role?: 'leader' | 'member') => Promise<void>;
  removeMember: (groupId: string, membershipId: string) => Promise<void>;
  toggleGroupActive: (groupId: string, isActive: boolean) => Promise<void>;
  clearError: () => void;
}

export const useGroupsStore = create<GroupsState>((set, get) => ({
  groups: [],
  myGroups: [],
  currentGroup: null,
  members: [],
  isLoading: false,
  error: null,
  pagination: {
    total: 0,
    page: 1,
    pages: 1,
    limit: 50,
  },

  fetchGroups: async (params = {}) => {
    set({ isLoading: true, error: null });
    try {
      const response = await groupsService.getAll(params);
      set({
        groups: response.data,
        pagination: response.pagination || get().pagination,
        isLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors du chargement des groupes';
      set({ error: message, isLoading: false });
    }
  },

  fetchMyGroups: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await groupsService.getMyGroups();

      // Pour chaque groupe, récupérer les membres et les statistiques
      const groupsWithDetails = await Promise.all(
        response.data.map(async (group) => {
          try {
            const [membersResponse, statsResponse] = await Promise.all([
              groupsService.getMembers(group.group_id),
              groupsService.getStats(group.group_id),
            ]);

            return {
              ...group,
              members: membersResponse.data,
              members_count: statsResponse.data.members_count,
              active_guards: statsResponse.data.active_guards,
            };
          } catch (err) {
            console.error(`Erreur lors du chargement des détails du groupe ${group.group_id}:`, err);
            return group;
          }
        })
      );

      set({
        myGroups: groupsWithDetails,
        isLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors du chargement de vos groupes';
      set({ error: message, isLoading: false });
    }
  },

  fetchGroup: async (groupId: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await groupsService.getById(groupId);

      // Récupérer également les membres du groupe
      const membersResponse = await groupsService.getMembers(groupId);

      set({
        currentGroup: {
          ...response.data,
          members: membersResponse.data,
        },
        isLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors du chargement du groupe';
      set({ error: message, isLoading: false });
    }
  },

  fetchGroupMembers: async (groupId: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await groupsService.getMembers(groupId);
      set({
        members: response.data,
        isLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors du chargement des membres';
      set({ error: message, isLoading: false });
    }
  },

  fetchGroupChildren: async (parentGroupId: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await groupsService.getChildren(parentGroupId);

      // Mettre à jour le groupe parent avec ses enfants
      const groups = get().groups.map(group => {
        if (group.group_id === parentGroupId) {
          return {
            ...group,
            children: response.data,
          };
        }
        return group;
      });

      set({
        groups,
        isLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors du chargement des sous-groupes';
      set({ error: message, isLoading: false });
    }
  },

  createGroup: async (group: Partial<Group>) => {
    set({ isLoading: true, error: null });
    try {
      const response = await groupsService.create(group);

      // Rafraîchir la liste des groupes
      await get().fetchMyGroups();

      set({ isLoading: false });
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la création du groupe';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  updateGroup: async (groupId: string, group: Partial<Group>) => {
    set({ isLoading: true, error: null });
    try {
      await groupsService.update(groupId, group);

      // Rafraîchir la liste des groupes
      await get().fetchMyGroups();

      set({ isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la mise à jour du groupe';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  deleteGroup: async (groupId: string) => {
    set({ isLoading: true, error: null });
    try {
      await groupsService.delete(groupId);

      // Rafraîchir la liste des groupes
      await get().fetchMyGroups();

      set({ isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la suppression du groupe';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  addMember: async (groupId: string, memberId: string, role = 'member' as 'leader' | 'member') => {
    set({ isLoading: true, error: null });
    try {
      await groupsService.addMember(groupId, memberId, role);

      // Rafraîchir les membres du groupe
      await get().fetchGroupMembers(groupId);

      set({ isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de l\'ajout du membre';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  removeMember: async (groupId: string, membershipId: string) => {
    set({ isLoading: true, error: null });
    try {
      await groupsService.removeMember(groupId, membershipId);

      // Rafraîchir les membres du groupe
      await get().fetchGroupMembers(groupId);

      set({ isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors du retrait du membre';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  toggleGroupActive: async (groupId: string, isActive: boolean) => {
    set({ isLoading: true, error: null });
    try {
      await groupsService.toggleActive(groupId, isActive);

      // Rafraîchir la liste des groupes
      await get().fetchMyGroups();

      set({ isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la modification du statut';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
