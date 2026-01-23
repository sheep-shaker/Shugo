// middleware/authenticate.js
// Middleware d'authentification JWT

const jwt = require('jsonwebtoken');
const { User, Session } = require('../models');
const config = require('../config');

async function authenticate(req, res, next) {
  try {
    // Extraire le token
    const token = extractToken(req);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'SHUGO-AUTH-001',
          message: 'Token d\'authentification requis'
        }
      });
    }

    // Vérifier le token
    const decoded = jwt.verify(token, config.jwt.secret);
    
    // Vérifier la session
    const session = await Session.findOne({
      where: {
        member_id: decoded.member_id,
        jwt_token: token,
        is_active: true
      }
    });

    if (!session) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'SHUGO-AUTH-002',
          message: 'Session invalide ou expirée'
        }
      });
    }

    // Mettre à jour l'activité
    await session.update({ last_activity: new Date() });

    // Ajouter l'utilisateur à la requête
    req.user = decoded;
    req.sessionId = session.session_id;
    
    next();

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'SHUGO-AUTH-003',
          message: 'Token expiré'
        }
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'SHUGO-AUTH-004',
          message: 'Token invalide'
        }
      });
    }

    console.error('Authentication error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SHUGO-AUTH-500',
        message: 'Erreur d\'authentification'
      }
    });
  }
}

function extractToken(req) {
  // Header Authorization
  if (req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      return parts[1];
    }
  }
  
  // Cookie
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }
  
  // Query param (non recommandé)
  if (req.query && req.query.token) {
    return req.query.token;
  }
  
  return null;
}

module.exports = { authenticate };
