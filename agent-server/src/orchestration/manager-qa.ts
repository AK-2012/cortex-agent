// input:  webhook /webhook/manager-qa (ask/poll/answer), agent-runner human-reply interception
// output: askManager / submitAnswer / getAnswer / tryAnswerFromHuman / buildQuestionNotice
// pos:    DR-0016 up-ask channel — a subtask asks its manager (or, at the top, a human) a clarifying
//         question and blocks (synchronously, via the ask_manager MCP tool's poll loop) until
//         answered. A suspended manager is woken to answer (resumeManagerForQuestion) and re-suspends
//         via pendingControl='wait' after answer_subtask. Central question state is an in-memory Map
//         in the daemon (synchronous model: a daemon restart fails the in-flight ask, consistent with
//         running threads failing on restart — no persistence in v1).
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { threadStore } from '@store/thread-repo.js';
import { scanAllTasks } from '@core/task-parser.js';
import { isTerminalStatus } from '@domain/threads/tree.js';
import { resumeManagerForQuestion } from './thread-callback.js';
import { ctx as jobCtx } from '@domain/scheduling/job-registry.js';
import { getOutboundQueue, durablePost } from '@store/outbound-queue.js';
import { createLogger } from '@core/log.js';
import { t } from '@core/i18n.js';
import type { ThreadRecord } from '@core/types/thread-types.js';
import type { Destination } from '@platform/index.js';

const log = createLogger('manager-qa');

interface PendingQuestion {
  questionId: string;
  fromThreadId: string;
  fromTaskId: string | null;
  managerThreadId: string | null; // null when escalated to a human
  channel: string | null;         // human-escalation channel (null for manager target)
  awaitingHuman: boolean;
  question: string;
  answer: string | null;
  createdAt: number;
}

/** Central in-memory question store (daemon process). questionId → question. */
const questions = new Map<string, PendingQuestion>();
/** channel → questionId, for routing a human's free-text reply back to the right pending ask. */
const channelIndex = new Map<string, string>();

/** Test hook: clear all in-memory Q&A state. */
export function _testResetManagerQa(): void {
  questions.clear();
  channelIndex.clear();
}

/** Minimal task shape the resolver needs (kept tiny so callers/tests can inject a reader). */
interface TaskLite { parent: string | null; origin_channel: string | null }

export interface ManagerQaDeps {
  /** Disk-fresh task lookup (defaults to scanAllTasks). Injected in tests to avoid disk. */
  readTask?: (project: string | null, taskId: string) => TaskLite | null;
  /** Resume a waiting manager so it can answer (defaults to resumeManagerForQuestion). */
  resume?: (managerThreadId: string) => void;
  /** Post the question to a human-escalation channel (defaults to the platform adapter). */
  postToChannel?: (channel: string, text: string) => void | Promise<void>;
}

function defaultReadTask(project: string | null, taskId: string): TaskLite | null {
  try {
    const t = scanAllTasks(project ?? undefined).find((x) => x.id === taskId);
    return t ? { parent: t.parent ?? null, origin_channel: t.origin_channel ?? null } : null;
  } catch {
    return null;
  }
}

async function defaultPostToChannel(channel: string, text: string): Promise<void> {
  const adapter = jobCtx.adapter;
  if (!adapter) { log.error(`no adapter; cannot escalate question to ${channel}`); return; }
  const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  const queue = getOutboundQueue();
  if (queue) await durablePost(queue, adapter, dest, { text });
  else await adapter.postMessage(dest, { text });
}

/** Notice injected into the manager's pendingMessages — an AGENT-facing prompt (English, not i18n;
 *  mirrors the directives, which are not localized). Mirrors buildChildResultNotice's shape: states
 *  what is asked and how to respond. */
export function buildQuestionNotice(q: { questionId: string; fromTaskId: string | null; question: string }): string {
  const from = q.fromTaskId ? `subtask #${q.fromTaskId}` : 'a subtask';
  return [
    `[Subtask question] ${from} hit something unclear/contradictory while executing and is checking your planning intent (you are its manager):`,
    '',
    `Question: ${q.question}`,
    '',
    'Answer with the answer_subtask tool (after answering you automatically return to waiting on your subtasks):',
    `    answer_subtask(question_id="${q.questionId}", answer="<your answer>")`,
    'If you are also unsure (it concerns a higher-level planning intent), call ask_manager to ask your own manager, then answer this subtask once you have their reply.',
  ].join('\n');
}

