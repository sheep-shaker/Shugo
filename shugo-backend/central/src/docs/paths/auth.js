/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Inscription d'un nouvel utilisateur
 *     description: Crée un nouveau compte utilisateur avec un token d'inscription valide
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: Inscription réussie
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Registration successful. Please set up 2FA.
 *                 data:
 *                   type: object
 *                   properties:
 *                     member_id:
 *                       type: integer
 *                     qr_code:
 *                       type: string
 *                       description: QR code base64 pour 2FA
 *                     secret:
 *                       type: string
 *                       description: Secret TOTP
 *                     backup_codes:
 *                       type: array
 *                       items:
 *                         type: string
 *       400:
 *         description: Token invalide ou expiré
 *       409:
 *         description: Email déjà enregistré
 *
 * /api/v1/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Connexion utilisateur
 *     description: Authentifie un utilisateur et retourne les tokens JWT
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Connexion réussie ou 2FA requis
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/LoginResponse'
 *                 - type: object
 *                   properties:
 *                     success:
 *                       type: boolean
 *                       example: false
 *                     message:
 *                       type: string
 *                       example: 2FA token required
 *                     require_2fa:
 *                       type: boolean
 *                       example: true
 *       401:
 *         description: Identifiants invalides
 *       423:
 *         description: Compte temporairement verrouillé
 *
 * /api/v1/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Déconnexion
 *     description: Invalide la session courante
 *     responses:
 *       200:
 *         description: Déconnexion réussie
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Logged out successfully
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *
 * /api/v1/auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Rafraîchir le token d'accès
 *     description: Génère un nouveau access token à partir d'un refresh token valide
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refresh_token]
 *             properties:
 *               refresh_token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token rafraîchi
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     access_token:
 *                       type: string
 *                     expires_in:
 *                       type: string
 *       401:
 *         description: Refresh token invalide ou expiré
 *
 * /api/v1/auth/verify-2fa:
 *   post:
 *     tags: [Auth]
 *     summary: Vérifier et activer le 2FA
 *     description: Vérifie le code TOTP et active l'authentification à deux facteurs
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [totp_token]
 *             properties:
 *               totp_token:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: 2FA activé
 *       400:
 *         description: Code TOTP invalide
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *
 * /api/v1/auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Demande de réinitialisation de mot de passe
 *     description: Envoie un email avec un lien de réinitialisation
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Si l'email existe, un lien a été envoyé
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: If the email exists, a reset link has been sent
 *
 * /api/v1/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Profil de l'utilisateur connecté
 *     description: Retourne les informations du profil de l'utilisateur authentifié
 *     responses:
 *       200:
 *         description: Profil utilisateur
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/UserProfile'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */

module.exports = {};
