import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Shield,
  Plus,
  Search,
  Filter,
  Calendar,
  MapPin,
  Users,
  Clock,
  MoreVertical,
  Eye,
  Edit,
  Trash2,
  CheckCircle,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Badge } from '@/components/ui';
import { cn, formatDate, formatTime, formatGuardStatus } from '@/lib/utils';

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

// Mock data
const mockGuards = [
  {
    id: '1',
    title: 'Garde Basilique - Matin',
    location: 'Basilique Saint-Pierre',
    start_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    end_time: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    status: 'pending' as const,
    required_agents: 4,
    assigned_count: 2,
    guard_type: 'standard' as const,
  },
  {
    id: '2',
    title: 'Garde Chapelle Sixtine',
    location: 'Chapelle Sixtine',
    start_time: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    end_time: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
    status: 'active' as const,
    required_agents: 3,
    assigned_count: 3,
    guard_type: 'special' as const,
  },
  {
    id: '3',
    title: 'Garde Musées Vatican',
    location: 'Musées du Vatican',
    start_time: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    end_time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    status: 'completed' as const,
    required_agents: 6,
    assigned_count: 6,
    guard_type: 'standard' as const,
  },
  {
    id: '4',
    title: 'Formation Nouveaux Recrues',
    location: 'Centre de Formation',
    start_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    end_time: new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString(),
    status: 'confirmed' as const,
    required_agents: 10,
    assigned_count: 8,
    guard_type: 'training' as const,
  },
  {
    id: '5',
    title: 'Garde Place Saint-Pierre',
    location: 'Place Saint-Pierre',
    start_time: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    end_time: new Date(Date.now() + 54 * 60 * 60 * 1000).toISOString(),
    status: 'pending' as const,
    required_agents: 8,
    assigned_count: 3,
    guard_type: 'standard' as const,
  },
];

type FilterStatus = 'all' | 'pending' | 'active' | 'completed' | 'confirmed';

