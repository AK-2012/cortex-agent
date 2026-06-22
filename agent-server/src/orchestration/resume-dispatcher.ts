// input:  rate-limit-throttle onResume → resume-registry (takeAllResumes) + agentRunner / resumeRateLimitedThread
// output: dispatchPendingResumes — wakes sessions/threads interrupted by a rate limit
// pos:    orch/ — runs when the rate-limit window resets (or on startup if the queue has orphans
//         and no throttle is active). Direct sessions are re-entered with a <system-reminder> and
//         serialized per channel; threads (status 'rate_limited') are re-run from the interrupted
//         step via resumeRateLimitedThread, fired concurrently (channel-parallel-safe) and only
//         skipped if a live direct session holds the channel. Options rebuilt by buildResumeOptions
//         (dispatch onEnd hook + destination). All deps injectable for tests.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { PlatformAdapter, IncomingMessage } from '@platform/index.js';
import type { ThreadRecord, RunThreadOptions } from '@core/types/thread-types.js';
import { takeAllResumes, type ResumeEntry } from '@domain/costs/resume-registry.js';
import { agentRunner } from './agent-runner.js';
import { resumeRateLimitedThread } from '@domain/threads/runner.js';
import { buildResumeOptions } from './thread-callback.js';
import { threadStore } from '@store/thread-repo.js';
import { runningExecutions } from '@core/running-executions.js';
import { createLogger } from '@core/log.js';

const log = createLogger('resume-dispatcher');

/** Entries older than this are considered obsolete (user moved on / thread finished).
 *  6h = the 5-hour window plus restart slack. */
const MAX_RESUME_AGE_MS = 6 * 60 * 60 * 1000;
/** Gap between consecutive resumes so we don't instantly re-trip the limit. */
const RESUME_STAGGER_MS = 3_000;

/** Auto-resume is on by default; disable with CORTEX_AUTO_RESUME=0 (or "false"). */
export function isAutoResumeEnabled(): boolean {
  const v = process.env.CORTEX_AUTO_RESUME;
  return v !== '0' && v !== 'false';
}

/** The continuation prompt injected into a resumed session/thread. Self-contained — the
 *  prior turn's content is already in the resumed session/thread history. */
export function buildResumeReminder(): string {
  return [
    '<system-reminder>',
    '上一轮因命中 API 限流(五小时窗口)被中断。该窗口现已重置,你可以继续。',
    '请从中断处接着做:回顾上方最近的对话上下文,判断还有什么没完成并完成它。',
    '不要从头重启任务、也不要重复询问用户已提供的信息。若上一轮其实已经完成,简短确认后停止。',
    '本条消息仅为恢复信号,不应改变你原本的任务。',
    '</system-reminder>',
  ].join('\n');
}

export interface ResumeDeps {
  takeAll: () => ResumeEntry[];
  route: (ctx: Parameters<typeof agentRunner.route>[0]) => Promise<void>;
  resumeThread: (threadId: string, opts: RunThreadOptions) => Promise<unknown>;
  buildResumeOptions: (thread: ThreadRecord) => RunThreadOptions | null;
  getThread: (threadId: string) => ThreadRecord | null;
  channelBusy: (channel: string) => boolean;
  /** True if a DIRECT (interactive) session is live on the channel — i.e. an execution with no
   *  threadId. Only direct sessions force a channel to serialize (a Slack conversation cannot
   *  interleave two assistant turns). Threads are channel-parallel-safe, so a rate-limited thread
   *  only needs to avoid a live direct session, not other threads. */
  directSessionBusy: (channel: string) => boolean;
  now: () => number;
  delay: (ms: number) => Promise<void>;
}

