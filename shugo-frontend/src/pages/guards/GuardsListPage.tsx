import { useState, useEffect } from 'react';
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
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Layers,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Badge } from '@/components/ui';
import { cn, formatDate, formatGuardStatus } from '@/lib/utils';
import { useGuardsStore } from '@/stores/guardsStore';

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

type FilterStatus = 'all' | 'open' | 'full' | 'closed' | 'cancelled';
type ViewMode = 'day' | 'week' | 'month';

export function GuardsListPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [showActivities, setShowActivities] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const { guards, isLoading, error, pagination, fetchGuards, cancelGuard: _cancelGuard } = useGuardsStore();

  // Calendar helpers
  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const getMonthName = (date: Date) => {
    return date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  };

  const previousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
  };

  const renderCalendar = (monthOffset: number = 0) => {
    const displayDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + monthOffset);
    const daysInMonth = getDaysInMonth(displayDate);
    const firstDay = getFirstDayOfMonth(displayDate);
    const days = [];

    // Empty cells for days before month starts (adjusted for Monday start)
    const adjustedFirstDay = firstDay === 0 ? 6 : firstDay - 1;
    for (let i = 0; i < adjustedFirstDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-24 border border-marble-100" />);
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(displayDate.getFullYear(), displayDate.getMonth(), day);
      const isToday = date.toDateString() === new Date().toDateString();
      const isSelected = selectedDate?.toDateString() === date.toDateString();
      // TODO: Replace with actual guard/activity data
      const hasGuard = Math.random() > 0.7;
      const hasActivity = Math.random() > 0.6;

      days.push(
        <div
          key={day}
          onClick={() => setSelectedDate(date)}
          className={cn(
            'h-24 border border-marble-100 p-2 hover:bg-marble-50 transition-colors cursor-pointer',
            isToday && 'bg-gold-50 border-gold-300',
            isSelected && 'bg-gold-100 border-gold-400 shadow-md'
          )}
        >
          <div className={cn(
            'text-sm font-medium mb-1',
            isToday ? 'text-gold-700' : 'text-gray-900',
            isSelected && 'text-gold-800'
          )}>
            {day}
          </div>
          <div className="space-y-1">
            {hasGuard && (
              <div className="text-xs bg-gold-500 text-white px-1.5 py-0.5 rounded truncate">
                Garde 14h-17h
              </div>
            )}
            {showActivities && hasActivity && (
              <div className="text-xs bg-blue-500 text-white px-1.5 py-0.5 rounded truncate">
                Activité 10h
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div>
        <h3 className="font-semibold text-gray-900 mb-3 capitalize">
          {getMonthName(displayDate)}
        </h3>
        <div className="grid grid-cols-7 gap-0">
          {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((day) => (
            <div key={day} className="text-center text-xs font-semibold text-gray-500 p-2 bg-marble-50 border border-marble-100">
              {day}
            </div>
          ))}
          {days}
        </div>
      </div>
    );
  };

  useEffect(() => {
    fetchGuards({ limit: 50 });
  }, [fetchGuards]);

  const filteredGuards = guards.filter((guard) => {
    const matchesSearch =
      guard.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      guard.geo_id.toLowerCase().includes(searchQuery.toLowerCase());
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

      {/* View Mode & Filters */}
      <motion.div variants={itemVariants}>
        <Card variant="default" padding="md">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            {/* View Mode Selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 mr-2">Vue:</span>
              {[
                { value: 'day', label: 'Jour' },
                { value: 'week', label: 'Semaine' },
                { value: 'month', label: 'Mois' },
              ].map((mode) => (
                <button
                  key={mode.value}
                  onClick={() => setViewMode(mode.value as ViewMode)}
                  className={cn(
                    'px-4 py-2 rounded-xl text-sm font-medium transition-all',
                    viewMode === mode.value
                      ? 'bg-gold-500 text-white shadow-gold'
                      : 'bg-marble-100 text-gray-600 hover:bg-marble-200'
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {/* Activity Overlay Toggle */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowActivities(!showActivities)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all',
                  showActivities
                    ? 'bg-blue-500 text-white shadow-blue'
                    : 'bg-marble-100 text-gray-600 hover:bg-marble-200'
                )}
              >
                <Layers className="h-4 w-4" />
                {showActivities ? 'Masquer' : 'Afficher'} les activités
              </button>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Calendar View - 2 Months */}
      {viewMode === 'month' && (
        <motion.div variants={itemVariants}>
          <Card variant="elevated">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-gold-500" />
                Calendrier des gardes
              </CardTitle>
              <div className="flex items-center gap-2">
                <button
                  onClick={previousMonth}
                  className="p-2 rounded-lg hover:bg-marble-100 transition-colors"
                >
                  <ChevronLeft className="h-5 w-5 text-gray-600" />
                </button>
                <button
                  onClick={nextMonth}
                  className="p-2 rounded-lg hover:bg-marble-100 transition-colors"
                >
                  <ChevronRight className="h-5 w-5 text-gray-600" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {renderCalendar(0)}
                {renderCalendar(1)}
              </div>
              <div className="flex items-center justify-center gap-6 mt-6 pt-4 border-t border-marble-200">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-gold-500 rounded"></div>
                  <span className="text-sm text-gray-600">Gardes</span>
                </div>
                {showActivities && (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-blue-500 rounded"></div>
                    <span className="text-sm text-gray-600">Activités</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Selected Date Details */}
      {selectedDate && viewMode === 'month' && (
        <motion.div variants={itemVariants}>
          <Card variant="elevated">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-gold-500" />
                Détails du {selectedDate.toLocaleDateString('fr-FR', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric'
                })}
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedDate(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                Fermer
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* TODO: Replace with actual guards for this date */}
                <div className="p-4 border border-marble-200 rounded-xl">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 bg-gold-100 rounded-xl flex items-center justify-center">
                      <Shield className="h-5 w-5 text-gold-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Garde Centre-Ville</p>
                      <p className="text-sm text-gray-500">14h00 - 17h00</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-4 w-4" />
                      Nice Centre
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-4 w-4" />
                      3/5 agents
                    </span>
                  </div>
                </div>
                {showActivities && (
                  <div className="p-4 border border-blue-200 bg-blue-50 rounded-xl">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                        <Calendar className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">Formation sécurité</p>
                        <p className="text-sm text-gray-500">10h00 - 12h00</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        Salle de formation
                      </span>
                    </div>
                  </div>
                )}
                {/* Empty state when no events */}
                {Math.random() > 0.5 && (
                  <div className="p-8 text-center text-gray-500">
                    <Calendar className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p>Aucune garde ou activité prévue pour cette date</p>
                    <Button variant="secondary" size="sm" className="mt-4">
                      <Plus className="h-4 w-4 mr-2" />
                      Planifier une garde
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Stats Cards */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gold-100 rounded-xl flex items-center justify-center">
              <Shield className="h-5 w-5 text-gold-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">{pagination.total}</p>
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
                {guards.filter((g) => g.status === 'full').length}
              </p>
              <p className="text-sm text-gray-500">Complètes</p>
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
                {guards.filter((g) => g.status === 'open').length}
              </p>
              <p className="text-sm text-gray-500">Ouvertes</p>
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
                {guards.filter((g) => g.status === 'closed').length}
              </p>
              <p className="text-sm text-gray-500">Fermées</p>
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
                { value: 'open', label: 'Ouvertes' },
                { value: 'full', label: 'Complètes' },
                { value: 'closed', label: 'Fermées' },
                { value: 'cancelled', label: 'Annulées' },
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
            {/* Loading State */}
            {isLoading && (
              <div className="p-12 text-center">
                <Loader2 className="h-8 w-8 text-gold-500 mx-auto mb-4 animate-spin" />
                <p className="text-gray-500">Chargement des gardes...</p>
              </div>
            )}

            {!isLoading && (
            <div className="divide-y divide-marble-100">
              {filteredGuards.map((guard) => {
                const statusInfo = formatGuardStatus(guard.status);
                return (
                  <motion.div
                    key={guard.guard_id}
                    variants={itemVariants}
                    className="p-4 hover:bg-marble-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4 flex-1">
                        {/* Icon */}
                        <div className={cn(
                          'w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0',
                          guard.status === 'full' && 'bg-green-100',
                          guard.status === 'open' && 'bg-amber-100',
                          guard.status === 'closed' && 'bg-blue-100',
                          guard.status === 'cancelled' && 'bg-gray-100'
                        )}>
                          <Shield className={cn(
                            'h-6 w-6',
                            guard.status === 'full' && 'text-green-600',
                            guard.status === 'open' && 'text-amber-600',
                            guard.status === 'closed' && 'text-blue-600',
                            guard.status === 'cancelled' && 'text-gray-600'
                          )} />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-medium text-gray-900">
                              Garde du {formatDate(guard.guard_date)}
                            </h3>
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
                              {guard.geo_id}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              {formatDate(guard.guard_date)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-4 w-4" />
                              {guard.start_time} - {guard.end_time}
                            </span>
                            <span className="flex items-center gap-1">
                              <Users className="h-4 w-4" />
                              {guard.current_participants}/{guard.max_participants} agents
                            </span>
                          </div>

                          {/* Progress bar for agent assignment */}
                          <div className="mt-3 w-48">
                            <div className="h-2 bg-marble-200 rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  'h-full rounded-full transition-all',
                                  guard.current_participants >= guard.max_participants
                                    ? 'bg-green-500'
                                    : guard.current_participants > 0
                                    ? 'bg-amber-500'
                                    : 'bg-red-500'
                                )}
                                style={{
                                  width: `${Math.min(
                                    (guard.current_participants / guard.max_participants) * 100,
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
                            guard.status === 'full' ? 'success' :
                            guard.status === 'open' ? 'warning' :
                            guard.status === 'closed' ? 'info' : 'default'
                          }
                        >
                          {statusInfo.label}
                        </Badge>

                        {/* Dropdown menu */}
                        <div className="relative">
                          <button
                            onClick={() => setOpenMenuId(openMenuId === guard.guard_id ? null : guard.guard_id)}
                            className="p-2 rounded-lg hover:bg-marble-100 transition-colors"
                          >
                            <MoreVertical className="h-5 w-5 text-gray-400" />
                          </button>

                          {openMenuId === guard.guard_id && (
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

              {filteredGuards.length === 0 && !isLoading && (
                <div className="p-12 text-center">
                  <Shield className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">Aucune garde trouvée</p>
                </div>
              )}
            </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

export default GuardsListPage;
