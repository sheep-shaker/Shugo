import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Lock, CheckCircle, AlertCircle, ArrowLeft, Check, X } from 'lucide-react';
import { Button, Input, Card, Logo } from '@/components/ui';
import { authService } from '@/services/auth.service';

// Validation schema - must match backend requirements
const resetSchema = z.object({
  password: z
    .string()
    .min(8, 'Minimum 8 caractères')
    .regex(/[a-z]/, 'Au moins une lettre minuscule requise')
    .regex(/[A-Z]/, 'Au moins une lettre majuscule requise')
    .regex(/[0-9]/, 'Au moins un chiffre requis')
    .regex(/[@$!%*?&#^()_+\-=\[\]{}|;':",.<>\/\\`~]/, 'Au moins un caractère spécial requis'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Les mots de passe ne correspondent pas',
  path: ['confirmPassword'],
});

type ResetFormData = z.infer<typeof resetSchema>;

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<ResetFormData>({
    resolver: zodResolver(resetSchema),
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  });

  // Password validation in real-time
  const password = form.watch('password') || '';
  const passwordChecks = {
    length: password.length >= 8,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[@$!%*?&#^()_+\-=[\]{}|;':",.<>/\\`~]/.test(password),
  };

  const onSubmit = async (data: ResetFormData) => {
    if (!token) {
      setError('Token de réinitialisation invalide');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await authService.resetPassword(token, data.password);
      setIsSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      setIsLoading(false);
    }
  };

  // No token provided
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-marble-50">
        <Card variant="elevated" padding="lg" className="max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-6 bg-red-100 rounded-full flex items-center justify-center">
            <AlertCircle className="h-8 w-8 text-red-600" />
          </div>
          <h2 className="text-xl font-display font-semibold text-gray-900 mb-2">
            Lien invalide
          </h2>
          <p className="text-gray-500 mb-6">
            Le lien de réinitialisation est invalide ou a expiré.
          </p>
          <Link to="/forgot-password">
            <Button variant="primary" className="w-full">
              Demander un nouveau lien
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-marble-50">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {/* Logo */}
        <div className="mb-8 text-center">
          <Logo size="lg" />
        </div>

        <Card variant="elevated" padding="lg" className="relative">
          {/* Decorative gold corners */}
          <div className="absolute top-0 left-0 w-12 h-12 border-t-2 border-l-2 border-gold-400 rounded-tl-2xl" />
          <div className="absolute top-0 right-0 w-12 h-12 border-t-2 border-r-2 border-gold-400 rounded-tr-2xl" />
          <div className="absolute bottom-0 left-0 w-12 h-12 border-b-2 border-l-2 border-gold-400 rounded-bl-2xl" />
          <div className="absolute bottom-0 right-0 w-12 h-12 border-b-2 border-r-2 border-gold-400 rounded-br-2xl" />

          {!isSuccess ? (
            <>
              <div className="text-center mb-8">
                <div className="w-16 h-16 mx-auto mb-4 bg-gold-100 rounded-2xl flex items-center justify-center">
                  <Lock className="h-8 w-8 text-gold-600" />
                </div>
                <h2 className="text-2xl font-display font-semibold text-gray-900 mb-2">
                  Nouveau mot de passe
                </h2>
                <p className="text-gray-500">
                  Choisissez un mot de passe sécurisé
                </p>
              </div>

              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div>
                  <Input
                    label="Nouveau mot de passe"
                    type="password"
                    placeholder="••••••••"
                    leftIcon={<Lock className="h-5 w-5" />}
                    error={form.formState.errors.password?.message}
                    {...form.register('password')}
                  />
                  {/* Password requirements guide */}
                  <div className="mt-2 p-3 bg-marble-50 rounded-lg border border-marble-200">
                    <p className="text-xs font-medium text-gray-600 mb-2">Exigences du mot de passe :</p>
                    <div className="grid grid-cols-1 gap-1">
                      <div className={`flex items-center gap-2 text-xs ${passwordChecks.length ? 'text-green-600' : 'text-gray-400'}`}>
                        {passwordChecks.length ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        <span>Au moins 8 caractères</span>
                      </div>
                      <div className={`flex items-center gap-2 text-xs ${passwordChecks.lowercase ? 'text-green-600' : 'text-gray-400'}`}>
                        {passwordChecks.lowercase ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        <span>Une lettre minuscule (a-z)</span>
                      </div>
                      <div className={`flex items-center gap-2 text-xs ${passwordChecks.uppercase ? 'text-green-600' : 'text-gray-400'}`}>
                        {passwordChecks.uppercase ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        <span>Une lettre majuscule (A-Z)</span>
                      </div>
                      <div className={`flex items-center gap-2 text-xs ${passwordChecks.number ? 'text-green-600' : 'text-gray-400'}`}>
                        {passwordChecks.number ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        <span>Un chiffre (0-9)</span>
                      </div>
                      <div className={`flex items-center gap-2 text-xs ${passwordChecks.special ? 'text-green-600' : 'text-gray-400'}`}>
                        {passwordChecks.special ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        <span>Un caractère spécial (@$!%*?&#...)</span>
                      </div>
                    </div>
                  </div>
                </div>

                <Input
                  label="Confirmer le mot de passe"
                  type="password"
                  placeholder="••••••••"
                  leftIcon={<Lock className="h-5 w-5" />}
                  error={form.formState.errors.confirmPassword?.message}
                  {...form.register('confirmPassword')}
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

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  className="w-full"
                  isLoading={isLoading}
                >
                  Réinitialiser le mot de passe
                </Button>
              </form>
            </>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <div className="w-16 h-16 mx-auto mb-6 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <h2 className="text-xl font-display font-semibold text-gray-900 mb-2">
                Mot de passe modifié
              </h2>
              <p className="text-gray-500 mb-6">
                Votre mot de passe a été réinitialisé avec succès.
                Vous pouvez maintenant vous connecter.
              </p>
              <Link to="/login">
                <Button variant="primary" className="w-full">
                  Se connecter
                </Button>
              </Link>
            </motion.div>
          )}

          {/* Divider */}
          <div className="my-8">
            <div className="gold-divider" />
          </div>

          {/* Back to login */}
          <Link
            to="/login"
            className="flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-gold-600 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Retour à la connexion
          </Link>
        </Card>

        {/* Version */}
        <p className="text-center text-xs text-gray-400 mt-6">
          SHUGO v7.0 — Tous droits réservés
        </p>
      </motion.div>
    </div>
  );
}

export default ResetPasswordPage;