function defaultDeps(): ResumeDeps {
  return {
    takeAll: takeAllResumes,
    route: (ctx) => agentRunner.route(ctx),
    resumeThread: (id, opts) => resumeRateLimitedThread(id, opts),
    buildResumeOptions: (thread) => buildResumeOptions(thread),
    getThread: (id) => threadStore.get(id),
    channelBusy: (ch) => runningExecutions.hasChannel(ch),
    directSessionBusy: (ch) => runningExecutions.getByChannel(ch).some(e => !e.threadId),
    now: () => Date.now(),
    delay: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

function entryKey(e: ResumeEntry): string {
  return e.kind === 'thread' ? `thread ${e.threadId}` : `direct ${e.channel}`;
}

/** Drain the resume registry and re-enter each interrupted target. Called by the
 *  rate-limit-throttle onResume hook when the window resets. Never throws. */
export async function dispatchPendingResumes(adapter: PlatformAdapter, overrides: Partial<ResumeDeps> = {}): Promise<void> {
  const deps = { ...defaultDeps(), ...overrides };

  if (!isAutoResumeEnabled()) {
    const drained = deps.takeAll(); // drain so stale entries don't pile up across windows
    if (drained.length > 0) log.info(`Auto-resume disabled — dropped ${drained.length} pending entry(ies)`);
    return;
  }

  const entries = deps.takeAll();
  if (entries.length === 0) return;
  log.info(`Rate-limit window reset — resuming ${entries.length} interrupted target(s)`);

  let dispatched = 0;
  for (const entry of entries) {
    const skip = guardSkipReason(entry, deps);
    if (skip) { log.info(`Resume skip (${entryKey(entry)}): ${skip}`); continue; }
    try {
      if (dispatched > 0) await deps.delay(RESUME_STAGGER_MS); // stagger START times, not completion
      if (entry.kind === 'direct') {
        // Direct sessions are serial per channel — await so the next dispatch sees it as busy.
        await resumeDirect(entry, adapter, deps);
      } else {
        // Threads are channel-parallel-safe: fire-and-forget so multiple rate-limited threads on
        // the same channel resume concurrently instead of serializing behind the first one.
        void resumeThread(entry, deps.getThread(entry.threadId)!, adapter, deps)
          .catch(e => log.error(`Resume failed (${entryKey(entry)}): ${(e as Error).message}`));
      }
      dispatched++;
    } catch (e) {
      log.error(`Resume failed (${entryKey(entry)}): ${(e as Error).message}`);
    }
  }
  log.info(`Resume complete — dispatched ${dispatched}/${entries.length}`);
}

/** Returns a human reason to skip, or null to proceed. */
function guardSkipReason(entry: ResumeEntry, deps: ResumeDeps): string | null {
  if (deps.now() - entry.recordedAt > MAX_RESUME_AGE_MS) return 'stale';
  if (entry.kind === 'direct') {
    // A direct session is a live conversation — serialize per channel (no interleaved turns).
    if (deps.channelBusy(entry.channel)) return 'channel already has a running execution';
    return null;
  }
  // Thread: channel-parallel-safe. Only avoid a live direct session (interactive turn) on the
  // channel; concurrent threads on the same channel are fine and must not skip each other.
  if (deps.directSessionBusy(entry.channel)) return 'direct session active on channel';
  const thread = deps.getThread(entry.threadId);
  if (!thread) return 'thread no longer exists';
  if (thread.status !== 'rate_limited') return `thread is ${thread.status}`;
  return null;
}

async function resumeDirect(entry: Extract<ResumeEntry, { kind: 'direct' }>, adapter: PlatformAdapter, deps: ResumeDeps): Promise<void> {
  const notice = buildResumeReminder();
  const message: IncomingMessage = {
    ref: { conduit: entry.channel, messageId: `resume_${Date.now()}` },
    text: notice,
    senderId: 'cortex-rate-limit-resume',
    isBot: false,
    kind: 'user',
    raw: { source: 'rate-limit-resume', originalMessage: entry.userMessage },
  };
  log.info(`Resuming direct session on ${entry.channel}`);
  await deps.route({ message, channel: entry.channel, adapter, threadAnchorId: null, hasFiles: false, userMessage: notice, agentMessage: notice });
}

async function resumeThread(entry: Extract<ResumeEntry, { kind: 'thread' }>, thread: ThreadRecord, _adapter: PlatformAdapter, deps: ResumeDeps): Promise<void> {
  // Rebuild RunThreadOptions (destination + dispatch task-status-check onEnd hook) from the
  // thread's persisted metadata — same machinery DR-0014 uses to re-enter suspended parents.
  // Unlike a direct session, a thread re-runs its interrupted step from the original prompt, so
  // no <system-reminder> / userMessage overwrite is injected.
  const opts = deps.buildResumeOptions(thread);
  if (!opts) {
    log.error(`Resume skip (thread ${entry.threadId}): could not rebuild run options (no adapter?)`);
    return;
  }
  log.info(`Resuming thread ${entry.threadId} on ${entry.channel}`);
  await deps.resumeThread(entry.threadId, opts);
}
