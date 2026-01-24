import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  MapPin,
  Users,
  Loader2,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { cn, formatDate } from '@/lib/utils';
import { useGuardsStore } from '@/stores/guardsStore';
import type { Guard } from '@/services/guards.service';

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

// Types for calendar events derived from guards
interface CalendarEvent {
  id: string;
  title: string;
  location: string;
  start: Date;
  end: Date;
  type: 'guard' | 'meeting' | 'training';
  status: 'pending' | 'confirmed' | 'active' | 'completed';
  agents: number;
  maxAgents: number;
}

// Convert Guard to CalendarEvent
const guardToCalendarEvent = (guard: Guard): CalendarEvent => {
  const [startHour, startMin] = (guard.start_time || '08:00').split(':').map(Number);
  const [endHour, endMin] = (guard.end_time || '16:00').split(':').map(Number);
  const guardDate = new Date(guard.guard_date);

  return {
    id: guard.guard_id,
    title: `Garde ${guard.geo_id}`,
    location: guard.geo_id,
    start: new Date(guardDate.getFullYear(), guardDate.getMonth(), guardDate.getDate(), startHour, startMin),
    end: new Date(guardDate.getFullYear(), guardDate.getMonth(), guardDate.getDate(), endHour, endMin),
    type: guard.guard_type === 'training' ? 'training' : 'guard',
    status: guard.status === 'full' ? 'confirmed' : guard.status === 'open' ? 'pending' : 'completed',
    agents: guard.current_participants,
    maxAgents: guard.max_participants,
  };
};

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

