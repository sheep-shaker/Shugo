import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Settings,
  Bell,
  Shield,
  Globe,
  Moon,
  Smartphone,
  Mail,
  Key,
  Save,
  ChevronRight,
  Loader2,
  MessageSquare,
  Sun,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, Input } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { authService } from '@/services/auth.service';

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

interface ToggleSwitchProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

function ToggleSwitch({ enabled, onChange, label, description, disabled }: ToggleSwitchProps) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className={cn("font-medium", disabled ? "text-gray-400" : "text-gray-900")}>{label}</p>
        {description && <p className="text-sm text-gray-500">{description}</p>}
      </div>
      <button
        onClick={() => !disabled && onChange(!enabled)}
        disabled={disabled}
        className={cn(
          'relative w-12 h-6 rounded-full transition-colors',
          enabled ? 'bg-gold-500' : 'bg-gray-300',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <span
          className={cn(
            'absolute top-1 w-4 h-4 bg-white rounded-full transition-transform shadow',
            enabled ? 'left-7' : 'left-1'
          )}
        />
      </button>
    </div>
  );
}

export function SettingsPage() {
  const { user } = useAuthStore();
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark';
    }
    return false;
  });

  const [settings, setSettings] = useState({
    notificationChannel: user?.notification_channel || 'email',
    matrixId: '',
    guardReminders: true,
    weeklyReport: false,
    twoFactorAuth: user?.two_factor_enabled || false,
    language: user?.preferred_language || 'fr',
  });

  // Apply dark mode
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  const updateSetting = (key: keyof typeof settings, value: boolean | string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaveMessage(null);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      // TODO: Call API to save settings
      // await api.patch('/users/me/settings', settings);

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));

      setSaveMessage({ type: 'success', text: 'Paramètres enregistrés avec succès' });
    } catch {
      setSaveMessage({ type: 'error', text: 'Erreur lors de l\'enregistrement' });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    try {
      await authService.requestPasswordResetSelf();
      setSaveMessage({ type: 'success', text: 'Email de réinitialisation envoyé' });
    } catch {
      setSaveMessage({ type: 'error', text: 'Erreur lors de l\'envoi de l\'email' });
    }
  };

  const handle2FAReset = async () => {
    try {
      await authService.request2FAReset();
      setSaveMessage({ type: 'success', text: 'Email de réinitialisation 2FA envoyé' });
    } catch {
      setSaveMessage({ type: 'error', text: 'Erreur lors de l\'envoi de l\'email' });
    }
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
              <Settings className="h-8 w-8 text-gold-500" />
              Paramètres
            </h1>
            <p className="mt-1 text-gray-500">
              Personnalisez votre expérience SHUGO
            </p>
          </div>
          <Button
            variant="primary"
            leftIcon={isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Enregistrement...' : 'Enregistrer'}
          </Button>
        </div>

        {/* Save message */}
        {saveMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              'mt-4 p-3 rounded-xl text-sm',
              saveMessage.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-red-50 border border-red-200 text-red-700'
            )}
          >
            {saveMessage.text}
          </motion.div>
        )}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Settings */}
        <motion.div variants={itemVariants} className="lg:col-span-2 space-y-6">
          {/* Notifications */}
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-gold-500" />
                Notifications
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Notification Channel */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Canal de notification préféré
                  </label>
                  <select
                    value={settings.notificationChannel}
                    onChange={(e) => updateSetting('notificationChannel', e.target.value)}
                    className="w-full px-4 py-3 bg-white border border-marble-300 rounded-xl focus:border-gold-500 focus:ring-2 focus:ring-gold-500/20 transition-all"
                  >
                    <option value="email">Email uniquement</option>
                    <option value="matrix">Matrix uniquement</option>
                    <option value="both">Email et Matrix</option>
                  </select>
                </div>

                {/* Matrix ID */}
                {(settings.notificationChannel === 'matrix' || settings.notificationChannel === 'both') && (
                  <div>
                    <Input
                      label="Identifiant Matrix"
                      placeholder="@username:matrix.org"
                      value={settings.matrixId}
                      onChange={(e) => updateSetting('matrixId', e.target.value)}
                      leftIcon={<MessageSquare className="h-5 w-5" />}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Votre identifiant Matrix au format @utilisateur:serveur.com
                    </p>
                  </div>
                )}

                <div className="border-t border-marble-100 pt-4">
                  <ToggleSwitch
                    enabled={settings.guardReminders}
                    onChange={(value) => updateSetting('guardReminders', value)}
                    label="Rappels de garde"
                    description="Recevez des rappels avant le début de vos gardes (J-2 et J)"
                  />
                  <ToggleSwitch
                    enabled={settings.weeklyReport}
                    onChange={(value) => updateSetting('weeklyReport', value)}
                    label="Rapport hebdomadaire"
                    description="Résumé de votre activité chaque semaine par email"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Appearance */}
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Moon className="h-5 w-5 text-gold-500" />
                Apparence
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-gray-900">Thème</p>
                  <p className="text-sm text-gray-500">Choisissez entre le mode clair et sombre</p>
                </div>
                <div className="flex items-center gap-2 bg-marble-100 rounded-xl p-1">
                  <button
                    onClick={() => setDarkMode(false)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 rounded-lg transition-all',
                      !darkMode ? 'bg-white shadow text-gold-600' : 'text-gray-500 hover:text-gray-700'
                    )}
                  >
                    <Sun className="h-4 w-4" />
                    Clair
                  </button>
                  <button
                    onClick={() => setDarkMode(true)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 rounded-lg transition-all',
                      darkMode ? 'bg-white shadow text-gold-600' : 'text-gray-500 hover:text-gray-700'
                    )}
                  >
                    <Moon className="h-4 w-4" />
                    Sombre
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Security */}
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-gold-500" />
                Sécurité
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-marble-100">
                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-gray-900">Authentification à deux facteurs</p>
                    <p className="text-sm text-gray-500">
                      {settings.twoFactorAuth ? 'Votre compte est protégé par la 2FA' : 'Activez la 2FA pour sécuriser votre compte'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={settings.twoFactorAuth ? 'success' : 'warning'} size="sm">
                      {settings.twoFactorAuth ? 'Activée' : 'Désactivée'}
                    </Badge>
                    {settings.twoFactorAuth && (
                      <Button variant="secondary" size="sm" onClick={handle2FAReset}>
                        Réinitialiser
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-gray-900">Mot de passe</p>
                    <p className="text-sm text-gray-500">Modifiez votre mot de passe de connexion</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={handlePasswordChange}>
                    Changer
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Language */}
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-gold-500" />
                Langue et région
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Langue de l'interface
                  </label>
                  <select
                    value={settings.language}
                    onChange={(e) => updateSetting('language', e.target.value)}
                    className="w-full px-4 py-3 bg-white border border-marble-300 rounded-xl focus:border-gold-500 focus:ring-2 focus:ring-gold-500/20 transition-all"
                  >
                    <option value="fr">Français</option>
                    <option value="it">Italiano</option>
                    <option value="en">English</option>
                    <option value="es">Español</option>
                    <option value="pt">Português</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Sidebar */}
        <motion.div variants={itemVariants} className="space-y-4">
          {/* Quick Links */}
          <Card variant="default">
            <CardHeader>
              <CardTitle className="text-base">Accès rapides</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-marble-100">
                <button
                  onClick={handlePasswordChange}
                  className="w-full flex items-center justify-between p-4 hover:bg-marble-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <Key className="h-5 w-5 text-gray-500" />
                    <span className="text-sm font-medium text-gray-700">Changer le mot de passe</span>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-400" />
                </button>
                <button className="w-full flex items-center justify-between p-4 hover:bg-marble-50 transition-colors text-left">
                  <div className="flex items-center gap-3">
                    <Smartphone className="h-5 w-5 text-gray-500" />
                    <span className="text-sm font-medium text-gray-700">Gérer les appareils</span>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-400" />
                </button>
                <button className="w-full flex items-center justify-between p-4 hover:bg-marble-50 transition-colors text-left">
                  <div className="flex items-center gap-3">
                    <Mail className="h-5 w-5 text-gray-500" />
                    <span className="text-sm font-medium text-gray-700">Préférences email</span>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-400" />
                </button>
              </div>
            </CardContent>
          </Card>

          {/* App Info */}
          <Card variant="gold" padding="md">
            <div className="text-center">
              <div className="w-16 h-16 bg-white rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-lg">
                <Shield className="h-8 w-8 text-gold-500" />
              </div>
              <h3 className="font-display font-semibold text-gray-900">SHUGO</h3>
              <p className="text-sm text-gray-500 mt-1">Version 7.0.0</p>
              <div className="mt-4">
                <Badge variant="success" size="sm">À jour</Badge>
              </div>
            </div>
          </Card>

          {/* Danger Zone */}
          <Card variant="default" className="border-red-200">
            <CardHeader>
              <CardTitle className="text-base text-red-600">Zone de danger</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500 mb-4">
                Ces actions sont irréversibles. Procédez avec prudence.
              </p>
              <Button variant="danger" size="sm" className="w-full">
                Supprimer mon compte
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}

export default SettingsPage;
