// packages/core/events/EventBus.js
// Système d'événements pour communication entre modules

const EventEmitter = require('events');

class EventBus extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = config;
        this.subscribers = new Map();
        this.remoteSubscribers = new Map();
        this.eventHistory = [];
        this.maxHistorySize = config.maxHistorySize || 1000;
        
        // Events that should be propagated to remote servers
        this.propagationRules = {
            // User events
            'user.created': true,
            'user.updated': true,
            'user.deleted': true,
            'user.login': false,
            'user.logout': false,
            
            // Guard events
            'guard.created': true,
            'guard.updated': true,
            'guard.deleted': true,
            'guard.assigned': true,
            'guard.unassigned': true,
            
            // Group events
            'group.created': true,
            'group.updated': true,
            'group.member.added': true,
            'group.member.removed': true,
            
            // System events
            'system.maintenance.started': true,
            'system.maintenance.completed': true,
            'system.error': true,
            'system.warning': false,
            
            // Sync events
            'sync.started': false,
            'sync.completed': false,
            'sync.failed': true,
            
            // Plugin events
            'plugin.installed': true,
            'plugin.enabled': true,
            'plugin.disabled': true,
            'plugin.error': true
        };
    }
    
    /**
     * Emit an event with automatic remote propagation
     */
    emit(event, data) {
        const eventData = {
            event,
            data,
            timestamp: new Date(),
            source: this.config.serverId || 'unknown',
            id: this.generateEventId()
        };
        
        // Add to history
        this.addToHistory(eventData);
        
        // Emit locally
        super.emit(event, eventData);
        super.emit('*', eventData); // Wildcard listeners
        
        // Propagate to remote if needed
        if (this.shouldPropagate(event)) {
            this.propagateToRemote(eventData);
        }
        
        return eventData;
    }
    
    /**
     * Subscribe to an event with optional filter
     */
    subscribe(event, callback, options = {}) {
        const subscription = {
            event,
            callback,
            filter: options.filter,
            once: options.once || false,
            priority: options.priority || 0,
            id: this.generateSubscriptionId()
        };
        
        if (!this.subscribers.has(event)) {
            this.subscribers.set(event, []);
        }
        
        // Add to subscribers sorted by priority
        const subs = this.subscribers.get(event);
        subs.push(subscription);
        subs.sort((a, b) => b.priority - a.priority);
        
        // Register with EventEmitter
        const wrappedCallback = (eventData) => {
            if (this.shouldExecuteCallback(subscription, eventData)) {
                callback(eventData);
                if (subscription.once) {
                    this.unsubscribe(subscription.id);
                }
            }
        };
        
        if (subscription.once) {
            this.once(event, wrappedCallback);
        } else {
            this.on(event, wrappedCallback);
        }
        
        return subscription.id;
    }
    
    /**
     * Unsubscribe from an event
     */
    unsubscribe(subscriptionId) {
        for (const [event, subs] of this.subscribers) {
            const index = subs.findIndex(s => s.id === subscriptionId);
            if (index !== -1) {
                const subscription = subs[index];
                this.removeListener(event, subscription.callback);
                subs.splice(index, 1);
                return true;
            }
        }
        return false;
    }
    
    /**
     * Subscribe to remote events
     */
    subscribeRemote(serverId, events = []) {
        this.remoteSubscribers.set(serverId, events);
    }
    
    /**
     * Check if event should be propagated
     */
    shouldPropagate(event) {
        // Check exact match
        if (this.propagationRules.hasOwnProperty(event)) {
            return this.propagationRules[event];
        }
        
        // Check pattern match
        for (const pattern in this.propagationRules) {
            if (pattern.includes('*')) {
                const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
                if (regex.test(event)) {
                    return this.propagationRules[pattern];
                }
            }
        }
        
        return false;
    }
    
    /**
     * Propagate event to remote servers
     */
    async propagateToRemote(eventData) {
        if (!this.config.syncManager) return;
        
        try {
            await this.config.syncManager.propagateEvent(eventData);
        } catch (error) {
            console.error('Failed to propagate event:', error);
            this.emit('propagation.failed', { eventData, error });
        }
    }
    
    /**
     * Check if callback should be executed based on filter
     */
    shouldExecuteCallback(subscription, eventData) {
        if (!subscription.filter) return true;
        
        // Apply filter function
        if (typeof subscription.filter === 'function') {
            return subscription.filter(eventData);
        }
        
        // Apply object filter (match properties)
        if (typeof subscription.filter === 'object') {
            for (const key in subscription.filter) {
                if (eventData.data[key] !== subscription.filter[key]) {
                    return false;
                }
            }
        }
        
        return true;
    }
    
    /**
     * Add event to history
     */
    addToHistory(eventData) {
        this.eventHistory.push(eventData);
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory.shift();
        }
    }
    
    /**
     * Get event history
     */
    getHistory(filter = {}) {
        let history = [...this.eventHistory];
        
        if (filter.event) {
            history = history.filter(e => e.event === filter.event);
        }
        
        if (filter.since) {
            const since = new Date(filter.since);
            history = history.filter(e => new Date(e.timestamp) > since);
        }
        
        if (filter.source) {
            history = history.filter(e => e.source === filter.source);
        }
        
        return history;
    }
    
    /**
     * Wait for an event (promise-based)
     */
    waitFor(event, timeout = 5000, filter = null) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.unsubscribe(subscriptionId);
                reject(new Error(`Timeout waiting for event: ${event}`));
            }, timeout);
            
            const subscriptionId = this.subscribe(event, (eventData) => {
                clearTimeout(timer);
                resolve(eventData);
            }, { once: true, filter });
        });
    }
    
    /**
     * Emit and wait for response
     */
    async request(event, data, timeout = 5000) {
        const requestId = this.generateEventId();
        const responseEvent = `${event}.response.${requestId}`;
        
        // Wait for response
        const responsePromise = this.waitFor(responseEvent, timeout);
        
        // Emit request
        this.emit(event, { ...data, requestId });
        
        // Wait and return response
        return await responsePromise;
    }
    
    /**
     * Reply to a request
     */
    reply(requestEvent, responseData) {
        const requestId = requestEvent.data.requestId;
        if (!requestId) {
            throw new Error('No requestId in event data');
        }
        
        const responseEvent = `${requestEvent.event}.response.${requestId}`;
        this.emit(responseEvent, responseData);
    }
    
    /**
     * Generate unique event ID
     */
    generateEventId() {
        return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Generate unique subscription ID
     */
    generateSubscriptionId() {
        return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Clear event history
     */
    clearHistory() {
        this.eventHistory = [];
    }
    
    /**
     * Get statistics
     */
    getStatistics() {
        const stats = {
            subscribers: {},
            totalSubscribers: 0,
            historySize: this.eventHistory.length,
            events: {}
        };
        
        for (const [event, subs] of this.subscribers) {
            stats.subscribers[event] = subs.length;
            stats.totalSubscribers += subs.length;
        }
        
        for (const event of this.eventHistory) {
            if (!stats.events[event.event]) {
                stats.events[event.event] = 0;
            }
            stats.events[event.event]++;
        }
        
        return stats;
    }
}

// Singleton instance
let instance = null;

module.exports = {
    EventBus,
    getInstance: (config) => {
        if (!instance) {
            instance = new EventBus(config);
        }
        return instance;
    }
};
