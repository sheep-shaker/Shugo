// middleware/auth2FA.js
// Middleware de vérification 2FA pour les opérations sensibles

const speakeasy = require('speakeasy');
const { User, Session, AuditLog, TwoFactorBackup } = require('../models');
const config = require('../config');

/**
 * Middleware pour exiger une vérification 2FA
 * @param {Object} options - Options de configuration
 * @param {boolean} options.required - Si 2FA est obligatoire (défaut: true)
 * @param {boolean} options.allowBackupCodes - Autoriser les codes de secours
 * @param {number} options.recentWindow - Fenêtre de temps pour 2FA récent (minutes)
 * @param {string} options.action - Action nécessitant 2FA (pour audit)
 */
const require2FA = (options = {}) => {
  const {
    required = true,
    allowBackupCodes = true,
    recentWindow = 5, // 5 minutes par défaut
    action = 'sensitive_operation'
  } = options;

  return async (req, res, next) => {
    try {
      // Vérifier si l'utilisateur est authentifié
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'SHUGO-AUTH-001',
            message: 'Authentication requise'
          }
        });
      }

      // Récupérer l'utilisateur complet
      const user = await User.findByPk(req.user.member_id);
      
      if (!user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'SHUGO-AUTH-002',
            message: 'Utilisateur non trouvé'
          }
        });
      }

      // Si 2FA n'est pas activé sur le compte
      if (!user.two_factor_enabled) {
        if (required) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'SHUGO-2FA-001',
              message: '2FA requis pour cette opération. Veuillez activer 2FA dans vos paramètres.'
            }
          });
        }
        // Si pas requis, continuer sans 2FA
        return next();
      }

      // Vérifier si une vérification 2FA récente existe
      const session = await Session.findOne({
        where: { 
          session_id: req.sessionId,
          member_id: req.user.member_id
        }
      });

      if (session && session.two_fa_verified_at) {
        const verifiedAt = new Date(session.two_fa_verified_at);
        const minutesAgo = (Date.now() - verifiedAt) / 1000 / 60;

        if (minutesAgo <= recentWindow) {
          // 2FA récent, pas besoin de re-vérifier
          req.twoFactorVerified = true;
          return next();
        }
      }

      // Récupérer le code 2FA depuis les headers ou le body
      const totpCode = req.headers['x-totp-code'] || 
                      req.body.totp_code || 
                      req.query.totp_code;

      const backupCode = req.headers['x-backup-code'] || 
                        req.body.backup_code || 
                        req.query.backup_code;

      if (!totpCode && !backupCode) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'SHUGO-2FA-002',
            message: 'Code 2FA requis pour cette opération',
            requires_2fa: true,
            action
          }
        });
      }

      let verified = false;
      let verificationMethod = null;

      // Vérifier le code TOTP
      if (totpCode) {
        const secret = await user.getTOTPSecret();
        
        if (!secret) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'SHUGO-2FA-003',
              message: '2FA non configuré correctement'
            }
          });
        }

        verified = speakeasy.totp.verify({
          secret,
          encoding: 'base32',
          token: totpCode,
          window: 2 // Tolérance de 2 intervalles (60 secondes)
        });

        verificationMethod = 'totp';
      }

      // Si TOTP échoue et backup codes autorisés
      if (!verified && backupCode && allowBackupCodes) {
        const backupUsed = await verifyBackupCode(user.member_id, backupCode);
        
        if (backupUsed) {
          verified = true;
          verificationMethod = 'backup_code';
          
          // Notifier l'utilisation d'un code de secours
          await notifyBackupCodeUsed(user);
        }
      }

      if (!verified) {
        // Log tentative échouée
        await AuditLog.create({
          action_type: '2fa.verification_failed',
          member_id: req.user.member_id,
          entity_type: 'auth',
          severity: 'warning',
          details: {
            action,
            ip_address: req.ip,
            user_agent: req.headers['user-agent']
          }
        });

        // Incrémenter le compteur d'échecs
        await incrementFailedAttempts(user);

        return res.status(403).json({
          success: false,
          error: {
            code: 'SHUGO-2FA-004',
            message: 'Code 2FA invalide'
          }
        });
      }

      // Mise à jour de la session avec vérification 2FA
      if (session) {
        await session.update({
          two_fa_verified_at: new Date(),
          two_fa_method: verificationMethod
        });
      }

      // Log succès
      await AuditLog.create({
        action_type: '2fa.verification_success',
        member_id: req.user.member_id,
        entity_type: 'auth',
        severity: 'info',
        details: {
          action,
          method: verificationMethod,
          ip_address: req.ip
        }
      });

      // Ajouter les infos de vérification à la requête
      req.twoFactorVerified = true;
      req.twoFactorMethod = verificationMethod;

      next();

    } catch (error) {
      console.error('2FA verification error:', error);
      
      return res.status(500).json({
        success: false,
        error: {
          code: 'SHUGO-2FA-500',
          message: 'Erreur lors de la vérification 2FA'
        }
      });
    }
  };
};

