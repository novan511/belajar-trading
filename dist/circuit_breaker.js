/**
 * Circuit Breaker Pattern — Graceful Degradation untuk External API Calls
 *
 * Mencegah bot trading buta/error ketika external services down.
 *
 * Fitur:
 * - Auto-open circuit setelah N failures berurutan
 * - Half-open setelah cooldown timeout
 * - Fallback ke function cadangan
 * - Metrics tracking untuk monitoring
 */
export class CircuitBreaker {
    states = new Map();
    failureCounts = new Map();
    lastFailureTimes = new Map();
    halfOpenRequests = new Map();
    totalFailures = new Map();
    totalSuccesses = new Map();
    lastStateChanges = new Map();
    responseTimes = new Map();
    defaultConfig = {
        failureThreshold: 3,
        resetTimeoutMs: 30000, // 30 detik cooldown
        halfOpenMaxRequests: 2,
        name: 'unnamed'
    };
    configs = new Map();
    constructor() {
        // Register default service configs
        this.registerService('nvidia_api', {
            failureThreshold: 3,
            resetTimeoutMs: 60000, // 1 menit untuk AI API
            halfOpenMaxRequests: 1,
            name: 'NVIDIA Llama API'
        });
        this.registerService('coingecko', {
            failureThreshold: 2,
            resetTimeoutMs: 30000,
            halfOpenMaxRequests: 2,
            name: 'CoinGecko API'
        });
        this.registerService('hyperliquid_ws', {
            failureThreshold: 5,
            resetTimeoutMs: 15000, // 15 detik untuk WebSocket
            halfOpenMaxRequests: 3,
            name: 'Hyperliquid WS'
        });
        this.registerService('hyperliquid_rest', {
            failureThreshold: 3,
            resetTimeoutMs: 10000,
            halfOpenMaxRequests: 2,
            name: 'Hyperliquid REST'
        });
    }
    registerService(name, config) {
        const fullConfig = { ...this.defaultConfig, ...config, name };
        this.configs.set(name, fullConfig);
        this.states.set(name, 'CLOSED');
        this.failureCounts.set(name, 0);
        this.lastFailureTimes.set(name, 0);
        this.halfOpenRequests.set(name, 0);
        this.totalFailures.set(name, 0);
        this.totalSuccesses.set(name, 0);
        this.lastStateChanges.set(name, Date.now());
        this.responseTimes.set(name, []);
    }
    /**
     * Execute function dengan circuit breaker protection
     *
     * @param serviceName - Nama service (nvidia_api, coingecko, dll)
     * @param fn - Function utama (async)
     * @param fallback - Function cadangan kalo circuit OPEN
     * @returns Result dari fn atau fallback
     */
    async call(serviceName, fn, fallback) {
        const config = this.configs.get(serviceName) || this.defaultConfig;
        const state = this.states.get(serviceName) || 'CLOSED';
        // Check circuit state
        if (state === 'OPEN') {
            const lastFail = this.lastFailureTimes.get(serviceName) || 0;
            const timeSinceFail = Date.now() - lastFail;
            if (timeSinceFail >= config.resetTimeoutMs) {
                // Cooldown expired → HALF_OPEN
                this.transitionTo(serviceName, 'HALF_OPEN');
                console.log(`\x1b[33m[CB] ${config.name} circuit → HALF_OPEN (cooldown expired)\x1b[0m`);
            }
            else {
                // Circuit masih OPEN → fallback
                const timeLeft = Math.ceil((config.resetTimeoutMs - timeSinceFail) / 1000);
                console.log(`\x1b[31m[CB] ${config.name} circuit OPEN. Fallback (retry in ${timeLeft}s)\x1b[0m`);
                return fallback();
            }
        }
        // HALF_OPEN: batasi jumlah request
        if (state === 'HALF_OPEN') {
            const requests = this.halfOpenRequests.get(serviceName) || 0;
            if (requests >= config.halfOpenMaxRequests) {
                console.log(`\x1b[33m[CB] ${config.name} HALF_OPEN: max requests reached. Fallback.\x1b[0m`);
                return fallback();
            }
            this.halfOpenRequests.set(serviceName, requests + 1);
        }
        // Execute function dengan timing
        const startTime = Date.now();
        try {
            const result = await fn();
            const responseTime = Date.now() - startTime;
            // Success → reset failure count, record timing
            this.onSuccess(serviceName, responseTime);
            return result;
        }
        catch (err) {
            const responseTime = Date.now() - startTime;
            // Failure → increment counter
            this.onFailure(serviceName, responseTime, err);
            // Log
            console.log(`\x1b[31m[CB] ${config.name} FAILED: ${err.message}. Circuit: ${this.states.get(serviceName)}\x1b[0m`);
            // Return fallback
            return fallback();
        }
    }
    onSuccess(serviceName, responseTime) {
        const state = this.states.get(serviceName);
        // Reset failure count
        this.failureCounts.set(serviceName, 0);
        this.totalSuccesses.set(serviceName, (this.totalSuccesses.get(serviceName) || 0) + 1);
        // Track response time (sliding window of last 20)
        const times = this.responseTimes.get(serviceName) || [];
        times.push(responseTime);
        if (times.length > 20)
            times.shift();
        this.responseTimes.set(serviceName, times);
        // HALF_OPEN success → CLOSED
        if (state === 'HALF_OPEN') {
            this.transitionTo(serviceName, 'CLOSED');
            this.halfOpenRequests.set(serviceName, 0);
            console.log(`\x1b[32m[CB] ${this.configs.get(serviceName)?.name} circuit → CLOSED (recovered)\x1b[0m`);
        }
    }
    onFailure(serviceName, responseTime, err) {
        const config = this.configs.get(serviceName) || this.defaultConfig;
        const count = (this.failureCounts.get(serviceName) || 0) + 1;
        this.failureCounts.set(serviceName, count);
        this.lastFailureTimes.set(serviceName, Date.now());
        this.totalFailures.set(serviceName, (this.totalFailures.get(serviceName) || 0) + 1);
        // Track response time
        const times = this.responseTimes.get(serviceName) || [];
        times.push(responseTime);
        if (times.length > 20)
            times.shift();
        this.responseTimes.set(serviceName, times);
        const state = this.states.get(serviceName);
        // CLOSED → OPEN (if threshold reached)
        if (state === 'CLOSED' && count >= config.failureThreshold) {
            this.transitionTo(serviceName, 'OPEN');
            console.log(`\x1b[31m[CB] ${config.name} circuit → OPEN (${count}/${config.failureThreshold} failures)\x1b[0m`);
        }
        // HALF_OPEN failure → back to OPEN
        if (state === 'HALF_OPEN') {
            this.transitionTo(serviceName, 'OPEN');
            this.halfOpenRequests.set(serviceName, 0);
            console.log(`\x1b[31m[CB] ${config.name} HALF_OPEN request failed → back to OPEN\x1b[0m`);
        }
    }
    transitionTo(serviceName, newState) {
        this.states.set(serviceName, newState);
        this.lastStateChanges.set(serviceName, Date.now());
    }
    // ============================================================
    // PUBLIC API — Monitoring & Metrics
    // ============================================================
    getState(serviceName) {
        return this.states.get(serviceName) || 'CLOSED';
    }
    isOpen(serviceName) {
        return this.states.get(serviceName) === 'OPEN';
    }
    isAvailable(serviceName) {
        const state = this.states.get(serviceName);
        if (state === 'CLOSED')
            return true;
        if (state === 'HALF_OPEN')
            return true; // Limited availability
        // OPEN: check if cooldown expired
        const config = this.configs.get(serviceName) || this.defaultConfig;
        const lastFail = this.lastFailureTimes.get(serviceName) || 0;
        return (Date.now() - lastFail) >= config.resetTimeoutMs;
    }
    getMetrics(serviceName) {
        const times = this.responseTimes.get(serviceName) || [];
        const avgTime = times.length > 0
            ? times.reduce((a, b) => a + b, 0) / times.length
            : 0;
        return {
            state: this.states.get(serviceName) || 'CLOSED',
            failureCount: this.failureCounts.get(serviceName) || 0,
            lastFailureTime: this.lastFailureTimes.get(serviceName) || 0,
            totalFailures: this.totalFailures.get(serviceName) || 0,
            totalSuccesses: this.totalSuccesses.get(serviceName) || 0,
            lastStateChange: this.lastStateChanges.get(serviceName) || Date.now(),
            avgResponseTime: Math.round(avgTime)
        };
    }
    getAllMetrics() {
        const result = {};
        for (const [name] of this.configs) {
            result[name] = this.getMetrics(name);
        }
        return result;
    }
    /**
     * Manual reset circuit (dipanggil dari dashboard)
     */
    reset(serviceName) {
        this.states.set(serviceName, 'CLOSED');
        this.failureCounts.set(serviceName, 0);
        this.halfOpenRequests.set(serviceName, 0);
        this.lastStateChanges.set(serviceName, Date.now());
        console.log(`\x1b[32m[CB] ${serviceName} manually reset to CLOSED\x1b[0m`);
    }
    resetAll() {
        for (const [name] of this.configs) {
            this.reset(name);
        }
    }
}
// Singleton instance — shared across all modules
export const circuitBreaker = new CircuitBreaker();
