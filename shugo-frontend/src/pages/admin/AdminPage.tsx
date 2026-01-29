import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Settings,
  Shield,
  Database,
  Server,
  Key,
  Mail,
  Globe,
  Clock,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Download,
  Upload,
  Users,
  Copy,
  UserPlus,
  Search,
  ChevronDown,
  ChevronUp,
  Activity,
  Info,
  X,
  Edit2,
  Trash2,
  Eye,
  FileText,
  TrendingUp,
  HardDrive,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, Input } from '@/components/ui';
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

interface SystemStatus {
  name: string;
  status: 'online' | 'offline' | 'warning';
  details: string;
  icon: React.ElementType;
  uptime?: string;
  lastCheck?: string;
}

interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: 'active' | 'inactive' | 'suspended';
  lastLogin: string;
  createdAt: string;
  groupId?: string;
}

interface SystemLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'success';
  module: string;
  message: string;
  user?: string;
}

interface SystemMetric {
  label: string;
  value: string | number;
  change?: number;
  icon: React.ElementType;
  color: string;
}

const systemStatuses: SystemStatus[] = [
  { name: 'Base de données', status: 'online', details: 'SQLite - 532 KB', icon: Database, uptime: '99.9%', lastCheck: 'Il y a 2 min' },
  { name: 'Serveur API', status: 'online', details: 'Port 3000', icon: Server, uptime: '100%', lastCheck: 'Il y a 1 min' },
  { name: 'Authentification', status: 'online', details: 'JWT actif', icon: Key, uptime: '100%', lastCheck: 'Il y a 2 min' },
  { name: 'Email (Mailjet)', status: 'online', details: 'Configuré', icon: Mail, uptime: '98.5%', lastCheck: 'Il y a 5 min' },
  { name: 'Matrix', status: 'offline', details: 'Non configuré', icon: Globe, uptime: '0%', lastCheck: 'Jamais' },
];

const mockUsers: AdminUser[] = [
  { id: '1', email: 'admin@shugo.fr', firstName: 'Jean', lastName: 'Dupont', role: 'Admin_N1', status: 'active', lastLogin: '2026-01-26 14:30', createdAt: '2024-01-15', groupId: 'GRP-001' },
  { id: '2', email: 'pierre.martin@shugo.fr', firstName: 'Pierre', lastName: 'Martin', role: 'Admin', status: 'active', lastLogin: '2026-01-26 09:15', createdAt: '2024-03-20', groupId: 'GRP-002' },
  { id: '3', email: 'marie.blanc@shugo.fr', firstName: 'Marie', lastName: 'Blanc', role: 'Platinum', status: 'active', lastLogin: '2026-01-25 18:45', createdAt: '2024-05-10', groupId: 'GRP-003' },
  { id: '4', email: 'luc.bernard@shugo.fr', firstName: 'Luc', lastName: 'Bernard', role: 'Gold', status: 'active', lastLogin: '2026-01-24 12:00', createdAt: '2024-06-01', groupId: 'GRP-004' },
  { id: '5', email: 'sophie.durand@shugo.fr', firstName: 'Sophie', lastName: 'Durand', role: 'Silver', status: 'inactive', lastLogin: '2026-01-20 08:30', createdAt: '2024-08-15' },
  { id: '6', email: 'paul.petit@shugo.fr', firstName: 'Paul', lastName: 'Petit', role: 'Gold', status: 'suspended', lastLogin: '2026-01-15 16:20', createdAt: '2024-09-01', groupId: 'GRP-005' },
];