export function PlanningPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');

  const { guards, isLoading, fetchGuards } = useGuardsStore();

  // Fetch guards for the current month
  useEffect(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const startDate = new Date(year, month, 1).toISOString().split('T')[0];
    const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];

    fetchGuards({
      startDate,
      endDate,
      limit: 100,
    });
  }, [currentDate, fetchGuards]);

  // Convert guards to calendar events
  const events = useMemo(() => guards.map(guardToCalendarEvent), [guards]);

  // Calendar helpers
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();

    // Get the day of week for first day (0 = Sunday, so we convert to Monday = 0)
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek < 0) startDayOfWeek = 6;

    const days: (Date | null)[] = [];

    // Add empty cells for days before first day of month
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }

    // Add days of month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }

    return days;
  };

  const getEventsForDate = (date: Date) => {
    return events.filter((event) => {
      const eventDate = new Date(event.start);
      return (
        eventDate.getDate() === date.getDate() &&
        eventDate.getMonth() === date.getMonth() &&
        eventDate.getFullYear() === date.getFullYear()
      );
    });
  };

  const navigateMonth = (direction: number) => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + direction, 1));
    setSelectedDate(null);
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const getEventColor = (type: string) => {
    const colors: Record<string, string> = {
      guard: 'bg-gold-100 border-gold-400 text-gold-800',
      training: 'bg-green-100 border-green-400 text-green-800',
      meeting: 'bg-blue-100 border-blue-400 text-blue-800',
    };
    return colors[type] || 'bg-gray-100 border-gray-400 text-gray-800';
  };

  const days = getDaysInMonth(currentDate);
  const selectedDateEvents = selectedDate ? getEventsForDate(selectedDate) : [];

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
              <Calendar className="h-8 w-8 text-gold-500" />
              Planning
            </h1>
            <p className="mt-1 text-gray-500">
              Calendrier des gardes et événements
            </p>
          </div>
          <div className="flex gap-3">
            <div className="flex bg-marble-100 rounded-xl p-1">
              <button
                onClick={() => setViewMode('month')}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  viewMode === 'month'
                    ? 'bg-white shadow text-gold-700'
                    : 'text-gray-600 hover:text-gray-900'
                )}
              >
                Mois
              </button>
              <button
                onClick={() => setViewMode('week')}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  viewMode === 'week'
                    ? 'bg-white shadow text-gold-700'
                    : 'text-gray-600 hover:text-gray-900'
                )}
              >
                Semaine
              </button>
            </div>
            <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />}>
              Nouvel événement
            </Button>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar */}
        <motion.div variants={itemVariants} className="lg:col-span-2">
          <Card variant="elevated">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}</CardTitle>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigateMonth(-1)}
                    className="p-2 rounded-lg hover:bg-marble-100 transition-colors"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => {
                      setCurrentDate(new Date());
                      setSelectedDate(new Date());
                    }}
                    className="px-3 py-1 text-sm font-medium text-gold-600 hover:bg-gold-50 rounded-lg transition-colors"
                  >
                    Aujourd'hui
                  </button>
                  <button
                    onClick={() => navigateMonth(1)}
                    className="p-2 rounded-lg hover:bg-marble-100 transition-colors"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="relative">
              {/* Loading overlay */}
              {isLoading && (
                <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10 rounded-xl">
                  <Loader2 className="h-8 w-8 text-gold-500 animate-spin" />
                </div>
              )}

              {/* Days header */}
              <div className="grid grid-cols-7 mb-2">
                {DAYS.map((day) => (
                  <div key={day} className="p-2 text-center text-sm font-medium text-gray-500">
                    {day}
                  </div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-1">
                {days.map((date, index) => {
                  if (!date) {
                    return <div key={`empty-${index}`} className="p-2 min-h-[100px]" />;
                  }

                  const dayEvents = getEventsForDate(date);
                  const isSelected = selectedDate &&
                    date.getDate() === selectedDate.getDate() &&
                    date.getMonth() === selectedDate.getMonth();

                  return (
                    <button
                      key={date.toISOString()}
                      onClick={() => setSelectedDate(date)}
                      className={cn(
                        'p-2 min-h-[100px] rounded-xl text-left transition-all border-2',
                        isToday(date) && 'bg-gold-50 border-gold-300',
                        isSelected && !isToday(date) && 'bg-marble-100 border-gold-400',
                        !isToday(date) && !isSelected && 'border-transparent hover:bg-marble-50'
                      )}
                    >
                      <span className={cn(
                        'inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-medium',
                        isToday(date) && 'bg-gold-500 text-white'
                      )}>
                        {date.getDate()}
                      </span>

                      {/* Event indicators */}
                      <div className="mt-1 space-y-1">
                        {dayEvents.slice(0, 2).map((event) => (
                          <div
                            key={event.id}
                            className={cn(
                              'px-1.5 py-0.5 rounded text-xs truncate border-l-2',
                              getEventColor(event.type)
                            )}
                          >
                            {event.title}
                          </div>
                        ))}
                        {dayEvents.length > 2 && (
                          <div className="text-xs text-gray-500 pl-1">
                            +{dayEvents.length - 2} autres
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Selected Day Details */}
        <motion.div variants={itemVariants}>
          <Card variant="elevated" className="sticky top-24">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-gold-500" />
                {selectedDate ? formatDate(selectedDate) : 'Sélectionnez une date'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {selectedDate ? (
                selectedDateEvents.length > 0 ? (
                  <div className="space-y-4">
                    {selectedDateEvents.map((event) => (
                      <div
                        key={event.id}
                        className={cn(
                          'p-4 rounded-xl border-l-4',
                          event.type === 'guard' && 'bg-gold-50 border-gold-500',
                          event.type === 'training' && 'bg-green-50 border-green-500',
                          event.type === 'meeting' && 'bg-blue-50 border-blue-500'
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <h4 className="font-medium text-gray-900">{event.title}</h4>
                          <Badge
                            variant={event.status === 'confirmed' ? 'success' : 'warning'}
                            size="sm"
                          >
                            {event.status === 'confirmed' ? 'Confirmé' : 'En attente'}
                          </Badge>
                        </div>

                        <div className="mt-3 space-y-2 text-sm text-gray-600">
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            {event.start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                            {' - '}
                            {event.end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4" />
                            {event.location}
                          </div>
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4" />
                            {event.agents}/{event.maxAgents} agents
                          </div>
                        </div>

                        <div className="mt-4 flex gap-2">
                          <Button variant="secondary" size="sm" className="flex-1">
                            Détails
                          </Button>
                          <Button variant="ghost" size="sm" className="flex-1">
                            Modifier
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Calendar className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">Aucun événement ce jour</p>
                    <Button variant="secondary" size="sm" className="mt-4">
                      <Plus className="h-4 w-4 mr-2" />
                      Ajouter
                    </Button>
                  </div>
                )
              ) : (
                <div className="text-center py-8">
                  <Calendar className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">
                    Cliquez sur une date pour voir les événements
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Legend */}
          <Card variant="default" padding="md" className="mt-4">
            <h4 className="font-medium text-gray-700 mb-3">Légende</h4>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-gold-400" />
                <span className="text-sm text-gray-600">Garde</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-green-400" />
                <span className="text-sm text-gray-600">Formation</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-blue-400" />
                <span className="text-sm text-gray-600">Réunion</span>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}

export default PlanningPage;
