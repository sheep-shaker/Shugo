import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Lock, Shield, ArrowRight } from 'lucide-react';
import { Button, Input, Card, Logo, LanguageSelector } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';

// Validation schema
const loginSchema = z.object({
  email: z.string().email('Email invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
});

const totpSchema = z.object({
  code: z.string().length(6, 'Le code doit contenir 6 chiffres'),
});

type LoginFormData = z.infer<typeof loginSchema>;
type TotpFormData = z.infer<typeof totpSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const { login, verify2FA, isLoading, error, requires2FA, clearError } = useAuthStore();
  const [step, setStep] = useState<'credentials' | '2fa'>('credentials');

  // Login form
  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  // 2FA form
  const totpForm = useForm<TotpFormData>({
    resolver: zodResolver(totpSchema),
    defaultValues: { code: '' },
  });

  // Handle login submit
  const onLoginSubmit = async (data: LoginFormData) => {
    clearError();
    const success = await login(data.email, data.password);

    if (success) {
      navigate('/dashboard');
    } else if (requires2FA) {
      setStep('2fa');
    }
  };

  // Handle 2FA submit
  const onTotpSubmit = async (data: TotpFormData) => {
    clearError();
    const success = await verify2FA(data.code);

    if (success) {
      navigate('/dashboard');
    }
  };

  return (
    <div className="min-h-screen flex relative">
      {/* Language Selector */}
      <div className="absolute top-6 right-6 z-50">
        <LanguageSelector variant="default" />
      </div>

      {/* Left Panel - Decorative */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-gold-500 via-gold-600 to-gold-700 relative overflow-hidden">
        {/* Decorative patterns */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-0 w-full h-full">
            {/* Marble pattern SVG */}
            <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <pattern id="marble" patternUnits="userSpaceOnUse" width="20" height="20">
                <circle cx="10" cy="10" r="1" fill="white" fillOpacity="0.3" />
              </pattern>
              <rect width="100%" height="100%" fill="url(#marble)" />
            </svg>
          </div>
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center items-center p-12 text-white">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-center"
          >
            <div className="w-24 h-24 mx-auto mb-8 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm">
              <Shield className="w-12 h-12" />
            </div>
            <h1 className="text-4xl font-display font-bold mb-4">
              SHUGO
            </h1>
            <p className="text-xl text-white/80 mb-8">
              Système Hiérarchisé d'Utilisation<br />
              et de Gestion Opérationnelle
            </p>
            <div className="w-32 h-1 bg-white/30 mx-auto rounded-full" />
          </motion.div>

          {/* Decorative corners */}
          <div className="absolute top-8 left-8 w-16 h-16 border-t-2 border-l-2 border-white/30 rounded-tl-2xl" />
          <div className="absolute top-8 right-8 w-16 h-16 border-t-2 border-r-2 border-white/30 rounded-tr-2xl" />
          <div className="absolute bottom-8 left-8 w-16 h-16 border-b-2 border-l-2 border-white/30 rounded-bl-2xl" />
          <div className="absolute bottom-8 right-8 w-16 h-16 border-b-2 border-r-2 border-white/30 rounded-br-2xl" />
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-marble-50">
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-full max-w-md"
        >
          {/* Logo mobile */}
          <div className="lg:hidden mb-8 text-center">
            <Logo size="lg" />
          </div>

          <Card variant="elevated" padding="lg" className="relative">
            {/* Decorative gold corners */}
            <div className="absolute top-0 left-0 w-12 h-12 border-t-2 border-l-2 border-gold-400 rounded-tl-2xl" />
            <div className="absolute top-0 right-0 w-12 h-12 border-t-2 border-r-2 border-gold-400 rounded-tr-2xl" />
            <div className="absolute bottom-0 left-0 w-12 h-12 border-b-2 border-l-2 border-gold-400 rounded-bl-2xl" />
            <div className="absolute bottom-0 right-0 w-12 h-12 border-b-2 border-r-2 border-gold-400 rounded-br-2xl" />

            {step === 'credentials' ? (
              <>
                <div className="text-center mb-8">
                  <h2 className="text-2xl font-display font-semibold text-gray-900 mb-2">
                    Connexion
                  </h2>
                  <p className="text-gray-500">
                    Accédez à votre espace de gestion
                  </p>
                </div>

                <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-6">
                  <Input
                    label="Email"
                    type="email"
                    placeholder="votre@email.com"
                    leftIcon={<Mail className="h-5 w-5" />}
                    error={loginForm.formState.errors.email?.message}
                    {...loginForm.register('email')}
                  />

                  <Input
                    label="Mot de passe"
                    type="password"
                    placeholder="••••••••"
                    leftIcon={<Lock className="h-5 w-5" />}
                    error={loginForm.formState.errors.password?.message}
                    {...loginForm.register('password')}
                  />

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"
                    >
                      {error}
                    </motion.div>
                  )}

                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-marble-300 text-gold-500 focus:ring-gold-500"
                      />
                      <span className="text-sm text-gray-600">Se souvenir de moi</span>
                    </label>
                    <Link
                      to="/forgot-password"
                      className="text-sm text-gold-600 hover:text-gold-700 font-medium"
                    >
                      Mot de passe oublié ?
                    </Link>
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    className="w-full"
                    isLoading={isLoading}
                    rightIcon={<ArrowRight className="h-5 w-5" />}
                  >
                    Se connecter
                  </Button>
                </form>
              </>
            ) : (
              <>
                <div className="text-center mb-8">
                  <div className="w-16 h-16 mx-auto mb-4 bg-gold-100 rounded-2xl flex items-center justify-center">
                    <Shield className="h-8 w-8 text-gold-600" />
                  </div>
                  <h2 className="text-2xl font-display font-semibold text-gray-900 mb-2">
                    Vérification 2FA
                  </h2>
                  <p className="text-gray-500">
                    Entrez le code de votre application d'authentification
                  </p>
                </div>

                <form onSubmit={totpForm.handleSubmit(onTotpSubmit)} className="space-y-6">
                  <div className="flex justify-center">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="000000"
                      className={cn(
                        'w-48 text-center text-3xl font-mono tracking-[0.5em]',
                        'px-4 py-4 bg-white border-2 border-marble-300 rounded-xl',
                        'focus:border-gold-500 focus:ring-2 focus:ring-gold-500/20',
                        'transition-all duration-200'
                      )}
                      {...totpForm.register('code')}
                    />
                  </div>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm text-center"
                    >
                      {error}
                    </motion.div>
                  )}

                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    className="w-full"
                    isLoading={isLoading}
                  >
                    Vérifier
                  </Button>

                  <button
                    type="button"
                    onClick={() => {
                      setStep('credentials');
                      clearError();
                    }}
                    className="w-full text-center text-sm text-gray-500 hover:text-gray-700"
                  >
                    Retour à la connexion
                  </button>
                </form>
              </>
            )}

            {/* Divider */}
            <div className="my-8">
              <div className="gold-divider" />
            </div>

            {/* Footer */}
            <p className="text-center text-sm text-gray-500">
              Pas encore de compte ?{' '}
              <Link to="/register" className="text-gold-600 hover:text-gold-700 font-medium">
                Demander un accès
              </Link>
            </p>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

export default LoginPage;
