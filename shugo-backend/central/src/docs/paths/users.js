/**
 * @swagger
 * /api/v1/users:
 *   get:
 *     tags: [Users]
 *     summary: Liste des utilisateurs
 *     description: Retourne une liste paginée des utilisateurs avec filtres
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortParam'
 *       - $ref: '#/components/parameters/GeoIdParam'
 *       - name: role
 *         in: query
 *         schema:
 *           $ref: '#/components/schemas/UserRole'
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *           enum: [active, inactive, suspended, pending]
 *       - name: search
 *         in: query
 *         description: Recherche par nom ou email
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Liste des utilisateurs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/UserProfile'
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *
 *   post:
 *     tags: [Users]
 *     summary: Créer un utilisateur
 *     description: Crée un nouvel utilisateur (admin uniquement)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserCreate'
 *     responses:
 *       201:
 *         description: Utilisateur créé
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
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       409:
 *         description: Email déjà utilisé
 *
 * /api/v1/users/{member_id}:
 *   get:
 *     tags: [Users]
 *     summary: Détails d'un utilisateur
 *     description: Retourne les informations détaillées d'un utilisateur
 *     parameters:
 *       - name: member_id
 *         in: path
 *         required: true
 *         description: ID membre (8 chiffres)
 *         schema:
 *           type: integer
 *           format: int64
 *     responses:
 *       200:
 *         description: Détails de l'utilisateur
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/UserProfile'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *
 *   patch:
 *     tags: [Users]
 *     summary: Modifier un utilisateur
 *     description: Met à jour les informations d'un utilisateur
 *     parameters:
 *       - name: member_id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           format: int64
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               phone:
 *                 type: string
 *               preferred_language:
 *                 type: string
 *                 enum: [fr, en, it, es, pt]
 *               notification_channel:
 *                 type: string
 *                 enum: [email, sms, matrix, push]
 *     responses:
 *       200:
 *         description: Utilisateur mis à jour
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *
 *   delete:
 *     tags: [Users]
 *     summary: Supprimer un utilisateur
 *     description: Désactive un compte utilisateur (soft delete)
 *     parameters:
 *       - name: member_id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           format: int64
 *     responses:
 *       200:
 *         description: Utilisateur supprimé
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *
 * /api/v1/users/{member_id}/role:
 *   patch:
 *     tags: [Users]
 *     summary: Modifier le rôle d'un utilisateur
 *     description: Change le niveau de rôle d'un utilisateur (admin uniquement)
 *     parameters:
 *       - name: member_id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           format: int64
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role:
 *                 $ref: '#/components/schemas/UserRole'
 *     responses:
 *       200:
 *         description: Rôle mis à jour
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *
 * /api/v1/users/{member_id}/guards:
 *   get:
 *     tags: [Users]
 *     summary: Gardes d'un utilisateur
 *     description: Retourne l'historique des gardes d'un utilisateur
 *     parameters:
 *       - name: member_id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           format: int64
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *           enum: [scheduled, confirmed, completed, cancelled, missed]
 *       - name: from
 *         in: query
 *         schema:
 *           type: string
 *           format: date
 *       - name: to
 *         in: query
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Liste des gardes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Guard'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *
 * /api/v1/users/{member_id}/sessions:
 *   get:
 *     tags: [Users]
 *     summary: Sessions actives
 *     description: Liste les sessions actives d'un utilisateur
 *     parameters:
 *       - name: member_id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           format: int64
 *     responses:
 *       200:
 *         description: Liste des sessions
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *
 *   delete:
 *     tags: [Users]
 *     summary: Révoquer toutes les sessions
 *     description: Invalide toutes les sessions d'un utilisateur
 *     parameters:
 *       - name: member_id
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           format: int64
 *     responses:
 *       200:
 *         description: Sessions révoquées
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */

module.exports = {};
