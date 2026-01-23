'use strict';

/**
 * Service d'Authentification SHUGO
 * 
 * Gère l'inscription, la connexion, le 2FA, les sessions JWT.
 * 
 * @see Document Technique V7.0 - Section 6
 */

const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const config = require('../config');
const crypto = require('../utils/crypto');

/**
 * Service d'authentification
 */
class AuthService {
  constructor(models) {
    this.models = models;
    this.User = models.User;
    this.Session = models.Session;
    this.RegistrationToken = models.RegistrationToken;
    this.AuditLog = models.AuditLog;
  }

  // =========================================
  // INSCRIPTION
  // =========================================

  /**
   * Valide un jeton d'inscription et retourne les données pré-remplies
   * @param {string} tokenCode - Code du jeton
   * @returns {Promise<Object>}
   */
  async validateRegistrationToken(tokenCode) {
    const token = await this.RegistrationToken.findOne({
      where: {
        token_code: tokenCode,
        status: 'active'
      }
    });

    if (!token) {
      throw new AuthError('TOKEN_INVALID', 'Jeton d\'inscription invalide ou expiré');
    }

    if (new Date() > token.expires_at) {
      await token.update({ status: 'expired' });
      throw new AuthError('TOKEN_EXPIRED', 'Jeton d\'inscription expiré');
    }

    return {
      tokenId: token.token_id,
      geoId: token.geo_id,
      firstName: token.target_first_name,
      lastName: token.target_last_name,
      role: token.target_role,
      groupId: token.target_group_id
    };
  }

  /**
   * Enregistre un nouvel utilisateur
   * @param {Object} data - Données d'inscription
   * @returns {Promise<Object>}
   */
  async register(data) {
    const { tokenCode, email, password, firstName, lastName, phone, preferredLanguage, notificationChannel } = data;

    // 1. Valider le jeton
    const tokenData = await this.validateRegistrationToken(tokenCode);

    // 2. Vérifier que l'email n'existe pas déjà
    const emailHash = crypto.hashForSearch(email);
    const existingUser = await this.User.findOne({
      where: { email_hash: emailHash }
    });

    if (existingUser) {
      throw new AuthError('EMAIL_EXISTS', 'Cette adresse email est déjà utilisée');
    }

    // 3. Générer le member_id
    const memberId = await this._generateMemberId();

    // 4. Chiffrer les données sensibles
    const emailEncrypted = crypto.encryptToBuffer(email.toLowerCase().trim());
    const firstNameEncrypted = crypto.encryptToBuffer(firstName || tokenData.firstName);
    const lastNameEncrypted = crypto.encryptToBuffer(lastName || tokenData.lastName);
    const phoneEncrypted = phone ? crypto.encryptToBuffer(phone) : null;

    // 5. Hasher le mot de passe
    const passwordHash = await crypto.hashPassword(password);

    // 6. Générer le secret TOTP
    const totpSecret = speakeasy.generateSecret({
      name: `SHUGO:${email}`,
      issuer: config.security.totp.issuer,
      length: 32
    });

    const totpSecretEncrypted = crypto.encryptToBuffer(totpSecret.base32);

    // 7. Générer les codes de backup
    const backupCodes = this._generateBackupCodes();
    const backupCodesEncrypted = crypto.encryptToBuffer(JSON.stringify(backupCodes));

    // 8. Calculer les hash phonétiques
    const firstNamePhonetic = this._generatePhonetic(firstName || tokenData.firstName);
    const lastNamePhonetic = this._generatePhonetic(lastName || tokenData.lastName);

    // 9. Créer l'utilisateur
    const user = await this.User.create({
      member_id: memberId,
      email_encrypted: emailEncrypted,
      email_hash: emailHash,
      password_hash: passwordHash,
      first_name_encrypted: firstNameEncrypted,
      last_name_encrypted: lastNameEncrypted,
      first_name_hash: crypto.hashForSearch(firstName || tokenData.firstName),
      last_name_hash: crypto.hashForSearch(lastName || tokenData.lastName),
      first_name_phonetic: firstNamePhonetic,
      last_name_phonetic: lastNamePhonetic,
      phonetic_algo: 'dm_fr',
      phone_encrypted: phoneEncrypted,
      role: tokenData.role,
      geo_id: tokenData.geoId,
      group_id: tokenData.groupId,
      scope: `local:${tokenData.geoId}`,
      preferred_language: preferredLanguage || config.geo.defaultLanguage,
      notification_channel: notificationChannel || 'email',
      totp_secret_encrypted: totpSecretEncrypted,
      totp_backup_codes: backupCodesEncrypted,
      totp_enabled: false, // Sera activé après validation
      status: 'pending_2fa', // En attente de validation 2FA
      enc_key_id: 1
    });

    // 10. Marquer le jeton comme utilisé
    await this.RegistrationToken.update(
      { status: 'used', used_at: new Date(), used_by_member_id: memberId },
      { where: { token_code: tokenCode } }
    );

    // 11. Générer le QR Code
    const qrCodeUrl = await QRCode.toDataURL(totpSecret.otpauth_url);

    // 12. Logger l'action
    await this._logAudit(memberId, 'register', 'success', { geoId: tokenData.geoId });

    return {
      memberId,
      qrCode: qrCodeUrl,
      totpSecret: totpSecret.base32, // Pour affichage manuel si QR impossible
      backupCodes,
      message: 'Compte créé. Veuillez valider votre code 2FA.'
    };
  }