/**
 * Middleware pour vérifier si 2FA est configuré (sans exiger de code)
 */
const check2FAEnabled = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'SHUGO-AUTH-001',
          message: 'Authentication requise'
        }
      });
    }

    const user = await User.findByPk(req.user.member_id, {
      attributes: ['two_factor_enabled']
    });

    req.has2FA = user?.two_factor_enabled || false;
    next();

  } catch (error) {
    console.error('Check 2FA error:', error);
    next();
  }
};

/**
 * Middleware pour exiger 2FA uniquement pour certains rôles
 */
const require2FAForRoles = (roles = ['admin', 'super_admin']) => {
  return async (req, res, next) => {
    try {
      // Si le rôle de l'utilisateur est dans la liste
      if (roles.includes(req.user?.role)) {
        // Appliquer le middleware 2FA
        return require2FA({ required: true })(req, res, next);
      }
      
      // Sinon, continuer sans 2FA
      next();

    } catch (error) {
      console.error('Role-based 2FA error:', error);
      next();
    }
  };
};

/**
 * Middleware pour valider un challenge 2FA temporaire
 */
const validateTempChallenge = async (req, res, next) => {
  try {
    const challengeToken = req.headers['x-challenge-token'] || req.body.challenge_token;
    
    if (!challengeToken) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'SHUGO-2FA-005',
          message: 'Challenge token requis'
        }
      });
    }

    // Vérifier le token de challenge dans Redis ou en DB
    const challenge = await validateChallengeToken(challengeToken);
    
    if (!challenge) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'SHUGO-2FA-006',
          message: 'Challenge token invalide ou expiré'
        }
      });
    }

    req.challengeValidated = true;
    req.challengeData = challenge;
    next();

  } catch (error) {
    console.error('Challenge validation error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SHUGO-2FA-500',
        message: 'Erreur lors de la validation du challenge'
      }
    });
  }
};

// Fonctions utilitaires

async function verifyBackupCode(member_id, code) {
  try {
    const backup = await TwoFactorBackup.findOne({
      where: {
        member_id,
        code_hash: hashBackupCode(code),
        used: false
      }
    });

    if (backup) {
      await backup.update({
        used: true,
        used_at: new Date()
      });
      return true;
    }

    return false;

  } catch (error) {
    console.error('Backup code verification error:', error);
    return false;
  }
}

function hashBackupCode(code) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(code.toUpperCase()).digest('hex');
}

async function notifyBackupCodeUsed(user) {
  try {
    const EmailService = require('../services/EmailService');
    
    await EmailService.sendTemplatedEmail({
      to: user.email,
      template: 'security_backup_code_used',
      data: {
        name: user.first_name,
        used_at: new Date().toLocaleString('fr-FR'),
        remaining_codes: await countRemainingBackupCodes(user.member_id)
      },
      priority: 'high'
    });

  } catch (error) {
    console.error('Failed to notify backup code usage:', error);
  }
}

async function countRemainingBackupCodes(member_id) {
  return await TwoFactorBackup.count({
    where: {
      member_id,
      used: false
    }
  });
}

async function incrementFailedAttempts(user) {
  const attempts = (user.two_fa_failed_attempts || 0) + 1;
  
  await user.update({
    two_fa_failed_attempts: attempts,
    last_two_fa_attempt: new Date()
  });

  // Verrouiller après 5 tentatives
  if (attempts >= 5) {
    await user.update({
      two_fa_locked_until: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
    });

    // Notifier le verrouillage
    const EmailService = require('../services/EmailService');
    await EmailService.sendTemplatedEmail({
      to: user.email,
      template: 'security_2fa_locked',
      data: {
        name: user.first_name,
        unlock_time: new Date(Date.now() + 30 * 60 * 1000).toLocaleString('fr-FR')
      },
      priority: 'high'
    });
  }
}

async function validateChallengeToken(token) {
  // Implémenter la validation du token de challenge
  // Peut utiliser Redis, JWT ou DB selon l'architecture
  
  // Exemple avec JWT
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, config.jwt.challengeSecret);
    
    if (decoded.type === '2fa_challenge' && decoded.exp > Date.now() / 1000) {
      return decoded;
    }
    
    return null;

  } catch (error) {
    return null;
  }
}

// Export des middlewares
module.exports = {
  require2FA,
  check2FAEnabled,
  require2FAForRoles,
  validateTempChallenge,
  
  // Alias pour compatibilité
  auth2FA: require2FA,
  
  // Configurations pré-définies
  critical: require2FA({ 
    required: true, 
    allowBackupCodes: true, 
    recentWindow: 5,
    action: 'critical_operation'
  }),
  
  moderate: require2FA({ 
    required: true, 
    allowBackupCodes: true, 
    recentWindow: 15,
    action: 'moderate_operation'
  }),
  
  optional: require2FA({ 
    required: false, 
    allowBackupCodes: true, 
    recentWindow: 30,
    action: 'optional_operation'
  })
};
