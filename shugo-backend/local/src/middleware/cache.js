// packages/local/src/middleware/cache.js
// Cache middleware for local server

const NodeCache = require('node-cache');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

// Create cache instance
const cache = new NodeCache({
    stdTTL: config.cache?.ttl || 300, // 5 minutes default
    checkperiod: config.cache?.checkPeriod || 60,
    useClones: config.cache?.useClones !== false,
    maxKeys: config.cache?.maxKeys || 500
});

// Cache statistics
let stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0
};

/**
 * Generate cache key from request
 */
function generateCacheKey(req) {
    const components = [
        req.method,
        req.originalUrl || req.url,
        req.user?.member_id || 'anonymous',
        req.user?.role || 'none'
    ];
    
    // Add relevant query parameters
    if (req.query && Object.keys(req.query).length > 0) {
        components.push(JSON.stringify(req.query));
    }
    
    // Create hash for consistent key
    return crypto
        .createHash('md5')
        .update(components.join(':'))
        .digest('hex');
}

/**
 * Cache middleware factory
 */
function cacheMiddleware(ttl = null) {
    return async (req, res, next) => {
        // Skip if cache disabled
        if (!config.cache?.enabled) {
            return next();
        }
        
        // Only cache GET requests
        if (req.method !== 'GET') {
            return next();
        }
        
        // Skip if user wants fresh data
        if (req.headers['cache-control'] === 'no-cache' || 
            req.headers['pragma'] === 'no-cache') {
            return next();
        }
        
        const key = generateCacheKey(req);
        
        // Try to get from cache
        const cached = cache.get(key);
        
        if (cached) {
            stats.hits++;
            logger.debug('Cache hit', { key, url: req.url });
            
            // Set cache headers
            res.set('X-Cache', 'HIT');
            res.set('X-Cache-TTL', cache.getTtl(key));
            
            return res.json(cached);
        }
        
        stats.misses++;
        logger.debug('Cache miss', { key, url: req.url });
        
        // Store original send
        const originalSend = res.json;
        
        // Override json method to cache response
        res.json = function(data) {
            // Only cache successful responses
            if (res.statusCode === 200 && data) {
                const cacheTTL = ttl || config.cache.ttl;
                cache.set(key, data, cacheTTL);
                stats.sets++;
                
                logger.debug('Response cached', { 
                    key, 
                    url: req.url, 
                    ttl: cacheTTL 
                });
                
                // Set cache headers
                res.set('X-Cache', 'MISS');
                res.set('X-Cache-TTL', cacheTTL);
            }
            
            // Call original send
            return originalSend.call(this, data);
        };
        
        next();
    };
}

/**
 * Clear cache by pattern
 */
function clearCache(pattern = '*') {
    if (pattern === '*') {
        cache.flushAll();
        stats.deletes += cache.getStats().keys;
        logger.info('Cache cleared completely');
    } else {
        const keys = cache.keys();
        const regex = new RegExp(pattern.replace('*', '.*'));
        let deleted = 0;
        
        for (const key of keys) {
            if (regex.test(key)) {
                cache.del(key);
                deleted++;
            }
        }
        
        stats.deletes += deleted;
        logger.info(`Cache cleared: ${deleted} keys matching ${pattern}`);
    }
}

/**
 * Get cache statistics
 */
function getCacheStats() {
    const nodeStats = cache.getStats();
    
    return {
        ...stats,
        ...nodeStats,
        hitRate: stats.hits > 0 
            ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) + '%'
            : '0%',
        memoryUsage: process.memoryUsage().heapUsed
    };
}

/**
 * Invalidate cache for specific user
 */
function invalidateUserCache(memberId) {
    const keys = cache.keys();
    let deleted = 0;
    
    for (const key of keys) {
        const value = cache.get(key);
        if (value && value._userId === memberId) {
            cache.del(key);
            deleted++;
        }
    }
    
    if (deleted > 0) {
        logger.debug(`Invalidated ${deleted} cache entries for user ${memberId}`);
    }
}

/**
 * Warm up cache with common queries
 */
async function warmupCache() {
    logger.info('Warming up cache...');
    
    // Add logic to pre-fetch common data
    // This would typically fetch guards for the current week,
    // user lists, etc.
}

// Reset stats periodically
setInterval(() => {
    logger.debug('Cache statistics', getCacheStats());
    
    // Reset counters but keep the cache
    stats = {
        hits: 0,
        misses: 0,
        sets: 0,
        deletes: 0
    };
}, 60 * 60 * 1000); // Every hour

module.exports = {
    middleware: cacheMiddleware,
    clear: clearCache,
    stats: getCacheStats,
    invalidateUser: invalidateUserCache,
    warmup: warmupCache,
    instance: cache
};
