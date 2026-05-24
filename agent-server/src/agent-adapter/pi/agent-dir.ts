// input:  DATA_DIR
// output: PI_AGENT_DIR / PI_SESSIONS_DIR / PI_MODELS_PATH constants
//         + writeProvidersConfig (multi-provider models.json override)
//         + ensureAuthVisible (symlink user's ~/.pi/agent/auth.json into PI_AGENT_DIR
//           so the PI subprocess can resolve OAuth/API key credentials)
//         + ensurePIAgentDirs
// pos:    PI agent directory management; models.json is written exclusively by PI adapter spawn
// layout: data/pi/models.json  data/pi/auth.json (symlink)  logs/sessions-pi/
//         PI_CODING_AGENT_DIR → DATA_DIR/data/pi (PI reads models.json + auth.json from here)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import {
  mkdirSync,
  writeFileSync,
  renameSync,
  existsSync,
  lstatSync,
  readlinkSync,
  unlinkSync,
  symlinkSync,
  copyFileSync,
} from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DATA_DIR } from '@core/utils.js';
import { createLogger } from '@core/log.js';

const log = createLogger('pi-agent-dir');

/** PI_CODING_AGENT_DIR: PI reads models.json, auth.json from this dir. */
export const PI_AGENT_DIR = path.join(DATA_DIR, 'data', 'pi');
export const PI_SESSIONS_DIR = path.join(DATA_DIR, 'logs', 'sessions-pi');
export const PI_MODELS_PATH = path.join(PI_AGENT_DIR, 'models.json');

/** Default location of the user's PI OAuth/API-key credentials. */
const USER_PI_AUTH_PATH = path.join(os.homedir(), '.pi', 'agent', 'auth.json');

// ─── Multi-provider models.json ───────────────────────────────────

/**
 * One provider entry to write into the cortex-controlled `models.json`. cortex uses PI's
 * "Override Built-in Providers" mechanism (docs/models.md §Overriding Built-in Providers):
 * specifying only `baseUrl` redirects all of that provider's traffic to our gateway while
 * keeping PI's built-in model catalog and OAuth/API-key auth resolution from auth.json intact.
 */
export interface ProviderOverride {
  /** PI provider name (e.g. "anthropic", "deepseek", "openai-codex"). */
  name: string;
  /**
   * Path segment appended to the gateway URL. Defaults to `/${name}`.
   * Set explicitly when a provider needs to land on a non-standard gateway path
   * (e.g. deepseek's anthropic-compat endpoint: `/deepseek/anthropic`).
   */
  basePath?: string;
}

export interface WriteProvidersOpts {
  /** Override target file path. Defaults to PI_MODELS_PATH. */
  modelsPath?: string;
}

/**
 * Atomic-write models.json with multi-provider baseUrl overrides. Each provider entry has a
 * `baseUrl` pointing to `<gatewayUrl><basePath>`; no apiKey is written so PI resolves credentials
 * from auth.json (or environment variables) per PI's auth resolution order.
 *
 * Called by PIAdapter.spawn() — sole writer of this file, no other code path touches it.
 */
export function writeProvidersConfig(
  providers: ProviderOverride[],
  gatewayUrl: string,
  opts?: WriteProvidersOpts,
): void {
  const targetPath = opts?.modelsPath ?? PI_MODELS_PATH;

  const providersBlock: Record<string, { baseUrl: string }> = {};
  for (const p of providers) {
    const basePath = p.basePath ?? `/${p.name}`;
    providersBlock[p.name] = { baseUrl: `${gatewayUrl}${basePath}` };
  }

  const data = { providers: providersBlock };
  const content = JSON.stringify(data, null, 2) + '\n';

  mkdirSync(path.dirname(targetPath), { recursive: true });

  // Atomic write: tmp + rename
  const tmp = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, targetPath);
  } catch (err) {
    // Best-effort cleanup of orphan tmp file (rename failure case)
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

// ─── auth.json visibility (symlink / copy from user PI dir) ──────

export interface EnsureAuthVisibleOpts {
  /** Source: where the user's PI auth.json lives. Defaults to ~/.pi/agent/auth.json. */
  userAuthPath?: string;
  /** Target dir (PI_CODING_AGENT_DIR). Defaults to PI_AGENT_DIR. */
  agentDir?: string;
}

/**
 * Make the user's PI OAuth/API-key credentials visible to the PI subprocess running under
 * cortex's PI_CODING_AGENT_DIR. Uses symlink on Linux/macOS so PI's automatic OAuth refresh
 * writes back to the user's canonical location. Falls back to file copy on Windows.
 *
 * Idempotent: a correctly-pointed symlink is preserved; a stale file/symlink is replaced.
 * Silently no-ops when the user has not logged into PI (no source auth.json).
 */
export function ensureAuthVisible(opts?: EnsureAuthVisibleOpts): void {
  const userAuth = opts?.userAuthPath ?? USER_PI_AUTH_PATH;
  const agentDir = opts?.agentDir ?? PI_AGENT_DIR;
  const cortexAuth = path.join(agentDir, 'auth.json');

  if (!existsSync(userAuth)) {
    // User hasn't logged into PI; nothing to mirror.
    return;
  }

  mkdirSync(agentDir, { recursive: true });

  // Inspect the destination — preserve correct symlink, replace anything else.
  if (existsSync(cortexAuth) || isBrokenSymlink(cortexAuth)) {
    try {
      const stat = lstatSync(cortexAuth);
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(cortexAuth);
        if (target === userAuth && process.platform !== 'win32') {
          // Already a correctly-pointing symlink, nothing to do.
          return;
        }
      }
      unlinkSync(cortexAuth);
    } catch (err) {
      log.warn(`Failed to inspect/remove existing ${cortexAuth}: ${(err as Error).message}`);
      return;
    }
  }

  if (process.platform === 'win32') {
    // Windows: symlink requires elevated permissions on many systems; copy instead.
    // KNOWN LIMITATION: PI's OAuth refresh writes to the cortex-private copy, not the user's
    // original file. Re-running ensureAuthVisible would overwrite the refreshed token. See
    // /home/fangxin/.cortex/plan/generic-wibbling-pine.md §D4 for Windows-specific TODO.
    copyFileSync(userAuth, cortexAuth);
  } else {
    symlinkSync(userAuth, cortexAuth);
  }
}

/** Returns true if `p` is a dangling symlink (exists in lstat sense but not in stat sense). */
function isBrokenSymlink(p: string): boolean {
  try {
    const lst = lstatSync(p);
    if (!lst.isSymbolicLink()) return false;
    // existsSync follows links; if it returned false we already know the link is broken.
    return !existsSync(p);
  } catch {
    return false;
  }
}

// ─── Directory bootstrap ──────────────────────────────────────────

export function ensurePIAgentDirs(): void {
  mkdirSync(PI_AGENT_DIR, { recursive: true });
  mkdirSync(PI_SESSIONS_DIR, { recursive: true });
}
