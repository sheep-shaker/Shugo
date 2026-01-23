/**
 * SHUGO v7.0 - Configuration Swagger/OpenAPI
 *
 * Documentation API automatique avec swagger-jsdoc et swagger-ui-express
 *
 * @see https://swagger.io/specification/
 */

'use strict';

const swaggerJSDoc = require('swagger-jsdoc');
const config = require('../config');

/**
 * OpenAPI 3.0 Specification
 */
const swaggerDefinition = {
    openapi: '3.0.3',
    info: {
        title: 'SHUGO API',
        version: '7.0.0',
        description: `
# SHUGO v7.0 - API Documentation

**Système Hiérarchisé d'Utilisation et de Gestion Opérationnelle**

API RESTful pour la gestion des gardes, utilisateurs, groupes et protocoles de sécurité.

## Authentification

L'API utilise des tokens JWT (JSON Web Tokens). Pour accéder aux endpoints protégés:

1. Obtenez un access token via \`POST /api/v1/auth/login\`
2. Incluez le token dans le header: \`Authorization: Bearer <token>\`

## Codes de réponse

| Code | Description |
|------|-------------|
| 200 | Succès |
| 201 | Ressource créée |
| 400 | Requête invalide |
| 401 | Non authentifié |
| 403 | Non autorisé |
| 404 | Ressource non trouvée |
| 409 | Conflit (ex: email déjà utilisé) |
| 423 | Compte verrouillé |
| 429 | Trop de requêtes |
| 500 | Erreur serveur |

## Rate Limiting

- Endpoints publics: 100 req/15min par IP
- Endpoints authentifiés: 500 req/15min par utilisateur
- Authentification: 5 tentatives/15min

## Rôles utilisateurs

| Rôle | Niveau | Description |
|------|--------|-------------|
| Diamond | 10 | Super administrateur |
| Gold | 8 | Administrateur système |
| Silver | 6 | Gestionnaire |
| Bronze | 4 | Utilisateur standard |
| Iron | 2 | Utilisateur limité |
| Visitor | 0 | Lecture seule |
        `.trim(),
        contact: {
            name: 'SHUGO Support',
            email: 'support@shugo.app',
            url: 'https://shugo.app/support'
        },
        license: {
            name: 'AGPL-3.0',
            url: 'https://www.gnu.org/licenses/agpl-3.0.html'
        }
    },
    servers: [
        {
            url: config.server?.baseUrl || 'http://localhost:3000',
            description: 'Serveur actuel'
        },
        {
            url: 'https://api.shugo.app',
            description: 'Production'
        },
        {
            url: 'https://staging-api.shugo.app',
            description: 'Staging'
        }
    ],
    tags: [
        { name: 'Auth', description: 'Authentification et sessions' },
        { name: 'Users', description: 'Gestion des utilisateurs' },
        { name: 'Groups', description: 'Gestion des groupes' },
        { name: 'Guards', description: 'Gestion des gardes' },
        { name: 'Scenarios', description: 'Scénarios et semaines-types' },
        { name: 'WaitingList', description: 'Liste d\'attente J-3' },
        { name: 'Missions', description: 'Missions utilisateurs' },
        { name: 'Messages', description: 'Centre de messages' },
        { name: 'Support', description: 'Tickets de support' },
        { name: 'Notifications', description: 'Notifications utilisateurs' },
        { name: 'Vault', description: 'Coffre-fort sécurisé' },
        { name: 'Backup', description: 'Sauvegarde et restauration' },
        { name: 'Maintenance', description: 'Maintenance système' },
        { name: 'LocalServers', description: 'Serveurs locaux' },
        { name: 'Plugins', description: 'Gestion des plugins' },
        { name: 'Emergency', description: 'Codes d\'urgence' },
        { name: 'Admin', description: 'Administration' },
        { name: 'Protocols', description: 'Protocoles de sécurité' },
        { name: 'Health', description: 'État du système' }
    ],
    components: {
        securitySchemes: {
            BearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'Token JWT obtenu via /api/v1/auth/login'
            },
            ApiKeyAuth: {
                type: 'apiKey',
                in: 'header',
                name: 'X-API-Key',
                description: 'Clé API pour les serveurs locaux'
            }
        },
        schemas: {
            // Common schemas
            Error: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: false },
                    error: {
                        type: 'object',
                        properties: {
                            code: { type: 'string', example: 'VALIDATION_ERROR' },
                            message: { type: 'string', example: 'Validation failed' },
                            details: { type: 'array', items: { type: 'string' } }
                        }
                    }
                }
            },
            Success: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string' },
                    data: { type: 'object' }
                }
            },
            Pagination: {
                type: 'object',
                properties: {
                    page: { type: 'integer', example: 1 },
                    limit: { type: 'integer', example: 20 },
                    total: { type: 'integer', example: 100 },
                    totalPages: { type: 'integer', example: 5 },
                    hasNext: { type: 'boolean', example: true },
                    hasPrev: { type: 'boolean', example: false }
                }
            },

            // Auth schemas
            LoginRequest: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                    email: { type: 'string', format: 'email', example: 'user@example.com' },
                    password: { type: 'string', format: 'password', minLength: 8 },
                    totp_token: { type: 'string', description: 'Code 2FA si activé', example: '123456' }
                }
            },
            LoginResponse: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                        type: 'object',
                        properties: {
                            access_token: { type: 'string' },
                            refresh_token: { type: 'string' },
                            expires_in: { type: 'string', example: '15m' },
                            user: { $ref: '#/components/schemas/UserProfile' }
                        }
                    }
                }
            },
            RegisterRequest: {
                type: 'object',
                required: ['token', 'email', 'password', 'first_name', 'last_name'],
                properties: {
                    token: { type: 'string', description: 'Token d\'inscription' },
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string', format: 'password', minLength: 8 },
                    first_name: { type: 'string', minLength: 2, maxLength: 50 },
                    last_name: { type: 'string', minLength: 2, maxLength: 50 },
                    phone: { type: 'string', pattern: '^\\+?[0-9]{10,15}$' }
                }
            },

            // User schemas
            UserProfile: {
                type: 'object',
                properties: {
                    member_id: { type: 'integer', format: 'int64', example: 12345678 },
                    email: { type: 'string', format: 'email' },
                    first_name: { type: 'string' },
                    last_name: { type: 'string' },
                    role: { $ref: '#/components/schemas/UserRole' },
                    geo_id: { type: 'string', pattern: '^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$' },
                    group_id: { type: 'string', format: 'uuid' },
                    status: { type: 'string', enum: ['active', 'inactive', 'suspended', 'pending'] },
                    totp_enabled: { type: 'boolean' },
                    last_login: { type: 'string', format: 'date-time' }
                }
            },
            UserRole: {
                type: 'string',
                enum: ['Diamond', 'Gold', 'Silver', 'Bronze', 'Iron', 'Visitor'],
                description: 'Niveau de rôle utilisateur'
            },
            UserCreate: {
                type: 'object',
                required: ['email', 'first_name', 'last_name', 'geo_id'],
                properties: {
                    email: { type: 'string', format: 'email' },
                    first_name: { type: 'string' },
                    last_name: { type: 'string' },
                    phone: { type: 'string' },
                    role: { $ref: '#/components/schemas/UserRole' },
                    geo_id: { type: 'string' },
                    group_id: { type: 'string', format: 'uuid' }
                }
            },

            // Group schemas
            Group: {
                type: 'object',
                properties: {
                    group_id: { type: 'string', format: 'uuid' },
                    name: { type: 'string' },
                    description: { type: 'string' },
                    geo_id: { type: 'string' },
                    parent_group_id: { type: 'string', format: 'uuid', nullable: true },
                    leader_member_id: { type: 'integer', format: 'int64' },
                    deputy_member_id: { type: 'integer', format: 'int64' },
                    max_members: { type: 'integer', default: 50 },
                    current_members: { type: 'integer' },
                    group_type: { type: 'string', enum: ['operational', 'administrative', 'training', 'special'] },
                    status: { type: 'string', enum: ['active', 'inactive', 'archived'] },
                    created_at: { type: 'string', format: 'date-time' },
                    updated_at: { type: 'string', format: 'date-time' }
                }
            },

            // Guard schemas
            Guard: {
                type: 'object',
                properties: {
                    guard_id: { type: 'string', format: 'uuid' },
                    geo_id: { type: 'string' },
                    date: { type: 'string', format: 'date' },
                    shift: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'night'] },
                    time_start: { type: 'string', pattern: '^[0-9]{2}:[0-9]{2}$' },
                    time_end: { type: 'string', pattern: '^[0-9]{2}:[0-9]{2}$' },
                    member_id: { type: 'integer', format: 'int64' },
                    backup_member_id: { type: 'integer', format: 'int64', nullable: true },
                    status: { type: 'string', enum: ['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'missed'] },
                    points: { type: 'integer', default: 1 },
                    notes: { type: 'string' },
                    created_at: { type: 'string', format: 'date-time' }
                }
            },
            GuardCreate: {
                type: 'object',
                required: ['geo_id', 'date', 'shift', 'member_id'],
                properties: {
                    geo_id: { type: 'string' },
                    date: { type: 'string', format: 'date' },
                    shift: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'night'] },
                    time_start: { type: 'string' },
                    time_end: { type: 'string' },
                    member_id: { type: 'integer', format: 'int64' },
                    backup_member_id: { type: 'integer', format: 'int64' },
                    points: { type: 'integer' },
                    notes: { type: 'string' }
                }
            },

            // Scenario schemas
            Scenario: {
                type: 'object',
                properties: {
                    scenario_id: { type: 'string', format: 'uuid' },
                    name: { type: 'string' },
                    description: { type: 'string' },
                    geo_id: { type: 'string' },
                    is_template: { type: 'boolean' },
                    week_definition: { type: 'object' },
                    status: { type: 'string', enum: ['draft', 'active', 'archived'] },
                    created_by_member_id: { type: 'integer', format: 'int64' },
                    created_at: { type: 'string', format: 'date-time' }
                }
            },

            // Message schemas
            Message: {
                type: 'object',
                properties: {
                    message_id: { type: 'string', format: 'uuid' },
                    sender_member_id: { type: 'integer', format: 'int64' },
                    subject: { type: 'string' },
                    content: { type: 'string' },
                    priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
                    message_type: { type: 'string', enum: ['announcement', 'alert', 'reminder', 'direct'] },
                    scope_type: { type: 'string', enum: ['all', 'geo', 'group', 'role', 'individual'] },
                    requires_acknowledgment: { type: 'boolean' },
                    created_at: { type: 'string', format: 'date-time' }
                }
            },

            // Support ticket schemas
            SupportTicket: {
                type: 'object',
                properties: {
                    ticket_id: { type: 'string', format: 'uuid' },
                    requester_member_id: { type: 'integer', format: 'int64' },
                    subject: { type: 'string' },
                    description: { type: 'string' },
                    category: { type: 'string', enum: ['technical', 'account', 'guards', 'groups', 'other'] },
                    priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
                    status: { type: 'string', enum: ['open', 'in_progress', 'waiting', 'resolved', 'closed'] },
                    assigned_to_member_id: { type: 'integer', format: 'int64' },
                    created_at: { type: 'string', format: 'date-time' },
                    updated_at: { type: 'string', format: 'date-time' }
                }
            },

            // Vault schemas
            VaultItem: {
                type: 'object',
                properties: {
                    item_id: { type: 'string', format: 'uuid' },
                    name: { type: 'string' },
                    item_type: { type: 'string', enum: ['credential', 'certificate', 'key', 'document'] },
                    encrypted_data: { type: 'string', description: 'Données chiffrées AES-256-GCM' },
                    access_level: { type: 'string', enum: ['public', 'restricted', 'confidential', 'secret'] },
                    created_by: { type: 'integer', format: 'int64' },
                    last_accessed: { type: 'string', format: 'date-time' }
                }
            },

            // Backup schemas
            BackupJob: {
                type: 'object',
                properties: {
                    job_id: { type: 'string', format: 'uuid' },
                    backup_type: { type: 'string', enum: ['full', 'incremental', 'differential'] },
                    status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'] },
                    size_bytes: { type: 'integer', format: 'int64' },
                    started_at: { type: 'string', format: 'date-time' },
                    completed_at: { type: 'string', format: 'date-time' }
                }
            },

            // Health schemas
            HealthStatus: {
                type: 'object',
                properties: {
                    status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
                    version: { type: 'string' },
                    uptime: { type: 'integer', description: 'Uptime in seconds' },
                    timestamp: { type: 'string', format: 'date-time' },
                    checks: {
                        type: 'object',
                        properties: {
                            database: { type: 'string', enum: ['ok', 'error'] },
                            redis: { type: 'string', enum: ['ok', 'error', 'disabled'] },
                            memory: { type: 'string', enum: ['ok', 'warning', 'critical'] }
                        }
                    }
                }
            },

            // Local server schemas
            LocalServer: {
                type: 'object',
                properties: {
                    server_id: { type: 'string', format: 'uuid' },
                    name: { type: 'string' },
                    geo_id: { type: 'string' },
                    status: { type: 'string', enum: ['active', 'inactive', 'maintenance', 'error'] },
                    version: { type: 'string' },
                    last_heartbeat: { type: 'string', format: 'date-time' },
                    ip_address: { type: 'string', format: 'ipv4' },
                    capabilities: { type: 'array', items: { type: 'string' } }
                }
            },

            // Protocol schemas
            ProtocolStatus: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    status: { type: 'string', enum: ['active', 'inactive', 'triggered'] },
                    last_triggered: { type: 'string', format: 'date-time', nullable: true },
                    triggered_by: { type: 'integer', format: 'int64', nullable: true }
                }
            }
        },
        responses: {
            UnauthorizedError: {
                description: 'Token JWT invalide ou manquant',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/Error' },
                        example: {
                            success: false,
                            error: { code: 'UNAUTHORIZED', message: 'Invalid or missing token' }
                        }
                    }
                }
            },
            ForbiddenError: {
                description: 'Accès interdit - rôle insuffisant',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/Error' },
                        example: {
                            success: false,
                            error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
                        }
                    }
                }
            },
            NotFoundError: {
                description: 'Ressource non trouvée',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/Error' },
                        example: {
                            success: false,
                            error: { code: 'NOT_FOUND', message: 'Resource not found' }
                        }
                    }
                }
            },
            ValidationError: {
                description: 'Erreur de validation',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/Error' },
                        example: {
                            success: false,
                            error: {
                                code: 'VALIDATION_ERROR',
                                message: 'Validation failed',
                                details: ['email is required', 'password must be at least 8 characters']
                            }
                        }
                    }
                }
            },
            RateLimitError: {
                description: 'Trop de requêtes',
                content: {
                    'application/json': {
                        schema: { $ref: '#/components/schemas/Error' },
                        example: {
                            success: false,
                            error: { code: 'RATE_LIMIT', message: 'Too many requests. Please try again later.' }
                        }
                    }
                }
            }
        },
        parameters: {
            PageParam: {
                name: 'page',
                in: 'query',
                description: 'Numéro de page',
                schema: { type: 'integer', default: 1, minimum: 1 }
            },
            LimitParam: {
                name: 'limit',
                in: 'query',
                description: 'Nombre d\'éléments par page',
                schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 }
            },
            SortParam: {
                name: 'sort',
                in: 'query',
                description: 'Champ de tri (préfixe - pour descendant)',
                schema: { type: 'string', example: '-created_at' }
            },
            GeoIdParam: {
                name: 'geo_id',
                in: 'query',
                description: 'Filtre par zone géographique',
                schema: { type: 'string', pattern: '^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$' }
            }
        }
    },
    security: [
        { BearerAuth: [] }
    ]
};

/**
 * Options pour swagger-jsdoc
 */
const options = {
    definition: swaggerDefinition,
    apis: [
        './src/routes/*.js',
        './src/docs/paths/*.yaml',
        './src/docs/paths/*.js'
    ]
};

/**
 * Génère la spec Swagger
 */
const swaggerSpec = swaggerJSDoc(options);

/**
 * Configuration de swagger-ui-express
 */
const swaggerUiOptions = {
    customCss: `
        .swagger-ui .topbar { display: none; }
        .swagger-ui .info { margin: 30px 0; }
        .swagger-ui .info .title { color: #1a237e; }
        .swagger-ui .scheme-container { background: #f5f5f5; padding: 15px; }
    `,
    customSiteTitle: 'SHUGO API Documentation',
    customfavIcon: '/favicon.ico',
    swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
        docExpansion: 'none',
        tagsSorter: 'alpha',
        operationsSorter: 'alpha'
    }
};

module.exports = {
    swaggerSpec,
    swaggerUiOptions,
    swaggerDefinition
};
