import { useState } from 'react';
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
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

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
}

function ToggleSwitch({ enabled, onChange, label, description }: ToggleSwitchProps) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="font-medium text-gray-900">{label}</p>
        {description && <p className="text-sm text-gray-500">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={cn(
          'relative w-12 h-6 rounded-full transition-colors',
          enabled ? 'bg-gold-500' : 'bg-gray-300'
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
  const [settings, setSettings] = useState({
    emailNotifications: true,
    pushNotifications: true,
    guardReminders: true,
    weeklyReport: false,
    darkMode: false,
    twoFactorAuth: false,
    language: 'fr',
  });

  const updateSetting = (key: keyof typeof settings, value: boolean | string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const settingsSections = [
    {
      title: 'Notifications',
      icon: Bell,
      items: [
        {
          key: 'emailNotifications' as const,
          label: 'Notifications par email',
          description: 'Recevez les notifications importantes par email',
        },
        {
          key: 'pushNotifications' as const,
          label: 'Notifications push',
          description: 'Notifications sur votre appareil mobile',
        },
        {
          key: 'guardReminders' as const,
          label: 'Rappels de garde',
          description: 'Rappels avant le début de vos gardes',
        },
        {
          key: 'weeklyReport' as const,
          label: 'Rapport hebdomadaire',
          description: 'Résumé de votre activité chaque semaine',
        },
      ],
    },
    {
      title: 'Apparence',
      icon: Moon,
      items: [
        {
          key: 'darkMode' as const,
          label: 'Mode sombre',
          description: 'Utiliser le thème sombre',
        },
      ],
    },
    {
      title: 'Sécurité',
      icon: Shield,
      items: [
        {
          key: 'twoFactorAuth' as const,
          label: 'Authentification à deux facteurs',
          description: 'Sécurisez votre compte avec la 2FA',
        },
      ],
    },
  ];

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
          <Button variant="primary" leftIcon={<Save className="h-4 w-4" />}>
            Enregistrer
          </Button>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Settings */}
        <motion.div variants={itemVariants} className="lg:col-span-2 space-y-6">
          {settingsSections.map((section) => (
            <Card key={section.title} variant="elevated">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <section.icon className="h-5 w-5 text-gold-500" />
                  {section.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-marble-100">
                  {section.items.map((item) => (
                    <ToggleSwitch
                      key={item.key}
                      enabled={settings[item.key] as boolean}
                      onChange={(value) => updateSetting(item.key, value)}
                      label={item.label}
                      description={item.description}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}

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
                    <option value="de">Deutsch</option>
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
                <button className="w-full flex items-center justify-between p-4 hover:bg-marble-50 transition-colors text-left">
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