/** Notice posted to a human's chat channel when a subtask escalates to the top of the tree — a
 *  USER-facing platform message, so it is localized via i18n.t() (CORTEX_LANG). The ❓ icon stays
 *  in code per the locales convention (icons never live in the message tables). */
function buildHumanEscalationNotice(q: PendingQuestion): string {
  const from = q.fromTaskId ? t('subtask.fromTask', { taskId: q.fromTaskId }) : t('subtask.fromUnknown');
  return [
    `❓ ${t('subtask.escalateHeader', { from })}`,
    '',
    t('subtask.questionLabel', { question: q.question }),
    '',
    t('subtask.escalateReply'),
  ].join('\n');
}

/** Resolve the manager thread to ask: prefer an explicit thread parent; otherwise walk the task
 *  tree (child task.parent → the live thread that owns that manager task). Returns null when no
 *  live manager exists (→ human escalation). */
function resolveManagerThread(thread: ThreadRecord, deps: ManagerQaDeps): string | null {
  const ptid = thread.metadata?.parentThreadId;
  if (ptid) {
    const p = threadStore.get(ptid);
    if (p && !isTerminalStatus(p.status)) return ptid;
  }
  const taskId = thread.metadata?.taskId;
  if (!taskId) return null;
  const project = thread.metadata?.taskProject ?? null;
  const childTask = (deps.readTask ?? defaultReadTask)(project, taskId);
  const managerTaskId = childTask?.parent ?? null;
  if (!managerTaskId) return null;
  const mgr = threadStore.getAll().find((t) => t.metadata?.taskId === managerTaskId && !isTerminalStatus(t.status));
  return mgr?.id ?? null;
}

/** Walk up the task tree from the asking thread's task to the nearest ancestor that carries an
 *  origin_channel — the human who set the work in motion. Used only when no manager thread exists. */
function findEscalationChannel(thread: ThreadRecord, deps: ManagerQaDeps): string | null {
  const read = deps.readTask ?? defaultReadTask;
  const project = thread.metadata?.taskProject ?? null;
  let taskId: string | null = thread.metadata?.taskId ?? null;
  let hops = 0;
  while (taskId && hops < 16) {
    const t = read(project, taskId);
    if (!t) break;
    if (t.origin_channel) return t.origin_channel;
    taskId = t.parent;
    hops++;
  }
  // No human conduit captured anywhere up the tree → nothing to escalate to. We deliberately do
  // NOT fall back to thread.channel: a dispatch thread's channel is often an unattended
  // project-report conduit, and silently posting a question there would block the subtask on an
  // answer that never comes.
  return null;
}

async function deliverToManager(managerThreadId: string, q: PendingQuestion, deps: ManagerQaDeps): Promise<void> {
  await threadStore.mutate(managerThreadId, (t) => {
    const m = (t.metadata ??= {});
    if (!Array.isArray(m.pendingMessages)) m.pendingMessages = [];
    if (m.pendingMessages.length >= 10) m.pendingMessages.shift();
    m.pendingMessages.push(buildQuestionNotice(q));
    if (!Array.isArray(m.pendingQuestions)) m.pendingQuestions = [];
    m.pendingQuestions.push({ questionId: q.questionId, fromTaskId: q.fromTaskId, question: q.question });
  });
  // Only a suspended manager needs waking; a running one will see the question in its own loop.
  const mgr = threadStore.get(managerThreadId);
  if (mgr?.status === 'waiting') (deps.resume ?? resumeManagerForQuestion)(managerThreadId);
}

export type AskResult =
  | { ok: true; questionId: string; target: 'manager'; managerThreadId: string }
  | { ok: true; questionId: string; target: 'human'; channel: string }
  | { ok: false; error: string };

