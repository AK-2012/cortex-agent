// input:  terminal thread record (threadStore), interactive runner, outbound queue, live adapter
// output: fireThreadCallback / notifyThreadParent / recoverWaitingThreads / buildChildResultNotice
// pos:    completion callback for MCP thread_start; closes the loop when a spawned thread finishes.
//         DR-0014: thread-parent children deliver results into the parent's pendingMessages and
//         resume the suspended parent when its last awaited child turns terminal.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { threadStore } from '@store/thread-repo.js';
import { agentRunner } from './agent-runner.js';
import { getOutboundQueue, durablePost } from '@store/outbound-queue.js';
import { ctx as jobCtx } from '@domain/scheduling/job-registry.js';
import { resumeThread } from '@domain/threads/runner.js';
import { isTerminalStatus } from '@domain/threads/tree.js';
import { runThreadDetached } from './thread-executor.js';
import { createLogger } from '@core/log.js';
import { scanAllTasks, type Task } from '@core/task-parser.js';
import type { ThreadRecord, RunThreadOptions } from '@core/types/thread-types.js';
import type { IncomingMessage, Destination } from '@platform/index.js';

const log = createLogger('thread-callback');

// Single-fire guard for the interactive-parent wake path (in-memory; resets on restart —
// acceptable there because waking a chat session twice is merely noisy). The thread-parent
// path does NOT use this set: its idempotency is persistent, via metadata.deliveredChildResults.
const fired = new Set<string>();
// Parents with a resume already in flight (guards the gap between scheduling the detached
// resume and resumeThread flipping status to 'running').
const resuming = new Set<string>();

/** Test hook: clear in-memory dedup state to simulate a server restart. */
export function _testResetCallbackState(): void {
  fired.clear();
  resuming.clear();
}

/** Compose a short, agent-actionable completion notice from the final thread record. */
function buildNotice(threadId: string): string {
  const t = threadStore.get(threadId)!;
  const cost = `$${(t.totalCostUsd || 0).toFixed(4)}`;
  const last = t.steps.length ? t.steps[t.steps.length - 1].output : null;
  const tail = t.abortReason || t.error || last || '(无输出)';
  const summary = tail.length > 200 ? tail.slice(0, 200) + '…' : tail;
  const label = t.templateName || t.activeAgent || 'thread';
  return `[后台线程完成] 你启动的线程 ${threadId} (${label}) 状态=${t.status} | ${cost}\n摘要: ${summary}\n调用 thread_result("${threadId}") 查看完整产出。`;
}

/** Child-result notice delivered into a suspended parent's pendingMessages. Echoes the
 *  delegation contract and demands acceptance verification before the result is trusted
 *  (DR-0014 L1 纠偏: verify the deliverable, never the child's self-report). */
export function buildChildResultNotice(child: ThreadRecord): string {
  const cost = `$${(child.totalCostUsd || 0).toFixed(4)}`;
  const label = child.templateName || child.activeAgent || 'thread';
  const contract = child.metadata?.contract;
  const parent = child.metadata?.parentThreadId ? threadStore.get(child.metadata.parentThreadId) : null;
  const childCount = parent?.metadata?.childThreadIds?.length ?? 0;
  const maxChildren = parseInt(process.env.CORTEX_THREAD_MAX_CHILDREN || '8', 10) || 8;

  const lines = [
    `[子线程完成] ${child.id} (${label}) 状态=${child.status} | ${cost}`,
  ];
  if (child.abortReason) lines.push(`子线程升级/中止原因: ${child.abortReason}`);
  if (child.error) lines.push(`子线程错误: ${child.error}`);
  if (contract) {
    lines.push(`契约: ${contract.goal}`);
    if (contract.doneWhen) lines.push(`Done when: ${contract.doneWhen}`);
    if (contract.deliverablePath) lines.push(`Deliverable: ${contract.deliverablePath}`);
  }
  lines.push(`完整产出: thread_result("${child.id}")${child.artifactPath ? `；artifact: ${child.artifactPath}` : ''}`);
  lines.push('');
  lines.push('验收要求（必须执行，不得凭子线程的汇报文本直接采信）:');
  lines.push('1. 读取 deliverable 实物，逐条核对 done_when；涉及代码的跑测试验证。');
  lines.push('2. 达标 → 蒸馏关键结论进你的 artifact，继续你的计划。');
  lines.push('3. 未达标 → 写出 expected/actual 差异与失败假设，用修订后的契约重新 thread_start' +
    `（你已使用 ${childCount}/${maxChildren} 个子线程额度；额度耗尽时 thread_start 会被拒绝）。`);
  lines.push('4. 无法判断或方向性问题 → 在 artifact 写 [ABORT: <诊断>] 升级到你的上层。');
  return lines.join('\n');
}