  /**
   * Valide le code TOTP lors de l'inscription
   * @param {number} memberId
   * @param {string} totpCode
   * @returns {Promise<Object>}
   */
  async validateRegistration2FA(memberId, totpCode) {
    const user = await this.User.findByPk(memberId);
    
    if (!user) {
      throw new AuthError('USER_NOT_FOUND', 'Utilisateur non trouvé');
    }

    if (user.status !== 'pending_2fa') {
      throw new AuthError('INVALID_STATUS', 'Compte déjà activé ou invalide');
    }

    // Déchiffrer le secret TOTP
    const totpSecret = crypto.decryptFromBuffer(user.totp_secret_encrypted).toString('utf8');

    // Vérifier le code
    const verified = speakeasy.totp.verify({
      secret: totpSecret,
      encoding: 'base32',
      token: totpCode,
      window: config.security.totp.window
    });

    if (!verified) {
      // Incrémenter les tentatives
      const attempts = (user.failed_login_attempts || 0) + 1;
      await user.update({ failed_login_attempts: attempts });

      if (attempts >= 3) {
        await user.update({ 
          status: 'blocked',
          locked_until: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h
        });
        throw new AuthError('ACCOUNT_BLOCKED', 'Trop de tentatives. Compte bloqué pour 24h.');
      }

      throw new AuthError('INVALID_TOTP', `Code invalide. ${3 - attempts} tentative(s) restante(s).`);
    }

    // Activer le compte
    await user.update({
      status: 'active',
      totp_enabled: true,
      failed_login_attempts: 0
    });

    await this._logAudit(memberId, 'activate_2fa', 'success');

    return { success: true, message: 'Compte activé avec succès' };
  }

  // =========================================
  // CONNEXION
  // =========================================

