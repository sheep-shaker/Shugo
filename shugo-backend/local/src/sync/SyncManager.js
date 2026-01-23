// packages/local/src/sync/SyncManager.js
// Gestionnaire de synchronisation bidirectionnelle avec le serveur central

const axios = require('axios');
const PQueue = require('p-queue').default;
const crypto = require('crypto');
const logger = require('../utils/logger');

class SyncManager {
    constructor(config, eventBus) {
        this.config = config;
        this.eventBus = eventBus;
        this.isOnline = false;
        this.isSyncing = false;
        this.lastSyncTime = null;
        this.syncQueue = new PQueue({ 
            concurrency: config.queueConcurrency || 2,
            autoStart: false
        });
        
        // Sync statistics
        this.stats = {
            successful: 0,
            failed: 0,
            pending: 0,
            lastError: null
        };
        
        // Central API client
        this.api = axios.create({
            baseURL: config.centralUrl,
            timeout: config.timeout || 10000,
            headers: {
                'X-Server-ID': config.serverId,
                'X-Geo-ID': config.geoId
            }
        });
        
        // Setup interceptors
        this.setupInterceptors();
    }
    
    /**
     * Initialize sync manager
     */
    async initialize() {
        logger.info('Initializing SyncManager...');
        
        // Load sync queue from persistent storage
        await this.loadQueue();
        
        // Check connectivity
        await this.checkConnectivity();
        
        // Start heartbeat
        this.startHeartbeat();
        
        // Start auto-sync if enabled
        if (this.config.mode === 'auto') {
            this.startAutoSync();
        }
        
        // Subscribe to events
        this.subscribeToEvents();
        
        logger.info('SyncManager initialized', {
            mode: this.config.mode,
            isOnline: this.isOnline,
            queueSize: this.syncQueue.size
        });
    }
    
