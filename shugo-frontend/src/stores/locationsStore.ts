import { create } from 'zustand';
import { locationsService, type Location, type LocationsListParams } from '@/services/locations.service';

interface LocationsState {
  locations: Location[];
  parentLocations: Location[];
  currentLocation: Location | null;
  isLoading: boolean;
  error: string | null;
  pagination: {
    total: number;
    page: number;
    pages: number;
    limit: number;
  };

  // Actions
  fetchLocations: (params?: LocationsListParams) => Promise<void>;
  fetchParentLocations: () => Promise<void>;
  fetchLocationChildren: (parentGeoId: string) => Promise<void>;
  fetchLocation: (geoId: string) => Promise<void>;
  createLocation: (location: Partial<Location>) => Promise<Location>;
  updateLocation: (geoId: string, location: Partial<Location>) => Promise<void>;
  toggleLocationActive: (geoId: string, isActive: boolean) => Promise<void>;
  deleteLocation: (geoId: string) => Promise<void>;
  clearError: () => void;
}

export const useLocationsStore = create<LocationsState>((set, get) => ({
  locations: [],
  parentLocations: [],
  currentLocation: null,
  isLoading: false,
  error: null,
  pagination: {
    total: 0,
    page: 1,
    pages: 1,
    limit: 50,
  },

  fetchLocations: async (params = {}) => {
    set({ isLoading: true, error: null });
    try {
      const response = await locationsService.getAll(params);
      set({
        locations: response.data,
        pagination: response.pagination || get().pagination,
        isLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors du chargement des lieux';
      set({ error: message, isLoading: false });
    }
  },

  fetchParentLocations: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await locationsService.getParents();

      // Pour chaque parent, récupérer ses enfants et les statistiques
      const parentsWithChildren = await Promise.all(
        response.data.map(async (parent) => {
          try {
            const [childrenResponse, statsResponse] = await Promise.all([
              locationsService.getChildren(parent.geo_id),
              locationsService.getStats(parent.geo_id),
            ]);

            return {
              ...parent,
              children: childrenResponse.data,
              members_count: statsResponse.data.members_count,
              active_guards: statsResponse.data.active_guards,
            };
          } catch (err) {
            // Si erreur, retourner le parent sans enfants
            console.error(`Erreur lors du chargement des enfants de ${parent.geo_id}:`, err);
            return {
              ...parent,
              children: [],
              members_count: 0,
              active_guards: 0,
            };
          }
        })
      );

      set({
        parentLocations: parentsWithChildren,
        isLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors du chargement des lieux parents';
      set({ error: message, isLoading: false });
    }
  },

  fetchLocationChildren: async (parentGeoId: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await locationsService.getChildren(parentGeoId);

      // Mettre à jour le parent dans la liste avec ses enfants
      const parentLocations = get().parentLocations.map(parent => {
        if (parent.geo_id === parentGeoId) {
          return {
            ...parent,
            children: response.data,
          };
        }
        return parent;
      });

      set({
        parentLocations,
        isLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors du chargement des locaux';
      set({ error: message, isLoading: false });
    }
  },

  fetchLocation: async (geoId: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await locationsService.getByGeoId(geoId);
      set({
        currentLocation: response.data,
        isLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors du chargement du lieu';
      set({ error: message, isLoading: false });
    }
  },

  createLocation: async (location: Partial<Location>) => {
    set({ isLoading: true, error: null });
    try {
      const response = await locationsService.create(location);

      // Rafraîchir la liste des parents
      await get().fetchParentLocations();

      set({ isLoading: false });
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la création du lieu';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  updateLocation: async (geoId: string, location: Partial<Location>) => {
    set({ isLoading: true, error: null });
    try {
      await locationsService.update(geoId, location);

      // Rafraîchir la liste des parents
      await get().fetchParentLocations();

      set({ isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la mise à jour du lieu';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  toggleLocationActive: async (geoId: string, isActive: boolean) => {
    set({ isLoading: true, error: null });
    try {
      await locationsService.toggleActive(geoId, isActive);

      // Rafraîchir la liste des parents
      await get().fetchParentLocations();

      set({ isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la modification du statut';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  deleteLocation: async (geoId: string) => {
    set({ isLoading: true, error: null });
    try {
      await locationsService.delete(geoId);

      // Rafraîchir la liste des parents
      await get().fetchParentLocations();

      set({ isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la suppression du lieu';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
