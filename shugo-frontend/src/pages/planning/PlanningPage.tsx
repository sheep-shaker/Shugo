import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  MapPin,
  Users,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { cn, formatDate } from '@/lib/utils';

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

// Types
interface CalendarEvent {
  id: string;
  title: string;
  location: string;
  start: Date;
  end: Date;
  type: 'guard' | 'meeting' | 'training';
  status: 'pending' | 'confirmed' | 'active' | 'completed';
  agents: number;
}

// Mock events
const generateMockEvents = (currentMonth: Date): CalendarEvent[] => {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  return [
    {
      id: '1',
      title: 'Garde Basilique',
      location: 'Basilique Saint-Pierre',
      start: new Date(year, month, 5, 8, 0),
      end: new Date(year, month, 5, 16, 0),
      type: 'guard',
      status: 'confirmed',
      agents: 4,
    },
    {
      id: '2',
      title: 'Formation Sécurité',
      location: 'Centre de Formation',
      start: new Date(year, month, 8, 9, 0),
      end: new Date(year, month, 8, 17, 0),
      type: 'training',
      status: 'confirmed',
      agents: 12,
    },
    {
      id: '3',
      title: 'Garde Musées',
      location: 'Musées du Vatican',
      start: new Date(year, month, 12, 6, 0),
      end: new Date(year, month, 12, 14, 0),
      type: 'guard',
      status: 'pending',
      agents: 6,
    },
    {
      id: '4',
      title: 'Réunion Coordination',
      location: 'Salle de Conférence',
      start: new Date(year, month, 15, 14, 0),
      end: new Date(year, month, 15, 16, 0),
      type: 'meeting',
      status: 'confirmed',
      agents: 8,
    },
    {
      id: '5',
      title: 'Garde Chapelle',
      location: 'Chapelle Sixtine',
      start: new Date(year, month, 18, 7, 0),
      end: new Date(year, month, 18, 15, 0),
      type: 'guard',
      status: 'confirmed',
      agents: 3,
    },
    {
      id: '6',
      title: 'Garde Place',
      location: 'Place Saint-Pierre',
      start: new Date(year, month, 22, 8, 0),
      end: new Date(year, month, 22, 20, 0),
      type: 'guard',
      status: 'pending',
      agents: 10,
    },
    {
      id: '7',
      title: 'Garde Nuit',
      location: 'Basilique Saint-Pierre',
      start: new Date(year, month, 25, 20, 0),
      end: new Date(year, month, 26, 6, 0),
      type: 'guard',
      status: 'confirmed',
      agents: 4,
    },
  ];
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

  const events = generateMockEvents(currentDate);

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
            <CardContent>
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
                            {event.agents} agents
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
