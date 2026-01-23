import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Users,
  Calendar,
  Shield,
  Bell,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronDown,
  MapPin,
  FileText,
  BarChart3,
  UserCog,
} from 'lucide-react';
import { Logo, Avatar, Badge } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { cn, formatRole, getFullName } from '@/lib/utils';

interface NavItemProps {
  to: string;
  icon: React.ElementType;
  label: string;
  badge?: number;
  onClick?: () => void;
}

function NavItem({ to, icon: Icon, label, badge, onClick }: NavItemProps) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200',
          isActive
            ? 'bg-gold-100 text-gold-700 font-medium border-l-4 border-gold-500 -ml-[2px]'
            : 'text-gray-600 hover:text-gold-700 hover:bg-gold-50'
        )
      }
    >
      <Icon className="h-5 w-5 flex-shrink-0" />
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <Badge variant="error" size="sm">
          {badge > 99 ? '99+' : badge}
        </Badge>
      )}
    </NavLink>
  );
}

export function DashboardLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const closeSidebar = () => setSidebarOpen(false);

  // Get user's full name
  const userName = getFullName(user);

  // Navigation items based on user role
  const navItems = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Tableau de bord' },
    { to: '/guards', icon: Shield, label: 'Gardes' },
    { to: '/planning', icon: Calendar, label: 'Planning' },
    { to: '/locations', icon: MapPin, label: 'Lieux' },
    { to: '/reports', icon: FileText, label: 'Rapports' },
    { to: '/statistics', icon: BarChart3, label: 'Statistiques' },
  ];

  // Admin-only items
  const adminItems = [
    { to: '/users', icon: Users, label: 'Utilisateurs' },
    { to: '/admin', icon: UserCog, label: 'Administration' },
  ];

  const isAdmin = user?.role === 'Admin_N1' || user?.role === 'Admin';

  return (
    <div className="min-h-screen bg-marble-50">
      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={closeSidebar}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 h-full w-72 bg-white border-r border-marble-200 shadow-lg',
          'transform transition-transform duration-300 ease-in-out',
          'lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between p-6 border-b border-marble-200">
          <Logo size="md" />
          <button
            onClick={closeSidebar}
            className="lg:hidden p-2 rounded-lg hover:bg-marble-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto max-h-[calc(100vh-200px)] scrollbar-gold">
          {navItems.map((item) => (
            <NavItem key={item.to} {...item} onClick={closeSidebar} />
          ))}

          {isAdmin && (
            <>
              <div className="my-4">
                <div className="gold-divider" />
              </div>
              <p className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Administration
              </p>
              {adminItems.map((item) => (
                <NavItem key={item.to} {...item} onClick={closeSidebar} />
              ))}
            </>
          )}
        </nav>

        {/* User Section */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-marble-200 bg-white">
          <div className="flex items-center gap-3">
            <Avatar
              src={user?.avatar_url}
              name={userName || 'User'}
              size="md"
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate">
                {userName}
              </p>
              <Badge
                variant={user?.role === 'Admin_N1' ? 'error' : user?.role === 'Admin' ? 'warning' : 'gold'}
                size="sm"
              >
                {formatRole(user?.role || '')}
              </Badge>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="lg:ml-72">
        {/* Top Header */}
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-lg border-b border-marble-200">
          <div className="flex items-center justify-between px-4 lg:px-8 h-16">
            {/* Mobile Menu Button */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg hover:bg-marble-100"
            >
              <Menu className="h-6 w-6" />
            </button>

            {/* Search (placeholder) */}
            <div className="hidden md:block flex-1 max-w-xl mx-4">
              {/* Future search component */}
            </div>

            {/* Right Actions */}
            <div className="flex items-center gap-2">
              {/* Notifications */}
              <button className="relative p-2 rounded-xl hover:bg-marble-100 transition-colors">
                <Bell className="h-5 w-5 text-gray-600" />
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
              </button>

              {/* Settings */}
              <button
                onClick={() => navigate('/settings')}
                className="p-2 rounded-xl hover:bg-marble-100 transition-colors"
              >
                <Settings className="h-5 w-5 text-gray-600" />
              </button>

              {/* User Menu */}
              <div className="relative ml-2">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 p-2 rounded-xl hover:bg-marble-100 transition-colors"
                >
                  <Avatar
                    src={user?.avatar_url}
                    name={userName || 'User'}
                    size="sm"
                  />
                  <ChevronDown className={cn(
                    'h-4 w-4 text-gray-500 transition-transform',
                    userMenuOpen && 'rotate-180'
                  )} />
                </button>

                {/* Dropdown */}
                <AnimatePresence>
                  {userMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-marble-200 py-2 z-50"
                    >
                      <div className="px-4 py-3 border-b border-marble-100">
                        <p className="font-medium text-gray-900">{userName}</p>
                        <p className="text-sm text-gray-500">{user?.email}</p>
                      </div>
                      <div className="py-2">
                        <button
                          onClick={() => {
                            navigate('/profile');
                            setUserMenuOpen(false);
                          }}
                          className="w-full px-4 py-2 text-left text-gray-700 hover:bg-marble-50 transition-colors"
                        >
                          Mon profil
                        </button>
                        <button
                          onClick={() => {
                            navigate('/settings');
                            setUserMenuOpen(false);
                          }}
                          className="w-full px-4 py-2 text-left text-gray-700 hover:bg-marble-50 transition-colors"
                        >
                          Paramètres
                        </button>
                      </div>
                      <div className="border-t border-marble-100 pt-2">
                        <button
                          onClick={handleLogout}
                          className="w-full px-4 py-2 text-left text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
                        >
                          <LogOut className="h-4 w-4" />
                          Déconnexion
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-4 lg:p-8">
          <Outlet />
        </main>
      </div>

      {/* Click outside to close user menu */}
      {userMenuOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setUserMenuOpen(false)}
        />
      )}
    </div>
  );
}

export default DashboardLayout;
