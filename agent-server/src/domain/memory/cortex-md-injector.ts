// input:  fs, device name, CortexMDEntry[], session id
// output: CortexMDInjector class + singleton
// pos:    remote CORTEX.md injection into MCP response dedup cache
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WORKSPACE_DIR } from '@core/utils.js';

export interface CortexMDEntry {
  path: string;
  content: string;
  mtimeMs: number;
}

export interface CortexMDBlock {
  type: 'text';
  text: string;
}

const DEFAULT_CACHE_DIR = path.join(WORKSPACE_DIR, 'mcp-cortexmd-cache');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_ID_RE = /^[A-Za-z0-9._-]+$/;

function resolveCacheFile(cacheDir: string, sessionId: string | undefined): string | null {
  if (!sessionId || !SESSION_ID_RE.test(sessionId)) return null;
  return path.join(cacheDir, `${sessionId}.json`);
}

/** Remove stale session cache files and the legacy global cache. Best-effort, swallows errors. */
function maintainCacheDir(cacheDir: string): void {
  try {
    if (!fs.existsSync(cacheDir)) return;
    const now = Date.now();
    for (const name of fs.readdirSync(cacheDir)) {
      const p = path.join(cacheDir, name);
      try {
        const st = fs.statSync(p);
        if (!st.isFile()) continue;
        if (now - st.mtimeMs > CACHE_TTL_MS) fs.rmSync(p, { force: true });
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

export interface CortexMDInjectorOptions {
  /** Session id — usually process.env.CORTEX_SESSION_ID. Undefined/invalid → in-memory only. */
  sessionId?: string;
  /** Directory where per-session cache files live. */
  cacheDir?: string;
  /** Direct cache file override (used by tests to bypass session-id logic). */
  cacheFile?: string | null;
}

export class CortexMDInjector {
  private cache = new Map<string, number>();
  private readonly cacheFile: string | null;

  constructor(options: CortexMDInjectorOptions = {}) {
    const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
    if (options.cacheFile !== undefined) {
      this.cacheFile = options.cacheFile;
    } else {
      const sessionId = options.sessionId ?? process.env.CORTEX_SESSION_ID;
      this.cacheFile = resolveCacheFile(cacheDir, sessionId);
    }
    maintainCacheDir(cacheDir);
    this.loadCache();
  }

  private loadCache(): void {
    if (!this.cacheFile) return;
    try {
      if (!fs.existsSync(this.cacheFile)) return;
      const raw = fs.readFileSync(this.cacheFile, 'utf8');
      const data = JSON.parse(raw) as Record<string, number>;
      if (data && typeof data === 'object') {
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === 'number') this.cache.set(k, v);
        }
      }
    } catch {
      // corrupt/unreadable cache — start fresh, will overwrite on next persist
    }
  }

  private persistCache(): void {
    if (!this.cacheFile) return;
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      const obj: Record<string, number> = {};
      for (const [k, v] of this.cache) obj[k] = v;
      const tmp = `${this.cacheFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
      fs.renameSync(tmp, this.cacheFile);
    } catch {
      // disk full, permission denied, partial write interrupted — degrade gracefully
    }
  }

  /** markOnlyPaths: entries whose path is in this set update the mtime cache
   *  (so future reads of sibling files skip them) but do not emit a block.
   *  Intended for the tool's own target file — the agent already has its
   *  content as the primary tool response and does not need a duplicate. */
  buildBlocks(device: string, entries: CortexMDEntry[], markOnlyPaths?: Set<string>): CortexMDBlock[] {
    if (!entries || entries.length === 0) return [];
    const blocks: CortexMDBlock[] = [];
    let changed = false;
    for (const entry of entries) {
      const key = `${device}:${entry.path}`;
      if (this.cache.get(key) === entry.mtimeMs) continue;
      this.cache.set(key, entry.mtimeMs);
      changed = true;
      if (markOnlyPaths?.has(entry.path)) continue;
      blocks.push({
        type: 'text',
        text:
          `<system-reminder>\n` +
          `Auto-loaded CORTEX.md from ${device}:${entry.path} ` +
          `(ancestor of accessed path on remote device). ` +
          `These instructions apply to files under this directory on that device.\n\n` +
          entry.content +
          `\n</system-reminder>`,
      });
    }
    if (changed) this.persistCache();
    return blocks;
  }
}

let defaultCortexInjector: CortexMDInjector | null = null;

export function getDefaultCortexInjector(): CortexMDInjector {
  if (!defaultCortexInjector) defaultCortexInjector = new CortexMDInjector();
  return defaultCortexInjector;
}
