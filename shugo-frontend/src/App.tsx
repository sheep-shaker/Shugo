import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';

// Layouts
import { AuthLayout, ProtectedRoute, DashboardLayout } from '@/components/layout';

// Auth Pages
import { LoginPage, RegisterPage, ForgotPasswordPage, ResetPasswordPage } from '@/pages/auth';

// Dashboard Pages
import { DashboardPage } from '@/pages/dashboard';

// Guards Pages
import { GuardsListPage } from '@/pages/guards';

// Planning Pages
import { PlanningPage } from '@/pages/planning';

// Locations Pages
import { LocationsPage } from '@/pages/locations';

// Profile & Settings Pages
import { ProfilePage } from '@/pages/profile';
import { SettingsPage } from '@/pages/settings';

// Users Pages
import { UsersPage } from '@/pages/users';

// Groups Pages
import { GroupsPage } from '@/pages/groups';

// Admin Pages
import { AdminPage } from '@/pages/admin';

// Notifications Pages
import { NotificationsPage } from '@/pages/notifications';

// Placeholder pages (to be implemented)
import { PlaceholderPage } from '@/pages/PlaceholderPage';

// Store
import { useAuthStore } from '@/stores/authStore';

// Create Query Client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function AppContent() {
  const { fetchUser, isLoading } = useAuthStore();

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // Show loading spinner while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-marble-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gold-500 mx-auto" />
          <p className="mt-4 text-gray-500">Chargement...</p>
        </div>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <Routes>
        {/* Public Routes - Auth */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>

        {/* Protected Routes - Dashboard */}
        <Route
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/guards" element={<GuardsListPage />} />
          <Route path="/planning" element={<PlanningPage />} />
          <Route path="/locations" element={<LocationsPage />} />
          <Route path="/reports" element={<PlaceholderPage title="Rapports" />} />
          <Route path="/statistics" element={<PlaceholderPage title="Statistiques" />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
        </Route>

        {/* Unauthorized Page */}
        <Route path="/unauthorized" element={<PlaceholderPage title="Accès non autorisé" />} />

        {/* Default Redirect */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AnimatePresence>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
