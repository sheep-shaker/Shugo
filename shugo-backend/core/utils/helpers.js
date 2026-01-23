// packages/core/utils/helpers.js
// Shared helper functions

/**
 * Sleep for ms milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry function with exponential backoff
 */
async function retry(fn, options = {}) {
    const {
        maxAttempts = 3,
        delay = 1000,
        backoff = 2,
        onRetry = () => {}
    } = options;
    
    let lastError;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            if (attempt < maxAttempts) {
                const waitTime = delay * Math.pow(backoff, attempt - 1);
                onRetry(attempt, error, waitTime);
                await sleep(waitTime);
            }
        }
    }
    
    throw lastError;
}

/**
 * Chunk array into smaller arrays
 */
function chunk(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

/**
 * Deep clone object
 */
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Parse boolean from string
 */
function parseBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
    }
    return !!value;
}

/**
 * Validate email format
 */
function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

/**
 * Generate member ID (10 digits)
 */
function generateMemberId() {
    return Math.floor(1000000000 + Math.random() * 9000000000);
}

/**
 * Validate geo_id format
 */
function isValidGeoId(geoId) {
    const pattern = /^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/;
    return pattern.test(geoId);
}

module.exports = {
    sleep,
    retry,
    chunk,
    deepClone,
    formatBytes,
    parseBoolean,
    isValidEmail,
    generateMemberId,
    isValidGeoId
};
