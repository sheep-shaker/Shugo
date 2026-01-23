import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  MapPin,
  Plus,
  Search,
  Building2,
  Users,
  Edit,
  Trash2,
  MoreVertical,
  Eye,
  CheckCircle,
} from 'lucide-react';
import { Card, Button, Input, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

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

// Mock locations data
const mockLocations = [
  {
    id: '1',
    name: 'Basilique Saint-Pierre',
    address: 'Piazza San Pietro, 00120 Città del Vaticano',
    capacity: 20,
    active_guards: 8,
    is_active: true,
    type: 'sacred',
  },
  {
    id: '2',
    name: 'Chapelle Sixtine',
    address: 'Viale Vaticano, 00165 Roma',
    capacity: 6,
    active_guards: 3,
    is_active: true,
    type: 'sacred',
  },
  {
    id: '3',
    name: 'Musées du Vatican',
    address: 'Viale Vaticano, 00165 Roma',
    capacity: 15,
    active_guards: 6,
    is_active: true,
    type: 'museum',
  },
  {
    id: '4',
    name: 'Place Saint-Pierre',
    address: 'Piazza San Pietro, 00120 Città del Vaticano',
    capacity: 25,
    active_guards: 10,
    is_active: true,
    type: 'outdoor',
  },
  {
    id: '5',
    name: 'Jardins du Vatican',
    address: 'Viale Vaticano, 00120 Città del Vaticano',
    capacity: 8,
    active_guards: 2,
    is_active: true,
    type: 'outdoor',
  },
  {
    id: '6',
    name: 'Centre de Formation',
    address: 'Via della Conciliazione, 00120 Città del Vaticano',
    capacity: 30,
    active_guards: 0,
    is_active: true,
    type: 'training',
  },
  {
    id: '7',
    name: 'Bibliothèque Vaticane',
    address: 'Cortile del Belvedere, 00120 Città del Vaticano',
    capacity: 4,
    active_guards: 0,
    is_active: false,
    type: 'museum',
  },
];

export function LocationsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const filteredLocations = mockLocations.filter((location) => {
    const matchesSearch =
      location.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      location.address.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || location.type === filterType;
    return matchesSearch && matchesType;
  });

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      sacred: 'bg-gold-100 text-gold-700',
      museum: 'bg-blue-100 text-blue-700',
      outdoor: 'bg-green-100 text-green-700',
      training: 'bg-purple-100 text-purple-700',
    };
    return colors[type] || 'bg-gray-100 text-gray-700';
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      sacred: 'Lieu sacré',
      museum: 'Musée',
      outdoor: 'Extérieur',
      training: 'Formation',
    };
    return labels[type] || type;
  };

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
              Gestion des Lieux
            </h1>
            <p className="mt-1 text-gray-500">
              Gérez les lieux de garde et leurs capacités
            </p>
          </div>
          <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />}>
            Nouveau lieu
          </Button>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gold-100 rounded-xl flex items-center justify-center">
              <MapPin className="h-5 w-5 text-gold-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">{mockLocations.length}</p>
              <p className="text-sm text-gray-500">Total lieux</p>
            </div>
          </div>
        </Card>
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">
                {mockLocations.filter((l) => l.is_active).length}
              </p>
              <p className="text-sm text-gray-500">Actifs</p>
            </div>
          </div>
        </Card>
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">
                {mockLocations.reduce((sum, l) => sum + l.active_guards, 0)}
              </p>
              <p className="text-sm text-gray-500">Gardes en poste</p>
            </div>
          </div>
        </Card>
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
              <Building2 className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">
                {mockLocations.reduce((sum, l) => sum + l.capacity, 0)}
              </p>
              <p className="text-sm text-gray-500">Capacité totale</p>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Filters */}
      <motion.div variants={itemVariants}>
        <Card variant="default" padding="md">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <Input
                placeholder="Rechercher un lieu..."
                leftIcon={<Search className="h-5 w-5" />}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {[
                { value: 'all', label: 'Tous' },
                { value: 'sacred', label: 'Lieux sacrés' },
                { value: 'museum', label: 'Musées' },
                { value: 'outdoor', label: 'Extérieurs' },
                { value: 'training', label: 'Formation' },
              ].map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => setFilterType(filter.value)}
                  className={cn(
                    'px-4 py-2 rounded-xl text-sm font-medium transition-all',
                    filterType === filter.value
                      ? 'bg-gold-500 text-white shadow-gold'
                      : 'bg-marble-100 text-gray-600 hover:bg-marble-200'
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Locations Grid */}
      <motion.div variants={itemVariants}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredLocations.map((location) => (
            <Card
              key={location.id}
              variant="elevated"
              padding="md"
              className={cn(
                'relative transition-all hover:shadow-gold',
                !location.is_active && 'opacity-60'
              )}
            >
              {/* Menu button */}
              <div className="absolute top-4 right-4">
                <button
                  onClick={() => setOpenMenuId(openMenuId === location.id ? null : location.id)}
                  className="p-2 rounded-lg hover:bg-marble-100 transition-colors"
                >
                  <MoreVertical className="h-5 w-5 text-gray-400" />
                </button>

                {openMenuId === location.id && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setOpenMenuId(null)}
                    />
                    <div className="absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-lg border border-marble-200 py-1 z-20">
                      <button className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-marble-50 flex items-center gap-2">
                        <Eye className="h-4 w-4" />
                        Voir détails
                      </button>
                      <button className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-marble-50 flex items-center gap-2">
                        <Edit className="h-4 w-4" />
                        Modifier
                      </button>
                      <button className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                        <Trash2 className="h-4 w-4" />
                        Supprimer
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Content */}
              <div className="flex items-start gap-4">
                <div className={cn(
                  'w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0',
                  location.is_active ? 'bg-gold-100' : 'bg-gray-100'
                )}>
                  <Building2 className={cn(
                    'h-6 w-6',
                    location.is_active ? 'text-gold-600' : 'text-gray-400'
                  )} />
                </div>
                <div className="flex-1 min-w-0 pr-8">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-gray-900 truncate">{location.name}</h3>
                  </div>
                  <p className="text-sm text-gray-500 truncate">{location.address}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <span className={cn(
                  'px-2 py-1 rounded-lg text-xs font-medium',
                  getTypeColor(location.type)
                )}>
                  {getTypeLabel(location.type)}
                </span>
                <Badge
                  variant={location.is_active ? 'success' : 'default'}
                  size="sm"
                >
                  {location.is_active ? 'Actif' : 'Inactif'}
                </Badge>
              </div>

              <div className="mt-4 pt-4 border-t border-marble-100">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-1 text-gray-500">
                    <Users className="h-4 w-4" />
                    <span>{location.active_guards}/{location.capacity} gardes</span>
                  </div>
                  <div className="w-20">
                    <div className="h-2 bg-marble-200 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          location.active_guards / location.capacity > 0.7
                            ? 'bg-green-500'
                            : location.active_guards > 0
                            ? 'bg-gold-500'
                            : 'bg-gray-300'
                        )}
                        style={{
                          width: `${Math.min(
                            (location.active_guards / location.capacity) * 100,
                            100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))}

          {filteredLocations.length === 0 && (
            <div className="col-span-full">
              <Card variant="default" padding="lg">
                <div className="text-center py-8">
                  <MapPin className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">Aucun lieu trouvé</p>
                </div>
              </Card>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

export default LocationsPage;
