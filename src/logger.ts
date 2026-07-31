export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  constructor(private readonly level: LogLevel = 'info') {}

  private isEnabled(lvl: LogLevel): boolean {
    const levels: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    return levels[lvl] >= levels[this.level];
  }

  debug(message: string, meta?: Record<string, any>) {
    if (!this.isEnabled('debug')) return;
    console.debug(JSON.stringify({ level: 'debug', message, ...meta, ts: Date.now() }));
  }

  info(message: string, meta?: Record<string, any>) {
    if (!this.isEnabled('info')) return;
    console.info(JSON.stringify({ level: 'info', message, ...meta, ts: Date.now() }));
  }

  warn(message: string, meta?: Record<string, any>) {
    if (!this.isEnabled('warn')) return;
    console.warn(JSON.stringify({ level: 'warn', message, ...meta, ts: Date.now() }));
  }

  error(message: string, meta?: Record<string, any>) {
    if (!this.isEnabled('error')) return;
    console.error(JSON.stringify({ level: 'error', message, ...meta, ts: Date.now() }));
  }
}

export const logger = new Logger(process.env.LOG_LEVEL as LogLevel || 'info');
