// packages/local/src/services/HealthMonitor.js
// Health monitoring service for local server

const os = require('os');
const logger = require('../utils/logger');

class HealthMonitor {
    constructor(config, eventBus) {
        this.config = config;
        this.eventBus = eventBus;
        this.isRunning = false;
        this.metrics = {
            cpu: [],
            memory: [],
            uptime: 0,
            errors: 0,
            warnings: 0
        };
        this.thresholds = {
            cpu: 80,          // CPU usage %
            memory: 85,       // Memory usage %
            diskSpace: 90,    // Disk usage %
            errorRate: 10     // Errors per minute
        };
        this.checkInterval = null;
    }
    
    /**
     * Start health monitoring
     */
    async start() {
        if (this.isRunning) return;
        
        logger.info('Starting HealthMonitor...');
        this.isRunning = true;
        
        // Initial check
        await this.performHealthCheck();
        
        // Setup periodic checks
        this.checkInterval = setInterval(() => {
            this.performHealthCheck().catch(err => {
                logger.error('Health check failed:', err);
            });
        }, 60000); // Every minute
        
        // Subscribe to events
        this.subscribeToEvents();
        
        logger.info('HealthMonitor started');
    }
    
    /**
     * Stop health monitoring
     */
    async stop() {
        if (!this.isRunning) return;
        
        logger.info('Stopping HealthMonitor...');
        this.isRunning = false;
        
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        
        logger.info('HealthMonitor stopped');
    }
    
    /**
     * Perform health check
     */
    async performHealthCheck() {
        const check = {
            timestamp: new Date(),
            cpu: this.getCPUUsage(),
            memory: this.getMemoryUsage(),
            disk: await this.getDiskUsage(),
            uptime: process.uptime(),
            errors: this.metrics.errors,
            warnings: this.metrics.warnings
        };
        
        // Store metrics
        this.updateMetrics(check);
        
        // Check thresholds
        await this.checkThresholds(check);
        
        // Emit health status
        this.eventBus.emit('health.check', check);
        
        return check;
    }
    
    /**
     * Get CPU usage
     */
    getCPUUsage() {
        const cpus = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;
        
        cpus.forEach(cpu => {
            for (const type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        });
        
        const idle = totalIdle / cpus.length;
        const total = totalTick / cpus.length;
        const usage = 100 - ~~(100 * idle / total);
        
        return {
            usage,
            cores: cpus.length,
            loadAverage: os.loadavg()
        };
    }
    
    /**
     * Get memory usage
     */
    getMemoryUsage() {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const usage = (usedMem / totalMem) * 100;
        
        return {
            usage: Math.round(usage),
            total: totalMem,
            free: freeMem,
            used: usedMem,
            process: process.memoryUsage()
        };
    }
    
    /**
     * Get disk usage
     */
    async getDiskUsage() {
        // This would require a package like 'diskusage'
        // For now, return mock data
        return {
            usage: 45,
            total: 32 * 1024 * 1024 * 1024, // 32GB
            free: 18 * 1024 * 1024 * 1024   // 18GB
        };
    }
    
    /**
     * Update metrics history
     */
    updateMetrics(check) {
        // Keep last 60 measurements (1 hour)
        this.metrics.cpu.push(check.cpu.usage);
        if (this.metrics.cpu.length > 60) {
            this.metrics.cpu.shift();
        }
        
        this.metrics.memory.push(check.memory.usage);
        if (this.metrics.memory.length > 60) {
            this.metrics.memory.shift();
        }
        
        this.metrics.uptime = check.uptime;
    }
    
    /**
     * Check thresholds and alert if needed
     */
    async checkThresholds(check) {
        const alerts = [];
        
        // CPU threshold
        if (check.cpu.usage > this.thresholds.cpu) {
            alerts.push({
                type: 'cpu',
                level: 'warning',
                message: `High CPU usage: ${check.cpu.usage}%`,
                value: check.cpu.usage,
                threshold: this.thresholds.cpu
            });
        }
        
        // Memory threshold
        if (check.memory.usage > this.thresholds.memory) {
            alerts.push({
                type: 'memory',
                level: check.memory.usage > 95 ? 'critical' : 'warning',
                message: `High memory usage: ${check.memory.usage}%`,
                value: check.memory.usage,
                threshold: this.thresholds.memory
            });
        }
        
        // Disk threshold
        if (check.disk.usage > this.thresholds.diskSpace) {
            alerts.push({
                type: 'disk',
                level: 'warning',
                message: `Low disk space: ${check.disk.usage}% used`,
                value: check.disk.usage,
                threshold: this.thresholds.diskSpace
            });
        }
        
        // Send alerts
        for (const alert of alerts) {
            logger.warn('Health alert:', alert);
            this.eventBus.emit('health.alert', alert);
        }
        
        return alerts;
    }
    
    /**
     * Subscribe to system events
     */
    subscribeToEvents() {
        // Track errors
        this.eventBus.on('error', () => {
            this.metrics.errors++;
        });
        
        // Track warnings
        this.eventBus.on('warning', () => {
            this.metrics.warnings++;
        });
        
        // Reset error count every hour
        setInterval(() => {
            this.metrics.errors = 0;
            this.metrics.warnings = 0;
        }, 3600000);
    }
    
    /**
     * Get current health status
     */
    async getStatus() {
        const check = await this.performHealthCheck();
        const avgCPU = this.metrics.cpu.reduce((a, b) => a + b, 0) / this.metrics.cpu.length || 0;
        const avgMemory = this.metrics.memory.reduce((a, b) => a + b, 0) / this.metrics.memory.length || 0;
        
        return {
            current: check,
            averages: {
                cpu: Math.round(avgCPU),
                memory: Math.round(avgMemory)
            },
            uptime: this.metrics.uptime,
            errors: this.metrics.errors,
            warnings: this.metrics.warnings,
            isHealthy: check.cpu.usage < this.thresholds.cpu && 
                      check.memory.usage < this.thresholds.memory
        };
    }
    
    /**
     * Set threshold values
     */
    setThresholds(thresholds) {
        this.thresholds = { ...this.thresholds, ...thresholds };
        logger.info('Health thresholds updated:', this.thresholds);
    }
}

module.exports = HealthMonitor;
