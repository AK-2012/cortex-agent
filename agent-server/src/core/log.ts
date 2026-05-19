// input:  nothing (leaf module)
// output: createLogger() factory
// pos:    centralized logging — console + daily-rotating file sink
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import fs from 'node:fs';
import path from 'node:path';
import { LOGS_DIR } from './paths.js';

// ── Config ──────────────────────────────────────────────
const RETENTION_DAYS = 14;

type Level = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

// ── File sink (daily rotation) ──────────────────────────
let currentDate = '';
let stream: fs.WriteStream | null = null;
let lastCleanup = '';

function dateTag(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('');
}

function getStream(): fs.WriteStream {
  const tag = dateTag();
  if (tag !== currentDate || !stream) {
    stream?.end();
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    currentDate = tag;
    stream = fs.createWriteStream(
      path.join(LOGS_DIR, `server-${tag}.log`),
      { flags: 'a' },
    );
    // attempt cleanup at most once per calendar day
    if (lastCleanup !== tag) {
      lastCleanup = tag;
      cleanOldLogs();
    }
  }
  return stream;
}

function cleanOldLogs(): void {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
    for (const f of fs.readdirSync(LOGS_DIR)) {
      const m = f.match(/^server-(\d{4})(\d{2})(\d{2})\.log$/);
      if (!m) continue;
      const fileDate = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
      if (fileDate < cutoff) {
        fs.unlinkSync(path.join(LOGS_DIR, f));
      }
    }
  } catch {
    // best-effort cleanup — don't crash on permission errors etc.
  }
}

// ── Formatting ──────────────────────────────────────────
function formatArg(a: unknown): string {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === 'object' && a !== null) {
    try { return JSON.stringify(a); } catch { return String(a); }
  }
  return String(a);
}

// ── Core write ──────────────────────────────────────────
function write(level: Level, mod: string, args: unknown[]): void {
  const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const prefix = `[${mod} ${ts}]`;

  // Console output
  switch (level) {
    case 'ERROR': console.error(prefix, ...args); break;
    case 'WARN':  console.warn(prefix, ...args);  break;
    case 'DEBUG': console.debug(prefix, ...args);  break;
    default:      console.log(prefix, ...args);
  }

  // File output
  const line = `${prefix} ${level} ${args.map(formatArg).join(' ')}\n`;
  try { getStream().write(line); } catch { /* don't crash on write failure */ }
}

// ── Factory ─────────────────────────────────────────────
export function createLogger(mod: string): Logger {
  return {
    info:  (...args) => write('INFO', mod, args),
    warn:  (...args) => write('WARN', mod, args),
    error: (...args) => write('ERROR', mod, args),
    debug: (...args) => { if (process.env.DEBUG) write('DEBUG', mod, args); },
  };
}

// Flush on process exit
process.on('exit', () => { stream?.end(); });
