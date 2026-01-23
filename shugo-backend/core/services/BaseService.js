// packages/core/services/BaseService.js
// Base service class with common functionality

const logger = require('../utils/logger');

class BaseService {
    constructor(name, config = {}) {
        this.name = name;
        this.config = config;
        this.isRunning = false;
        this.startTime = null;
    }
    
    /**
     * Start the service
     */
    async start() {
        if (this.isRunning) {
            logger.warn(`Service ${this.name} is already running`);
            return;
        }
        
        logger.info(`Starting service: ${this.name}`);
        this.startTime = new Date();
        this.isRunning = true;
        
        // Call child implementation
        if (this.onStart) {
            await this.onStart();
        }
        
        logger.info(`Service ${this.name} started successfully`);
    }
    
    /**
     * Stop the service
     */
    async stop() {
        if (!this.isRunning) {
            logger.warn(`Service ${this.name} is not running`);
            return;
        }
        
        logger.info(`Stopping service: ${this.name}`);
        
        // Call child implementation
        if (this.onStop) {
            await this.onStop();
        }
        
        this.isRunning = false;
        logger.info(`Service ${this.name} stopped`);
    }
    
    /**
     * Get service status
     */
    getStatus() {
        return {
            name: this.name,
            isRunning: this.isRunning,
            startTime: this.startTime,
            uptime: this.isRunning ? Date.now() - this.startTime : 0
        };
    }
    
    /**
     * Health check
     */
    async healthCheck() {
        if (!this.isRunning) {
            return {
                healthy: false,
                reason: 'Service not running'
            };
        }
        
        // Call child implementation if exists
        if (this.onHealthCheck) {
            return await this.onHealthCheck();
        }
        
        return {
            healthy: true
        };
    }
}

module.exports = BaseService;
