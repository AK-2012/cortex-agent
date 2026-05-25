// input:  machines.json config (hot-reloadable)
// output: getMachineRegistry + task ID generators
// pos:    device registry and task ID generation utilities
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as crypto from 'crypto';
import { readFileSync, watch, existsSync, type FSWatcher } from 'fs';
import * as path from 'path';
import { CONFIG_DIR } from '@core/utils.js';
import { createLogger } from '@core/log.js';
import { Icons } from '../../core/icons.js';

const log = createLogger('machine-registry');

// --- Machine Registry ---

export interface MachineEntry {
  cortexPath: string;
  gpuCount: number;
  ssh?: string;
  win?: boolean;
}

export type MachineRegistry = Record<string, MachineEntry>;

const MACHINES_FILE = path.join(CONFIG_DIR, 'machines.json');

let _registry: MachineRegistry = {};
let _loaded = false;
let _watcher: FSWatcher | null = null;
let _reloadTimer: ReturnType<typeof setTimeout> | null = null;

// --- Admin notification (hot-reload → Slack) ---
let _adminNotifier: ((text: string) => void) | null = null;
export function setAdminNotifier(fn: (text: string) => void): void { _adminNotifier = fn; }

/**
 * Load machines.json from disk into memory.
 * On first call (startup), throws if file is missing or malformed.
 * On subsequent calls (hot-reload), logs errors and keeps old config.
 */
function loadMachinesFromFile(failOnError = true): void {
  try {
    const raw = readFileSync(MACHINES_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as MachineRegistry;

    // Basic validation: ensure every entry has cortexPath and gpuCount
    for (const [name, entry] of Object.entries(parsed)) {
      if (typeof entry.cortexPath !== 'string' || typeof entry.gpuCount !== 'number') {
        throw new Error(`Invalid machine entry "${name}": requires cortexPath (string) and gpuCount (number)`);
      }
    }

    const oldKeys = Object.keys(_registry).sort().join(',');
    const newKeys = Object.keys(parsed).sort().join(',');
    const isReload = _loaded;
    _registry = parsed;
    _loaded = true;

    if (isReload) {
      if (oldKeys !== newKeys) {
        log.info(`Hot-reload: machines changed [${oldKeys}] → [${newKeys}]`);
        _adminNotifier?.(`${Icons.refresh} \`machines.json\` hot-reloaded: [${oldKeys}] → [${newKeys}]`);
      } else {
        log.info(`Hot-reload: ${Object.keys(parsed).length} machines reloaded`);
        _adminNotifier?.(`${Icons.refresh} \`machines.json\` hot-reloaded (${Object.keys(parsed).length} machines)`);
      }
    } else {
      log.info(`Loaded ${Object.keys(parsed).length} machines: ${Object.keys(parsed).join(', ')}`);
    }
  } catch (e) {
    const msg = `[machine-registry] Failed to load ${MACHINES_FILE}: ${(e as Error).message}`;
    if (failOnError) {
      throw new Error(msg);
    }
    log.error(msg + ' — keeping previous config');
    _adminNotifier?.(`${Icons.warning} \`machines.json\` hot-reload FAILED — keeping previous config`);
  }
}

/**
 * Return the current in-memory machine registry.
 */
function getMachineRegistry(): MachineRegistry {
  return _registry;
}

/**
 * Return the first machine key in the registry as the local/default machine.
 * Falls back to 'local' if no machines are registered.
 */
function getLocalMachine(): string {
  return Object.keys(_registry)[0] || 'local';
}

/**
 * Start watching machines.json for changes. Reloads on file edit.
 * Handles atomic file replacement (rename event) by re-creating the watcher.
 */
function startMachineRegistryWatcher(): void {
  if (!existsSync(MACHINES_FILE)) return;

  const setup = () => {
    try {
      if (_watcher) _watcher.close();
      _watcher = watch(MACHINES_FILE, (eventType) => {
        if (eventType === 'rename') {
          // File was atomically replaced — inode changed, watcher is dead.
          // Re-create after a short delay to let the new file settle.
          setTimeout(() => setup(), 100);
          return; // setup() will handle the reload after the new watcher fires
        }
        if (_reloadTimer) clearTimeout(_reloadTimer);
        _reloadTimer = setTimeout(() => {
          _reloadTimer = null;
          loadMachinesFromFile(false); // hot-reload: don't crash on error
        }, 300);
      });
    } catch (e) {
      log.error(`Failed to watch machines.json: ${(e as Error).message}`);
    }
  };
  setup();
}

/**
 * Stop watching machines.json (for tests / graceful shutdown).
 */
function stopMachineRegistryWatcher(): void {
  if (_watcher) {
    _watcher.close();
    _watcher = null;
  }
  if (_reloadTimer) {
    clearTimeout(_reloadTimer);
    _reloadTimer = null;
  }
}

// --- Auto-load at import time (equivalent to the old hardcoded constant) ---
// This ensures getMachineRegistry() works immediately for all consumers.
// app.ts also calls loadMachinesFromFile() explicitly + starts the watcher.
if (existsSync(MACHINES_FILE)) {
  try {
    loadMachinesFromFile();
  } catch (e) {
    log.error(`Auto-load failed: ${(e as Error).message}`);
  }
}

// --- Task ID utilities ---

function generateTaskId() {
  return crypto.randomBytes(2).toString('hex');
}

function buildDispatchSessionName(taskId) {
  return `task-dispatch-${taskId}`;
}

/** Test-only: directly set the in-memory machine registry. */
function _testSetRegistry(registry: MachineRegistry): void {
  _registry = { ...registry };
  _loaded = true;
}

export {
  getMachineRegistry,
  getLocalMachine,
  loadMachinesFromFile,
  startMachineRegistryWatcher,
  stopMachineRegistryWatcher,
  generateTaskId,
  buildDispatchSessionName,
  _testSetRegistry,
};
