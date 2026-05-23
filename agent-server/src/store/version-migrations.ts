// input:  CORTEX_VERSION, DATA_DIR/DEFAULTS_DIR, atomicWrite, createLogger
// output: runMigrations() — applies pending file migrations before config loading
// pos:    Version-tracked file migration runner. Tracks per-file applied migration versions
//         in DATA_DIR/data/versions.json; on startup compares against CORTEX_VERSION and
//         runs pending migrations in version order. Idempotent and crash-safe via atomicWrite.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { CORTEX_VERSION } from '@core/version.js';
import { DATA_DIR, DEFAULTS_DIR } from '@core/paths.js';
import { atomicWrite } from '@core/atomic-write.js';
import { createLogger } from '@core/log.js';

const log = createLogger('version-migrations');

// ── CalVer comparison ──────────────────────────────────────────
// CalVer format: YYYY.M.D (no zero-padding, e.g. 2026.5.23).
// String comparison fails on cross-digit boundaries (2026.5.9 vs 2026.5.23)
// so we parse into numeric components and compare element-wise.
// Returns negative if a < b, positive if a > b, 0 if equal.

export function compareCalVer(a: string, b: string): number {
  const [aYear, aMonth, aDay] = a.split('.').map(Number);
  const [bYear, bMonth, bDay] = b.split('.').map(Number);
  if (aYear !== bYear) return aYear - bYear;
  if (aMonth !== bMonth) return aMonth - bMonth;
  return aDay - bDay;
}

// ── Migration type ─────────────────────────────────────────────

export interface Migration {
  /** File path relative to DATA_DIR, e.g. "config/thread-templates.json". */
  filePath: string;
  /** CalVer when this migration was introduced. Compared against the per-file
   *  version tracked in versions.json to decide whether to run. */
  version: string;
  /** Idempotent migration function. Receives the parsed JSON of the target file
   *  and optionally the parsed JSON of the corresponding defaults file (or undefined
   *  if no defaults file applies or it couldn't be loaded). Must return the migrated
   *  data — the runner compares before/after to decide whether to write. */
  migrate(data: unknown, defaults?: unknown): unknown;
}

// ── Registry ───────────────────────────────────────────────────
// Add new migrations here. The runner groups them by filePath and applies
// pending ones in version-ascending order.

const migrations: Migration[] = [
  // M1: Backfill systemPrompt on user agents that are missing it.
  // Agents that exist in both user config and defaults, but whose user version
  // has no systemPrompt field, get the default agent's systemPrompt value copied.
  // Agents that already have systemPrompt are left untouched. User-only agents
  // (not in defaults) are skipped.
  {
    filePath: 'config/thread-templates.json',
    version: '2026.5.23',
    migrate(data: unknown, defaultsData?: unknown): unknown {
      if (!defaultsData || typeof defaultsData !== 'object' || defaultsData === null) return data;
      if (typeof data !== 'object' || data === null) return data;
      const d = data as Record<string, unknown>;
      const defs = defaultsData as Record<string, unknown>;
      const userAgents: Record<string, unknown> | undefined = d.agents as Record<string, unknown> | undefined;
      const defaultAgents: Record<string, unknown> | undefined = defs.agents as Record<string, unknown> | undefined;
      if (!userAgents || !defaultAgents) return data;

      let changed = false;
      for (const [name, defAgent] of Object.entries(defaultAgents)) {
        const userAgent = userAgents[name];
        if (!userAgent || typeof userAgent !== 'object') continue; // agent not in user config
        const ua = userAgent as Record<string, unknown>;
        const da = defAgent as Record<string, unknown>;
        if (ua.systemPrompt === undefined && da.systemPrompt !== undefined) {
          ua.systemPrompt = da.systemPrompt;
          changed = true;
        }
      }
      if (changed) d.agents = userAgents;
      return data;
    },
  },
];

// ── Versions file I/O ──────────────────────────────────────────

async function loadVersionsFrom(filePath: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      log.warn('versions.json has unexpected shape; resetting');
      return {};
    }
    return parsed as Record<string, string>;
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      log.info('versions.json not found; all migrations will be considered pending');
      return {};
    }
    if (err instanceof SyntaxError) {
      log.warn(`Corrupt versions.json (${e.message}); resetting`);
      return {};
    }
    throw err;
  }
}

async function saveVersionsTo(filePath: string, versions: Record<string, string>): Promise<void> {
  await atomicWrite(filePath, JSON.stringify(versions, null, 2) + '\n');
}

