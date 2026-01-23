/**
 * @swagger
 * /api/v1/guards:
 *   get:
 *     tags: [Guards]
 *     summary: Liste des gardes
 *     description: Retourne une liste paginée des gardes avec filtres
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/GeoIdParam'
 *       - name: from
 *         in: query
 *         description: Date de début (YYYY-MM-DD)
 *         schema:
 *           type: string
 *           format: date
 *       - name: to
 *         in: query
 *         description: Date de fin (YYYY-MM-DD)
 *         schema:
 *           type: string
 *           format: date
 *       - name: shift
 *         in: query
 *         schema:
 *           type: string
 *           enum: [morning, afternoon, evening, night]
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *           enum: [scheduled, confirmed, in_progress, completed, cancelled, missed]
 *       - name: member_id
 *         in: query
 *         description: Filtrer par utilisateur assigné
 *         schema:
 *           type: integer
 *           format: int64
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
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *
 *   post:
 *     tags: [Guards]
 *     summary: Créer une garde
 *     description: Crée une nouvelle garde
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GuardCreate'
 *     responses:
 *       201:
 *         description: Garde créée
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Guard'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       409:
 *         description: Conflit (garde déjà existante pour ce créneau)
 *
 * /api/v1/guards/my-guards:
 *   get:
 *     tags: [Guards]
 *     summary: Mes gardes
 *     description: Retourne les gardes de l'utilisateur connecté
 *     parameters:
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *           enum: [upcoming, past, all]
 *           default: upcoming
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
 *         description: Mes gardes
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
 *
 * /api/v1/guards/{guard_id}:
 *   get:
 *     tags: [Guards]
 *     summary: Détails d'une garde
 *     parameters:
 *       - name: guard_id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Détails de la garde
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Guard'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *
 *   patch:
 *     tags: [Guards]
 *     summary: Modifier une garde
 *     parameters:
 *       - name: guard_id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               shift:
 *                 type: string
 *                 enum: [morning, afternoon, evening, night]
 *               time_start:
 *                 type: string
 *               time_end:
 *                 type: string
 *               member_id:
 *                 type: integer
 *                 format: int64
 *               backup_member_id:
 *                 type: integer
 *                 format: int64
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Garde mise à jour
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
 *     tags: [Guards]
 *     summary: Supprimer une garde
 *     parameters:
 *       - name: guard_id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Garde supprimée
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *
 * /api/v1/guards/{guard_id}/confirm:
 *   post:
 *     tags: [Guards]
 *     summary: Confirmer une garde
 *     description: L'utilisateur confirme sa présence pour une garde
 *     parameters:
 *       - name: guard_id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Garde confirmée
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Non assigné à cette garde
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *
 * /api/v1/guards/{guard_id}/cancel:
 *   post:
 *     tags: [Guards]
 *     summary: Annuler une garde
 *     parameters:
 *       - name: guard_id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Motif d'annulation
 *     responses:
 *       200:
 *         description: Garde annulée
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *
 * /api/v1/guards/{guard_id}/swap:
 *   post:
 *     tags: [Guards]
 *     summary: Demander un échange de garde
 *     description: Crée une demande d'échange avec un autre utilisateur
 *     parameters:
 *       - name: guard_id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [target_member_id]
 *             properties:
 *               target_member_id:
 *                 type: integer
 *                 format: int64
 *                 description: ID du membre avec qui échanger
 *               target_guard_id:
 *                 type: string
 *                 format: uuid
 *                 description: ID de la garde à échanger (optionnel)
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: Demande d'échange créée
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *
 * /api/v1/guards/statistics:
 *   get:
 *     tags: [Guards]
 *     summary: Statistiques des gardes
 *     description: Retourne les statistiques globales ou par zone
 *     parameters:
 *       - $ref: '#/components/parameters/GeoIdParam'
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
 *         description: Statistiques
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     total_guards:
 *                       type: integer
 *                     by_status:
 *                       type: object
 *                     by_shift:
 *                       type: object
 *                     completion_rate:
 *                       type: number
 *                       format: float
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *
 * /api/v1/guards/calendar:
 *   get:
 *     tags: [Guards]
 *     summary: Vue calendrier
 *     description: Retourne les gardes formatées pour un calendrier
 *     parameters:
 *       - name: month
 *         in: query
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *       - name: year
 *         in: query
 *         required: true
 *         schema:
 *           type: integer
 *       - $ref: '#/components/parameters/GeoIdParam'
 *     responses:
 *       200:
 *         description: Données calendrier
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */

module.exports = {};
