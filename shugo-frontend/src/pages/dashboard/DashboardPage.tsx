import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Shield,
  Users,
  Calendar,
  AlertTriangle,
  TrendingUp,
  MapPin,
  Bell,
  ArrowRight,
  CheckCircle,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { cn, formatRelativeTime, getFullName } from '@/lib/utils';

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

// Mock data for demonstration
const mockRecentGuards = [
  {
    id: '1',
    location: 'Basilique Saint-Pierre',
    date: new Date(Date.now() + 2 * 60 * 60 * 1000),
    status: 'upcoming',
    assignedTo: 'Marco Bianchi',
  },
  {
    id: '2',
    location: 'Chapelle Sixtine',
    date: new Date(Date.now() - 1 * 60 * 60 * 1000),
    status: 'active',
    assignedTo: 'Luigi Romano',
  },
  {
    id: '3',
    location: 'Musées du Vatican',
    date: new Date(Date.now() - 5 * 60 * 60 * 1000),
    status: 'completed',
    assignedTo: 'Giovanni Rossi',
  },
];

const mockAlerts = [
  {
    id: '1',
    type: 'warning',
    message: 'Garde non assignée demain à 14h',
    time: new Date(Date.now() - 30 * 60 * 1000),
  },
  {
    id: '2',
    type: 'info',
    message: 'Nouveau lieu ajouté: Jardin du Vatican',
    time: new Date(Date.now() - 2 * 60 * 60 * 1000),
  },
  {
    id: '3',
    type: 'success',
    message: 'Rapport mensuel généré avec succès',
    time: new Date(Date.now() - 4 * 60 * 60 * 1000),
  },
];

export function DashboardPage() {
  const { user } = useAuthStore();
  const [currentTime, setCurrentTime] = useState(new Date());

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
            <Button variant="secondary" leftIcon={<Calendar className="h-4 w-4" />}>
              Voir le planning
            </Button>
            <Button variant="primary" leftIcon={<Shield className="h-4 w-4" />}>
              Nouvelle garde
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Stats Grid */}
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <StatCard
          title="Gardes aujourd'hui"
          value={12}
          change="+2 vs hier"
          changeType="positive"
          icon={Shield}
          color="gold"
        />
        <StatCard
          title="Gardes actifs"
          value={8}
          icon={Users}
          color="green"
        />
        <StatCard
          title="À venir (7j)"
          value={45}
          change="+12%"
          changeType="positive"
          icon={Calendar}
          color="blue"
        />
        <StatCard
          title="Alertes"
          value={3}
          icon={AlertTriangle}
          color="red"
        />
      </motion.div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Guards */}
        <motion.div variants={itemVariants} className="lg:col-span-2">
          <Card variant="elevated">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-gold-500" />
                Gardes récentes
              </CardTitle>
              <Button variant="ghost" size="sm" rightIcon={<ArrowRight className="h-4 w-4" />}>
                Voir tout
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-marble-100">
                {mockRecentGuards.map((guard) => (
                  <div
                    key={guard.id}
                    className="flex items-center justify-between p-4 hover:bg-marble-50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        'w-10 h-10 rounded-xl flex items-center justify-center',
                        guard.status === 'active' && 'bg-green-100 text-green-600',
                        guard.status === 'upcoming' && 'bg-blue-100 text-blue-600',
                        guard.status === 'completed' && 'bg-gray-100 text-gray-600'
                      )}>
                        <MapPin className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{guard.location}</p>
                        <p className="text-sm text-gray-500">
                          {guard.assignedTo} • {formatRelativeTime(guard.date)}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={
                        guard.status === 'active' ? 'success' :
                        guard.status === 'upcoming' ? 'info' : 'default'
                      }
                    >
                      {guard.status === 'active' && 'En cours'}
                      {guard.status === 'upcoming' && 'À venir'}
                      {guard.status === 'completed' && 'Terminée'}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Alerts & Notifications */}
        <motion.div variants={itemVariants}>
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-gold-500" />
                Notifications
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-marble-100">
                {mockAlerts.map((alert) => (
                  <div key={alert.id} className="p-4 hover:bg-marble-50 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
                        alert.type === 'warning' && 'bg-amber-100 text-amber-600',
                        alert.type === 'info' && 'bg-blue-100 text-blue-600',
                        alert.type === 'success' && 'bg-green-100 text-green-600'
                      )}>
                        {alert.type === 'warning' && <AlertTriangle className="h-4 w-4" />}
                        {alert.type === 'info' && <Bell className="h-4 w-4" />}
                        {alert.type === 'success' && <CheckCircle className="h-4 w-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900">{alert.message}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {formatRelativeTime(alert.time)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Quick Actions */}
      <motion.div variants={itemVariants}>
        <Card variant="gold" padding="lg">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gold-500 rounded-xl flex items-center justify-center">
                <Calendar className="h-6 w-6 text-white" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-gray-900">
                  Planifiez vos gardes
                </h3>
                <p className="text-gray-600">
                  Gérez efficacement le planning de la semaine
                </p>
              </div>
            </div>
            <Button variant="primary" rightIcon={<ArrowRight className="h-4 w-4" />}>
              Accéder au planning
            </Button>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  );
}

export default DashboardPage;
