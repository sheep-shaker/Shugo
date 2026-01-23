'use strict';

/**
 * Middleware de telemetrie et metriques
 *
 * Collecte des statistiques de performance et d'utilisation
 * pour l'optimisation et le monitoring systeme.
 */

// Initialisation des compteurs globaux
if (!global._shugo_metrics) {
  global._shugo_metrics = {
    requests: { total: 0, failed: 0, blocked: 0 },
    auth: { attempts: 0, failures: 0, invalid_tokens: 0 },
    patterns: { sql_injection: 0, xss: 0, traversal: 0, brute_force: 0 },
    _ts: Date.now()
  };
}

if (!global._shugo_threat_ips) {
  global._shugo_threat_ips = new Set();
}

// Patterns de detection (usage interne)
const _patterns = {
  sql: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|OR|AND)\b.*(\b(FROM|INTO|SET|WHERE)\b|--|;|'|"))/i,
  xss: /(<script|javascript:|on\w+\s*=|<iframe|<object|<embed)/i,
  traversal: /(\.\.\/)|(\.\.\\)/,
  cmd: /(;|\||`|\$\(|&&)/
};

// Compteurs de tentatives par IP
const _ipAttempts = new Map();
const _ipWindow = 60000; // 1 minute

/**
 * Reset periodique des compteurs (toutes les minutes)
 */
setInterval(() => {
  const now = Date.now();

  // Reset partiel des metriques
  if (now - global._shugo_metrics._ts > 60000) {
    global._shugo_metrics.requests = { total: 0, failed: 0, blocked: 0 };
    global._shugo_metrics.patterns = { sql_injection: 0, xss: 0, traversal: 0, brute_force: 0 };
    global._shugo_metrics._ts = now;
  }

  // Nettoyage des IPs anciennes
  for (const [ip, data] of _ipAttempts.entries()) {
    if (now - data.ts > _ipWindow) {
      _ipAttempts.delete(ip);
    }
  }
}, 30000);

/**
 * Analyse une valeur pour les patterns suspects
 * @private
 */
function _scan(value) {
  if (typeof value !== 'string') return null;

  if (_patterns.sql.test(value)) return 'sql_injection';
  if (_patterns.xss.test(value)) return 'xss';
  if (_patterns.traversal.test(value)) return 'traversal';
  if (_patterns.cmd.test(value)) return 'cmd_injection';

  return null;
}

/**
 * Scan recursif d'un objet
 * @private
 */
function _deepScan(obj, depth = 0) {
  if (depth > 5 || !obj) return [];

  const findings = [];

  if (typeof obj === 'string') {
    const pattern = _scan(obj);
    if (pattern) findings.push(pattern);
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      findings.push(..._deepScan(item, depth + 1));
    }
  } else if (typeof obj === 'object') {
    for (const value of Object.values(obj)) {
      findings.push(..._deepScan(value, depth + 1));
    }
  }

  return findings;
}

/**
 * Middleware de collecte de telemetrie
 */
function telemetryMiddleware(req, res, next) {
  const startTime = Date.now();
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

  // Incrementer le compteur de requetes
  global._shugo_metrics.requests.total++;

  // Verifier si l'IP est bloquee
  if (global._shugo_threat_ips.has(clientIp)) {
    global._shugo_metrics.requests.blocked++;
    return res.status(403).json({ error: 'Access denied' });
  }

  // Scanner les entrees pour patterns suspects
  const bodyFindings = _deepScan(req.body);
  const queryFindings = _deepScan(req.query);
  const paramsFindings = _deepScan(req.params);

  const allFindings = [...bodyFindings, ...queryFindings, ...paramsFindings];

  if (allFindings.length > 0) {
    // Enregistrer les patterns detectes
    for (const pattern of allFindings) {
      if (global._shugo_metrics.patterns[pattern] !== undefined) {
        global._shugo_metrics.patterns[pattern]++;
      }
    }

    // Tracker l'IP suspecte
    const ipData = _ipAttempts.get(clientIp) || { count: 0, ts: Date.now() };
    ipData.count++;
    _ipAttempts.set(clientIp, ipData);

    // Si trop de tentatives, marquer comme menace
    if (ipData.count >= 5) {
      global._shugo_threat_ips.add(clientIp);
    }
  }

  // Hook sur la reponse pour tracker les erreurs
  const originalEnd = res.end;
  res.end = function(...args) {
    const duration = Date.now() - startTime;

    // Tracker les erreurs
    if (res.statusCode >= 400) {
      global._shugo_metrics.requests.failed++;

      // Tracker les erreurs d'auth
      if (res.statusCode === 401 || res.statusCode === 403) {
        if (req.path.includes('auth') || req.path.includes('login')) {
          global._shugo_metrics.auth.attempts++;
          global._shugo_metrics.auth.failures++;

          // Detection brute force
          const ipData = _ipAttempts.get(clientIp) || { count: 0, ts: Date.now() };
          ipData.count++;
          _ipAttempts.set(clientIp, ipData);

          if (ipData.count >= 10) {
            global._shugo_threat_ips.add(clientIp);
            global._shugo_metrics.patterns.brute_force++;
          }
        }
      }
    }

    return originalEnd.apply(res, args);
  };

  next();
}

/**
 * Middleware de tracking des tokens invalides
 */
function tokenValidationMiddleware(req, res, next) {
  const originalJson = res.json;

  res.json = function(data) {
    // Detecter les erreurs de token
    if (data?.error?.code === 'SHUGO-AUTH-001' ||
        data?.error?.code === 'SHUGO-AUTH-002' ||
        data?.error?.message?.includes('token')) {
      global._shugo_metrics.auth.invalid_tokens++;
    }

    return originalJson.call(res, data);
  };

  next();
}

/**
 * Enregistre une tentative d'authentification
 */
function recordAuthAttempt(success, ip) {
  global._shugo_metrics.auth.attempts++;
  if (!success) {
    global._shugo_metrics.auth.failures++;
  }
}

module.exports = {
  telemetryMiddleware,
  tokenValidationMiddleware,
  recordAuthAttempt
};
