import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Plus,
  Search,
  Eye,
  Shield,
  MapPin,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Building2,
  UserCheck,
  Crown,
} from 'lucide-react';
import { Card, Button, Input, Badge, AvatarGroup } from '@/components/ui';
import { isAdmin as checkIsAdmin, getFullName } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useGroupsStore } from '@/stores/groupsStore';

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

export function GroupsPage() {
  const { user } = useAuthStore();
  const { myGroups, isLoading, error, fetchMyGroups } = useGroupsStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const userIsAdmin = checkIsAdmin(user?.role);

  // Titre de la page selon le rôle
  const getPageTitle = () => {
    if (userIsAdmin) return 'Gestion des Groupes';
    if (user?.role === 'Platinum') return 'Mes Groupes';
    if (user?.role === 'Gold') return 'Mon Groupe';
    return 'Mes Groupes';
  };

  const getPageDescription = () => {
    if (userIsAdmin) return 'Gérez tous les groupes de l\'organisation';
    if (user?.role === 'Platinum') return 'Gérez vos groupes et sous-groupes';
    if (user?.role === 'Gold') return 'Coordonnez votre groupe';
    return 'Consultez vos groupes';
  };

  useEffect(() => {
    fetchMyGroups();
  }, [fetchMyGroups]);

  // Auto-expand groups on first load
  useEffect(() => {
    if (myGroups.length > 0 && expandedGroups.size === 0) {
      const activeGroupIds = myGroups
        .filter(group => group.is_active && group.children && group.children.length > 0)
        .map(group => group.group_id);
      setExpandedGroups(new Set(activeGroupIds));
    }
  }, [myGroups]);

  const toggleExpand = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const filteredGroups = myGroups.filter((group) =>
    group.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    group.geo_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    group.leader?.first_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    group.leader?.last_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Calculer les statistiques
  const totalGroups = myGroups.length;
  const totalMembers = myGroups.reduce((sum, group) => sum + (group.members_count || 0), 0);
  const totalGuards = myGroups.reduce((sum, group) => sum + (group.active_guards || 0), 0);

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
              <Users className="h-8 w-8 text-gold-500" />
              {getPageTitle()}
            </h1>
            <p className="mt-1 text-gray-500">
              {getPageDescription()}
            </p>
          </div>
          {(userIsAdmin || user?.role === 'Platinum') && (
            <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />}>
              Nouveau groupe
            </Button>
          )}
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gold-100 rounded-xl flex items-center justify-center">
              <Users className="h-5 w-5 text-gold-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">{totalGroups}</p>
              <p className="text-sm text-gray-500">
                {totalGroups > 1 ? 'Groupes actifs' : 'Groupe actif'}
              </p>
            </div>
          </div>
        </Card>
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <UserCheck className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">{totalMembers}</p>
              <p className="text-sm text-gray-500">Total membres</p>
            </div>
          </div>
        </Card>
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
              <Shield className="h-5 w-5 text-green-600" />
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
            placeholder="Rechercher un groupe..."
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
              <p className="text-gray-500">Chargement des groupes...</p>
            </div>
          </Card>
        </motion.div>
      )}

      {/* Groups List */}
      {!isLoading && (
        <motion.div variants={itemVariants}>
          {filteredGroups.length === 0 ? (
            <Card variant="elevated" padding="lg">
              <div className="text-center py-12">
                <Users className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Aucun groupe
                </h3>
                <p className="text-gray-500 mb-6">
                  {userIsAdmin
                    ? 'Les groupes sont créés automatiquement par le système'
                    : 'Vous n\'êtes pas encore assigné à un groupe'}
                </p>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredGroups.map((group) => (
                <Card key={group.group_id} variant="elevated">
                  {/* Group Header */}
                  <div
                    className="p-4 hover:bg-marble-50 transition-colors cursor-pointer"
                    onClick={() => toggleExpand(group.group_id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 flex-1">
                        {/* Expand button */}
                        {group.children && group.children.length > 0 && (
                          <button
                            className="p-2 rounded-lg hover:bg-marble-100 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpand(group.group_id);
                            }}
                          >
                            {expandedGroups.has(group.group_id) ? (
                              <ChevronDown className="h-5 w-5 text-gray-400" />
                            ) : (
                              <ChevronRight className="h-5 w-5 text-gray-400" />
                            )}
                          </button>
                        )}

                        {/* Icon */}
                        <div className="w-12 h-12 bg-gold-100 rounded-xl flex items-center justify-center">
                          <Users className="h-6 w-6 text-gold-600" />
                        </div>

                        {/* Info */}
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-gray-900">{group.name}</h3>
                            {group.leader && (
                              <Badge variant="gold" size="sm">
                                <Crown className="h-3 w-3 mr-1" />
                                {getFullName(group.leader)}
                              </Badge>
                            )}
                          </div>

                          <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                            <span className="flex items-center gap-1">
                              <MapPin className="h-4 w-4" />
                              {group.geo_id}
                            </span>
                            <span className="flex items-center gap-1">
                              <Users className="h-4 w-4" />
                              {group.members_count || 0} membres
                            </span>
                            <span className="flex items-center gap-1">
                              <Shield className="h-4 w-4" />
                              {group.active_guards || 0} gardes
                            </span>
                            {group.children && group.children.length > 0 && (
                              <span className="text-gray-400">
                                {group.children.length} sous-groupe{group.children.length > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <Badge variant={group.is_active ? 'success' : 'default'} size="sm">
                          {group.is_active ? 'Actif' : 'Inactif'}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<Eye className="h-4 w-4" />}
                          onClick={(e) => {
                            e.stopPropagation();
                            // TODO: Navigate to group details
                          }}
                        >
                          Voir
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Members Preview */}
                  {group.members && group.members.length > 0 && (
                    <div className="px-4 pb-4">
                      <div className="flex items-center justify-between p-3 bg-marble-50 rounded-xl">
                        <AvatarGroup
                          users={group.members.slice(0, 5).map(m => ({
                            name: m.user ? getFullName(m.user) : 'Membre',
                            avatar: m.user?.avatar_url,
                          }))}
                          max={5}
                          size="sm"
                        />
                        <span className="text-sm text-gray-600">
                          {group.members.length} membre{group.members.length > 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Children Groups */}
                  <AnimatePresence>
                    {expandedGroups.has(group.group_id) && group.children && group.children.length > 0 && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden border-t border-marble-200 bg-marble-50"
                      >
                        {group.children.map((child) => (
                          <div
                            key={child.group_id}
                            className="flex items-center justify-between p-4 pl-16 hover:bg-marble-100 transition-colors border-l-2 border-gold-300 ml-8"
                          >
                            <div className="flex items-center gap-3 flex-1">
                              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                                <Building2 className="h-5 w-5 text-blue-600" />
                              </div>
                              <div>
                                <p className="font-medium text-gray-900">{child.name}</p>
                                <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                                  <span>{child.members_count || 0} membres</span>
                                  <span>{child.active_guards || 0} gardes</span>
                                  {child.leader && (
                                    <span className="flex items-center gap-1">
                                      <Crown className="h-3 w-3" />
                                      {getFullName(child.leader)}
                                    </span>
                                  )}
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
                </Card>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

export default GroupsPage;