/** Durable degraded-path notice to the project-report channel. */
async function postProjectNotice(t: ThreadRecord, text: string): Promise<void> {
  const adapter = jobCtx.adapter;
  if (!adapter) { log.error(`no adapter; cannot post notice for ${t.id}`); return; }
  const dest: Destination = { type: 'project-report', projectId: t.projectId, trigger: 'mcp-thread', sessionId: '' };
  const queue = getOutboundQueue();
  if (queue) {
    await durablePost(queue, adapter, dest, { text });
  } else {
    await adapter.postMessage(dest, { text });
  }
}

/** Rebuild RunThreadOptions for re-entering a suspended parent. extraHooks are not
 *  persisted on ThreadRecord, so the dispatch task-status-check hook is reconstructed
 *  from metadata.taskId/taskProject (the reason dispatch threads must store them). */
function buildResumeOptions(parent: ThreadRecord): RunThreadOptions | null {
  const adapter = jobCtx.adapter;
  if (!adapter) return null;
  const m = parent.metadata;
  const dest: Destination = m?.resumeDest === 'interactive-reply'
    ? { type: 'interactive-reply', conduit: parent.channel, sessionId: '' }
    : { type: 'project-report', projectId: parent.projectId, trigger: m?.trigger || 'mcp-thread', sessionId: '' };
  const extraHooks = (m?.trigger === 'task-dispatch' && m?.taskId)
    ? { onEnd: { command: 'node hooks/task-status-check.mjs', args: [m.taskProject || parent.projectId, m.taskId], timeout: 10000 } }
    : undefined;
  return {
    adapter,
    channel: parent.channel,
    destination: dest,
    threadAnchorId: parent.platformThreadId ?? null,
    statusMsg: null,
    startTime: Date.now(),
    onProgress: null,
    onToolUse: null,
    extraHooks,
  };
}

export type ResumeFn = (parentThreadId: string) => void;

const defaultResume: ResumeFn = (parentId) => {
  const parent = threadStore.get(parentId);
  if (!parent) { resuming.delete(parentId); return; }
  const opts = buildResumeOptions(parent);
  if (!opts) {
    resuming.delete(parentId);
    log.error(`cannot resume suspended parent ${parentId}: no adapter`);
    return;
  }
  log.info(`resuming suspended parent ${parentId} (all awaited children terminal)`);
  runThreadDetached(parentId, opts, {
    run: (tid, o) => resumeThread(tid, o),
    onSettled: async (tid) => {
      resuming.delete(tid);
      // Cascade: when the resumed parent itself terminates (or suspends again and later
      // terminates), its own parent gets notified through the same callback chain.
      await fireThreadCallback(tid).catch((e) => log.error(`cascade callback ${tid}: ${(e as Error).message}`));
    },
  });
};

/** Resume `parentId` if (and only if) it is suspended with nothing left to wait on —
 *  both thread children (waitingOn) and task children (waitingOnTasks, DR-0014 §8). */
function maybeResumeParent(parentId: string, resume?: ResumeFn): void {
  if (resuming.has(parentId)) return;
  const parent = threadStore.get(parentId);
  if (!parent || parent.status !== 'waiting') return;
  if (parent.metadata?.waitingOn?.length) return;
  if (parent.metadata?.waitingOnTasks?.length) return;
  resuming.add(parentId);
  (resume ?? defaultResume)(parentId);
}

/** Deliver a terminal child's result to its thread parent: remove the child from waitingOn,
 *  queue the result notice into pendingMessages (persistent idempotency via
 *  deliveredChildResults), and resume the parent when nothing is left to wait on.
 *  Orphan children (parent purged or already terminal) degrade to a project-report notice. */
