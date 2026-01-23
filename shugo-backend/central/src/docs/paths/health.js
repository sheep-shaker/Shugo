/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     tags: [Health]
 *     summary: État de santé du système
 *     description: Vérifie l'état de tous les composants système
 *     security: []
 *     responses:
 *       200:
 *         description: Système opérationnel
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthStatus'
 *       503:
 *         description: Système dégradé ou indisponible
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthStatus'
 *
 * /api/v1/health/live:
 *   get:
 *     tags: [Health]
 *     summary: Liveness probe
 *     description: Vérifie si le serveur répond (pour Kubernetes)
 *     security: []
 *     responses:
 *       200:
 *         description: Serveur actif
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *
 * /api/v1/health/ready:
 *   get:
 *     tags: [Health]
 *     summary: Readiness probe
 *     description: Vérifie si le serveur est prêt à recevoir du trafic
 *     security: []
 *     responses:
 *       200:
 *         description: Serveur prêt
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ready
 *                 checks:
 *                   type: object
 *       503:
 *         description: Serveur non prêt
 *
 * /api/v1/health/metrics:
 *   get:
 *     tags: [Health]
 *     summary: Métriques système
 *     description: Retourne les métriques détaillées (admin uniquement)
 *     responses:
 *       200:
 *         description: Métriques système
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
 *                     cpu:
 *                       type: object
 *                       properties:
 *                         usage:
 *                           type: number
 *                         cores:
 *                           type: integer
 *                     memory:
 *                       type: object
 *                       properties:
 *                         used:
 *                           type: integer
 *                         total:
 *                           type: integer
 *                         percentage:
 *                           type: number
 *                     database:
 *                       type: object
 *                       properties:
 *                         pool_size:
 *                           type: integer
 *                         active_connections:
 *                           type: integer
 *                     uptime:
 *                       type: integer
 *                       description: Secondes depuis le démarrage
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */

module.exports = {};