export function GuardsListPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const filteredGuards = mockGuards.filter((guard) => {
    const matchesSearch =
      guard.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      guard.location.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'all' || guard.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const getGuardTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      standard: 'bg-blue-100 text-blue-700',
      special: 'bg-purple-100 text-purple-700',
      emergency: 'bg-red-100 text-red-700',
      training: 'bg-green-100 text-green-700',
    };
    return colors[type] || 'bg-gray-100 text-gray-700';
  };

  const getGuardTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      standard: 'Standard',
      special: 'Spéciale',
      emergency: 'Urgence',
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
              <Shield className="h-8 w-8 text-gold-500" />
              Gestion des Gardes
            </h1>
            <p className="mt-1 text-gray-500">
              Gérez et planifiez les gardes de sécurité
            </p>
          </div>
          <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />}>
            Nouvelle garde
          </Button>
        </div>
      </motion.div>

      {/* Stats Cards */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gold-100 rounded-xl flex items-center justify-center">
              <Shield className="h-5 w-5 text-gold-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">{mockGuards.length}</p>
              <p className="text-sm text-gray-500">Total gardes</p>
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
                {mockGuards.filter((g) => g.status === 'active').length}
              </p>
              <p className="text-sm text-gray-500">En cours</p>
            </div>
          </div>
        </Card>
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
              <Clock className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">
                {mockGuards.filter((g) => g.status === 'pending').length}
              </p>
              <p className="text-sm text-gray-500">En attente</p>
            </div>
          </div>
        </Card>
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <Calendar className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">
                {mockGuards.filter((g) => g.status === 'confirmed').length}
              </p>
              <p className="text-sm text-gray-500">Confirmées</p>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Filters */}
      <motion.div variants={itemVariants}>
        <Card variant="default" padding="md">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1">
              <Input
                placeholder="Rechercher une garde..."
                leftIcon={<Search className="h-5 w-5" />}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {/* Status Filter */}
            <div className="flex gap-2 flex-wrap">
              {[
                { value: 'all', label: 'Tous' },
                { value: 'active', label: 'En cours' },
                { value: 'pending', label: 'En attente' },
                { value: 'confirmed', label: 'Confirmées' },
                { value: 'completed', label: 'Terminées' },
              ].map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => setFilterStatus(filter.value as FilterStatus)}
                  className={cn(
                    'px-4 py-2 rounded-xl text-sm font-medium transition-all',
                    filterStatus === filter.value
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

      {/* Guards List */}
      <motion.div variants={itemVariants}>
        <Card variant="elevated">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5 text-gold-500" />
              Liste des gardes ({filteredGuards.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-marble-100">
              {filteredGuards.map((guard) => {
                const statusInfo = formatGuardStatus(guard.status);
                return (
                  <motion.div
                    key={guard.id}
                    variants={itemVariants}
                    className="p-4 hover:bg-marble-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4 flex-1">
                        {/* Icon */}
                        <div className={cn(
                          'w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0',
                          guard.status === 'active' && 'bg-green-100',
                          guard.status === 'pending' && 'bg-amber-100',
                          guard.status === 'confirmed' && 'bg-blue-100',
                          guard.status === 'completed' && 'bg-gray-100'
                        )}>
                          <Shield className={cn(
                            'h-6 w-6',
                            guard.status === 'active' && 'text-green-600',
                            guard.status === 'pending' && 'text-amber-600',
                            guard.status === 'confirmed' && 'text-blue-600',
                            guard.status === 'completed' && 'text-gray-600'
                          )} />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-medium text-gray-900">{guard.title}</h3>
                            <span className={cn(
                              'px-2 py-0.5 rounded-full text-xs font-medium',
                              getGuardTypeColor(guard.guard_type)
                            )}>
                              {getGuardTypeLabel(guard.guard_type)}
                            </span>
                          </div>

                          <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-500">
                            <span className="flex items-center gap-1">
                              <MapPin className="h-4 w-4" />
                              {guard.location}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              {formatDate(guard.start_time)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-4 w-4" />
                              {formatTime(guard.start_time)} - {formatTime(guard.end_time)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Users className="h-4 w-4" />
                              {guard.assigned_count}/{guard.required_agents} agents
                            </span>
                          </div>

                          {/* Progress bar for agent assignment */}
                          <div className="mt-3 w-48">
                            <div className="h-2 bg-marble-200 rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  'h-full rounded-full transition-all',
                                  guard.assigned_count >= guard.required_agents
                                    ? 'bg-green-500'
                                    : guard.assigned_count > 0
                                    ? 'bg-amber-500'
                                    : 'bg-red-500'
                                )}
                                style={{
                                  width: `${Math.min(
                                    (guard.assigned_count / guard.required_agents) * 100,
                                    100
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            guard.status === 'active' ? 'success' :
                            guard.status === 'pending' ? 'warning' :
                            guard.status === 'confirmed' ? 'info' : 'default'
                          }
                        >
                          {statusInfo.label}
                        </Badge>

                        {/* Dropdown menu */}
                        <div className="relative">
                          <button
                            onClick={() => setOpenMenuId(openMenuId === guard.id ? null : guard.id)}
                            className="p-2 rounded-lg hover:bg-marble-100 transition-colors"
                          >
                            <MoreVertical className="h-5 w-5 text-gray-400" />
                          </button>

                          {openMenuId === guard.id && (
                            <>
                              <div
                                className="fixed inset-0 z-10"
                                onClick={() => setOpenMenuId(null)}
                              />
                              <div className="absolute right-0 mt-1 w-48 bg-white rounded-xl shadow-lg border border-marble-200 py-1 z-20">
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
                      </div>
                    </div>
                  </motion.div>
                );
              })}

              {filteredGuards.length === 0 && (
                <div className="p-12 text-center">
                  <Shield className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">Aucune garde trouvée</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

export default GuardsListPage;
