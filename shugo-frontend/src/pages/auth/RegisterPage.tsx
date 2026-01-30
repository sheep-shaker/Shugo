import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Key, Mail, User, Lock, Shield, ArrowRight, Check, Copy, QrCode } from 'lucide-react';
import { Button, Input, Card, Logo, LanguageSelector } from '@/components/ui';
import { authService } from '@/services/auth.service';

// Validation schema
const tokenSchema = z.object({
  token: z.string().min(8, 'Jeton invalide'),
});

const registerSchema = z.object({
  first_name: z.string().min(2, 'Prénom requis'),
  last_name: z.string().min(2, 'Nom requis'),
  email: z.string().email('Email invalide'),
  password: z.string().min(8, 'Minimum 8 caractères'),
  confirm_password: z.string(),
}).refine((data) => data.password === data.confirm_password, {
  message: 'Les mots de passe ne correspondent pas',
  path: ['confirm_password'],
});

type TokenFormData = z.infer<typeof tokenSchema>;
type RegisterFormData = z.infer<typeof registerSchema>;

interface TwoFASetupData {
  qr_code: string;
  secret: string;
  backup_codes: string[];
  member_id: number;
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'token' | 'register' | '2fa_setup' | 'success'>('token');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenData, setTokenData] = useState<{
    first_name: string;
    last_name: string;
    role: string;
    geo_id: string;
  } | null>(null);
  const [twoFAData, setTwoFAData] = useState<TwoFASetupData | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Token form
  const tokenForm = useForm<TokenFormData>({
    resolver: zodResolver(tokenSchema),
    defaultValues: { token: '' },
  });

  // Register form
  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  // Handle token validation
  const onTokenSubmit = async (data: TokenFormData) => {
    setError(null);
    setIsLoading(true);

    try {
      const response = await authService.validateToken(data.token);

      setTokenData(response);
      registerForm.setValue('first_name', response.first_name || '');
      registerForm.setValue('last_name', response.last_name || '');

      setStep('register');
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { message?: string } } };
      setError(apiError?.response?.data?.message || 'Jeton invalide ou expiré');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle registration
  const onRegisterSubmit = async (data: RegisterFormData) => {
    setError(null);
    setIsLoading(true);

    try {
      const response = await authService.register({
        token: tokenForm.getValues('token'),
        email: data.email,
        password: data.password,
        first_name: data.first_name,
        last_name: data.last_name,
      });

      // Show 2FA setup
      setTwoFAData({
        qr_code: response.qr_code,
        secret: response.secret,
        backup_codes: response.backup_codes,
        member_id: response.member_id,
      });
      setStep('2fa_setup');
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { message?: string; errors?: Array<{ message: string }> } } };
      const errorMessage = apiError?.response?.data?.errors?.[0]?.message
        || apiError?.response?.data?.message
        || 'Erreur lors de la création du compte';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Copy backup code to clipboard
  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // Copy all backup codes
  const copyAllCodes = () => {
    if (twoFAData?.backup_codes) {
      navigator.clipboard.writeText(twoFAData.backup_codes.join('\n'));
      setCopiedCode('all');
      setTimeout(() => setCopiedCode(null), 2000);
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
              Bienvenue dans SHUGO
            </h1>
            <p className="text-xl text-white/80 mb-8">
              Créez votre compte pour accéder<br />
              à la plateforme de gestion
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

      {/* Right Panel - Forms */}
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

            {/* Step 1: Token validation */}
            {step === 'token' && (
              <>
                <div className="text-center mb-8">
                  <div className="w-16 h-16 mx-auto mb-4 bg-gold-100 rounded-2xl flex items-center justify-center">
                    <Key className="h-8 w-8 text-gold-600" />
                  </div>
                  <h2 className="text-2xl font-display font-semibold text-gray-900 mb-2">
                    Demander un accès
                  </h2>
                  <p className="text-gray-500">
                    Entrez le jeton d'invitation fourni par votre administrateur
                  </p>
                </div>

                <form onSubmit={tokenForm.handleSubmit(onTokenSubmit)} className="space-y-6">
                  <Input
                    label="Jeton d'invitation"
                    type="text"
                    placeholder="XXXXXXXX-XXXX-XXXX"
                    leftIcon={<Key className="h-5 w-5" />}
                    error={tokenForm.formState.errors.token?.message}
                    {...tokenForm.register('token')}
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
                    Valider le jeton
                  </Button>
                </form>
              </>
            )}

            {/* Step 2: Registration form */}
            {step === 'register' && (
              <>
                <div className="text-center mb-8">
                  <h2 className="text-2xl font-display font-semibold text-gray-900 mb-2">
                    Créer votre compte
                  </h2>
                  <p className="text-gray-500">
                    Complétez vos informations
                  </p>
                </div>

                <form onSubmit={registerForm.handleSubmit(onRegisterSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      label="Prénom"
                      type="text"
                      placeholder="Jean"
                      leftIcon={<User className="h-5 w-5" />}
                      error={registerForm.formState.errors.first_name?.message}
                      {...registerForm.register('first_name')}
                      disabled={!!tokenData?.first_name}
                    />
                    <Input
                      label="Nom"
                      type="text"
                      placeholder="Dupont"
                      leftIcon={<User className="h-5 w-5" />}
                      error={registerForm.formState.errors.last_name?.message}
                      {...registerForm.register('last_name')}
                      disabled={!!tokenData?.last_name}
                    />
                  </div>

                  <Input
                    label="Email"
                    type="email"
                    placeholder="votre@email.com"
                    leftIcon={<Mail className="h-5 w-5" />}
                    error={registerForm.formState.errors.email?.message}
                    {...registerForm.register('email')}
                  />

                  <Input
                    label="Mot de passe"
                    type="password"
                    placeholder="••••••••"
                    leftIcon={<Lock className="h-5 w-5" />}
                    error={registerForm.formState.errors.password?.message}
                    {...registerForm.register('password')}
                  />

                  <Input
                    label="Confirmer le mot de passe"
                    type="password"
                    placeholder="••••••••"
                    leftIcon={<Lock className="h-5 w-5" />}
                    error={registerForm.formState.errors.confirm_password?.message}
                    {...registerForm.register('confirm_password')}
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
                    Créer mon compte
                  </Button>
                </form>
              </>
            )}

            {/* Step 3: 2FA Setup */}
            {step === '2fa_setup' && twoFAData && (
              <div className="py-4">
                <div className="text-center mb-6">
                  <div className="w-16 h-16 mx-auto mb-4 bg-gold-100 rounded-2xl flex items-center justify-center">
                    <QrCode className="h-8 w-8 text-gold-600" />
                  </div>
                  <h2 className="text-2xl font-display font-semibold text-gray-900 mb-2">
                    Configuration 2FA
                  </h2>
                  <p className="text-gray-500 text-sm">
                    Scannez le QR code avec votre application d'authentification (Google Authenticator, Authy, etc.)
                  </p>
                </div>

                {/* QR Code */}
                <div className="flex justify-center mb-6">
                  <div className="p-4 bg-white rounded-xl shadow-md">
                    <img src={twoFAData.qr_code} alt="QR Code 2FA" className="w-48 h-48" />
                  </div>
                </div>

                {/* Secret key (fallback) */}
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
                    <p className="text-sm font-medium text-gray-700">Codes de secours</p>
                    <button
                      onClick={copyAllCodes}
                      className="text-xs text-gold-600 hover:text-gold-700 flex items-center gap-1"
                    >
                      <Copy className="h-3 w-3" />
                      {copiedCode === 'all' ? 'Copié !' : 'Tout copier'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">
                    Conservez ces codes en lieu sûr. Chaque code ne peut être utilisé qu'une fois.
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
                  onClick={() => setStep('success')}
                  rightIcon={<ArrowRight className="h-5 w-5" />}
                >
                  J'ai sauvegardé mes codes
                </Button>
              </div>
            )}

            {/* Step 4: Success */}
            {step === 'success' && (
              <div className="text-center py-8">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="w-20 h-20 mx-auto mb-6 bg-green-100 rounded-full flex items-center justify-center"
                >
                  <Check className="h-10 w-10 text-green-600" />
                </motion.div>
                <h2 className="text-2xl font-display font-semibold text-gray-900 mb-2">
                  Compte créé avec succès !
                </h2>
                <p className="text-gray-500 mb-8">
                  Vous pouvez maintenant vous connecter avec vos identifiants
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
              </div>
            )}

            {/* Footer */}
            {(step === 'token' || step === 'register') && (
              <>
                <div className="my-8">
                  <div className="gold-divider" />
                </div>

                <p className="text-center text-sm text-gray-500">
                  Vous avez déjà un compte ?{' '}
                  <Link to="/login" className="text-gold-600 hover:text-gold-700 font-medium">
                    Se connecter
                  </Link>
                </p>
              </>
            )}
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

export default RegisterPage;
