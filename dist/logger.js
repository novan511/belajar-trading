export class Logger {
    level;
    constructor(level = 'info') {
        this.level = level;
    }
    isEnabled(lvl) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        return levels[lvl] >= levels[this.level];
    }
    debug(message, meta) {
        if (!this.isEnabled('debug'))
            return;
        console.debug(JSON.stringify({ level: 'debug', message, ...meta, ts: Date.now() }));
    }
    info(message, meta) {
        if (!this.isEnabled('info'))
            return;
        console.info(JSON.stringify({ level: 'info', message, ...meta, ts: Date.now() }));
    }
    warn(message, meta) {
        if (!this.isEnabled('warn'))
            return;
        console.warn(JSON.stringify({ level: 'warn', message, ...meta, ts: Date.now() }));
    }
    error(message, meta) {
        if (!this.isEnabled('error'))
            return;
        console.error(JSON.stringify({ level: 'error', message, ...meta, ts: Date.now() }));
    }
}
export const logger = new Logger(process.env.LOG_LEVEL || 'info');
