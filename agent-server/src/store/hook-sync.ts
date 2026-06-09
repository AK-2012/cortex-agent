// input:  DEFAULTS_DIR/hooks/*.mjs (version-stamped) + HOOKS_DIR (DATA_DIR/hooks)
// output: syncManagedHooks() — refreshes a deployed hook when the shipped default is newer
// pos:    Startup asset-sync sibling to runMigrations; keeps DATA_DIR/hooks in sync with defaults.
//         init.ts deployHooks() uses safeCopy (copy-if-missing) so an existing hook is NEVER
//         refreshed on upgrade — code-level hook fixes would never reach an existing install.
//         This closes that gap for *managed* (version-stamped) hooks.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { DEFAULTS_DIR, HOOKS_DIR } from '@core/paths.js';
import { atomicWrite } from '@core/atomic-write.js';
import { compareCalVer } from './version-migrations.js';
import { createLogger } from '@core/log.js';

const log = createLogger('hook-sync');

// A managed hook declares its version in a header comment:
//   // @cortex-hook-version 2026.6.4
// Set it to the current release version (agent-server/package.json / CORTEX_VERSION) whenever you
// change the hook, so an existing install gets the new code on next startup.
const VERSION_MARKER_RE = /@cortex-hook-version\s+(\d{4}\.\d{1,2}\.\d{1,2}(?:-\d+)?)/;

/** Parse the @cortex-hook-version stamp from hook source, or null if absent/malformed. */
export function parseHookVersion(src: string): string | null {
  const m = src.match(VERSION_MARKER_RE);
  return m ? m[1] : null;
}

/**
 * Keep version-stamped hooks in HOOKS_DIR in sync with the shipped defaults.
 *
 * A default hook that carries an `// @cortex-hook-version YYYY.M.D` stamp is (re)written into
 * HOOKS_DIR whenever the shipped stamp is newer than the deployed one. A missing or unstamped
 * deployed copy counts as oldest, so legacy installs are brought under management on first run.
 * Unmanaged defaults (no stamp) are left to init's copy-if-missing (deployHooks/safeCopy) and are
 * never touched here. Idempotent and crash-safe via atomicWrite.
 *
 * `opts` exists for tests; production calls it with no args (real DEFAULTS_DIR/HOOKS_DIR).
 * Returns the list of hook filenames that were updated.
 */
export async function syncManagedHooks(opts: { srcDir?: string; dstDir?: string } = {}): Promise<string[]> {
  const srcDir = opts.srcDir ?? path.join(DEFAULTS_DIR, 'hooks');
  const dstDir = opts.dstDir ?? HOOKS_DIR;

  if (!existsSync(srcDir)) return [];

  let files: string[];
  try {
    files = await fs.readdir(srcDir);
  } catch {
    return [];
  }

  await fs.mkdir(dstDir, { recursive: true });

  const updated: string[] = [];
  for (const file of files) {
    if (!file.endsWith('.mjs')) continue;

    let srcContent: string;
    try {
      srcContent = await fs.readFile(path.join(srcDir, file), 'utf8');
    } catch {
      continue;
    }

    const srcVer = parseHookVersion(srcContent);
    if (!srcVer) continue; // unmanaged default → leave to init's copy-if-missing

    const dstPath = path.join(dstDir, file);
    if (existsSync(dstPath)) {
      let dstVer: string | null = null;
      try {
        dstVer = parseHookVersion(await fs.readFile(dstPath, 'utf8'));
      } catch {
        dstVer = null;
      }
      // Deployed copy already at or ahead of the shipped version → current; skip.
      // An unstamped deployed copy (dstVer === null) counts as oldest → refresh it.
      if (dstVer && compareCalVer(dstVer, srcVer) >= 0) continue;
    }

    try {
      await atomicWrite(dstPath, srcContent);
      updated.push(file);
      log.info(`synced hook ${file} → ${srcVer}`);
    } catch (e) {
      log.error(`failed to sync hook ${file}: ${(e as Error).message}`);
    }
  }

  if (updated.length === 0) {
    log.info('managed hooks up to date');
  }
  return updated;
}
