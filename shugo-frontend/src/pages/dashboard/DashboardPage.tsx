import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Shield,
  Calendar,
  AlertTriangle,
  TrendingUp,
  MapPin,
  ArrowRight,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { useDashboardStore } from '@/stores/dashboardStore';
import { cn, formatRelativeTime, getFullName, formatDate } from '@/lib/utils';

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

interface StatCardProps {
  title: string;
  value: string | number;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon: React.ElementType;
  color: 'gold' | 'green' | 'blue' | 'red';
}

function StatCard({ title, value, change, changeType, icon: Icon, color }: StatCardProps) {
  const colorClasses = {
    gold: 'bg-gold-100 text-gold-600',
    green: 'bg-green-100 text-green-600',
    blue: 'bg-blue-100 text-blue-600',
    red: 'bg-red-100 text-red-600',
  };

  return (
    <Card variant="elevated" padding="md" className="hover:shadow-gold transition-shadow duration-300">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="mt-2 text-3xl font-display font-semibold text-gray-900">{value}</p>
          {change && (
            <p className={cn(
              'mt-1 text-sm flex items-center gap-1',
              changeType === 'positive' && 'text-green-600',
              changeType === 'negative' && 'text-red-600',
              changeType === 'neutral' && 'text-gray-500'
            )}>
              {changeType === 'positive' && <TrendingUp className="h-4 w-4" />}
              {change}
            </p>
          )}
        </div>
        <div className={cn('p-3 rounded-xl', colorClasses[color])}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </Card>
  );
}

