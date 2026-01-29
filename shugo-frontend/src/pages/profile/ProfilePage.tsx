import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  User,
  Mail,
  Phone,
  Shield,
  Camera,
  Save,
  Key,
  Bell,
  Clock,
  Calendar,
  MapPin,
  Loader2,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Badge, Avatar } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { useGuardsStore } from '@/stores/guardsStore';
import { getFullName, formatRole, formatDate } from '@/lib/utils';

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

export function ProfilePage() {
  const { user } = useAuthStore();
  const { mySchedule, isLoading, fetchMySchedule } = useGuardsStore();
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    fetchMySchedule();
  }, [fetchMySchedule]);

  // Calculate stats from my schedule
  const currentMonthGuards = mySchedule.filter((g) => {
    const guardDate = new Date(g.guard_date);
    const now = new Date();
    return guardDate.getMonth() === now.getMonth() && guardDate.getFullYear() === now.getFullYear();
  });

  const stats = {
    totalGuards: mySchedule.length,
    hoursWorked: mySchedule.length * 8, // Estimate 8h per guard
    completionRate: mySchedule.filter((g) => g.status === 'closed').length / Math.max(mySchedule.length, 1) * 100,
    currentMonth: currentMonthGuards.length,
  };

  const userName = getFullName(user);

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* Header */}
      <motion.div variants={itemVariants}>
        <h1 className="text-3xl font-display font-semibold text-gray-900 flex items-center gap-3">
          <User className="h-8 w-8 text-gold-500" />
          Mon Profil
        </h1>
        <p className="mt-1 text-gray-500">
          Gérez vos informations personnelles
        </p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <motion.div variants={itemVariants} className="lg:col-span-1">
          <Card variant="elevated" padding="lg">
            <div className="text-center">
              {/* Avatar */}
              <div className="relative inline-block">
                <Avatar
                  src={user?.avatar_url}
                  name={userName || 'User'}
                  size="2xl"
                  ring="gold"
                />
                <button className="absolute bottom-0 right-0 p-2 bg-gold-500 rounded-full text-white hover:bg-gold-600 transition-colors shadow-lg">
                  <Camera className="h-4 w-4" />
                </button>
              </div>

              <h2 className="mt-4 text-xl font-display font-semibold text-gray-900">
                {userName}
              </h2>
              <p className="text-gray-500">{user?.email}</p>

              <div className="mt-3">
                <Badge
                  variant={user?.role === 'Admin_N1' ? 'error' : user?.role === 'Admin' ? 'warning' : 'gold'}
                  size="md"
                >
                  {formatRole(user?.role || '')}
                </Badge>
              </div>

              {/* Quick Stats */}
              <div className="mt-6 pt-6 border-t border-marble-100">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-semibold text-gold-600">{stats.totalGuards}</p>
                    <p className="text-sm text-gray-500">Gardes programmées</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-semibold text-gold-600">{stats.currentMonth}</p>
                    <p className="text-sm text-gray-500">Ce mois</p>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-marble-100">
                <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                  <Calendar className="h-4 w-4" />
                  Membre depuis {user?.created_at ? formatDate(user.created_at) : 'N/A'}
                </div>
              </div>
            </div>
          </Card>

          {/* Security Card */}
          <Card variant="default" padding="md" className="mt-4">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Key className="h-5 w-5 text-gold-500" />
                Sécurité
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Authentification 2FA</span>
                  <Badge variant={user?.two_factor_enabled ? 'success' : 'warning'} size="sm">
                    {user?.two_factor_enabled ? 'Activée' : 'Désactivée'}
                  </Badge>
                </div>
                <Button variant="secondary" size="sm" className="w-full">
                  Changer le mot de passe
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Main Content */}
        <motion.div variants={itemVariants} className="lg:col-span-2 space-y-6">
          {/* Personal Info */}
          <Card variant="elevated">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-gold-500" />
                Informations personnelles
              </CardTitle>
              <Button
                variant={isEditing ? 'primary' : 'secondary'}
                size="sm"
                leftIcon={isEditing ? <Save className="h-4 w-4" /> : undefined}
                onClick={() => setIsEditing(!isEditing)}
              >
                {isEditing ? 'Enregistrer' : 'Modifier'}
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Prénom"
                  defaultValue={user?.first_name || ''}
                  disabled={!isEditing}
                  leftIcon={<User className="h-5 w-5" />}
                />
                <Input
                  label="Nom"
                  defaultValue={user?.last_name || ''}
                  disabled={!isEditing}
                  leftIcon={<User className="h-5 w-5" />}
                />
                <Input
                  label="Email"
                  type="email"
                  defaultValue={user?.email || ''}
                  disabled={!isEditing}
                  leftIcon={<Mail className="h-5 w-5" />}
                />
                <Input
                  label="Téléphone"
                  defaultValue={user?.phone || ''}
                  disabled={!isEditing}
                  leftIcon={<Phone className="h-5 w-5" />}
                />
              </div>
            </CardContent>
          </Card>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card variant="default" padding="md">
              <div className="text-center">
                <Shield className="h-6 w-6 text-gold-500 mx-auto mb-2" />
                <p className="text-2xl font-semibold text-gray-900">{stats.currentMonth}</p>
                <p className="text-xs text-gray-500">Gardes ce mois</p>
              </div>
            </Card>
            <Card variant="default" padding="md">
              <div className="text-center">
                <Clock className="h-6 w-6 text-blue-500 mx-auto mb-2" />
                <p className="text-2xl font-semibold text-gray-900">{stats.currentMonth * 8}h</p>
                <p className="text-xs text-gray-500">Heures estimées</p>
              </div>
            </Card>
            <Card variant="default" padding="md">
              <div className="text-center">
                <Calendar className="h-6 w-6 text-green-500 mx-auto mb-2" />
                <p className="text-2xl font-semibold text-gray-900">{Math.round(stats.completionRate)}%</p>
                <p className="text-xs text-gray-500">Gardes terminées</p>
              </div>
            </Card>
            <Card variant="default" padding="md">
              <div className="text-center">
                <MapPin className="h-6 w-6 text-purple-500 mx-auto mb-2" />
                <p className="text-2xl font-semibold text-gray-900">
                  {new Set(mySchedule.map((g) => g.geo_id)).size}
                </p>
                <p className="text-xs text-gray-500">Lieux différents</p>
              </div>
            </Card>
          </div>

          {/* Recent Guards */}
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-gold-500" />
                Mes gardes récentes
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center">
                  <Loader2 className="h-6 w-6 text-gold-500 mx-auto animate-spin" />
                </div>
              ) : (
              <div className="divide-y divide-marble-100">
                {mySchedule.length > 0 ? mySchedule.slice(0, 5).map((guard) => (
                  <div key={guard.guard_id} className="p-4 hover:bg-marble-50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-gold-100 rounded-xl flex items-center justify-center">
                        <Shield className="h-5 w-5 text-gold-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">Garde {guard.geo_id}</p>
                        <p className="text-sm text-gray-500">{guard.start_time} - {guard.end_time}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-900">{formatDate(guard.guard_date)}</p>
                        <Badge
                          variant={guard.status === 'full' ? 'success' : guard.status === 'open' ? 'warning' : 'default'}
                          size="sm"
                        >
                          {guard.status === 'full' ? 'Confirmé' : guard.status === 'open' ? 'Ouvert' : 'Terminé'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                )) : (
                  <div className="p-8 text-center text-gray-500">
                    Aucune garde programmée
                  </div>
                )}
              </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}

export default ProfilePage;