export async function notifyThreadParent(childId: string, deps: { resume?: ResumeFn } = {}): Promise<void> {
  const child = threadStore.get(childId);
  if (!child) return;
  const parentId = child.metadata?.parentThreadId;
  if (!parentId) return;

  const parent = threadStore.get(parentId);
  if (!parent || isTerminalStatus(parent.status)) {
    log.info(`orphan child ${childId}: parent ${parentId} ${parent ? parent.status : 'purged'} — degrading to project notice`);
    await postProjectNotice(child, buildNotice(childId));
    return;
  }

  let delivered = false;
  await threadStore.mutate(parentId, (t) => {
    const m = (t.metadata ??= {});
    const waiting = m.waitingOn ?? [];
    const idx = waiting.indexOf(childId);
    if (idx >= 0) {
      waiting.splice(idx, 1);
      m.waitingOn = waiting;
    }
    const alreadyDelivered = (m.deliveredChildResults ?? []).includes(childId);
    if (alreadyDelivered) return;
    delivered = true;
    (m.deliveredChildResults ??= []).push(childId);
    if (!Array.isArray(m.pendingMessages)) m.pendingMessages = [];
    if (m.pendingMessages.length >= 10) m.pendingMessages.shift();
    m.pendingMessages.push(buildChildResultNotice(child));
  });

  // Failure visibility (tree noise reduction trades per-node completion spam for this):
  // failed/aborted children additionally surface on the project-report channel.
  if (delivered && (child.status === 'failed' || child.status === 'aborted')) {
    await postProjectNotice(child, buildNotice(childId)).catch(() => {});
  }

  if (delivered) maybeResumeParent(parentId, deps.resume);
}

// --- Task-children bridge (DR-0014 §8: resident manager waits on child TASKS) ---

/** Child-task result notice delivered into a suspended manager's pendingMessages.
 *  completed → acceptance instructions (verify the deliverable, never the report);
 *  blocked → escalation instructions (the child cannot finish on its own). */
export function buildTaskResultNotice(task: Task, kind: 'completed' | 'blocked'): string {
  const lines: string[] = [];
  if (kind === 'completed') {
    lines.push(`[子任务完成] #${task.id} ${task.text}`);
    if (task.done_when) lines.push(`Done when: ${task.done_when}`);
    if (task.completed_note) lines.push(`完成备注: ${task.completed_note}`);
    lines.push('');
    lines.push('验收要求（必须执行，不得凭完成备注直接采信）:');
    lines.push('1. 读取实际产出（代码/文档/实验记录），逐条核对 done_when；涉及代码的跑测试验证。');
    lines.push('2. 达标 → 蒸馏关键结论进你的 artifact，继续你的计划。');
    lines.push(`3. 未达标 → cortex-task uncomplete 后修订该任务，或用 decompose --keep-parent 增加修订子任务，再 [WAIT_CHILDREN]。`);
    lines.push('4. 方向性问题 → 在 artifact 写 [ABORT: <诊断>] 升级。');
  } else {
    lines.push(`[子任务被阻塞 — 升级信号] #${task.id} ${task.text}`);
    lines.push(`阻塞原因: ${task.blocked_by || '(未记录)'}`);
    lines.push('');
    lines.push('这是子任务的升级：它无法自行完成。你必须处理:');
    lines.push('1. 诊断原因（读它的产出/日志；too-big 类原因 = 你当初的分解需要修订）。');
    lines.push('2. 可修复 → cortex-task unblock 并修订任务描述/done_when，或重建修订后的子任务（decompose --keep-parent），再 [WAIT_CHILDREN]。');
    lines.push('3. 超出你的职权或方向性问题 → 在 artifact 写 [ABORT: <诊断>] 向上升级。');
  }
  return lines.join('\n');
}

/** Disk-fresh read of one task (zero-dependency core parser — consistent with the
 *  suspension snapshot, immune to taskStore cache staleness). */
function readTaskFromDisk(project: string, taskId: string): Task | null {
  try {
    return scanAllTasks(project).find((t) => t.id === taskId) ?? null;
  } catch {
    return null;
  }
}

/** Deliver one child-task result to one waiting manager thread. Returns true if delivered.
 *  Idempotency rides the same persistent deliveredChildResults array as thread children
 *  (4-hex task ids cannot collide with thr_ thread ids). */
async function deliverTaskResult(parentThreadId: string, task: Task, kind: 'completed' | 'blocked', deps: { resume?: ResumeFn }): Promise<boolean> {
  let delivered = false;
  await threadStore.mutate(parentThreadId, (t) => {
    const m = (t.metadata ??= {});
    const waiting = m.waitingOnTasks ?? [];
    const idx = waiting.indexOf(task.id);
    if (idx >= 0) {
      waiting.splice(idx, 1);
      m.waitingOnTasks = waiting;
    }
    if ((m.deliveredChildResults ?? []).includes(task.id)) return;
    delivered = true;
    (m.deliveredChildResults ??= []).push(task.id);
    if (!Array.isArray(m.pendingMessages)) m.pendingMessages = [];
    if (m.pendingMessages.length >= 10) m.pendingMessages.shift();
    m.pendingMessages.push(buildTaskResultNotice(task, kind));
  });
  if (delivered) maybeResumeParent(parentThreadId, deps.resume);
  return delivered;
}