function newQuestionId(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Register a subtask's question and route it: to its manager (woken to answer), or — at the top of
 *  the tree — to a human via the origin channel. Returns a questionId the caller polls via getAnswer. */
export async function askManager(threadId: string, question: string, deps: ManagerQaDeps = {}): Promise<AskResult> {
  const thread = threadStore.get(threadId);
  if (!thread) return { ok: false, error: 'calling thread not found (CORTEX_THREAD_ID stale?)' };
  const q = (question ?? '').trim();
  if (!q) return { ok: false, error: 'question must not be empty' };

  const managerThreadId = resolveManagerThread(thread, deps);
  const questionId = newQuestionId();

  if (managerThreadId) {
    const rec: PendingQuestion = {
      questionId, fromThreadId: threadId, fromTaskId: thread.metadata?.taskId ?? null,
      managerThreadId, channel: null, awaitingHuman: false, question: q, answer: null, createdAt: Date.now(),
    };
    questions.set(questionId, rec);
    await deliverToManager(managerThreadId, rec, deps);
    log.info(`ask_manager: ${threadId} → manager ${managerThreadId} (${questionId})`);
    return { ok: true, questionId, target: 'manager', managerThreadId };
  }

  const channel = findEscalationChannel(thread, deps);
  if (!channel) {
    return { ok: false, error: 'no manager and no origin channel to escalate to — use your best judgment, record the assumption, or call thread_abort with a diagnosis' };
  }
  const rec: PendingQuestion = {
    questionId, fromThreadId: threadId, fromTaskId: thread.metadata?.taskId ?? null,
    managerThreadId: null, channel, awaitingHuman: true, question: q, answer: null, createdAt: Date.now(),
  };
  questions.set(questionId, rec);
  channelIndex.set(channel, questionId);
  await (deps.postToChannel ?? defaultPostToChannel)(channel, buildHumanEscalationNotice(rec));
  log.info(`ask_manager: ${threadId} → human escalation on ${channel} (${questionId})`);
  return { ok: true, questionId, target: 'human', channel };
}

/** Manager answers a subtask question. Records the answer and forces the manager back to waiting
 *  (pendingControl='wait') so it re-suspends on its still-live children at the next step boundary. */
export async function submitAnswer(questionId: string, answer: string): Promise<{ ok: boolean; error?: string }> {
  const rec = questions.get(questionId);
  if (!rec) return { ok: false, error: `unknown question ${questionId} (expired, already consumed, or lost on restart)` };
  rec.answer = answer ?? '';
  if (rec.managerThreadId) {
    await threadStore.mutate(rec.managerThreadId, (t) => {
      const m = (t.metadata ??= {});
      if (Array.isArray(m.pendingQuestions)) m.pendingQuestions = m.pendingQuestions.filter((x) => x.questionId !== questionId);
      // Re-suspend after answering — unless a control intent is already queued (don't clobber it).
      if (!m.pendingControl) m.pendingControl = { action: 'wait' };
    });
  }
  log.info(`answer_subtask: ${questionId} answered`);
  return { ok: true };
}

/** Poll for an answer. Consumes the entry once an answer is present (one-shot read by the poller). */
export function getAnswer(questionId: string): { found: boolean; answered: boolean; answer: string | null } {
  const rec = questions.get(questionId);
  if (!rec) return { found: false, answered: false, answer: null };
  if (rec.answer !== null) {
    questions.delete(questionId);
    if (rec.channel) channelIndex.delete(rec.channel);
    return { found: true, answered: true, answer: rec.answer };
  }
  return { found: true, answered: false, answer: null };
}

/** Interactive hook: if `channel` has a pending human-escalated question, consume this message as
 *  its answer and return true (the caller should then short-circuit normal turn handling). */
export function tryAnswerFromHuman(channel: string, text: string): boolean {
  const qid = channelIndex.get(channel);
  if (!qid) return false;
  const rec = questions.get(qid);
  if (!rec || !rec.awaitingHuman) { channelIndex.delete(channel); return false; }
  rec.answer = text ?? '';
  log.info(`ask_manager: human answered ${qid} on ${channel}`);
  return true;
}
