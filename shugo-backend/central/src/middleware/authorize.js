// middleware/authorize.js
// Middleware d'autorisation par rôle

function authorize(roles = []) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'SHUGO-AUTHZ-001',
          message: 'Authentication requise'
        }
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'SHUGO-AUTHZ-002',
          message: 'Rôle insuffisant',
          required: allowedRoles,
          current: req.user.role
        }
      });
    }

    next();
  };
}

module.exports = { authorize };