    /**
     * Setup axios interceptors for auth and retry
     */
    setupInterceptors() {
        // Request interceptor - Add authentication
        this.api.interceptors.request.use(
            (config) => {
                // Add timestamp
                config.headers['X-Timestamp'] = new Date().toISOString();
                
                // Add HMAC signature
                const signature = this.generateSignature(config);
                config.headers['X-Signature'] = signature;
                
                return config;
            },
            (error) => Promise.reject(error)
        );
        
        // Response interceptor - Handle errors and retry
        this.api.interceptors.response.use(
            (response) => response,
            async (error) => {
                const originalRequest = error.config;
                
                // Retry logic
                if (!originalRequest._retry && error.response?.status >= 500) {
                    originalRequest._retry = true;
                    originalRequest._retryCount = (originalRequest._retryCount || 0) + 1;
                    
                    if (originalRequest._retryCount <= this.config.retryAttempts) {
                        await this.delay(this.config.retryDelay * originalRequest._retryCount);
                        return this.api(originalRequest);
                    }
                }
                
                // Mark as offline if connection failed
                if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                    this.setOffline();
                }
                
                return Promise.reject(error);
            }
        );
    }
    
    /**
     * Generate HMAC signature for request
     */
    generateSignature(config) {
        const data = JSON.stringify({
            method: config.method,
            url: config.url,
            timestamp: config.headers['X-Timestamp'],
            body: config.data
        });
        
        return crypto
            .createHmac('sha256', this.config.sharedSecret)
            .update(data)
            .digest('hex');
    }
    
    /**
     * Check connectivity with central server
     */
    async checkConnectivity() {
        try {
            const response = await this.api.get('/health');
            if (response.status === 200) {
                this.setOnline();
                return true;
            }
        } catch (error) {
            logger.warn('Cannot connect to central server:', error.message);
            this.setOffline();
            return false;
        }
    }
    
    /**
     * Set online status
     */
    setOnline() {
        if (!this.isOnline) {
            this.isOnline = true;
            logger.info('✅ Connected to central server');
            this.eventBus.emit('sync.online');
            
            // Start queue processing
            if (this.syncQueue.size > 0) {
                this.syncQueue.start();
            }
        }
    }
    
    /**
     * Set offline status
     */
    setOffline() {
        if (this.isOnline) {
            this.isOnline = false;
            logger.warn('❌ Disconnected from central server');
            this.eventBus.emit('sync.offline');
            
            // Pause queue processing
            this.syncQueue.pause();
        }
    }
    
    /**
     * Start heartbeat with central
     */
    startHeartbeat() {
        setInterval(async () => {
            if (this.isOnline) {
                try {
                    const metrics = await this.collectMetrics();
                    await this.api.post('/heartbeat', {
                        serverId: this.config.serverId,
                        geoId: this.config.geoId,
                        timestamp: new Date(),
                        metrics,
                        queueSize: this.syncQueue.size
                    });
                } catch (error) {
                    logger.error('Heartbeat failed:', error.message);
                    await this.checkConnectivity();
                }
            } else {
                // Try to reconnect
                await this.checkConnectivity();
            }
        }, this.config.heartbeatInterval);
    }
    
    /**
     * Start automatic synchronization
     */
    startAutoSync() {
        setInterval(async () => {
            if (this.isOnline && !this.isSyncing) {
                await this.performSync();
            }
        }, this.config.interval);
    }
    
    /**
     * Perform full synchronization
     */
    async performSync() {
        if (this.isSyncing) {
            logger.warn('Sync already in progress');
            return;
        }
        
        this.isSyncing = true;
        logger.info('🔄 Starting synchronization...');
        this.eventBus.emit('sync.started');
        
        try {
            // Pull changes from central
            await this.pullChanges();
            
            // Push local changes
            await this.pushChanges();
            
            // Process sync queue
            await this.processQueue();
            
            // Update last sync time
            this.lastSyncTime = new Date();
            this.stats.successful++;
            
            logger.info('✅ Synchronization completed', {
                duration: Date.now() - this.lastSyncTime,
                pushed: this.stats.pushed,
                pulled: this.stats.pulled
            });
            
            this.eventBus.emit('sync.completed', {
                duration: Date.now() - this.lastSyncTime,
                stats: this.stats
            });
            
        } catch (error) {
            this.stats.failed++;
            this.stats.lastError = error.message;
            
            logger.error('❌ Synchronization failed:', error);
            this.eventBus.emit('sync.failed', { error });
            
        } finally {
            this.isSyncing = false;
        }
    }
    
    /**
     * Pull changes from central
     */
    async pullChanges() {
        const lastSync = this.lastSyncTime || new Date(0);
        
        try {
            // Get changes since last sync
            const response = await this.api.get('/sync/changes', {
                params: {
                    since: lastSync.toISOString(),
                    geoId: this.config.geoId
                }
            });
            
            const changes = response.data;
            
            // Apply changes by priority
            const priorities = Object.entries(this.config.priorities)
                .sort(([,a], [,b]) => a - b);
            
            for (const [entity] of priorities) {
                if (changes[entity] && changes[entity].length > 0) {
                    await this.applyChanges(entity, changes[entity]);
                }
            }
            
            return changes;
            
        } catch (error) {
            throw new Error(`Pull failed: ${error.message}`);
        }
    }
    
    /**
     * Push local changes to central
     */
    async pushChanges() {
        const { LocalChange } = require('../models');
        
        try {
            // Get unpushed changes
            const changes = await LocalChange.findAll({
                where: {
                    pushed: false,
                    created_at: {
                        [Op.lte]: new Date() // Don't push changes made during sync
                    }
                },
                order: [['created_at', 'ASC']],
                limit: this.config.batchSize
            });
            
            if (changes.length === 0) return;
            
            // Group changes by entity
            const grouped = this.groupChangesByEntity(changes);
            
            // Push each group
            for (const [entity, entityChanges] of Object.entries(grouped)) {
                const response = await this.api.post('/sync/push', {
                    entity,
                    changes: entityChanges,
                    geoId: this.config.geoId
                });
                
                // Mark as pushed
                const ids = entityChanges.map(c => c.id);
                await LocalChange.update(
                    { pushed: true, pushed_at: new Date() },
                    { where: { id: ids } }
                );
            }
            
            return changes.length;
            
        } catch (error) {
            throw new Error(`Push failed: ${error.message}`);
        }
    }
    
    /**
     * Apply changes from central
     */
    async applyChanges(entity, changes) {
        const Model = this.getModel(entity);
        if (!Model) {
            logger.warn(`Unknown entity: ${entity}`);
            return;
        }
        
        for (const change of changes) {
            try {
                switch (change.operation) {
                    case 'create':
                    case 'update':
                        await Model.upsert(change.data);
                        break;
                        
                    case 'delete':
                        await Model.destroy({
                            where: { id: change.data.id }
                        });
                        break;
                        
                    default:
                        logger.warn(`Unknown operation: ${change.operation}`);
                }
            } catch (error) {
                logger.error(`Failed to apply change:`, { entity, change, error });
                // Continue with other changes
            }
        }
    }
    
    /**
     * Add item to sync queue
     */
    async addToQueue(operation, entity, data) {
        const item = {
            id: crypto.randomBytes(16).toString('hex'),
            operation,
            entity,
            data,
            timestamp: new Date(),
            retries: 0
        };
        
        // Add to persistent queue
        await this.saveQueueItem(item);
        
        // Add to memory queue
        this.syncQueue.add(async () => {
            await this.processSyncItem(item);
        });
        
        this.stats.pending = this.syncQueue.size;
        
        // Start queue if online
        if (this.isOnline && !this.syncQueue.isPaused) {
            this.syncQueue.start();
        }
        
        return item.id;
    }
    
    /**
     * Process sync queue item
     */
    async processSyncItem(item) {
        try {
            const response = await this.api.post('/sync/item', item);
            
            // Remove from persistent queue
            await this.removeQueueItem(item.id);
            
            this.stats.pending = this.syncQueue.size;
            
            return response.data;
            
        } catch (error) {
            item.retries++;
            
            if (item.retries < this.config.retryAttempts) {
                // Re-queue
                await this.saveQueueItem(item);
                throw error; // Will be retried by PQueue
            } else {
                // Max retries reached
                logger.error('Sync item failed after max retries:', item);
                await this.moveToDeadLetter(item);
                throw error;
            }
        }
    }
    
    /**
     * Subscribe to local events for sync
     */
    subscribeToEvents() {
        // Guard events
        this.eventBus.on('guard.created', (event) => {
            this.addToQueue('create', 'guard', event.data);
        });
        
        this.eventBus.on('guard.updated', (event) => {
            this.addToQueue('update', 'guard', event.data);
        });
        
        this.eventBus.on('guard.deleted', (event) => {
            this.addToQueue('delete', 'guard', event.data);
        });
        
        // Assignment events
        this.eventBus.on('assignment.created', (event) => {
            this.addToQueue('create', 'assignment', event.data);
        });
        
        // Add more event subscriptions as needed
    }
    
    /**
     * Collect metrics for heartbeat
     */
    async collectMetrics() {
        const os = require('os');
        const { LocalUser, LocalGuard } = require('../models');
        
        return {
            cpu: os.loadavg()[0],
            memory: {
                total: os.totalmem(),
                free: os.freemem(),
                used: os.totalmem() - os.freemem()
            },
            uptime: process.uptime(),
            users: await LocalUser.count(),
            guards: await LocalGuard.count(),
            syncStats: this.stats
        };
    }
    
    /**
     * Helper functions
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    getModel(entity) {
        const models = require('../models');
        const modelMap = {
            'user': models.LocalUser,
            'guard': models.LocalGuard,
            'group': models.LocalGroup,
            'assignment': models.LocalAssignment
        };
        return modelMap[entity];
    }
    
    groupChangesByEntity(changes) {
        const grouped = {};
        for (const change of changes) {
            if (!grouped[change.entity]) {
                grouped[change.entity] = [];
            }
            grouped[change.entity].push(change);
        }
        return grouped;
    }
    
    async loadQueue() {
        // Load from SQLite
        const { SyncQueue } = require('../models');
        const items = await SyncQueue.findAll({
            where: { status: 'pending' },
            order: [['created_at', 'ASC']]
        });
        
        for (const item of items) {
            this.syncQueue.add(async () => {
                await this.processSyncItem(item.data);
            });
        }
    }
    
    async saveQueueItem(item) {
        const { SyncQueue } = require('../models');
        await SyncQueue.upsert({
            id: item.id,
            data: item,
            status: 'pending'
        });
    }
    
    async removeQueueItem(id) {
        const { SyncQueue } = require('../models');
        await SyncQueue.destroy({ where: { id } });
    }
    
    async moveToDeadLetter(item) {
        const { DeadLetter } = require('../models');
        await DeadLetter.create({
            data: item,
            error: 'Max retries exceeded'
        });
        await this.removeQueueItem(item.id);
    }
    
    /**
     * Shutdown sync manager
     */
    async shutdown() {
        logger.info('Shutting down SyncManager...');
        
        // Stop queue
        this.syncQueue.pause();
        this.syncQueue.clear();
        
        // Final sync attempt if online
        if (this.isOnline) {
            try {
                await this.performSync();
            } catch (error) {
                logger.error('Final sync failed:', error);
            }
        }
        
        logger.info('SyncManager shutdown complete');
    }
}

module.exports = SyncManager;