// ── Defaults loader ────────────────────────────────────────────

/** Map of target filePath → corresponding defaults filePath (relative to DEFAULTS_DIR).
 *  When a migration needs defaults data, the runner looks up the defaults path here,
 *  reads it once, and passes it to every pending migration for that target file. */
const DEFAULTS_MAP: Record<string, string> = {
  'config/thread-templates.json': 'config/thread-templates.json',
};

async function loadDefaultsForWith(filePath: string, defaultsDir: string): Promise<unknown> {
  const defaultsRel = DEFAULTS_MAP[filePath];
  if (!defaultsRel) return undefined;
  const defaultsPath = path.join(defaultsDir, defaultsRel);
  try {
    const raw = await fs.readFile(defaultsPath, 'utf8');
    return JSON.parse(raw);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      log.warn(`Defaults file not found: ${defaultsPath}; migrations for ${filePath} may be skipped`);
    } else if (err instanceof SyntaxError) {
      log.warn(`Defaults file corrupt (${defaultsPath}): ${e.message}`);
    } else {
      log.warn(`Could not load defaults for ${filePath}: ${e.message}`);
    }
    return undefined;
  }
}

// ── Runner options ─────────────────────────────────────────────

export interface MigrationOptions {
  /** Override DATA_DIR (user config location). Defaults to the real CORTEX_HOME. */
  dataDir?: string;
  /** Override DEFAULTS_DIR (default config location). Defaults to INSTALL_ROOT/defaults. */
  defaultsDir?: string;
  /** Override versions.json location. Defaults to dataDir/data. */
  storeDir?: string;
}

// ── Runner ─────────────────────────────────────────────────────

export async function runMigrations(opts: MigrationOptions = {}): Promise<void> {
  const dataDir = opts.dataDir ?? DATA_DIR;
  const defaultsDir = opts.defaultsDir ?? DEFAULTS_DIR;
  const storeDir = opts.storeDir ?? path.join(dataDir, 'data');

  const versionsFile = path.join(storeDir, 'versions.json');
  const versions = await loadVersionsFrom(versionsFile);

  // Group migrations by filePath
  const byFilePath = new Map<string, Migration[]>();
  for (const m of migrations) {
    const list = byFilePath.get(m.filePath) ?? [];
    list.push(m);
    byFilePath.set(m.filePath, list);
  }

  for (const [filePath, fileMigrations] of byFilePath) {
    const trackedVersion = versions[filePath] || '0.0.0';

    // Pending: migrations whose version > trackedVersion and <= CORTEX_VERSION
    const pending = fileMigrations
      .filter(m => compareCalVer(trackedVersion, m.version) < 0 && compareCalVer(CORTEX_VERSION, m.version) >= 0)
      .sort((a, b) => compareCalVer(a.version, b.version));

    if (pending.length === 0) continue;

    // Read target file
    const absPath = path.join(dataDir, filePath);
    let data: unknown;
    try {
      const raw = await fs.readFile(absPath, 'utf8');
      data = JSON.parse(raw);
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') {
        log.info(`Skipping migrations for ${filePath}: file does not exist yet`);
        continue;
      }
      if (err instanceof SyntaxError) {
        log.warn(`Skipping migrations for ${filePath}: corrupt JSON (${e.message})`);
        continue;
      }
      throw err;
    }

    // Load defaults once for this file (if any)
    const defaultsData = await loadDefaultsForWith(filePath, defaultsDir);

    // Apply all pending migrations in version order
    let changed = false;
    let anyFailed = false;
    for (const m of pending) {
      const before = JSON.stringify(data);
      try {
        data = m.migrate(data, defaultsData);
      } catch (err: unknown) {
        log.error(`Migration ${m.version} for ${filePath} failed: ${(err as Error).message}; skipping remaining migrations for this file`);
        changed = false;
        anyFailed = true;
        break;
      }
      if (JSON.stringify(data) !== before) {
        log.info(`Migration ${m.version} applied to ${filePath}`);
        changed = true;
      }
    }

    if (changed) {
      await atomicWrite(absPath, JSON.stringify(data, null, 2) + '\n');
    }

    // Only bump the tracked version if ALL pending migrations succeeded.
    // If any failed: we did not write the file (changed=false), so the data on
    // disk is unchanged. Leave version at the old value → all pending migrations
    // retry next boot. Idempotent migrations guarantee this is safe.
    if (!anyFailed) {
      versions[filePath] = pending[pending.length - 1].version;
    }
  }

  await saveVersionsTo(versionsFile, versions);
}
