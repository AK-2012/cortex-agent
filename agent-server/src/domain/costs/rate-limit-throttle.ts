// input:  rate_limit_event + persistence + slack client
// output: init/handleRateLimitEvent/isThrottled/isModeRateLimited/getThrottleState
// pos:    Pure state tracker — no scheduler coupling. Mode-level rate limit tracking.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { PlatformAdapter } from '@platform/index.js';
import { createLogger } from '@core/log.js';

const log = createLogger('rate-limit-throttle');

const UTILIZATION_THRESHOLD = 0.90;
const RESUME_BUFFER_MS = 5_000;

// --- Module state ---
let _adapter: PlatformAdapter | null = null;
let _persistence: ThrottlePersistence | null = null;
let _isThrottled = false;
let _resetsAt: number | null = null; // Unix seconds
let _resumeTimer: ReturnType<typeof setTimeout> | null = null;
const _rateLimitedModes = new Set<string>();

// --- Types ---
export interface ThrottlePersistence {
  save: (state: { resetsAt: number; activatedAt: number; modes: string[] } | null) => Promise<void>;
  load: () => Promise<{ resetsAt: number; activatedAt: number; modes?: string[] } | null>;
}

// --- Logging (handled by createLogger) ---

// --- Admin DM (fire-and-forget) ---
function sendDM(text: string) {
  if (!_adapter) return;
  _adapter.postMessage({ type: 'system-notice' }, { text }).catch(e => {
    log.error(`DM failed: ${(e as Error).message}`);
  });
}

function formatResetTime(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleString('en-GB', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

// --- Timer ---
function clearThrottle(): void {
  _isThrottled = false;
  _resetsAt = null;
  _rateLimitedModes.clear();
  _resumeTimer = null;
  sendDM(':white_check_mark: Rate limit throttle cleared.');
  _persistence?.save(null).catch(e => {
    log.error(`Failed to persist cleared throttle: ${(e as Error).message}`);
  });
}

function scheduleResumeTimer(): void {
  if (_resumeTimer) clearTimeout(_resumeTimer);
  const delayMs = Math.max(0, (_resetsAt! * 1000) - Date.now()) + RESUME_BUFFER_MS;
  log.info(`Resume scheduled in ${(delayMs / 1000 / 60).toFixed(1)} min`);
  _resumeTimer = setTimeout(() => {
    clearThrottle();
  }, delayMs);
}

// --- Public API ---

async function initRateLimitThrottle(adapter: PlatformAdapter, persistence: ThrottlePersistence): Promise<void> {
  _adapter = adapter;
  _persistence = persistence;

  // Recover throttle state from disk (survives restart)
  const persisted = await persistence.load();
  if (persisted) {
    const now = Date.now();
    if (persisted.resetsAt * 1000 + RESUME_BUFFER_MS > now) {
      _isThrottled = true;
      _resetsAt = persisted.resetsAt;
      if (persisted.modes) {
        for (const m of persisted.modes) _rateLimitedModes.add(m);
      }
      log.info(`Restored throttle from disk: ${persisted.modes?.length ?? 0} mode(s) rate-limited, resetsAt=${new Date(_resetsAt * 1000).toISOString()}`);
      scheduleResumeTimer();
    } else {
      log.info(`Throttle expired during downtime (resetsAt was ${new Date(persisted.resetsAt * 1000).toISOString()}). Clearing.`);
      await persistence.save(null);
    }
  }

  log.info('Initialized');
}

interface RateLimitInfo {
  status?: string;
  resetsAt?: number;
  rateLimitType?: string;
  utilization?: number;
  isUsingOverage?: boolean;
  surpassedThreshold?: number;
}

async function handleRateLimitEvent(info: RateLimitInfo, mode?: string): Promise<void> {
  if (!info || !_persistence) return;
  if (info.rateLimitType !== 'five_hour') return;
  if (typeof info.utilization !== 'number' || info.utilization < UTILIZATION_THRESHOLD) return;
  if (!info.resetsAt) return;

  if (_isThrottled) {
    if (info.resetsAt > (_resetsAt || 0)) {
      log.info(`Extending throttle: resetsAt ${_resetsAt} → ${info.resetsAt}`);
      _resetsAt = info.resetsAt;
      if (mode) _rateLimitedModes.add(mode);
      await _persistence.save({ resetsAt: _resetsAt, activatedAt: Date.now(), modes: [..._rateLimitedModes] });
      scheduleResumeTimer();
    }
    return;
  }

  _isThrottled = true;
  _resetsAt = info.resetsAt;
  if (mode) _rateLimitedModes.add(mode);
  log.info(`Throttle activated: utilization=${info.utilization}, resetsAt=${new Date(_resetsAt * 1000).toISOString()}, mode=${mode ?? '(none)'}`);

  scheduleResumeTimer();
  await _persistence.save({ resetsAt: _resetsAt, activatedAt: Date.now(), modes: [..._rateLimitedModes] });

  const resetStr = formatResetTime(_resetsAt);
  const modeNote = mode ? ` (mode: ${mode})` : '';
  sendDM(`:warning: Rate limit throttle activated — utilization ${(info.utilization * 100).toFixed(0)}%${modeNote}.\nAuto-resume at ${resetStr}.`);
}

function isThrottled(): boolean {
  return _isThrottled;
}

function isModeRateLimited(mode: string): boolean {
  return _isThrottled && _rateLimitedModes.has(mode);
}

function getThrottleState(): { isThrottled: boolean; resetsAt: number | null; rateLimitedModes: string[] } {
  return { isThrottled: _isThrottled, resetsAt: _resetsAt, rateLimitedModes: [..._rateLimitedModes] };
}

// --- Test helpers ---
function _testReset(): void {
  if (_resumeTimer) clearTimeout(_resumeTimer);
  _isThrottled = false;
  _resetsAt = null;
  _resumeTimer = null;
  _rateLimitedModes.clear();
  _adapter = null;
  _persistence = null;
}

export { initRateLimitThrottle, handleRateLimitEvent, isThrottled, isModeRateLimited, getThrottleState, _testReset };
