import api from './api';

// Types pour les locations avec système geo_id hiérarchique
export interface Location {
  geo_id: string;
  parent_id: string | null;
  name: string;
  description?: string;
  address?: string;
  city?: string;
  postal_code?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  capacity?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Données calculées
  children?: Location[];
  members_count?: number;
  active_guards?: number;
}

export interface LocationsListParams {
  parent_id?: string | null;
  is_active?: boolean;
  include_children?: boolean;
  page?: number;
  limit?: number;
}

interface LocationsListResponse {
  success: boolean;
  data: Location[];
  pagination?: {
    total: number;
    page: number;
    pages: number;
    limit: number;
  };
}

interface LocationResponse {
  success: boolean;
  data: Location;
}

/**
 * Service pour gérer les locations avec le système geo_id hiérarchique
 * Format geo_id: 02-033-04-01-00
 * - 02: Pays (France)
 * - 033: Département (Alpes-Maritimes)
 * - 04: Région (PACA)
 * - 01: Ville parent (Nice)
 * - 00: Local (00 = parent, 01+ = enfants)
 */
export const locationsService = {
  /**
   * Récupérer toutes les locations avec hiérarchie
   */
  async getAll(params?: LocationsListParams): Promise<LocationsListResponse> {
    const response = await api.get<LocationsListResponse>('/locations', {
      params,
    });
    return response.data;
  },

  /**
   * Récupérer les locations parentes (villes principales)
   */
  async getParents(): Promise<LocationsListResponse> {
    const response = await api.get<LocationsListResponse>('/locations/parents');
    return response.data;
  },

  /**
   * Récupérer les enfants d'une location parente
   */
  async getChildren(parentGeoId: string): Promise<LocationsListResponse> {
    const response = await api.get<LocationsListResponse>(`/locations/${parentGeoId}/children`);
    return response.data;
  },

  /**
   * Récupérer une location par geo_id
   */
  async getByGeoId(geoId: string): Promise<LocationResponse> {
    const response = await api.get<LocationResponse>(`/locations/${geoId}`);
    return response.data;
  },

  /**
   * Créer une nouvelle location
   */
  async create(location: Partial<Location>): Promise<LocationResponse> {
    const response = await api.post<LocationResponse>('/locations', location);
    return response.data;
  },

  /**
   * Mettre à jour une location
   */
  async update(geoId: string, location: Partial<Location>): Promise<LocationResponse> {
    const response = await api.put<LocationResponse>(`/locations/${geoId}`, location);
    return response.data;
  },

  /**
   * Supprimer une location
   */
  async delete(geoId: string): Promise<{ success: boolean }> {
    const response = await api.delete<{ success: boolean }>(`/locations/${geoId}`);
    return response.data;
  },

  /**
   * Activer/désactiver une location
   */
  async toggleActive(geoId: string, isActive: boolean): Promise<LocationResponse> {
    const response = await api.patch<LocationResponse>(`/locations/${geoId}/toggle`, {
      is_active: isActive,
    });
    return response.data;
  },

  /**
   * Récupérer les statistiques d'une location
   */
  async getStats(geoId: string): Promise<{
    success: boolean;
    data: {
      members_count: number;
      active_guards: number;
      total_guards: number;
      children_count: number;
    };
  }> {
    const response = await api.get(`/locations/${geoId}/stats`);
    return response.data;
  },

  /**
   * Parser le geo_id pour extraire les informations hiérarchiques
   */
  parseGeoId(geoId: string): {
    country: string;
    department: string;
    region: string;
    city: string;
    local: string;
    isParent: boolean;
  } {
    const parts = geoId.split('-');
    return {
      country: parts[0] || '',
      department: parts[1] || '',
      region: parts[2] || '',
      city: parts[3] || '',
      local: parts[4] || '00',
      isParent: parts[4] === '00',
    };
  },

  /**
   * Construire un geo_id enfant à partir du parent
   */
  buildChildGeoId(parentGeoId: string, childNumber: number): string {
    const parts = parentGeoId.split('-');
    parts[4] = childNumber.toString().padStart(2, '0');
    return parts.join('-');
  },

  /**
   * Obtenir le geo_id parent à partir d'un enfant
   */
  getParentGeoId(childGeoId: string): string {
    const parts = childGeoId.split('-');
    parts[4] = '00';
    return parts.join('-');
  },
};

export default locationsService;
