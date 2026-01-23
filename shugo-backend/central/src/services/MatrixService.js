// services/MatrixService.js
// Service MatrixService

class MatrixService {
  constructor() {
    console.log('MatrixService initialized');
  }

  // Méthodes principales du service
  async init() {
    return { initialized: true };
  }
}

module.exports = new MatrixService();
