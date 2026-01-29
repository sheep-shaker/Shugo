import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin,
  Plus,
  Search,
  Building2,
  Users,
  ChevronRight,
  ChevronDown,
  Eye,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Badge } from '@/components/ui';
import { useLocationsStore } from '@/stores/locationsStore';

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export function LocationsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());

  const { parentLocations, isLoading, error, fetchParentLocations } = useLocationsStore();

  useEffect(() => {
    fetchParentLocations();
  }, [fetchParentLocations]);

  // Auto-expand active locations on first load
  useEffect(() => {
    if (parentLocations.length > 0 && expandedLocations.size === 0) {
      const activeGeoIds = parentLocations
        .filter(loc => loc.is_active)
        .map(loc => loc.geo_id);
      setExpandedLocations(new Set(activeGeoIds));
    }
  }, [parentLocations]);

  const toggleExpand = (geoId: string) => {
    setExpandedLocations((prev) => {
      const next = new Set(prev);
      if (next.has(geoId)) {
        next.delete(geoId);
      } else {
        next.add(geoId);
      }
      return next;
    });
  };

  const filteredLocations = parentLocations.filter((location) =>
    location.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    location.city?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeLocations = filteredLocations.filter((loc) => loc.is_active);
  const inactiveLocations = filteredLocations.filter((loc) => !loc.is_active);

  const totalMembers = parentLocations.reduce((sum, loc) => sum + (loc.members_count || 0), 0);
  const totalGuards = parentLocations.reduce((sum, loc) => sum + (loc.active_guards || 0), 0);

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* Header */}
      <motion.div variants={itemVariants}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-semibold text-gray-900 flex items-center gap-3">
              <MapPin className="h-8 w-8 text-gold-500" />
              Lieux
            </h1>
            <p className="mt-1 text-gray-500">
              Gérez les lieux et locaux de l'organisation
            </p>
          </div>
          <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />}>
            Nouveau lieu
          </Button>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gold-100 rounded-xl flex items-center justify-center">
              <MapPin className="h-5 w-5 text-gold-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">{activeLocations.length}</p>
              <p className="text-sm text-gray-500">Lieux actifs</p>
            </div>
          </div>
        </Card>
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
              <Users className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">{totalMembers}</p>
              <p className="text-sm text-gray-500">Total membres</p>
            </div>
          </div>
        </Card>
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <CheckCircle className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">{totalGuards}</p>
              <p className="text-sm text-gray-500">Gardes en cours</p>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Search */}
      <motion.div variants={itemVariants}>
        <Card variant="default" padding="md">
          <Input
            placeholder="Rechercher un lieu..."
            leftIcon={<Search className="h-5 w-5" />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={isLoading}
          />
        </Card>
      </motion.div>

      {/* Error State */}
      {error && (
        <motion.div variants={itemVariants}>
          <Card variant="default" padding="md" className="border-red-200 bg-red-50">
            <div className="flex items-center gap-3 text-red-700">
              <AlertCircle className="h-5 w-5" />
              <p>{error}</p>
            </div>
          </Card>
        </motion.div>
      )}

      {/* Loading State */}
      {isLoading && (
        <motion.div variants={itemVariants}>
          <Card variant="elevated" padding="lg">
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-12 w-12 text-gold-500 animate-spin mb-4" />
              <p className="text-gray-500">Chargement des lieux...</p>
            </div>
          </Card>
        </motion.div>
      )}

      {/* Active Locations */}
      {!isLoading && (
      <motion.div variants={itemVariants}>
        <Card variant="elevated">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Lieux actifs
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-marble-100">
              {activeLocations.length > 0 ? activeLocations.map((location) => (
                <div key={location.geo_id}>
                  {/* Parent Location */}
                  <div
                    className="p-4 hover:bg-marble-50 transition-colors cursor-pointer"
                    onClick={() => toggleExpand(location.geo_id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 flex-1">
                        <button
                          className="p-2 rounded-lg hover:bg-marble-100 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(location.geo_id);
                          }}
                        >
                          {expandedLocations.has(location.geo_id) ? (
                            <ChevronDown className="h-5 w-5 text-gray-400" />
                          ) : (
                            <ChevronRight className="h-5 w-5 text-gray-400" />
                          )}
                        </button>
                        <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                          <Building2 className="h-5 w-5 text-green-600" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-900">{location.name}</h3>
                          <div className="flex items-center gap-4 mt-1">
                            <span className="text-sm text-gray-500 flex items-center gap-1">
                              <Users className="h-4 w-4" />
                              {location.members_count} membres
                            </span>
                            <span className="text-sm text-gray-500">
                              {location.children?.length || 0} locaux
                            </span>
                          </div>
                        </div>
                      </div>
                      <Badge variant="success" size="sm">
                        Actif
                      </Badge>
                    </div>
                  </div>

                  {/* Child Locations */}
                  <AnimatePresence>
                    {expandedLocations.has(location.geo_id) && location.children && location.children.length > 0 && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden bg-marble-50"
                      >
                        {location.children.map((child) => (
                          <div
                            key={child.geo_id}
                            className="flex items-center justify-between p-4 pl-16 hover:bg-marble-100 transition-colors border-l-2 border-gold-300 ml-8"
                          >
                            <div className="flex items-center gap-3 flex-1">
                              <div className="w-8 h-8 bg-gold-100 rounded-lg flex items-center justify-center">
                                <MapPin className="h-4 w-4 text-gold-600" />
                              </div>
                              <div>
                                <p className="font-medium text-gray-900">{child.name}</p>
                                <p className="text-sm text-gray-500">{child.address}</p>
                                <p className="text-xs text-gray-400 mt-0.5">GEO ID: {child.geo_id}</p>
                                <div className="flex items-center gap-4 mt-1">
                                  <span className="text-xs text-gray-400">
                                    {child.members_count || 0} membres
                                  </span>
                                  <span className="text-xs text-gray-400">
                                    {child.active_guards || 0} gardes
                                  </span>
                                </div>
                              </div>
                            </div>
                            <Button variant="ghost" size="sm" leftIcon={<Eye className="h-4 w-4" />}>
                              Voir
                            </Button>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )) : (
                <div className="p-8 text-center text-gray-500">
                  <CheckCircle className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p>Aucun lieu actif</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
      )}

      {/* Inactive Locations */}
      {!isLoading && (
      <motion.div variants={itemVariants}>
        <Card variant="elevated">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-gray-400" />
              Lieux inactifs
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-marble-100">
              {inactiveLocations.length > 0 ? inactiveLocations.map((location) => (
                <div key={location.geo_id}>
                  {/* Parent Location */}
                  <div
                    className="p-4 hover:bg-marble-50 transition-colors cursor-pointer opacity-60"
                    onClick={() => toggleExpand(location.geo_id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 flex-1">
                        <button
                          className="p-2 rounded-lg hover:bg-marble-100 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(location.geo_id);
                          }}
                        >
                          {expandedLocations.has(location.geo_id) ? (
                            <ChevronDown className="h-5 w-5 text-gray-400" />
                          ) : (
                            <ChevronRight className="h-5 w-5 text-gray-400" />
                          )}
                        </button>
                        <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center">
                          <Building2 className="h-5 w-5 text-gray-400" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-600">{location.name}</h3>
                          <p className="text-sm text-gray-400 mt-1">
                            {location.children?.length || 0} locaux répertoriés
                          </p>
                        </div>
                      </div>
                      <Badge variant="default" size="sm">
                        Inactif
                      </Badge>
                    </div>
                  </div>

                  {/* Child Locations */}
                  <AnimatePresence>
                    {expandedLocations.has(location.geo_id) && location.children && location.children.length > 0 && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden bg-marble-50 opacity-60"
                      >
                        {location.children.map((child) => (
                          <div
                            key={child.geo_id}
                            className="flex items-center justify-between p-4 pl-16 hover:bg-marble-100 transition-colors border-l-2 border-gray-300 ml-8"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
                                <MapPin className="h-4 w-4 text-gray-400" />
                              </div>
                              <div>
                                <p className="font-medium text-gray-600">{child.name}</p>
                                <p className="text-sm text-gray-400">{child.address}</p>
                                <p className="text-xs text-gray-400 mt-0.5">GEO ID: {child.geo_id}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )) : (
                <div className="p-8 text-center text-gray-500">
                  <XCircle className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p>Aucun lieu inactif</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
      )}
    </motion.div>
  );
}

export default LocationsPage;