  /**
   * Étape 1 de connexion: email + mot de passe
   * @param {string} email
   * @param {string} password
   * @param {Object} metadata - IP, User-Agent, etc.
   * @returns {Promise<Object>}
   */
  async loginStep1(email, password, metadata = {}) {
    // 1. Trouver l'utilisateur par hash email
    const emailHash = crypto.hashForSearch(email);
    const user = await this.User.findOne({
      where: { email_hash: emailHash }
    });

    if (!user) {
      // Log tentative avec email inconnu
      await this._logAudit(null, 'login_attempt', 'failure', { 
        reason: 'unknown_email',
        ip: metadata.ip 
      });
      throw new AuthError('INVALID_CREDENTIALS', 'Email ou mot de passe incorrect');
    }

    // 2. Vérifier le statut du compte
    if (user.status === 'blocked' || user.status === 'deleted') {
      throw new AuthError('ACCOUNT_BLOCKED', 'Compte bloqué ou supprimé');
    }

    if (user.status === 'suspended') {
      throw new AuthError('ACCOUNT_SUSPENDED', 'Compte suspendu');
    }

    if (user.locked_until && new Date() < user.locked_until) {
      const remaining = Math.ceil((user.locked_until - new Date()) / 60000);
      throw new AuthError('ACCOUNT_LOCKED', `Compte verrouillé. Réessayez dans ${remaining} minutes.`);
    }

    // 3. Vérifier le mot de passe
    const passwordValid = await crypto.verifyPassword(user.password_hash, password);

    if (!passwordValid) {
      const attempts = (user.failed_login_attempts || 0) + 1;
      const updates = { failed_login_attempts: attempts };

      if (attempts >= config.security.rateLimit.maxAuthAttempts) {
        updates.locked_until = new Date(Date.now() + config.security.rateLimit.authLockoutMinutes * 60000);
        await user.update(updates);

        await this._logAudit(user.member_id, 'login_lockout', 'failure', { 
          attempts,
          ip: metadata.ip 
        });

        throw new AuthError('ACCOUNT_LOCKED', `Compte verrouillé pour ${config.security.rateLimit.authLockoutMinutes} minutes.`);
      }

      await user.update(updates);
      await this._logAudit(user.member_id, 'login_attempt', 'failure', { 
        reason: 'invalid_password',
        attempt: attempts,
        ip: metadata.ip 
      });

      throw new AuthError('INVALID_CREDENTIALS', 'Email ou mot de passe incorrect');
    }

    // 4. Vérifier si rehash nécessaire
    if (crypto.needsRehash(user.password_hash)) {
      const newHash = await crypto.hashPassword(password);
      await user.update({ password_hash: newHash });
    }

    // 5. Préparer l'étape 2 (2FA)
    const loginToken = crypto.generateToken(32);
    
    // Stocker temporairement (en cache ou dans un champ)
    // Pour simplifier, on utilise un JWT court
    const tempToken = jwt.sign(
      { memberId: user.member_id, step: 1 },
      config.jwt.secret,
      { expiresIn: '5m' }
    );

    return {
      requiresTOTP: user.totp_enabled,
      tempToken,
      message: user.totp_enabled ? 'Veuillez entrer votre code 2FA' : 'Connexion réussie'
    };
  }

  /**
   * Étape 2 de connexion: code TOTP
   * @param {string} tempToken
   * @param {string} totpCode
   * @param {Object} metadata
   * @returns {Promise<Object>}
   */
  async loginStep2(tempToken, totpCode, metadata = {}) {
    // 1. Valider le token temporaire
    let decoded;
    try {
      decoded = jwt.verify(tempToken, config.jwt.secret);
    } catch (err) {
      throw new AuthError('INVALID_TOKEN', 'Session expirée. Veuillez recommencer.');
    }

    if (decoded.step !== 1) {
      throw new AuthError('INVALID_TOKEN', 'Token invalide');
    }

    // 2. Récupérer l'utilisateur
    const user = await this.User.findByPk(decoded.memberId);
    if (!user || user.status !== 'active') {
      throw new AuthError('USER_NOT_FOUND', 'Utilisateur non trouvé ou inactif');
    }

    // 3. Vérifier le code TOTP
    const totpSecret = crypto.decryptFromBuffer(user.totp_secret_encrypted).toString('utf8');
    
    const verified = speakeasy.totp.verify({
      secret: totpSecret,
      encoding: 'base32',
      token: totpCode,
      window: config.security.totp.window
    });

    if (!verified) {
      const attempts = (user.failed_login_attempts || 0) + 1;
      await user.update({ failed_login_attempts: attempts });

      if (attempts >= 3) {
        await user.update({
          locked_until: new Date(Date.now() + 15 * 60000) // 15 min
        });
        throw new AuthError('ACCOUNT_LOCKED', 'Trop de tentatives. Compte verrouillé 15 minutes.');
      }

      await this._logAudit(user.member_id, 'totp_verify', 'failure', { 
        attempt: attempts,
        ip: metadata.ip 
      });

      throw new AuthError('INVALID_TOTP', `Code invalide. ${3 - attempts} tentative(s) restante(s).`);
    }

    // 4. Créer la session
    return this._createSession(user, metadata);
  }

