// routes/index.js
// Fichier principal d'export de toutes les routes SHUGO v7
// Ce fichier centralise l'import et l'export de toutes les routes API

// Routes principales
const scenarios = require('./scenarios');
const waitingList = require('./waitingList');
const missions = require('./missions');
const messages = require('./messages');
const support = require('./support');
const vault = require('./vault');
const backup = require('./backup');
const maintenance = require('./maintenance');
const localServers = require('./localServers');
const plugins = require('./plugins');
const emergencyCodes = require('./emergencyCodes');
const admin = require('./admin');
const sync = require('./sync');
const locations = require('./locations');
const groups = require('./groups');

// Routeur des protocoles (contient tous les sous-protocoles)
const protocols = require('./protocols');

// Export groupé pour faciliter l'intégration dans app.js
module.exports = {
  // Routes API principales
  scenarios,
  waitingList,
  missions,
  messages,
  support,
  vault,
  backup,
  maintenance,
  localServers,
  plugins,
  emergencyCodes,
  admin,
  sync,
  locations,
  groups,

  // Protocoles système
  protocols,
  
  // Fonction utilitaire pour monter toutes les routes
  mountRoutes: (app) => {
    // Routes API v1
    app.use('/api/v1/scenarios', scenarios);
    app.use('/api/v1/waiting-list', waitingList);
    app.use('/api/v1/missions', missions);
    app.use('/api/v1/messages', messages);
    app.use('/api/v1/support', support);
    app.use('/api/v1/vault', vault);
    app.use('/api/v1/backup', backup);
    app.use('/api/v1/maintenance', maintenance);
    app.use('/api/v1/local-servers', localServers);
    app.use('/api/v1/plugins', plugins);
    app.use('/api/v1/emergency', emergencyCodes);
    app.use('/api/v1/admin', admin);
    app.use('/api/sync', sync);
    app.use('/api/v1/locations', locations);
    app.use('/api/v1/groups', groups);

    // Protocoles système
    app.use('/api/v1/protocols', protocols);

    console.log('[Routes] Toutes les routes SHUGO v7 montées avec succès');
  },
  
  // Liste des endpoints pour documentation
  getEndpointsList: () => {
    return {
      scenarios: [
        'GET    /api/v1/scenarios',
        'GET    /api/v1/scenarios/:id',
        'POST   /api/v1/scenarios',
        'PATCH  /api/v1/scenarios/:id',
        'DELETE /api/v1/scenarios/:id',
        'POST   /api/v1/scenarios/:id/apply',
        'POST   /api/v1/scenarios/:id/clone',
        'GET    /api/v1/scenarios/:id/preview',
        'GET    /api/v1/scenarios/templates',
        'POST   /api/v1/scenarios/:id/validate'
      ],
      waitingList: [
        'GET    /api/v1/waiting-list',
        'GET    /api/v1/waiting-list/my-positions',
        'GET    /api/v1/waiting-list/guards/:guard_id',
        'POST   /api/v1/waiting-list',
        'PATCH  /api/v1/waiting-list/:id',
        'DELETE /api/v1/waiting-list/:id',
        'POST   /api/v1/waiting-list/activate',
        'GET    /api/v1/waiting-list/pending-activations',
        'POST   /api/v1/waiting-list/:id/activate-now',
        'GET    /api/v1/waiting-list/statistics',
        'POST   /api/v1/waiting-list/process-j3'
      ],
      missions: [
        'GET    /api/v1/missions',
        'GET    /api/v1/missions/my-missions',
        'GET    /api/v1/missions/:id',
        'POST   /api/v1/missions',
        'PATCH  /api/v1/missions/:id',
        'POST   /api/v1/missions/:id/revoke',
        'POST   /api/v1/missions/:id/validate',
        'POST   /api/v1/missions/:id/renew',
        'GET    /api/v1/missions/pending-validation',
        'GET    /api/v1/missions/expiring',
        'GET    /api/v1/missions/audit-log',
        'POST   /api/v1/missions/check-privileges'
      ],
      messages: [
        'GET    /api/v1/messages',
        'GET    /api/v1/messages/unread-count',
        'GET    /api/v1/messages/:id',
        'POST   /api/v1/messages',
        'PATCH  /api/v1/messages/:id',
        'DELETE /api/v1/messages/:id',
        'POST   /api/v1/messages/mark-read',
        'POST   /api/v1/messages/:id/acknowledge',
        'POST   /api/v1/messages/:id/reply',
        'GET    /api/v1/messages/:id/thread',
        'GET    /api/v1/messages/:id/read-status',
        'POST   /api/v1/messages/broadcast',
        'GET    /api/v1/messages/templates'
      ],
      support: [
        'GET    /api/v1/support/tickets',
        'GET    /api/v1/support/tickets/:id',
        'POST   /api/v1/support/tickets',
        'PATCH  /api/v1/support/tickets/:id',
        'POST   /api/v1/support/tickets/:id/responses',
        'POST   /api/v1/support/tickets/:id/assign',
        'POST   /api/v1/support/tickets/:id/escalate',
        'POST   /api/v1/support/tickets/:id/close',
        'POST   /api/v1/support/tickets/:id/reopen',
        'POST   /api/v1/support/tickets/:id/rate',
        'GET    /api/v1/support/categories',
        'GET    /api/v1/support/statistics',
        'GET    /api/v1/support/kb/search',
        'GET    /api/v1/support/kb/articles/:id'
      ],
      vault: [
        'GET    /api/v1/vault/status',
        'GET    /api/v1/vault/secrets',
        'GET    /api/v1/vault/secrets/:id',
        'POST   /api/v1/vault/secrets',
        'PATCH  /api/v1/vault/secrets/:id',
        'DELETE /api/v1/vault/secrets/:id',
        'POST   /api/v1/vault/rotate-keys',
        'GET    /api/v1/vault/rotation-status',
        'POST   /api/v1/vault/verify-integrity',
        'GET    /api/v1/vault/audit-log',
        'POST   /api/v1/vault/backup',
        'POST   /api/v1/vault/restore'
      ],
      backup: [
        'GET    /api/v1/backup/jobs',
        'GET    /api/v1/backup/jobs/:id',
        'POST   /api/v1/backup/create',
        'POST   /api/v1/backup/schedule',
        'POST   /api/v1/backup/restore',
        'DELETE /api/v1/backup/jobs/:id',
        'POST   /api/v1/backup/verify/:id',
        'GET    /api/v1/backup/storage',
        'POST   /api/v1/backup/cleanup',
        'GET    /api/v1/backup/restore-points',
        'GET    /api/v1/backup/schedules',
        'PATCH  /api/v1/backup/schedules/:id',
        'DELETE /api/v1/backup/schedules/:id'
      ],
      maintenance: [
        'GET    /api/v1/maintenance/runs',
        'GET    /api/v1/maintenance/runs/:id',
        'GET    /api/v1/maintenance/status',
        'POST   /api/v1/maintenance/schedule',
        'PATCH  /api/v1/maintenance/:id',
        'DELETE /api/v1/maintenance/:id',
        'POST   /api/v1/maintenance/run-now',
        'POST   /api/v1/maintenance/nightly',
        'GET    /api/v1/maintenance/operations',
        'GET    /api/v1/maintenance/health',
        'GET    /api/v1/maintenance/metrics',
        'POST   /api/v1/maintenance/optimize',
        'GET    /api/v1/maintenance/schedule',
        'POST   /api/v1/maintenance/test'
      ],
      localServers: [
        'GET    /api/v1/local-servers',
        'GET    /api/v1/local-servers/:id',
        'POST   /api/v1/local-servers/register',
        'PATCH  /api/v1/local-servers/:id',
        'DELETE /api/v1/local-servers/:id',
        'POST   /api/v1/local-servers/heartbeat',
        'POST   /api/v1/local-servers/:id/sync',
        'GET    /api/v1/local-servers/:id/status',
        'POST   /api/v1/local-servers/:id/command',
        'GET    /api/v1/local-servers/:id/logs',
        'GET    /api/v1/local-servers/:id/metrics',
        'POST   /api/v1/local-servers/:id/restart',
        'GET    /api/v1/local-servers/health-summary'
      ],
      plugins: [
        'GET    /api/v1/plugins',
        'GET    /api/v1/plugins/:id',
        'POST   /api/v1/plugins/install',
        'POST   /api/v1/plugins/upload',
        'PATCH  /api/v1/plugins/:id/configure',
        'POST   /api/v1/plugins/:id/enable',
        'POST   /api/v1/plugins/:id/disable',
        'POST   /api/v1/plugins/:id/update',
        'DELETE /api/v1/plugins/:id',
        'GET    /api/v1/plugins/:id/logs',
        'GET    /api/v1/plugins/:id/metrics',
        'POST   /api/v1/plugins/:id/execute',
        'GET    /api/v1/plugins/marketplace',
        'POST   /api/v1/plugins/check-updates'
      ],
      emergency: [
        'GET    /api/v1/emergency/tables',
        'GET    /api/v1/emergency/my-table',
        'POST   /api/v1/emergency/generate',
        'POST   /api/v1/emergency/validate',
        'POST   /api/v1/emergency/tables/:id/revoke',
        'GET    /api/v1/emergency/tables/:id/usage',
        'POST   /api/v1/emergency/request-new',
        'POST   /api/v1/emergency/unlock-account',
        'GET    /api/v1/emergency/statistics',
        'POST   /api/v1/emergency/test-delivery'
      ],
      admin: [
        'GET    /api/v1/admin/dashboard',
        'GET    /api/v1/admin/statistics',
        'POST   /api/v1/admin/export',
        'POST   /api/v1/admin/reports/generate',
        'GET    /api/v1/admin/reports',
        'GET    /api/v1/admin/reports/:id',
        'GET    /api/v1/admin/audit-logs',
        'GET    /api/v1/admin/system-config',
        'PATCH  /api/v1/admin/system-config',
        'GET    /api/v1/admin/users/activity',
        'GET    /api/v1/admin/errors',
        'POST   /api/v1/admin/broadcast',
        'POST   /api/v1/admin/impersonate',
        'GET    /api/v1/admin/compliance'
      ],
      locations: [
        'GET    /api/v1/locations',
        'GET    /api/v1/locations/parents',
        'GET    /api/v1/locations/:geoId',
        'GET    /api/v1/locations/:geoId/children',
        'GET    /api/v1/locations/:geoId/stats',
        'POST   /api/v1/locations',
        'PUT    /api/v1/locations/:geoId',
        'DELETE /api/v1/locations/:geoId',
        'PATCH  /api/v1/locations/:geoId/toggle'
      ],
      groups: [
        'GET    /api/v1/groups',
        'GET    /api/v1/groups/my-groups',
        'GET    /api/v1/groups/:id',
        'GET    /api/v1/groups/:id/members',
        'GET    /api/v1/groups/:id/children',
        'GET    /api/v1/groups/:id/stats',
        'POST   /api/v1/groups',
        'PUT    /api/v1/groups/:id',
        'DELETE /api/v1/groups/:id',
        'POST   /api/v1/groups/:id/add-member',
        'POST   /api/v1/groups/:id/remove-member',
        'POST   /api/v1/groups/:id/leave',
        'POST   /api/v1/groups/:id/transfer-leadership',
        'PATCH  /api/v1/groups/:id/toggle'
      ],
      protocols: {
        main: [
          'GET    /api/v1/protocols',
          'GET    /api/v1/protocols/status',
          'POST   /api/v1/protocols/emergency-stop'
        ],
        guiltySpark: [
          'POST   /api/v1/protocols/guilty-spark/initialize',
          'POST   /api/v1/protocols/guilty-spark/configure',
          'POST   /api/v1/protocols/guilty-spark/deploy',
          'GET    /api/v1/protocols/guilty-spark/servers',
          'GET    /api/v1/protocols/guilty-spark/servers/:id',
          'POST   /api/v1/protocols/guilty-spark/servers/:id/health-check',
          'POST   /api/v1/protocols/guilty-spark/servers/:id/sync',
          'POST   /api/v1/protocols/guilty-spark/servers/:id/maintenance',
          'POST   /api/v1/protocols/guilty-spark/servers/:id/decommission',
          'GET    /api/v1/protocols/guilty-spark/deployment-status/:id',
          'POST   /api/v1/protocols/guilty-spark/rollback'
        ],
        cendreBlanche: [
          'POST   /api/v1/protocols/cendre-blanche/initiate',
          'POST   /api/v1/protocols/cendre-blanche/confirm',
          'POST   /api/v1/protocols/cendre-blanche/execute/:id',
          'GET    /api/v1/protocols/cendre-blanche/status/:id'
        ],
        papierFroisse: [
          'POST   /api/v1/protocols/papier-froisse/search',
          'POST   /api/v1/protocols/papier-froisse/restore',
          'GET    /api/v1/protocols/papier-froisse/archive'
        ],
        porteDeGrange: [
          'POST   /api/v1/protocols/porte-de-grange/isolate',
          'GET    /api/v1/protocols/porte-de-grange/status',
          'POST   /api/v1/protocols/porte-de-grange/restore/:id'
        ],
        upsideMode: [
          'POST   /api/v1/protocols/upside-mode/enable',
          'POST   /api/v1/protocols/upside-mode/disable/:id',
          'POST   /api/v1/protocols/upside-mode/sync/:id',
          'GET    /api/v1/protocols/upside-mode/environments'
        ],
        cleTotem: [
          'POST   /api/v1/protocols/cle-totem/register',
          'POST   /api/v1/protocols/cle-totem/authenticate',
          'POST   /api/v1/protocols/cle-totem/revoke/:id',
          'GET    /api/v1/protocols/cle-totem/my-totems',
          'POST   /api/v1/protocols/cle-totem/challenge'
        ]
      }
    };
  }
};
