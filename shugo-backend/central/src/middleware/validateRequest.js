// middleware/validateRequest.js
// Middleware de validation des requêtes avec Joi

function validateRequest(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(
      {
        body: req.body,
        query: req.query,
        params: req.params
      },
      {
        abortEarly: false,
        stripUnknown: true
      }
    );

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        success: false,
        error: {
          code: 'SHUGO-VALIDATE-001',
          message: 'Validation échouée',
          details: errors
        }
      });
    }

    // Remplacer avec les valeurs validées
    req.body = value.body || req.body;
    req.query = value.query || req.query;
    req.params = value.params || req.params;
    
    next();
  };
}

module.exports = { validateRequest };