/** Event-bridge entry: a task completed or got blocked — wake every manager thread waiting
 *  on it. For 'completed', the task's real status is verified on disk first: the dispatch
 *  cycle publishes task.completed loosely (thread ended ≠ task done), so the disk state is
 *  the source of truth. A rejected bogus event keeps the manager waiting; the genuine
 *  completion publishes again later. */
export async function notifyTaskParentThreads(taskId: string, kind: 'completed' | 'blocked', deps: { resume?: ResumeFn } = {}): Promise<void> {
  for (const parent of threadStore.getAll()) {
    if (parent.status !== 'waiting') continue;
    if (!parent.metadata?.waitingOnTasks?.includes(taskId)) continue;
    const project = parent.metadata?.taskProject || parent.projectId;
    const task = readTaskFromDisk(project, taskId);
    if (!task) {
      log.warn(`task ${taskId} not found on disk for waiting manager ${parent.id} — leaving to reconcile/recovery`);
      continue;
    }
    if (kind === 'completed' && task.status !== 'done') {
      log.info(`ignoring loose task.completed for ${taskId} (disk status=${task.status})`);
      continue;
    }
    if (kind === 'blocked' && !task.blocked_by) {
      log.info(`ignoring stale task.blocked for ${taskId} (no blocked_by on disk)`);
      continue;
    }
    await deliverTaskResult(parent.id, task, kind, deps);
  }
}

/** Sweep one waiting thread's waitingOnTasks against disk state: deliver already-done and
 *  already-blocked children, drop missing ones, keep open ones. Closes the race window
 *  where a child task turns terminal between the suspension snapshot and the waiting
 *  persist (its event fired before anyone was listening). Also the recovery path for task
 *  children — unlike thread children, open tasks survive restarts and stay awaited. */
export async function reconcileWaitingTasks(threadId: string, deps: { resume?: ResumeFn } = {}): Promise<void> {
  const thread = threadStore.get(threadId);
  if (!thread || thread.status !== 'waiting') return;
  const ids = [...(thread.metadata?.waitingOnTasks ?? [])];
  if (!ids.length) {
    maybeResumeParent(threadId, deps.resume);
    return;
  }
  const project = thread.metadata?.taskProject || thread.projectId;
  for (const taskId of ids) {
    const task = readTaskFromDisk(project, taskId);
    if (!task) {
      await threadStore.mutate(threadId, (t) => {
        const m = t.metadata!;
        m.waitingOnTasks = (m.waitingOnTasks ?? []).filter((id) => id !== taskId);
        if (!Array.isArray(m.pendingMessages)) m.pendingMessages = [];
        m.pendingMessages.push(`[子任务丢失] #${taskId} 已不在 TASKS.yaml（可能被归档或删除），按失败处理。`);
      });
      log.warn(`reconcile: dropped missing task ${taskId} from waiting thread ${threadId}`);
    } else if (task.status === 'done') {
      await deliverTaskResult(threadId, task, 'completed', deps);
    } else if (task.blocked_by) {
      await deliverTaskResult(threadId, task, 'blocked', deps);
    }
    // open/pending and unblocked → keep waiting (tasks survive restarts).
  }
  maybeResumeParent(threadId, deps.resume);
}

/** Register the EventBus subscribers that wake suspended manager threads on child-task
 *  terminal events (DR-0014 §8). Call once at startup, before recoverWaitingThreads. */
export function registerTaskTreeSubscribers(bus: { subscribe: (type: any, fn: (e: any) => void) => unknown }): void {
  bus.subscribe('task.completed', (e: { taskId: string }) => {
    void notifyTaskParentThreads(e.taskId, 'completed').catch((err) => log.error(`task.completed bridge: ${(err as Error).message}`));
  });
  bus.subscribe('task.blocked', (e: { taskId: string }) => {
    void notifyTaskParentThreads(e.taskId, 'blocked').catch((err) => log.error(`task.blocked bridge: ${(err as Error).message}`));
  });
}

