/**
 * Structured logger with levels.
 * Set LOG_LEVEL via localStorage('omega-point-log-level') or default to 'info'.
 * Levels: debug < info < warn < error
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLevel(): LogLevel {
  try {
    const stored = localStorage.getItem('omega-point-log-level');
    if (stored && stored in LEVEL_ORDER) return stored as LogLevel;
  } catch { /* SSR-safe */ }
  return 'info';
}

let currentLevel = getConfiguredLevel();

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function formatPrefix(scope: string, level: LogLevel): string {
  return `[${scope}] ${level.toUpperCase()}`;
}

export interface Logger {
  debug: (...args: any[]) => void;
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (...args: any[]) => {
      if (shouldLog('debug')) console.debug(formatPrefix(scope, 'debug'), ...args);
    },
    info: (...args: any[]) => {
      if (shouldLog('info')) console.log(formatPrefix(scope, 'info'), ...args);
    },
    warn: (...args: any[]) => {
      if (shouldLog('warn')) console.warn(formatPrefix(scope, 'warn'), ...args);
    },
    error: (...args: any[]) => {
      if (shouldLog('error')) console.error(formatPrefix(scope, 'error'), ...args);
    },
  };
}

/** Change log level at runtime: setLogLevel('debug') */
export function setLogLevel(level: LogLevel) {
  currentLevel = level;
  try { localStorage.setItem('omega-point-log-level', level); } catch { /* noop */ }
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}
