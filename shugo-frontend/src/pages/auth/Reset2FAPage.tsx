import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Shield, Lock, CheckCircle, AlertCircle, ArrowLeft, Copy, QrCode, ArrowRight, Check } from 'lucide-react';
import { Button, Input, Card, Logo } from '@/components/ui';
import { authService } from '@/services/auth.service';

// Validation schema for password verification
const passwordSchema = z.object({
  password: z.string().min(1, 'Mot de passe requis'),
});

// Validation schema for TOTP verification
const totpSchema = z.object({
  totp_code: z.string().length(6, 'Le code doit contenir 6 chiffres').regex(/^\d+$/, 'Le code doit contenir uniquement des chiffres'),
});

type PasswordFormData = z.infer<typeof passwordSchema>;
type TotpFormData = z.infer<typeof totpSchema>;

interface TwoFAData {
  qr_code: string;
  secret: string;
  backup_codes: string[];
}

type ResetStep = 'password' | '2fa_setup' | '2fa_verify' | 'success';

export function Reset2FAPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [step, setStep] = useState<ResetStep>('password');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [twoFAData, setTwoFAData] = useState<TwoFAData | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: '' },
  });

  const totpForm = useForm<TotpFormData>({
    resolver: zodResolver(totpSchema),
    defaultValues: { totp_code: '' },
  });

  // Step 1: Verify password and get new 2FA setup
  const onPasswordSubmit = async (data: PasswordFormData) => {
    if (!token) {
      setError('Token de réinitialisation invalide');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await authService.reset2FAConfirm(token, data.password);
      setTwoFAData(response);
      setStep('2fa_setup');
    } catch (err: unknown) {
      const apiError = err as { message?: string; response?: { data?: { message?: string } } };
      setError(apiError?.response?.data?.message || apiError?.message || 'Mot de passe incorrect');
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3: Verify new TOTP code
  const onTotpSubmit = async (data: TotpFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      await authService.verify2FASetup(data.totp_code);
      setStep('success');
    } catch (err: unknown) {
      const apiError = err as { message?: string };
      setError(apiError?.message || 'Code 2FA incorrect');
    } finally {
      setIsLoading(false);
    }
  };

  // Copy helpers
  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const copyAllCodes = () => {
    if (twoFAData?.backup_codes) {
      navigator.clipboard.writeText(twoFAData.backup_codes.join('\n'));
      setCopiedCode('all');
      setTimeout(() => setCopiedCode(null), 2000);
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
            Le lien de réinitialisation 2FA est invalide ou a expiré.
          </p>
          <Link to="/login">
            <Button variant="primary" className="w-full">
              Retour à la connexion
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

          {/* Step 1: Password verification */}
          {step === 'password' && (
            <>
              <div className="text-center mb-8">
                <div className="w-16 h-16 mx-auto mb-4 bg-gold-100 rounded-2xl flex items-center justify-center">
                  <Lock className="h-8 w-8 text-gold-600" />
                </div>
                <h2 className="text-2xl font-display font-semibold text-gray-900 mb-2">
                  Réinitialisation 2FA
                </h2>
                <p className="text-gray-500">
                  Confirmez votre identité avec votre mot de passe
                </p>
              </div>

              <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-6">
                <Input
                  label="Mot de passe actuel"
                  type="password"
                  placeholder="••••••••"
                  leftIcon={<Lock className="h-5 w-5" />}
                  error={passwordForm.formState.errors.password?.message}
                  {...passwordForm.register('password')}
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
                  rightIcon={<ArrowRight className="h-5 w-5" />}
                >
                  Continuer
                </Button>
              </form>
            </>
          )}

          {/* Step 2: 2FA Setup (show QR code) */}
          {step === '2fa_setup' && twoFAData && (
            <div className="py-4">
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 bg-gold-100 rounded-2xl flex items-center justify-center">
                  <QrCode className="h-8 w-8 text-gold-600" />
                </div>
                <h2 className="text-2xl font-display font-semibold text-gray-900 mb-2">
                  Nouvelle configuration 2FA
                </h2>
                <p className="text-gray-500 text-sm">
                  Scannez le QR code avec votre application d'authentification
                </p>
              </div>

              {/* QR Code */}
              <div className="flex justify-center mb-6">
                <div className="p-4 bg-white rounded-xl shadow-md">
                  <img src={twoFAData.qr_code} alt="QR Code 2FA" className="w-48 h-48" />
                </div>
              </div>

              {/* Secret key */}
              <div className="mb-6">
                <p className="text-xs text-gray-500 mb-2 text-center">Ou entrez manuellement ce code :</p>
                <div className="flex items-center justify-center gap-2 p-3 bg-gray-100 rounded-lg">
                  <code className="text-sm font-mono text-gray-700 break-all">{twoFAData.secret}</code>
                  <button
                    onClick={() => copyToClipboard(twoFAData.secret)}
                    className="p-1 hover:bg-gray-200 rounded"
                  >
                    <Copy className="h-4 w-4 text-gray-500" />
                  </button>
                </div>
              </div>

              {/* Backup codes */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-700">Nouveaux codes de secours</p>
                  <button
                    onClick={copyAllCodes}
                    className="text-xs text-gold-600 hover:text-gold-700 flex items-center gap-1"
                  >
                    <Copy className="h-3 w-3" />
                    {copiedCode === 'all' ? 'Copié !' : 'Tout copier'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  Vos anciens codes ne sont plus valides. Conservez ces nouveaux codes en lieu sûr.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {twoFAData.backup_codes.map((code, index) => (
                    <div
                      key={index}
                      onClick={() => copyToClipboard(code)}
                      className="flex items-center justify-between p-2 bg-gray-50 rounded cursor-pointer hover:bg-gray-100"
                    >
                      <code className="text-xs font-mono">{code}</code>
                      {copiedCode === code && <span className="text-xs text-green-600">Copié</span>}
                    </div>
                  ))}
                </div>
              </div>

              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={() => setStep('2fa_verify')}
                rightIcon={<ArrowRight className="h-5 w-5" />}
              >
                J'ai configuré mon application
              </Button>
            </div>
          )}

          {/* Step 3: 2FA Verification */}
          {step === '2fa_verify' && (
            <>
              <div className="text-center mb-8">
                <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-2xl flex items-center justify-center">
                  <Shield className="h-8 w-8 text-green-600" />
                </div>
                <h2 className="text-2xl font-display font-semibold text-gray-900 mb-2">
                  Vérification
                </h2>
                <p className="text-gray-500 text-sm">
                  Entrez le code affiché dans votre application pour confirmer
                </p>
              </div>

              <form onSubmit={totpForm.handleSubmit(onTotpSubmit)} className="space-y-6">
                <Input
                  label="Code 2FA"
                  type="text"
                  placeholder="000000"
                  maxLength={6}
                  className="text-center text-2xl tracking-widest"
                  error={totpForm.formState.errors.totp_code?.message}
                  {...totpForm.register('totp_code')}
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
                  rightIcon={<Check className="h-5 w-5" />}
                >
                  Confirmer
                </Button>

                <button
                  type="button"
                  onClick={() => setStep('2fa_setup')}
                  className="w-full text-sm text-gray-500 hover:text-gray-700"
                >
                  Retour au QR code
                </button>
              </form>
            </>
          )}

          {/* Step 4: Success */}
          {step === 'success' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-8"
            >
              <div className="w-20 h-20 mx-auto mb-6 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="h-10 w-10 text-green-600" />
              </div>
              <h2 className="text-2xl font-display font-semibold text-gray-900 mb-2">
                2FA réinitialisé !
              </h2>
              <p className="text-gray-500 mb-8">
                Votre authentification à deux facteurs a été réinitialisée avec succès.
              </p>
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={() => navigate('/login')}
                rightIcon={<ArrowRight className="h-5 w-5" />}
              >
                Se connecter
              </Button>
            </motion.div>
          )}

          {/* Back link (only on first step) */}
          {step === 'password' && (
            <>
              <div className="my-8">
                <div className="gold-divider" />
              </div>
              <Link
                to="/login"
                className="flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-gold-600 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Retour à la connexion
              </Link>
            </>
          )}
        </Card>

        {/* Version */}
        <p className="text-center text-xs text-gray-400 mt-6">
          SHUGO v7.0 — Tous droits réservés
        </p>
      </motion.div>
    </div>
  );
}

export default Reset2FAPage;