/** Startup recovery: re-deliver results that completed while the server was down.
 *  Idempotent — safe to call repeatedly. Thread children still marked waiting whose records
 *  are gone are treated as failed (the restart already failed all in-flight running threads,
 *  so every surviving child THREAD record is terminal by the time this runs). Task children
 *  are reconciled against disk — open ones stay awaited. Returns the number
 *  of suspended parents processed. */
export async function recoverWaitingThreads(deps: { resume?: ResumeFn } = {}): Promise<number> {
  let recovered = 0;
  for (const parent of threadStore.getAll()) {
    if (parent.status !== 'waiting') continue;
    const m = parent.metadata;
    if (!m?.waitingOn?.length && !m?.childThreadIds?.length && !m?.waitingOnTasks?.length) continue; // legacy waiting — not ours
    recovered++;

    for (const childId of [...(m.waitingOn ?? [])]) {
      const child = threadStore.get(childId);
      if (!child) {
        await threadStore.mutate(parent.id, (t) => {
          const meta = t.metadata!;
          meta.waitingOn = (meta.waitingOn ?? []).filter((id) => id !== childId);
          if (!Array.isArray(meta.pendingMessages)) meta.pendingMessages = [];
          meta.pendingMessages.push(`[子线程丢失] ${childId} 的记录已不存在（可能被清理），按失败处理。`);
        });
        log.warn(`recover: dropped missing child ${childId} from waiting parent ${parent.id}`);
      } else if (isTerminalStatus(child.status)) {
        await notifyThreadParent(childId, deps);
      }
    }
    // Task children: reconcile against disk (already-done/blocked delivered, missing
    // dropped, open kept — tasks survive restarts). Ends with its own resume check, which
    // also covers the crash-after-last-delivery-before-resume window and the
    // missing-child branch above (neither resumes by itself).
    await reconcileWaitingTasks(parent.id, deps);
  }
  if (recovered > 0) log.info(`recovered ${recovered} suspended parent thread(s)`);
  return recovered;
}

/**
 * Fire the completion callback for an MCP-spawned thread once it is terminal.
 *  - Non-terminal statuses (e.g. a parent that suspended via [WAIT_CHILDREN] and returned
 *    from runThread in 'waiting') are ignored — suspension is not completion.
 *  - Interactive parent (no parentThreadId): wake the parent by routing a synthetic turn onto
 *    its channel via agentRunner.route.
 *  - Thread-agent parent (parentThreadId set): deliver into the parent thread's
 *    pendingMessages and resume it when its waitingOn empties (notifyThreadParent).
 * Threads not spawned via thread_start (no parentSessionId) are ignored.
 */
export async function fireThreadCallback(threadId: string): Promise<void> {
  const t = threadStore.get(threadId);
  if (!t) return;
  if (!isTerminalStatus(t.status)) {
    // Suspension is not completion — but it IS the moment to close the task-side race
    // window: a child task that turned terminal between the suspension snapshot and the
    // waiting persist fired its event before anyone was listening. Sweep disk state now.
    // (All detached run paths — webhook start, resume — settle through this callback.)
    if (t.status === 'waiting' && t.metadata?.waitingOnTasks?.length) {
      await reconcileWaitingTasks(threadId).catch((e) => log.error(`reconcile ${threadId}: ${(e as Error).message}`));
    }
    return;
  }
  const m = t.metadata;
  if (!m?.parentSessionId) return; // not agent-spawned → nobody to notify

  // Thread-agent parent → persistent-idempotent delivery into the parent thread.
  if (m.parentThreadId) {
    await notifyThreadParent(threadId);
    return;
  }

  // Interactive parent → wake its session (single-fire, in-memory guard).
  if (fired.has(threadId)) return;
  fired.add(threadId);
  const notice = buildNotice(threadId);
  const adapter = jobCtx.adapter;

  if (m.parentChannel) {
    if (!adapter) { log.error(`no adapter; cannot wake parent for ${threadId}`); return; }
    const channel = m.parentChannel;
    const message: IncomingMessage = {
      ref: { conduit: channel, messageId: `cb_${threadId}_${Date.now()}` },
      text: notice,
      senderId: 'cortex-thread-callback',
      isBot: false,
      kind: 'user',
      raw: { source: 'thread-callback', threadId },
    };
    log.info(`waking parent session on ${channel} for thread ${threadId}`);
    await agentRunner.route({
      message,
      channel,
      adapter,
      threadAnchorId: null,
      hasFiles: false,
      userMessage: notice,
      agentMessage: notice,
    });
    return;
  }

  // No channel → durable notice to the project-report channel.
  await postProjectNotice(t, notice);
}