const mockLogs: SystemLog[] = [
  { id: '1', timestamp: '2026-01-26 14:35:22', level: 'info', module: 'Auth', message: 'Connexion réussie pour admin@shugo.fr', user: 'Jean Dupont' },
  { id: '2', timestamp: '2026-01-26 14:32:15', level: 'success', module: 'Guards', message: 'Nouvelle garde créée: GRD-2026-001', user: 'Pierre Martin' },
  { id: '3', timestamp: '2026-01-26 14:28:03', level: 'warning', module: 'System', message: 'Utilisation mémoire à 78%', user: 'System' },
  { id: '4', timestamp: '2026-01-26 14:15:41', level: 'error', module: 'Email', message: 'Échec envoi notification à sophie.durand@shugo.fr', user: 'System' },
  { id: '5', timestamp: '2026-01-26 14:10:30', level: 'info', module: 'Users', message: 'Mise à jour profil utilisateur #3', user: 'Marie Blanc' },
  { id: '6', timestamp: '2026-01-26 14:05:18', level: 'success', module: 'Backup', message: 'Sauvegarde automatique effectuée avec succès', user: 'System' },
  { id: '7', timestamp: '2026-01-26 13:55:09', level: 'warning', module: 'Database', message: 'Requête lente détectée (2.3s)', user: 'System' },
  { id: '8', timestamp: '2026-01-26 13:45:22', level: 'info', module: 'Planning', message: 'Planning mis à jour pour février 2026', user: 'Pierre Martin' },
];

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'system' | 'logs' | 'security'>('overview');
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState('Silver');
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<string>('all');
  const [userStatusFilter, setUserStatusFilter] = useState<string>('all');
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logLevelFilter, setLogLevelFilter] = useState<string>('all');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['status', 'metrics']));
  const [selectedLogs, setSelectedLogs] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const handleSort = (key: string) => {
    setSortConfig(current => {
      if (current?.key === key) {
        return current.direction === 'asc'
          ? { key, direction: 'desc' }
          : null;
      }
      return { key, direction: 'asc' };
    });
  };

  const filteredUsers = useMemo(() => {
    let filtered = mockUsers;

    if (userSearchQuery) {
      filtered = filtered.filter(user =>
        user.email.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
        user.firstName.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
        user.lastName.toLowerCase().includes(userSearchQuery.toLowerCase())
      );
    }

    if (userRoleFilter !== 'all') {
      filtered = filtered.filter(user => user.role === userRoleFilter);
    }

    if (userStatusFilter !== 'all') {
      filtered = filtered.filter(user => user.status === userStatusFilter);
    }

    if (sortConfig) {
      filtered = [...filtered].sort((a, b) => {
        const aValue = a[sortConfig.key as keyof AdminUser];
        const bValue = b[sortConfig.key as keyof AdminUser];

        if (aValue === undefined || bValue === undefined) return 0;

        if (sortConfig.direction === 'asc') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });
    }

    return filtered;
  }, [mockUsers, userSearchQuery, userRoleFilter, userStatusFilter, sortConfig]);

  const filteredLogs = useMemo(() => {
    let filtered = mockLogs;

    if (logSearchQuery) {
      filtered = filtered.filter(log =>
        log.message.toLowerCase().includes(logSearchQuery.toLowerCase()) ||
        log.module.toLowerCase().includes(logSearchQuery.toLowerCase())
      );
    }

    if (logLevelFilter !== 'all') {
      filtered = filtered.filter(log => log.level === logLevelFilter);
    }

    return filtered;
  }, [mockLogs, logSearchQuery, logLevelFilter]);

  const generateToken = () => {
    const token = 'SHUGO-' + Math.random().toString(36).substring(2, 15).toUpperCase() + '-' + Math.random().toString(36).substring(2, 15).toUpperCase();
    setGeneratedToken(token);
  };

  const copyToken = () => {
    if (generatedToken) {
      navigator.clipboard.writeText(generatedToken);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return 'bg-green-100 text-green-600';
      case 'offline':
        return 'bg-gray-100 text-gray-600';
      case 'warning':
        return 'bg-amber-100 text-amber-600';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'online':
        return 'success';
      case 'offline':
        return 'default';
      case 'warning':
        return 'warning';
      default:
        return 'default';
    }
  };

  const getLogLevelColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'text-red-600 bg-red-50';
      case 'warning':
        return 'text-amber-600 bg-amber-50';
      case 'success':
        return 'text-green-600 bg-green-50';
      default:
        return 'text-blue-600 bg-blue-50';
    }
  };

  const getUserStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return 'success';
      case 'inactive':
        return 'default';
      case 'suspended':
        return 'error';
      default:
        return 'default';
    }
  };

  const systemMetrics: SystemMetric[] = [
    { label: 'Utilisateurs actifs', value: mockUsers.filter(u => u.status === 'active').length, change: 5, icon: Users, color: 'blue' },
    { label: 'Gardes ce mois', value: 47, change: 12, icon: Shield, color: 'green' },
    { label: 'Taux disponibilité', value: '99.2%', change: 0.3, icon: TrendingUp, color: 'gold' },
    { label: 'Espace disque', value: '532 KB', icon: HardDrive, color: 'purple' },
  ];

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-4"
    >
      {/* Header - SAP Style */}
      <motion.div variants={itemVariants}>
        <div className="bg-gradient-to-r from-gray-800 to-gray-900 -mx-6 -mt-6 px-6 py-4 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-white flex items-center gap-3">
                <Settings className="h-6 w-6 text-gold-400" />
                Administration système SHUGO v7.0
              </h1>
              <p className="mt-1 text-gray-300 text-sm">
                Gestion centralisée et monitoring du système
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>
                Actualiser
              </Button>
              <Button variant="primary" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />}>
                Export
              </Button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Tabs - SAP Style */}
      <motion.div variants={itemVariants}>
        <div className="flex gap-1 bg-marble-100 p-1 rounded-lg">
          {[
            { id: 'overview', label: 'Vue d\'ensemble', icon: Activity },
            { id: 'users', label: 'Utilisateurs', icon: Users },
            { id: 'system', label: 'Système', icon: Server },
            { id: 'logs', label: 'Journaux', icon: FileText },
            { id: 'security', label: 'Sécurité', icon: Shield },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md transition-all flex-1',
                activeTab === tab.id
                  ? 'bg-white text-gold-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-marble-50'
              )}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Overview Tab - SAP Dashboard Style */}
      {activeTab === 'overview' && (
        <>
          {/* KPI Metrics */}
          <motion.div variants={itemVariants}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {systemMetrics.map((metric, i) => (
                <Card key={i} variant="default" padding="sm" className="border-l-4" style={{ borderLeftColor: `var(--${metric.color}-500)` }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-500 uppercase font-medium">{metric.label}</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{metric.value}</p>
                      {metric.change !== undefined && (
                        <p className={cn('text-xs mt-1 flex items-center gap-1', metric.change >= 0 ? 'text-green-600' : 'text-red-600')}>
                          <TrendingUp className={cn('h-3 w-3', metric.change < 0 && 'rotate-180')} />
                          {metric.change > 0 ? '+' : ''}{metric.change}%
                        </p>
                      )}
                    </div>
                    <div className={cn('p-3 rounded-lg', `bg-${metric.color}-100`)}>
                      <metric.icon className={cn('h-6 w-6', `text-${metric.color}-600`)} />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </motion.div>

          {/* System Status - Compact Table */}
          <motion.div variants={itemVariants}>
            <Card variant="default" padding="none">
              <div className="border-b border-marble-200 bg-marble-50 px-4 py-2.5 flex items-center justify-between cursor-pointer" onClick={() => toggleSection('status')}>
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <Server className="h-4 w-4 text-gold-600" />
                  État des services ({systemStatuses.filter(s => s.status === 'online').length}/{systemStatuses.length})
                </h3>
                {expandedSections.has('status') ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
              </div>
              {expandedSections.has('status') && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-marble-50 border-b border-marble-200">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Service</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Statut</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Détails</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Disponibilité</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Dernière vérif.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-marble-100">
                      {systemStatuses.map((service) => (
                        <tr key={service.name} className="hover:bg-marble-50 transition-colors">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className={cn('p-1.5 rounded', getStatusColor(service.status))}>
                                <service.icon className="h-3.5 w-3.5" />
                              </div>
                              <span className="font-medium text-gray-900">{service.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge variant={getStatusBadge(service.status) as any} size="sm">
                              {service.status === 'online' ? 'En ligne' : service.status === 'offline' ? 'Hors ligne' : 'Attention'}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 text-gray-600">{service.details}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn('font-medium', service.uptime === '100%' || service.uptime === '99.9%' ? 'text-green-600' : service.uptime === '0%' ? 'text-gray-400' : 'text-amber-600')}>
                              {service.uptime}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-gray-500">{service.lastCheck}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </motion.div>

          {/* Recent Activity */}
          <motion.div variants={itemVariants}>
            <Card variant="default" padding="none">
              <div className="border-b border-marble-200 bg-marble-50 px-4 py-2.5 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-gold-600" />
                  Activité récente
                </h3>
                <Button variant="ghost" size="sm">
                  Voir tout
                </Button>
              </div>
              <div className="divide-y divide-marble-100">
                {filteredLogs.slice(0, 5).map((log) => (
                  <div key={log.id} className="px-4 py-2.5 hover:bg-marble-50 transition-colors flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <div className={cn('px-2 py-0.5 rounded text-xs font-medium uppercase', getLogLevelColor(log.level))}>
                        {log.level}
                      </div>
                      <span className="text-xs text-gray-500 font-mono">{log.timestamp}</span>
                      <span className="text-sm text-gray-900">{log.message}</span>
                    </div>
                    <Badge variant="default" size="sm">{log.module}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        </>
      )}

      {/* System Tab */}
      {activeTab === 'system' && (
        <>
          <motion.div variants={itemVariants}>
            <Card variant="default" padding="md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Globe className="h-5 w-5 text-gold-500" />
                  Informations serveur
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-3 bg-marble-50 rounded-lg border border-marble-200">
                    <p className="text-xs text-gray-500 uppercase font-medium">Version</p>
                    <p className="text-lg font-semibold text-gray-900 mt-1">7.0.0</p>
                  </div>
                  <div className="p-3 bg-marble-50 rounded-lg border border-marble-200">
                    <p className="text-xs text-gray-500 uppercase font-medium">Environnement</p>
                    <p className="text-lg font-semibold text-gray-900 mt-1">Development</p>
                  </div>
                  <div className="p-3 bg-marble-50 rounded-lg border border-marble-200">
                    <p className="text-xs text-gray-500 uppercase font-medium">Utilisateurs</p>
                    <p className="text-lg font-semibold text-gray-900 mt-1">{mockUsers.length}</p>
                  </div>
                  <div className="p-3 bg-marble-50 rounded-lg border border-marble-200">
                    <p className="text-xs text-gray-500 uppercase font-medium">Uptime</p>
                    <p className="text-lg font-semibold text-gray-900 mt-1">2h 34m</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Backup Tab Content */}
          <motion.div variants={itemVariants}>
            <Card variant="default" padding="md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Database className="h-5 w-5 text-gold-500" />
                  Gestion des sauvegardes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex flex-col md:flex-row gap-3">
                    <Button variant="primary" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />}>
                      Créer une sauvegarde
                    </Button>
                    <Button variant="secondary" size="sm" leftIcon={<Upload className="h-3.5 w-3.5" />}>
                      Restaurer
                    </Button>
                  </div>

                  <div className="border-t border-marble-200 pt-4">
                    <h4 className="text-sm font-medium text-gray-900 mb-3">Sauvegardes récentes</h4>
                    <div className="space-y-2">
                      {[
                        { date: '26/01/2026 02:00', size: '534 KB', type: 'Automatique' },
                        { date: '25/01/2026 02:00', size: '532 KB', type: 'Automatique' },
                        { date: '24/01/2026 14:30', size: '530 KB', type: 'Manuelle' },
                      ].map((backup, i) => (
                        <div key={i} className="flex items-center justify-between p-2.5 bg-marble-50 rounded-lg border border-marble-200 text-sm">
                          <div className="flex items-center gap-3">
                            <Clock className="h-3.5 w-3.5 text-gray-400" />
                            <span className="text-gray-900 font-medium">{backup.date}</span>
                            <Badge variant="default" size="sm">{backup.type}</Badge>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-gray-500">{backup.size}</span>
                            <Button variant="ghost" size="sm">
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </>
      )}

      {/* Security Tab */}
      {activeTab === 'security' && (
        <>
          <motion.div variants={itemVariants}>
            <Card variant="default" padding="md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield className="h-5 w-5 text-gold-500" />
                  Configuration de sécurité
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-marble-50 rounded-lg border border-marble-200">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-green-100 rounded">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 text-sm">Chiffrement AES-256</p>
                        <p className="text-xs text-gray-500">Toutes les données sensibles sont chiffrées</p>
                      </div>
                    </div>
                    <Badge variant="success" size="sm">Actif</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-marble-50 rounded-lg border border-marble-200">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-green-100 rounded">
                        <Key className="h-4 w-4 text-green-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 text-sm">Authentification JWT</p>
                        <p className="text-xs text-gray-500">Tokens sécurisés avec expiration 24h</p>
                      </div>
                    </div>
                    <Badge variant="success" size="sm">Actif</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-marble-50 rounded-lg border border-marble-200">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-amber-100 rounded">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 text-sm">2FA obligatoire</p>
                        <p className="text-xs text-gray-500">Authentification à deux facteurs pour les admins</p>
                      </div>
                    </div>
                    <Badge variant="warning" size="sm">Optionnel</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Token Generation */}
          <motion.div variants={itemVariants}>
            <Card variant="default" padding="md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserPlus className="h-5 w-5 text-gold-500" />
                  Génération de jetons d'invitation
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <p className="text-xs text-gray-500">
                    Générez un jeton unique pour permettre à un nouvel utilisateur de créer son compte.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">
                        Email du nouvel utilisateur
                      </label>
                      <Input
                        type="email"
                        placeholder="utilisateur@example.com"
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">
                        Rôle attribué
                      </label>
                      <select
                        value={newUserRole}
                        onChange={(e) => setNewUserRole(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-marble-300 rounded-xl focus:ring-2 focus:ring-gold-500 focus:border-gold-500 text-sm"
                      >
                        <option value="Silver">Silver (Membre)</option>
                        <option value="Gold">Gold (Coordinateur)</option>
                        <option value="Platinum">Platinum (Manager)</option>
                        <option value="Admin">Admin (Administrateur)</option>
                        <option value="Admin_N1">Admin N1 (Super Admin)</option>
                      </select>
                    </div>
                  </div>

                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<Key className="h-3.5 w-3.5" />}
                    onClick={generateToken}
                    disabled={!newUserEmail}
                  >
                    Générer le jeton
                  </Button>

                  {generatedToken && (
                    <div className="mt-4 p-3 bg-gold-50 border-2 border-gold-300 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gold-900 uppercase">Jeton généré</span>
                        <button
                          onClick={copyToken}
                          className="flex items-center gap-1.5 px-2.5 py-1 bg-gold-500 text-white rounded-md hover:bg-gold-600 transition-colors text-xs font-medium"
                        >
                          <Copy className="h-3 w-3" />
                          Copier
                        </button>
                      </div>
                      <code className="block p-2.5 bg-white rounded text-gold-700 font-mono text-xs break-all border border-gold-200">
                        {generatedToken}
                      </code>
                      <p className="mt-2 text-xs text-gold-700 flex items-center gap-1">
                        <Info className="h-3 w-3" />
                        Envoyez ce jeton au nouvel utilisateur. Valide pendant 7 jours.
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </>
      )}

      {/* Users Tab - SAP Table Style */}
      {activeTab === 'users' && (
        <motion.div variants={itemVariants}>
          <Card variant="default" padding="none">
            {/* Toolbar */}
            <div className="border-b border-marble-200 bg-marble-50 px-4 py-3">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Rechercher un utilisateur..."
                      value={userSearchQuery}
                      onChange={(e) => setUserSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-marble-300 rounded-lg focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
                    />
                  </div>
                  <select
                    value={userRoleFilter}
                    onChange={(e) => setUserRoleFilter(e.target.value)}
                    className="px-3 py-2 text-sm bg-white border border-marble-300 rounded-lg focus:ring-2 focus:ring-gold-500"
                  >
                    <option value="all">Tous les rôles</option>
                    <option value="Admin_N1">Admin N1</option>
                    <option value="Admin">Admin</option>
                    <option value="Platinum">Platinum</option>
                    <option value="Gold">Gold</option>
                    <option value="Silver">Silver</option>
                  </select>
                  <select
                    value={userStatusFilter}
                    onChange={(e) => setUserStatusFilter(e.target.value)}
                    className="px-3 py-2 text-sm bg-white border border-marble-300 rounded-lg focus:ring-2 focus:ring-gold-500"
                  >
                    <option value="all">Tous les statuts</option>
                    <option value="active">Actif</option>
                    <option value="inactive">Inactif</option>
                    <option value="suspended">Suspendu</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />}>
                    Export CSV
                  </Button>
                  <Button variant="primary" size="sm" leftIcon={<UserPlus className="h-3.5 w-3.5" />}>
                    Nouvel utilisateur
                  </Button>
                </div>
              </div>
            </div>

            {/* Results count */}
            <div className="px-4 py-2 bg-marble-50 border-b border-marble-100 text-xs text-gray-600">
              {filteredUsers.length} utilisateur{filteredUsers.length > 1 ? 's' : ''} trouvé{filteredUsers.length > 1 ? 's' : ''}
              {(userSearchQuery || userRoleFilter !== 'all' || userStatusFilter !== 'all') && (
                <button
                  onClick={() => {
                    setUserSearchQuery('');
                    setUserRoleFilter('all');
                    setUserStatusFilter('all');
                  }}
                  className="ml-2 text-gold-600 hover:text-gold-700 font-medium"
                >
                  Réinitialiser les filtres
                </button>
              )}
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-marble-50 border-b border-marble-200">
                  <tr>
                    <th className="px-4 py-2.5 text-left">
                      <input type="checkbox" className="rounded border-marble-300" />
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 cursor-pointer hover:text-gray-900" onClick={() => handleSort('email')}>
                      <div className="flex items-center gap-1">
                        Email
                        {sortConfig?.key === 'email' && (sortConfig.direction === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                      </div>
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 cursor-pointer hover:text-gray-900" onClick={() => handleSort('firstName')}>
                      <div className="flex items-center gap-1">
                        Nom complet
                        {sortConfig?.key === 'firstName' && (sortConfig.direction === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                      </div>
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 cursor-pointer hover:text-gray-900" onClick={() => handleSort('role')}>
                      <div className="flex items-center gap-1">
                        Rôle
                        {sortConfig?.key === 'role' && (sortConfig.direction === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                      </div>
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Statut</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 cursor-pointer hover:text-gray-900" onClick={() => handleSort('lastLogin')}>
                      <div className="flex items-center gap-1">
                        Dernière connexion
                        {sortConfig?.key === 'lastLogin' && (sortConfig.direction === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                      </div>
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Groupe</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-marble-100">
                  {filteredUsers.map((user) => (
                    <tr
                      key={user.id}
                      className={cn(
                        'hover:bg-marble-50 transition-colors cursor-pointer',
                        selectedUser?.id === user.id && 'bg-gold-50'
                      )}
                      onClick={() => setSelectedUser(user)}
                    >
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          className="rounded border-marble-300"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-gray-900">{user.email}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-gray-900">{user.firstName} {user.lastName}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          variant={
                            user.role === 'Admin_N1' || user.role === 'Admin' ? 'error' :
                            user.role === 'Platinum' ? 'info' :
                            user.role === 'Gold' ? 'gold' : 'default'
                          }
                          size="sm"
                        >
                          {user.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={getUserStatusBadge(user.status) as any} size="sm">
                          {user.status === 'active' ? 'Actif' : user.status === 'inactive' ? 'Inactif' : 'Suspendu'}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 text-xs font-mono">
                        {user.lastLogin}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">
                        {user.groupId || '-'}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button className="p-1.5 hover:bg-marble-100 rounded transition-colors" title="Voir">
                            <Eye className="h-3.5 w-3.5 text-gray-600" />
                          </button>
                          <button className="p-1.5 hover:bg-marble-100 rounded transition-colors" title="Éditer">
                            <Edit2 className="h-3.5 w-3.5 text-gray-600" />
                          </button>
                          <button className="p-1.5 hover:bg-red-100 rounded transition-colors" title="Supprimer">
                            <Trash2 className="h-3.5 w-3.5 text-red-600" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* User Details Panel */}
            {selectedUser && (
              <div className="border-t-2 border-gold-300 bg-gold-50 p-4">
                <div className="flex items-start justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <Info className="h-4 w-4 text-gold-600" />
                    Détails utilisateur
                  </h4>
                  <button onClick={() => setSelectedUser(null)} className="p-1 hover:bg-gold-100 rounded transition-colors">
                    <X className="h-4 w-4 text-gray-500" />
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium mb-1">ID</p>
                    <p className="text-gray-900 font-mono">{selectedUser.id}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium mb-1">Nom complet</p>
                    <p className="text-gray-900">{selectedUser.firstName} {selectedUser.lastName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium mb-1">Email</p>
                    <p className="text-gray-900">{selectedUser.email}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium mb-1">Rôle</p>
                    <Badge variant="gold" size="sm">{selectedUser.role}</Badge>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium mb-1">Statut</p>
                    <Badge variant={getUserStatusBadge(selectedUser.status) as any} size="sm">
                      {selectedUser.status === 'active' ? 'Actif' : selectedUser.status === 'inactive' ? 'Inactif' : 'Suspendu'}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium mb-1">Groupe</p>
                    <p className="text-gray-900">{selectedUser.groupId || 'Aucun'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium mb-1">Dernière connexion</p>
                    <p className="text-gray-900 font-mono text-xs">{selectedUser.lastLogin}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium mb-1">Créé le</p>
                    <p className="text-gray-900 text-xs">{selectedUser.createdAt}</p>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </motion.div>
      )}

      {/* Logs Tab - SAP Table Style */}
      {activeTab === 'logs' && (
        <motion.div variants={itemVariants}>
          <Card variant="default" padding="none">
            {/* Toolbar */}
            <div className="border-b border-marble-200 bg-marble-50 px-4 py-3">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Rechercher dans les journaux..."
                      value={logSearchQuery}
                      onChange={(e) => setLogSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-marble-300 rounded-lg focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
                    />
                  </div>
                  <select
                    value={logLevelFilter}
                    onChange={(e) => setLogLevelFilter(e.target.value)}
                    className="px-3 py-2 text-sm bg-white border border-marble-300 rounded-lg focus:ring-2 focus:ring-gold-500"
                  >
                    <option value="all">Tous les niveaux</option>
                    <option value="info">Info</option>
                    <option value="success">Success</option>
                    <option value="warning">Warning</option>
                    <option value="error">Error</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />}>
                    Export logs
                  </Button>
                  <Button variant="secondary" size="sm" leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>
                    Actualiser
                  </Button>
                </div>
              </div>
            </div>

            {/* Results count */}
            <div className="px-4 py-2 bg-marble-50 border-b border-marble-100 text-xs text-gray-600">
              {filteredLogs.length} événement{filteredLogs.length > 1 ? 's' : ''} trouvé{filteredLogs.length > 1 ? 's' : ''}
              {(logSearchQuery || logLevelFilter !== 'all') && (
                <button
                  onClick={() => {
                    setLogSearchQuery('');
                    setLogLevelFilter('all');
                  }}
                  className="ml-2 text-gold-600 hover:text-gold-700 font-medium"
                >
                  Réinitialiser les filtres
                </button>
              )}
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-marble-50 border-b border-marble-200">
                  <tr>
                    <th className="px-4 py-2.5 text-left">
                      <input
                        type="checkbox"
                        className="rounded border-marble-300"
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedLogs(new Set(filteredLogs.map(l => l.id)));
                          } else {
                            setSelectedLogs(new Set());
                          }
                        }}
                      />
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Horodatage</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Niveau</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Module</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Message</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Utilisateur</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-marble-100">
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-marble-50 transition-colors">
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          className="rounded border-marble-300"
                          checked={selectedLogs.has(log.id)}
                          onChange={(e) => {
                            const next = new Set(selectedLogs);
                            if (e.target.checked) {
                              next.add(log.id);
                            } else {
                              next.delete(log.id);
                            }
                            setSelectedLogs(next);
                          }}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 font-mono text-xs whitespace-nowrap">
                        {log.timestamp}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className={cn('inline-flex px-2 py-0.5 rounded text-xs font-medium uppercase', getLogLevelColor(log.level))}>
                          {log.level}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="default" size="sm">{log.module}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-gray-900 max-w-md truncate">
                        {log.message}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">
                        {log.user || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Bulk Actions */}
            {selectedLogs.size > 0 && (
              <div className="border-t-2 border-gold-300 bg-gold-50 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-900">
                    <span className="font-semibold">{selectedLogs.size}</span> événement{selectedLogs.size > 1 ? 's' : ''} sélectionné{selectedLogs.size > 1 ? 's' : ''}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />}>
                      Exporter
                    </Button>
                    <Button variant="secondary" size="sm" leftIcon={<Trash2 className="h-3.5 w-3.5" />}>
                      Archiver
                    </Button>
                    <button
                      onClick={() => setSelectedLogs(new Set())}
                      className="text-sm text-gray-600 hover:text-gray-900 px-3"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </motion.div>
      )}
    </motion.div>
  );
}

export default AdminPage;