  /**
   * Connexion directe (sans 2FA) - pour tests ou si 2FA désactivé
   * @param {string} email
   * @param {string} password
   * @param {Object} metadata
   * @returns {Promise<Object>}
   */
  async login(email, password, metadata = {}) {
    const step1 = await this.loginStep1(email, password, metadata);
    
    if (!step1.requiresTOTP) {
      // Pas de 2FA, créer la session directement
      const decoded = jwt.verify(step1.tempToken, config.jwt.secret);
      const user = await this.User.findByPk(decoded.memberId);
      return this._createSession(user, metadata);
    }

    return step1;
  }

  // =========================================
  // SESSIONS ET TOKENS
  // =========================================

  /**
   * Crée une session et génère les tokens JWT
   * @param {Object} user
   * @param {Object} metadata
   * @returns {Promise<Object>}
   */
  async _createSession(user, metadata = {}) {
    // 1. Vérifier le nombre de sessions actives
    const activeSessions = await this.Session.count({
      where: { member_id: user.member_id, is_active: true }
    });

    if (activeSessions >= config.security.session.maxConcurrent) {
      // Fermer la session la plus ancienne
      const oldestSession = await this.Session.findOne({
        where: { member_id: user.member_id, is_active: true },
        order: [['created_at', 'ASC']]
      });
      if (oldestSession) {
        await oldestSession.update({ is_active: false, logout_reason: 'replaced' });
      }
    }

    // 2. Générer les tokens
    const accessToken = this._generateAccessToken(user);
    const refreshToken = this._generateRefreshToken(user);

    // 3. Créer la session
    const session = await this.Session.create({
      member_id: user.member_id,
      jwt_token_hash: crypto.sha256(accessToken),
      ip_address: metadata.ip || null,
      user_agent: metadata.userAgent || null,
      geo_location: metadata.geoLocation || null,
      device_info: metadata.deviceInfo || null,
      expires_at: new Date(Date.now() + this._parseExpiry(config.jwt.refreshExpiresIn)),
      is_active: true
    });

    // 4. Mettre à jour l'utilisateur
    await user.update({
      last_login: new Date(),
      last_ip: metadata.ip || null,
      failed_login_attempts: 0,
      locked_until: null
    });

    // 5. Logger
    await this._logAudit(user.member_id, 'login', 'success', {
      ip: metadata.ip,
      sessionId: session.session_id
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: config.jwt.accessExpiresIn,
      user: {
        memberId: user.member_id,
        role: user.role,
        geoId: user.geo_id,
        scope: user.scope
      }
    };
  }

  /**
   * Génère un access token JWT
   * @param {Object} user
   * @returns {string}
   */
  _generateAccessToken(user) {
    const payload = {
      sub: user.member_id.toString(),
      memberId: user.member_id,
      role: user.role,
      geoId: user.geo_id,
      scope: user.scope,
      type: 'access'
    };

    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.accessExpiresIn,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      algorithm: config.jwt.algorithm
    });
  }

  /**
   * Génère un refresh token JWT
   * @param {Object} user
   * @returns {string}
   */
  _generateRefreshToken(user) {
    const payload = {
      sub: user.member_id.toString(),
      memberId: user.member_id,
      type: 'refresh'
    };

    return jwt.sign(payload, config.jwt.refreshSecret, {
      expiresIn: config.jwt.refreshExpiresIn,
      issuer: config.jwt.issuer,
      algorithm: config.jwt.algorithm
    });
  }

  /**
   * Rafraîchit les tokens
   * @param {string} refreshToken
   * @param {Object} metadata
   * @returns {Promise<Object>}
   */
  async refreshTokens(refreshToken, metadata = {}) {
    // 1. Vérifier le refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
    } catch (err) {
      throw new AuthError('INVALID_TOKEN', 'Token de rafraîchissement invalide');
    }

    if (decoded.type !== 'refresh') {
      throw new AuthError('INVALID_TOKEN', 'Type de token invalide');
    }

    // 2. Récupérer l'utilisateur
    const user = await this.User.findByPk(decoded.memberId);
    if (!user || user.status !== 'active') {
      throw new AuthError('USER_NOT_FOUND', 'Utilisateur non trouvé ou inactif');
    }

    // 3. Générer de nouveaux tokens
    const accessToken = this._generateAccessToken(user);
    const newRefreshToken = this._generateRefreshToken(user);

    // 4. Mettre à jour la session
    await this.Session.update(
      { jwt_token_hash: crypto.sha256(accessToken) },
      { where: { member_id: user.member_id, is_active: true } }
    );

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: config.jwt.accessExpiresIn
    };
  }

  /**
   * Vérifie un access token
   * @param {string} token
   * @returns {Promise<Object>}
   */
  async verifyAccessToken(token) {
    try {
      const decoded = jwt.verify(token, config.jwt.secret, {
        issuer: config.jwt.issuer,
        audience: config.jwt.audience
      });

      if (decoded.type !== 'access') {
        throw new AuthError('INVALID_TOKEN', 'Type de token invalide');
      }

      // Vérifier la session
      const session = await this.Session.findOne({
        where: {
          member_id: decoded.memberId,
          jwt_token_hash: crypto.sha256(token),
          is_active: true
        }
      });

      if (!session) {
        throw new AuthError('SESSION_INVALID', 'Session invalide ou expirée');
      }

      // Mettre à jour last_activity
      await session.update({ last_activity: new Date() });

      return decoded;
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError('INVALID_TOKEN', 'Token invalide ou expiré');
    }
  }

  // =========================================
  // DÉCONNEXION
  // =========================================

  /**
   * Déconnecte l'utilisateur (invalide la session)
   * @param {number} memberId
   * @param {string} token
   * @returns {Promise<void>}
   */
  async logout(memberId, token) {
    await this.Session.update(
      { is_active: false, logout_reason: 'manual' },
      { 
        where: { 
          member_id: memberId, 
          jwt_token_hash: crypto.sha256(token),
          is_active: true 
        } 
      }
    );

    await this._logAudit(memberId, 'logout', 'success');
  }

  /**
   * Déconnecte toutes les sessions d'un utilisateur
   * @param {number} memberId
   * @param {string} reason
   * @returns {Promise<number>} Nombre de sessions fermées
   */
  async logoutAll(memberId, reason = 'logout_all') {
    const [count] = await this.Session.update(
      { is_active: false, logout_reason: reason },
      { where: { member_id: memberId, is_active: true } }
    );

    await this._logAudit(memberId, 'logout_all', 'success', { count });
    return count;
  }

  // =========================================
  // RÉINITIALISATION MOT DE PASSE
  // =========================================

  /**
   * Demande de réinitialisation de mot de passe
   * @param {string} email
   * @returns {Promise<Object>}
   */
  async requestPasswordReset(email) {
    const emailHash = crypto.hashForSearch(email);
    const user = await this.User.findOne({ where: { email_hash: emailHash } });

    // Ne pas révéler si l'email existe
    if (!user) {
      return { message: 'Si l\'adresse existe, un email a été envoyé.' };
    }

    // Générer un token de reset
    const resetToken = crypto.generateToken(32);
    const resetTokenHash = crypto.sha256(resetToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h

    // Stocker dans registration_tokens avec type spécial
    await this.RegistrationToken.create({
      token_code: resetTokenHash,
      geo_id: user.geo_id,
      created_by_member_id: user.member_id,
      target_role: user.role,
      expires_at: expiresAt,
      status: 'active'
    });

    // Envoyer l'email de réinitialisation
    try {
      const emailService = require('./EmailService');
      const decryptedEmail = crypto.decryptFromBuffer(user.email_encrypted).toString('utf8');
      const firstName = user.first_name_encrypted
        ? crypto.decryptFromBuffer(user.first_name_encrypted).toString('utf8')
        : '';

      await emailService.sendPasswordReset(
        { email: decryptedEmail, firstName },
        resetToken
      );
    } catch (emailError) {
      // Log l'erreur mais ne pas bloquer le processus
      console.error('[AuthService] Erreur envoi email reset:', emailError.message);
    }

    await this._logAudit(user.member_id, 'password_reset_request', 'success');

    return { 
      message: 'Si l\'adresse existe, un email a été envoyé.',
      // En dev, retourner le token
      ...(config.isDev && { resetToken })
    };
  }

  /**
   * Réinitialise le mot de passe avec le token
   * @param {string} resetToken
   * @param {string} totpCode
   * @param {string} newPassword
   * @returns {Promise<Object>}
   */
  async resetPassword(resetToken, totpCode, newPassword) {
    const resetTokenHash = crypto.sha256(resetToken);
    
    const token = await this.RegistrationToken.findOne({
      where: { token_code: resetTokenHash, status: 'active' }
    });

    if (!token || new Date() > token.expires_at) {
      throw new AuthError('INVALID_TOKEN', 'Lien de réinitialisation invalide ou expiré');
    }

    const user = await this.User.findByPk(token.created_by_member_id);
    if (!user) {
      throw new AuthError('USER_NOT_FOUND', 'Utilisateur non trouvé');
    }

    // Vérifier le TOTP
    const totpSecret = crypto.decryptFromBuffer(user.totp_secret_encrypted).toString('utf8');
    const verified = speakeasy.totp.verify({
      secret: totpSecret,
      encoding: 'base32',
      token: totpCode,
      window: config.security.totp.window
    });

    if (!verified) {
      throw new AuthError('INVALID_TOTP', 'Code 2FA invalide');
    }

    // Hasher le nouveau mot de passe
    const passwordHash = await crypto.hashPassword(newPassword);

    // Mettre à jour
    await user.update({
      password_hash: passwordHash,
      password_changed_at: new Date(),
      failed_login_attempts: 0,
      locked_until: null
    });

    // Invalider le token
    await token.update({ status: 'used', used_at: new Date() });

    // Déconnecter toutes les sessions
    await this.logoutAll(user.member_id, 'password_reset');

    await this._logAudit(user.member_id, 'password_reset', 'success');

    return { success: true, message: 'Mot de passe modifié avec succès' };
  }

  // =========================================
  // UTILITAIRES PRIVÉS
  // =========================================

  /**
   * Génère un nouveau member_id unique
   * @returns {Promise<number>}
   */
  async _generateMemberId() {
    // Trouver le dernier member_id
    const lastUser = await this.User.findOne({
      order: [['member_id', 'DESC']],
      attributes: ['member_id']
    });

    let nextId = lastUser ? lastUser.member_id + 1 : 1;

    // Vérifier les ID recyclés (après Cendre Blanche)
    // TODO: Implémenter la file des IDs recyclés

    if (nextId > 9999999999) {
      throw new Error('Limite de member_id atteinte');
    }

    return nextId;
  }

  /**
   * Génère des codes de backup pour 2FA
   * @returns {string[]}
   */
  _generateBackupCodes() {
    const codes = [];
    for (let i = 0; i < 10; i++) {
      codes.push(crypto.generateNumericCode(8));
    }
    return codes;
  }

  /**
   * Génère l'empreinte phonétique
   * @param {string} name
   * @returns {string}
   */
  _generatePhonetic(name) {
    if (!name) return null;
    // Implémentation simplifiée - à améliorer avec double metaphone
    return name.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z]/g, '');
  }

  /**
   * Parse une durée d'expiration
   * @param {string} expiry - Ex: '15m', '7d'
   * @returns {number} Millisecondes
   */
  _parseExpiry(expiry) {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 15 * 60 * 1000; // 15 min par défaut

    const value = parseInt(match[1], 10);
    const unit = match[2];

    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return value * multipliers[unit];
  }

  /**
   * Log une action d'audit
   * @param {number} memberId
   * @param {string} action
   * @param {string} result
   * @param {Object} details
   */
  async _logAudit(memberId, action, result, details = {}) {
    try {
      await this.AuditLog.create({
        member_id: memberId,
        action: `auth.${action}`,
        action_category: 'auth',
        result,
        ip_address: details.ip || null,
        metadata: details
      });
    } catch (err) {
      console.error('Erreur audit log:', err);
    }
  }
}

/**
 * Classe d'erreur d'authentification
 */
class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = this._getStatusCode(code);
  }

  _getStatusCode(code) {
    const codes = {
      INVALID_CREDENTIALS: 401,
      INVALID_TOKEN: 401,
      INVALID_TOTP: 401,
      TOKEN_INVALID: 400,
      TOKEN_EXPIRED: 400,
      ACCOUNT_BLOCKED: 403,
      ACCOUNT_SUSPENDED: 403,
      ACCOUNT_LOCKED: 423,
      USER_NOT_FOUND: 404,
      EMAIL_EXISTS: 409,
      SESSION_INVALID: 401,
      INVALID_STATUS: 400
    };
    return codes[code] || 500;
  }
}

module.exports = AuthService;
module.exports.AuthError = AuthError;
