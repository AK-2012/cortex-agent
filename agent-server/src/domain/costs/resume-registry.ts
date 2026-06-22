// input:  persistence (load/save) + recordResume calls from interruption points
// output: init/recordResume/takeAllResumes/getResumeCount — pending resume bookkeeping
// pos:    Pure state tracker for sessions/threads interrupted by a rate limit. No
//         orchestration/scheduler coupling — the resume *dispatch* lives in orchestration.
//         Mirrors rate-limit-throttle.ts purity & injected-persistence shape.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { createLogger } from '@core/log.js';

const log = createLogger('resume-registry');

// --- Types ---

/** One unit of work that was interrupted by a rate limit and should be resumed
 *  once the limit window resets. `direct` = an interactive conversation (resumed by
 *  re-routing a message into the channel's pooled session); `thread` = a thread
 *  pipeline (resumed via continueThread). */
export type ResumeEntry =
  | { kind: 'direct'; channel: string; userMessage: string; recordedAt: number }
  | { kind: 'thread'; threadId: string; channel: string; userMessage: string; recordedAt: number };

export interface ResumePersistence {
  save: (entries: ResumeEntry[]) => Promise<void>;
  load: () => Promise<ResumeEntry[]>;
}

// --- Module state ---
let _persistence: ResumePersistence | null = null;
// Direct conversations dedupe by channel (pooled per channel — only the latest turn matters).
const _direct = new Map<string, ResumeEntry>();
// Threads dedupe by threadId (each thread is an independent resumable unit).
const _threads = new Map<string, ResumeEntry>();

function snapshot(): ResumeEntry[] {
  return [..._direct.values(), ..._threads.values()];
}

function persist(): void {
  _persistence?.save(snapshot()).catch(e => {
    log.error(`Failed to persist resume queue: ${(e as Error).message}`);
  });
}

// --- Public API ---

async function initResumeRegistry(persistence: ResumePersistence): Promise<void> {
  _persistence = persistence;
  try {
    const persisted = await persistence.load();
    for (const entry of persisted ?? []) {
      if (entry.kind === 'direct') _direct.set(entry.channel, entry);
      else if (entry.kind === 'thread') _threads.set(entry.threadId, entry);
    }
    log.info(`Initialized — ${_direct.size + _threads.size} pending resume(s) restored`);
  } catch (e) {
    log.error(`Failed to load resume queue: ${(e as Error).message}`);
  }
}

/** Record an interrupted session/thread for later resume. Idempotent per key
 *  (direct→channel, thread→threadId): a newer record overwrites the older one. */
function recordResume(entry: ResumeEntry): void {
  if (entry.kind === 'direct') _direct.set(entry.channel, entry);
  else if (entry.kind === 'thread') _threads.set(entry.threadId, entry);
  persist();
}

/** Drain the registry: return all pending entries and clear (persists the empty list).
 *  "take + clear" is atomic so each entry is dispatched at most once. */
function takeAllResumes(): ResumeEntry[] {
  const all = snapshot();
  _direct.clear();
  _threads.clear();
  if (all.length > 0) persist();
  return all;
}

function getResumeCount(): number {
  return _direct.size + _threads.size;
}

// --- Test helpers ---
function _testReset(): void {
  _direct.clear();
  _threads.clear();
  _persistence = null;
}

export { initResumeRegistry, recordResume, takeAllResumes, getResumeCount, _testReset };