// Helper to get guard status display
const getGuardStatusInfo = (status: string) => {
  switch (status) {
    case 'full':
      return { label: 'Complet', variant: 'success' as const };
    case 'open':
      return { label: 'Ouvert', variant: 'warning' as const };
    case 'closed':
      return { label: 'Fermé', variant: 'info' as const };
    default:
      return { label: status, variant: 'default' as const };
  }
};

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { stats, recentGuards, alerts, isLoading, fetchDashboardData, fetchAlerts } = useDashboardStore();
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    fetchDashboardData();
    fetchAlerts();
  }, [fetchDashboardData, fetchAlerts]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const greeting = () => {
    const hour = currentTime.getHours();
    if (hour < 12) return 'Bonjour';
    if (hour < 18) return 'Bon après-midi';
    return 'Bonsoir';
  };

  // Get user's first name for greeting
  const firstName = user?.first_name || getFullName(user)?.split(' ')[0] || '';

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-8"
    >
      {/* Header */}
      <motion.div variants={itemVariants}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-semibold text-gray-900">
              {greeting()}, {firstName}
            </h1>
            <p className="mt-1 text-gray-500">
              {currentTime.toLocaleDateString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" leftIcon={<Calendar className="h-4 w-4" />} onClick={() => navigate('/planning')}>
              Voir le planning
            </Button>
            <Button variant="primary" leftIcon={<Shield className="h-4 w-4" />} onClick={() => navigate('/guards')}>
              Nouvelle garde
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Stats Grid */}
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <StatCard
          title="Prochaines gardes"
          value={stats.upcomingWeek}
          icon={Calendar}
          color="gold"
        />
        <StatCard
          title="Activités du mois"
          value={stats.guardsToday}
          icon={Shield}
          color="blue"
        />
        <StatCard
          title="Alertes"
          value={stats.alertsCount}
          icon={AlertTriangle}
          color="red"
        />
      </motion.div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upcoming Guards - Large Block */}
        <motion.div variants={itemVariants} className="lg:col-span-2">
          <Card variant="elevated">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-gold-500" />
                Prochaines gardes
              </CardTitle>
              <Button variant="ghost" size="sm" rightIcon={<ArrowRight className="h-4 w-4" />} onClick={() => navigate('/guards')}>
                Voir tout
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center">
                  <Loader2 className="h-6 w-6 text-gold-500 mx-auto animate-spin" />
                </div>
              ) : (
              <div className="divide-y divide-marble-100">
                {/* TODO: Replace with actual upcoming guards data */}
                {recentGuards.length > 0 ? recentGuards.slice(0, 3).map((guard) => {
                  return (
                  <div
                    key={guard.guard_id}
                    className="flex items-center justify-between p-4 hover:bg-marble-50 transition-colors cursor-pointer"
                    onClick={() => navigate('/guards')}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-gold-100 text-gold-600 rounded-xl flex items-center justify-center font-semibold">
                        {new Date(guard.guard_date).getDate()}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">
                          {formatDate(guard.guard_date)}
                        </p>
                        <p className="text-sm text-gray-500">
                          {guard.start_time} - {guard.end_time} • {guard.geo_id}
                        </p>
                      </div>
                    </div>
                    <Badge variant="info">
                      Confirmée
                    </Badge>
                  </div>
                );
                }) : (
                  <div className="p-8 text-center text-gray-500">
                    <Calendar className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p>Aucune garde programmée</p>
                    <Button variant="secondary" size="sm" className="mt-4" onClick={() => navigate('/guards')}>
                      Planifier une garde
                    </Button>
                  </div>
                )}
              </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Alerts - Important */}
        <motion.div variants={itemVariants}>
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-gold-500" />
                Alertes
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-marble-100">
                {alerts.filter(a => a.type === 'warning' || a.type === 'error').length > 0 ? alerts.filter(a => a.type === 'warning' || a.type === 'error').slice(0, 3).map((alert) => (
                  <div key={alert.id} className="p-4 hover:bg-marble-50 transition-colors cursor-pointer">
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
                        alert.type === 'warning' && 'bg-amber-100 text-amber-600',
                        alert.type === 'error' && 'bg-red-100 text-red-600'
                      )}>
                        <AlertTriangle className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 font-medium">{alert.message}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {formatRelativeTime(alert.time)}
                        </p>
                      </div>
                    </div>
                  </div>
                )) : (
                  <div className="p-8 text-center text-gray-500">
                    <CheckCircle className="h-12 w-12 mx-auto mb-3 text-green-300" />
                    <p>Aucune alerte</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Secondary Grid - Recent Guards */}
      <motion.div variants={itemVariants}>
        <Card variant="elevated">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-gold-500" />
              Gardes récentes
            </CardTitle>
            <Button variant="ghost" size="sm" rightIcon={<ArrowRight className="h-4 w-4" />} onClick={() => navigate('/guards')}>
              Voir tout
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center">
                <Loader2 className="h-6 w-6 text-gold-500 mx-auto animate-spin" />
              </div>
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
              {recentGuards.length > 0 ? recentGuards.slice(0, 6).map((guard) => {
                const statusInfo = getGuardStatusInfo(guard.status);
                return (
                <div
                  key={guard.guard_id}
                  className="p-4 border border-marble-200 rounded-xl hover:border-gold-300 hover:bg-marble-50 transition-all cursor-pointer"
                  onClick={() => navigate('/guards')}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center',
                      guard.status === 'full' && 'bg-green-100 text-green-600',
                      guard.status === 'open' && 'bg-amber-100 text-amber-600',
                      guard.status === 'closed' && 'bg-blue-100 text-blue-600'
                    )}>
                      <MapPin className="h-5 w-5" />
                    </div>
                    <Badge variant={statusInfo.variant} size="sm">
                      {statusInfo.label}
                    </Badge>
                  </div>
                  <p className="font-medium text-gray-900">{guard.geo_id}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {formatDate(guard.guard_date)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {guard.start_time} - {guard.end_time}
                  </p>
                </div>
              );
              }) : (
                <div className="col-span-full p-8 text-center text-gray-500">
                  Aucune garde récente
                </div>
              )}
            </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Weekly Overview */}
      <motion.div variants={itemVariants}>
        <Card variant="elevated">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-gold-500" />
              Ma semaine
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-2">
              {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((day, index) => {
                const today = new Date();
                const dayDate = new Date(today);
                dayDate.setDate(today.getDate() - today.getDay() + index + 1);
                const isToday = dayDate.toDateString() === today.toDateString();
                // TODO: Replace with actual guard/activity data for each day
                const hasGuard = index === 2 || index === 5; // Mock data
                const hasActivity = index === 1 || index === 4; // Mock data

                return (
                  <div
                    key={day}
                    className={cn(
                      'p-3 rounded-xl border-2 transition-all cursor-pointer hover:scale-105',
                      isToday ? 'border-gold-500 bg-gold-50' : 'border-marble-200 bg-white hover:border-gold-300'
                    )}
                    onClick={() => navigate('/planning')}
                  >
                    <p className={cn(
                      'text-xs font-medium text-center mb-2',
                      isToday ? 'text-gold-700' : 'text-gray-500'
                    )}>
                      {day}
                    </p>
                    <p className={cn(
                      'text-lg font-semibold text-center mb-2',
                      isToday ? 'text-gold-700' : 'text-gray-900'
                    )}>
                      {dayDate.getDate()}
                    </p>
                    <div className="flex flex-col gap-1">
                      {hasGuard && (
                        <div className="w-full h-1.5 bg-gold-500 rounded-full" title="Garde"></div>
                      )}
                      {hasActivity && (
                        <div className="w-full h-1.5 bg-blue-500 rounded-full" title="Activité"></div>
                      )}
                      {!hasGuard && !hasActivity && (
                        <div className="w-full h-1.5 bg-transparent"></div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-center gap-6 mt-6 pt-4 border-t border-marble-200">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-gold-500 rounded-full"></div>
                <span className="text-sm text-gray-600">Gardes</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                <span className="text-sm text-gray-600">Activités</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/planning')}>
                Voir le planning complet
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

export default DashboardPage;
