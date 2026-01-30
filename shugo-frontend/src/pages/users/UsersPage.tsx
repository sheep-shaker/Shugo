import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  Plus,
  Search,
  Filter,
  MoreVertical,
  Eye,
  Edit,
  Trash2,
  Shield,
  Mail,
  UserCheck,
  UserX,
  Loader2,
  AlertCircle,
  Key,
  RefreshCw,
  QrCode,
  Copy,
  Check,
  X,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Badge, Avatar } from '@/components/ui';
import { cn, getFullName, formatRole, formatDate } from '@/lib/utils';
import { useUsersStore } from '@/stores/usersStore';
import { usersService, type Reset2FAResponse } from '@/services/users.service';

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

type FilterRole = 'all' | 'Admin_N1' | 'Admin' | 'Platinum' | 'Gold' | 'Silver';
type FilterStatus = 'all' | 'active' | 'inactive' | 'suspended';

export function UsersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState<FilterRole>('all');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Modal states
  const [showCreateTokenModal, setShowCreateTokenModal] = useState(false);
  const [showTokenResultModal, setShowTokenResultModal] = useState(false);
  const [show2FAResultModal, setShow2FAResultModal] = useState(false);
  const [showPasswordResultModal, setShowPasswordResultModal] = useState(false);

  // Form states
  const [tokenForm, setTokenForm] = useState({
    first_name: '',
    last_name: '',
    role: 'Silver',
    geo_id: '02-033-04-01-00',
  });
  const [createdTokenCode, setCreatedTokenCode] = useState<string | null>(null);
  const [reset2FAResult, setReset2FAResult] = useState<Reset2FAResponse | null>(null);
  const [resetPasswordToken, setResetPasswordToken] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const { users, isLoading, error, pagination, fetchUsers, deleteUser } = useUsersStore();

  // Copy to clipboard helper
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // Create registration token
  const handleCreateToken = async () => {
    setActionLoading(true);
    setActionError(null);
    try {
      const result = await usersService.createRegistrationToken(tokenForm);
      setCreatedTokenCode(result.token_code);
      setShowCreateTokenModal(false);
      setShowTokenResultModal(true);
      setTokenForm({ first_name: '', last_name: '', role: 'Silver', geo_id: '02-033-04-01-00' });
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { message?: string } } };
      setActionError(apiError?.response?.data?.message || 'Erreur lors de la création du jeton');
    } finally {
      setActionLoading(false);
    }
  };

  // Admin reset 2FA
  const handleReset2FA = async (userId: string) => {
    if (!confirm('Êtes-vous sûr de vouloir réinitialiser le 2FA de cet utilisateur ?')) return;
    setActionLoading(true);
    setOpenMenuId(null);
    try {
      const result = await usersService.adminReset2FA(userId);
      setReset2FAResult(result);
      setShow2FAResultModal(true);
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { message?: string } } };
      alert(apiError?.response?.data?.message || 'Erreur lors de la réinitialisation 2FA');
    } finally {
      setActionLoading(false);
    }
  };

  // Admin reset password
  const handleResetPassword = async (userId: string) => {
    if (!confirm('Êtes-vous sûr de vouloir réinitialiser le mot de passe de cet utilisateur ?')) return;
    setActionLoading(true);
    setOpenMenuId(null);
    try {
      const result = await usersService.adminResetPassword(userId);
      setResetPasswordToken(result.reset_token);
      setShowPasswordResultModal(true);
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { message?: string } } };
      alert(apiError?.response?.data?.message || 'Erreur lors de la réinitialisation du mot de passe');
    } finally {
      setActionLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers({ limit: 50 });
  }, [fetchUsers]);

  const filteredUsers = users.filter((user) => {
    const fullName = getFullName(user).toLowerCase();
    const matchesSearch =
      fullName.includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = filterRole === 'all' || user.role === filterRole;
    const matchesStatus = filterStatus === 'all' || user.status === filterStatus;
    return matchesSearch && matchesRole && matchesStatus;
  });

  const getRoleBadgeVariant = (role: string) => {
    const variants: Record<string, 'error' | 'warning' | 'info' | 'gold' | 'success'> = {
      Admin_N1: 'error',
      Admin: 'warning',
      Platinum: 'info',
      Gold: 'gold',
      Silver: 'success',
    };
    return variants[role] || 'default';
  };

  const getStatusBadgeVariant = (status: string) => {
    const variants: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
      active: 'success',
      inactive: 'default',
      suspended: 'error',
    };
    return variants[status] || 'default';
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      active: 'Actif',
      inactive: 'Inactif',
      suspended: 'Suspendu',
    };
    return labels[status] || status;
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
              <Users className="h-8 w-8 text-gold-500" />
              Gestion des Utilisateurs
            </h1>
            <p className="mt-1 text-gray-500">
              Gérez les comptes et permissions des utilisateurs
            </p>
          </div>
          <Button
            variant="primary"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => setShowCreateTokenModal(true)}
          >
            Créer un jeton d'inscription
          </Button>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gold-100 rounded-xl flex items-center justify-center">
              <Users className="h-5 w-5 text-gold-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">{pagination.total}</p>
              <p className="text-sm text-gray-500">Total utilisateurs</p>
            </div>
          </div>
        </Card>
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
              <UserCheck className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">
                {users.filter((u) => u.status === 'active').length}
              </p>
              <p className="text-sm text-gray-500">Actifs</p>
            </div>
          </div>
        </Card>
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
              <UserX className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">
                {users.filter((u) => u.status === 'suspended').length}
              </p>
              <p className="text-sm text-gray-500">Suspendus</p>
            </div>
          </div>
        </Card>
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
              <Shield className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">
                {users.filter((u) => u.role === 'Admin_N1' || u.role === 'Admin').length}
              </p>
              <p className="text-sm text-gray-500">Administrateurs</p>
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

      {/* Filters */}
      <motion.div variants={itemVariants}>
        <Card variant="default" padding="md">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Search */}
            <div className="flex-1">
              <Input
                placeholder="Rechercher un utilisateur..."
                leftIcon={<Search className="h-5 w-5" />}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {/* Role Filter */}
            <div className="flex gap-2 flex-wrap">
              <div className="flex items-center gap-2 mr-2">
                <Filter className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-500">Rôle:</span>
              </div>
              {[
                { value: 'all', label: 'Tous' },
                { value: 'Admin_N1', label: 'Admin N1' },
                { value: 'Admin', label: 'Admin' },
                { value: 'Platinum', label: 'Platinum' },
                { value: 'Gold', label: 'Gold' },
                { value: 'Silver', label: 'Silver' },
              ].map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => setFilterRole(filter.value as FilterRole)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                    filterRole === filter.value
                      ? 'bg-gold-500 text-white'
                      : 'bg-marble-100 text-gray-600 hover:bg-marble-200'
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
          {/* Status Filter */}
          <div className="flex gap-2 flex-wrap mt-3 pt-3 border-t border-marble-100">
            <div className="flex items-center gap-2 mr-2">
              <span className="text-sm text-gray-500">Statut:</span>
            </div>
            {[
              { value: 'all', label: 'Tous' },
              { value: 'active', label: 'Actifs' },
              { value: 'inactive', label: 'Inactifs' },
              { value: 'suspended', label: 'Suspendus' },
            ].map((filter) => (
              <button
                key={filter.value}
                onClick={() => setFilterStatus(filter.value as FilterStatus)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                  filterStatus === filter.value
                    ? 'bg-gold-500 text-white'
                    : 'bg-marble-100 text-gray-600 hover:bg-marble-200'
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </Card>
      </motion.div>

      {/* Users Table */}
      <motion.div variants={itemVariants}>
        <Card variant="elevated">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-gold-500" />
              Liste des utilisateurs ({filteredUsers.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {/* Loading State */}
            {isLoading && (
              <div className="p-12 text-center">
                <Loader2 className="h-8 w-8 text-gold-500 mx-auto mb-4 animate-spin" />
                <p className="text-gray-500">Chargement des utilisateurs...</p>
              </div>
            )}

            {!isLoading && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-marble-50 border-b border-marble-200">
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">
                      Utilisateur
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">
                      Email
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">
                      Rôle
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">
                      Statut
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">
                      Zone
                    </th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-marble-100">
                  {filteredUsers.map((user) => (
                    <tr key={user.member_id} className="hover:bg-marble-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <Avatar
                            name={getFullName(user)}
                            size="md"
                          />
                          <div>
                            <p className="font-medium text-gray-900">{getFullName(user)}</p>
                            <p className="text-sm text-gray-500">
                              Membre depuis {formatDate(user.created_at)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Mail className="h-4 w-4" />
                          {user.email}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={getRoleBadgeVariant(user.role)}>
                          {formatRole(user.role)}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={getStatusBadgeVariant(user.status)} size="sm">
                          {getStatusLabel(user.status)}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-gray-600">{user.geo_id}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="relative inline-block">
                          <button
                            onClick={() => setOpenMenuId(openMenuId === user.member_id ? null : user.member_id)}
                            className="p-2 rounded-lg hover:bg-marble-100 transition-colors"
                          >
                            <MoreVertical className="h-5 w-5 text-gray-400" />
                          </button>

                          {openMenuId === user.member_id && (
                            <>
                              <div
                                className="fixed inset-0 z-10"
                                onClick={() => setOpenMenuId(null)}
                              />
                              <div className="absolute right-0 mt-1 w-52 bg-white rounded-xl shadow-lg border border-marble-200 py-1 z-20">
                                <button className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-marble-50 flex items-center gap-2">
                                  <Eye className="h-4 w-4" />
                                  Voir profil
                                </button>
                                <button className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-marble-50 flex items-center gap-2">
                                  <Edit className="h-4 w-4" />
                                  Modifier
                                </button>
                                <div className="border-t border-marble-100 my-1" />
                                <button
                                  onClick={() => handleResetPassword(user.member_id)}
                                  className="w-full px-4 py-2 text-left text-sm text-orange-600 hover:bg-orange-50 flex items-center gap-2"
                                >
                                  <RefreshCw className="h-4 w-4" />
                                  Réinitialiser MDP
                                </button>
                                <button
                                  onClick={() => handleReset2FA(user.member_id)}
                                  className="w-full px-4 py-2 text-left text-sm text-purple-600 hover:bg-purple-50 flex items-center gap-2"
                                >
                                  <QrCode className="h-4 w-4" />
                                  Réinitialiser 2FA
                                </button>
                                <div className="border-t border-marble-100 my-1" />
                                <button
                                  onClick={() => {
                                    if (confirm('Êtes-vous sûr de vouloir supprimer cet utilisateur ?')) {
                                      deleteUser(user.member_id);
                                      setOpenMenuId(null);
                                    }
                                  }}
                                  className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Supprimer
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredUsers.length === 0 && (
                <div className="p-12 text-center">
                  <Users className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">Aucun utilisateur trouvé</p>
                </div>
              )}
            </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Modal: Create Registration Token */}
      {showCreateTokenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowCreateTokenModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 m-4">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gold-100 rounded-xl flex items-center justify-center">
                  <Key className="h-5 w-5 text-gold-600" />
                </div>
                <h3 className="text-lg font-semibold">Créer un jeton d'inscription</h3>
              </div>
              <button
                onClick={() => setShowCreateTokenModal(false)}
                className="p-2 rounded-lg hover:bg-marble-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prénom</label>
                  <input
                    type="text"
                    value={tokenForm.first_name}
                    onChange={(e) => setTokenForm({ ...tokenForm, first_name: e.target.value })}
                    className="w-full px-3 py-2 border border-marble-200 rounded-lg focus:ring-2 focus:ring-gold-500 focus:border-transparent"
                    placeholder="Jean"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
                  <input
                    type="text"
                    value={tokenForm.last_name}
                    onChange={(e) => setTokenForm({ ...tokenForm, last_name: e.target.value })}
                    className="w-full px-3 py-2 border border-marble-200 rounded-lg focus:ring-2 focus:ring-gold-500 focus:border-transparent"
                    placeholder="Dupont"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rôle</label>
                <select
                  value={tokenForm.role}
                  onChange={(e) => setTokenForm({ ...tokenForm, role: e.target.value })}
                  className="w-full px-3 py-2 border border-marble-200 rounded-lg focus:ring-2 focus:ring-gold-500 focus:border-transparent"
                >
                  <option value="Silver">Silver</option>
                  <option value="Gold">Gold</option>
                  <option value="Platinum">Platinum</option>
                  <option value="Admin">Admin</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Zone géographique</label>
                <select
                  value={tokenForm.geo_id}
                  onChange={(e) => setTokenForm({ ...tokenForm, geo_id: e.target.value })}
                  className="w-full px-3 py-2 border border-marble-200 rounded-lg focus:ring-2 focus:ring-gold-500 focus:border-transparent"
                >
                  <option value="02-033-04-01-00">Nice (02-033-04-01-00)</option>
                  <option value="02-033-04-01-01">Cannes (02-033-04-01-01)</option>
                  <option value="02-033-04-01-02">Saint Raphaël (02-033-04-01-02)</option>
                </select>
              </div>

              {actionError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                  {actionError}
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setShowCreateTokenModal(false)}
                >
                  Annuler
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleCreateToken}
                  isLoading={actionLoading}
                >
                  Créer le jeton
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Token Created Result */}
      {showTokenResultModal && createdTokenCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowTokenResultModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 m-4 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Jeton créé avec succès !</h3>
            <p className="text-gray-500 text-sm mb-4">
              Partagez ce code avec le nouvel utilisateur pour qu'il puisse s'inscrire.
            </p>

            <div
              onClick={() => copyToClipboard(createdTokenCode, 'token')}
              className="flex items-center justify-center gap-3 p-4 bg-marble-50 rounded-xl cursor-pointer hover:bg-marble-100 transition-colors"
            >
              <code className="text-2xl font-mono font-bold text-gold-600">{createdTokenCode}</code>
              {copiedText === 'token' ? (
                <Check className="h-5 w-5 text-green-500" />
              ) : (
                <Copy className="h-5 w-5 text-gray-400" />
              )}
            </div>

            <p className="text-xs text-gray-400 mt-3">
              Cliquez pour copier • Expire dans 7 jours
            </p>

            <Button
              variant="primary"
              className="w-full mt-6"
              onClick={() => setShowTokenResultModal(false)}
            >
              Fermer
            </Button>
          </div>
        </div>
      )}

      {/* Modal: 2FA Reset Result */}
      {show2FAResultModal && reset2FAResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShow2FAResultModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 m-4">
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto mb-4 bg-purple-100 rounded-full flex items-center justify-center">
                <QrCode className="h-8 w-8 text-purple-600" />
              </div>
              <h3 className="text-lg font-semibold">2FA réinitialisé</h3>
              <p className="text-gray-500 text-sm">
                Partagez ce QR code avec l'utilisateur
              </p>
            </div>

            <div className="flex justify-center mb-4">
              <img src={reset2FAResult.qr_code} alt="QR Code 2FA" className="w-40 h-40" />
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">Code secret (si QR impossible)</label>
                <div
                  onClick={() => copyToClipboard(reset2FAResult.secret, 'secret')}
                  className="flex items-center justify-between p-2 bg-marble-50 rounded-lg cursor-pointer hover:bg-marble-100"
                >
                  <code className="text-sm font-mono">{reset2FAResult.secret}</code>
                  {copiedText === 'secret' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4 text-gray-400" />}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Jeton de configuration</label>
                <div
                  onClick={() => copyToClipboard(reset2FAResult.reset_token, 'resetToken')}
                  className="flex items-center justify-between p-2 bg-marble-50 rounded-lg cursor-pointer hover:bg-marble-100"
                >
                  <code className="text-sm font-mono">{reset2FAResult.reset_token}</code>
                  {copiedText === 'resetToken' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4 text-gray-400" />}
                </div>
              </div>
            </div>

            <Button
              variant="primary"
              className="w-full mt-6"
              onClick={() => {
                setShow2FAResultModal(false);
                setReset2FAResult(null);
              }}
            >
              Fermer
            </Button>
          </div>
        </div>
      )}

      {/* Modal: Password Reset Result */}
      {showPasswordResultModal && resetPasswordToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowPasswordResultModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 m-4 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-orange-100 rounded-full flex items-center justify-center">
              <RefreshCw className="h-8 w-8 text-orange-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Mot de passe réinitialisé</h3>
            <p className="text-gray-500 text-sm mb-4">
              Partagez ce lien avec l'utilisateur pour qu'il définisse un nouveau mot de passe.
            </p>

            <div className="p-3 bg-marble-50 rounded-lg text-left mb-4">
              <label className="text-xs text-gray-500 mb-1 block">Jeton de réinitialisation</label>
              <div
                onClick={() => copyToClipboard(resetPasswordToken, 'pwdToken')}
                className="flex items-center justify-between cursor-pointer"
              >
                <code className="text-sm font-mono break-all">{resetPasswordToken}</code>
                {copiedText === 'pwdToken' ? <Check className="h-4 w-4 text-green-500 ml-2 flex-shrink-0" /> : <Copy className="h-4 w-4 text-gray-400 ml-2 flex-shrink-0" />}
              </div>
            </div>

            <p className="text-xs text-gray-400">
              L'utilisateur doit se rendre sur la page de réinitialisation avec ce jeton • Expire dans 1 heure
            </p>

            <Button
              variant="primary"
              className="w-full mt-6"
              onClick={() => {
                setShowPasswordResultModal(false);
                setResetPasswordToken(null);
              }}
            >
              Fermer
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default UsersPage;
