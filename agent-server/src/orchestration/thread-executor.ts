// input:  domain/threads, thread-runner, orch/channel-queue, orch/busy-tracker
// output: ThreadExecutor — handles thread-add / thread-continue / thread-start sub-paths [S8]
// pos:    orch/ — sole thread-routing execution path
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as path from 'path';
import type { Destination, PlatformAdapter, MessageRef, DownloadedFile, IncomingMessage, PlatformFileRef } from '@platform/index.js';
import { channelQueues, enqueue } from './channel-queue.js';
import { trackPendingTask } from './busy-tracker.js';
import { addAgentToThread, createThread, getTemplate, getAgent } from '@domain/threads/index.js';
import { runThread, continueThread, buildThreadSummary, getActiveHandle } from '@domain/threads/runner.js';
import { downloadFiles as downloadPlatformFiles } from './routing/file-handler.js';
import { computeElapsed, buildStatusActionBlocks, buildSealedStatusActionBlocks, initStatusBlocks } from './status-helpers.js';
import { threadStore } from '@store/thread-repo.js';
import { WORKSPACE_DIR } from '@core/utils.js';
import { buildInteractiveCallbacks } from './agent-runner.js';

const TEMP_DIR = WORKSPACE_DIR;

type Enqueuer = (channel: string, fn: () => Promise<void>) => boolean;
type Tracker = (delta: number) => void;
type Executor = (ctx: ThreadExecCtx) => Promise<void>;

export interface ThreadExecCtx {
  message: IncomingMessage;
  channel: string;
  adapter: PlatformAdapter;
  threadTs: string | null;
  hasFiles: boolean;
  agentMessage: string;
  threadAddMatch: RegExpMatchArray | null;
  threadStartMatch: RegExpMatchArray | null;
  existingThread: any;
  isActiveThread: boolean;
}

export class ThreadExecutor {
  readonly _enqueue: Enqueuer;
  readonly _track: Tracker;
  /** Injectable for unit tests — allows verification of track(-1)-in-finally without running real thread ops. */
  readonly _execute: Executor;

  constructor(opts: { enqueue?: Enqueuer; track?: Tracker; execute?: Executor } = {}) {
    this._enqueue = opts.enqueue ?? enqueue;
    this._track = opts.track ?? trackPendingTask;
    this._execute = opts.execute ?? ((ctx) => this._executeReal(ctx));
  }

  async route(ctx: ThreadExecCtx): Promise<void> {
    const { message, channel, adapter } = ctx;

    // Phase 6: buffer user messages when the thread is running a step,
    // so they're included in the next step's prompt instead of being lost.
    if (ctx.isActiveThread && ctx.existingThread && ctx.existingThread.status === 'running'
        && !ctx.threadAddMatch && !ctx.threadStartMatch) {
      await bufferUserMessage(ctx);
      return;
    }

    if (channelQueues.has(channel)) {
      await adapter.addReaction({ channel, messageId: message.ref.messageId }, 'hourglass').catch(() => {});
    }
    this._track(+1);

    this._enqueue(channel, async () => {
      try {
        await this._execute(ctx);
      } finally {
        this._track(-1);
      }
    });
  }

  private async _executeReal(ctx: ThreadExecCtx): Promise<void> {
    const { channel, adapter } = ctx;
    const interactiveDest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
    const startTime = Date.now();
    let statusMsg: MessageRef | undefined;
    const downloadedFiles = await downloadFiles(ctx.message.files, ctx.hasFiles, ctx.adapter);
    try {
      if (ctx.threadAddMatch) {
        statusMsg = await handleThreadAdd({ threadAddMatch: ctx.threadAddMatch, existingThread: ctx.existingThread, channel, adapter, threadTs: ctx.threadTs, startTime, downloadedFiles }) || undefined;
      } else if (ctx.isActiveThread && ctx.existingThread) {
        statusMsg = await handleThreadContinue({ existingThread: ctx.existingThread, agentMessage: ctx.agentMessage, channel, adapter, threadTs: ctx.threadTs, startTime, downloadedFiles });
      } else if (ctx.threadStartMatch) {
        statusMsg = await handleThreadStart({ threadStartMatch: ctx.threadStartMatch, messageId: ctx.message.ref.messageId, channel, adapter, threadTs: ctx.threadTs, startTime, downloadedFiles }) || undefined;
      }
    } catch (error) {
      const { elapsedStr } = computeElapsed(startTime);
      const isCancelled = (error as any)?.cancelled;
      const errorBlocksTemplate = { channel, sessionName: null, isDm: false };
      if (isCancelled) {
        if (statusMsg) {
          const cancelText = `:octagonal_sign: Cancelled (${elapsedStr}s)`;
          await adapter.updateMessage(statusMsg, {
            text: cancelText,
            richBlocks: buildSealedStatusActionBlocks(cancelText, errorBlocksTemplate),
          }).catch(() => {});
        } else {
          await adapter.postMessage(interactiveDest, { text: ':octagonal_sign: Cancelled' }, ctx.threadTs ? { threadId: ctx.threadTs } : undefined).catch(() => {});
        }
      } else {
        const errorMsg = (error as Error)?.message || 'Unknown error';
        if (statusMsg) {
          const failText = `:x: Thread failed (${elapsedStr}s): ${errorMsg}`;
          await adapter.updateMessage(statusMsg, {
            text: failText,
            richBlocks: buildSealedStatusActionBlocks(failText, errorBlocksTemplate),
          }).catch(() => {});
        } else {
          await adapter.postMessage(interactiveDest, { text: `:x: Thread failed: ${errorMsg}` }, ctx.threadTs ? { threadId: ctx.threadTs } : undefined).catch(() => {});
        }
      }
    }
  }
}

export const threadExecutor = new ThreadExecutor();

// --- Thread sub-handlers ---

async function handleThreadAdd({ threadAddMatch, existingThread, channel, adapter, threadTs, startTime, downloadedFiles }: {
  threadAddMatch: RegExpMatchArray; existingThread: any; channel: string; adapter: PlatformAdapter;
  threadTs: string | null; startTime: number; downloadedFiles: DownloadedFile[];
}): Promise<MessageRef | null> {
  const interactiveDest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  const addAgentName = threadAddMatch[1];
  const addMessage = threadAddMatch[2]?.trim() || null;
  const targetThread = await validateThreadAddTarget(addAgentName, existingThread, channel, adapter, threadTs);
  if (!targetThread) return null;

  await addAgentToThread(targetThread.id, addAgentName, addMessage);
  const platformThreadId = targetThread.platformThreadId || threadTs;
  const threadBlocksTemplate = { channel, sessionName: null, isDm: false, threadId: targetThread.id };
  const addText = `:heavy_plus_sign: Adding *${addAgentName}* to thread ${targetThread.id.substring(0, 12)}...`;
  const statusMsg = await adapter.postMessage(interactiveDest, {
    text: addText,
    richBlocks: buildStatusActionBlocks(addText, threadBlocksTemplate),
  }, platformThreadId ? { threadId: platformThreadId } : undefined);
  initStatusBlocks(statusMsg, threadBlocksTemplate);

  const interactiveCallbacks = buildInteractiveCallbacks(channel, null);
  const threadResult = await runThread(targetThread.id, {
    adapter, channel, threadTs: platformThreadId, statusMsg, startTime, existingSessionId: null, files: downloadedFiles,
    destination: interactiveDest,
    onToolUse: interactiveCallbacks.onToolUse, onPlanWritten: interactiveCallbacks.onPlanWritten, onAskUserQuestion: interactiveCallbacks.onAskUserQuestion,
  });
  const summaryText = buildThreadSummary(threadResult);
  await adapter.updateMessage(statusMsg, {
    text: summaryText,
    richBlocks: buildSealedStatusActionBlocks(summaryText, threadBlocksTemplate),
  });
  return statusMsg;
}

async function validateThreadAddTarget(addAgentName: string, existingThread: any, channel: string, adapter: PlatformAdapter, threadTs: string | null): Promise<any> {
  const interactiveDest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  if (!getAgent(addAgentName)) {
    await adapter.postMessage(interactiveDest, { text: `:x: Unknown agent: \`${addAgentName}\`. Use \`!thread agents\` to see available agents.` }, threadTs ? { threadId: threadTs } : undefined);
    return null;
  }
  const targetThread = existingThread || threadStore.findByChannel(channel).find((t: any) => t.status === 'completed' || t.status === 'waiting');
  if (!targetThread) {
    await adapter.postMessage(interactiveDest, { text: `:x: No thread found. Start one first with \`!thread <agent> <message>\`.` }, threadTs ? { threadId: threadTs } : undefined);
    return null;
  }
  if (targetThread.status === 'running' && getActiveHandle(channel)) {
    await adapter.postMessage(interactiveDest, { text: `:warning: Thread ${targetThread.id.substring(0, 12)} is currently running. Wait for it to finish.` }, threadTs ? { threadId: threadTs } : undefined);
    return null;
  }
  return targetThread;
}

async function handleThreadContinue({ existingThread, agentMessage, channel, adapter, threadTs, startTime, downloadedFiles }: {
  existingThread: any; agentMessage: string; channel: string; adapter: PlatformAdapter;
  threadTs: string | null; startTime: number; downloadedFiles: DownloadedFile[];
}): Promise<MessageRef> {
  const interactiveDest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  const continueBlocksTemplate = { channel, sessionName: null, isDm: false, threadId: existingThread.id };
  const continueText = `:hourglass_flowing_sand: Continuing thread ${existingThread.id.substring(0, 12)}...`;
  const statusMsg = await adapter.postMessage(interactiveDest, {
    text: continueText,
    richBlocks: buildStatusActionBlocks(continueText, continueBlocksTemplate),
  }, threadTs ? { threadId: threadTs } : undefined);
  initStatusBlocks(statusMsg, continueBlocksTemplate);

  const interactiveCallbacks = buildInteractiveCallbacks(channel, null);
  const threadResult = await continueThread(existingThread.id, agentMessage, {
    adapter, channel, threadTs, statusMsg, startTime, existingSessionId: null, files: downloadedFiles,
    destination: interactiveDest,
    onToolUse: interactiveCallbacks.onToolUse, onPlanWritten: interactiveCallbacks.onPlanWritten, onAskUserQuestion: interactiveCallbacks.onAskUserQuestion,
  });

  const continueSummaryText = buildThreadSummary(threadResult);
  await adapter.updateMessage(statusMsg, {
    text: continueSummaryText,
    richBlocks: buildSealedStatusActionBlocks(continueSummaryText, continueBlocksTemplate),
  });
  return statusMsg;
}

async function handleThreadStart({ threadStartMatch, messageId, channel, adapter, threadTs, startTime, downloadedFiles }: {
  threadStartMatch: RegExpMatchArray; messageId: string; channel: string; adapter: PlatformAdapter;
  threadTs: string | null; startTime: number; downloadedFiles: DownloadedFile[];
}): Promise<MessageRef | null> {
  const interactiveDest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  const name = threadStartMatch[1];
  const template = getTemplate(name);
  const agent = getAgent(name);
  if (!template && !agent) {
    await adapter.postMessage(interactiveDest, { text: `:x: Unknown template or agent: \`${name}\`. Use \`!thread templates\` or \`!thread agents\`.` });
    return null;
  }

  const startBlocksTemplate = { channel, sessionName: null, isDm: false };
  const startText = `:hourglass_flowing_sand: Starting thread (${template ? name : `agent:${name}`})...`;
  const statusMsg = await adapter.postMessage(interactiveDest, {
    text: startText,
    // No Cancel button initially — threadId needed first
  }, threadTs ? { threadId: threadTs } : undefined);
  const platformThreadId = threadTs || statusMsg.messageId;
  const thread = createThread(channel, {
    templateName: template ? name : null, agentName: template ? null : name,
    userMessage: threadStartMatch[2].trim(), userMessageTs: messageId, platformThreadId,
  });
  // Update status message with Cancel button now that we have thread.id
  const startBlocksTemplateWithThread = { ...startBlocksTemplate, threadId: thread.id };
  await adapter.updateMessage(statusMsg, {
    text: startText,
    richBlocks: buildStatusActionBlocks(startText, startBlocksTemplateWithThread),
  }).catch(() => {});
  initStatusBlocks(statusMsg, startBlocksTemplateWithThread);

  const interactiveCallbacks = buildInteractiveCallbacks(channel, null);
  const threadResult = await runThread(thread.id, {
    adapter, channel, threadTs: platformThreadId, statusMsg, startTime, existingSessionId: null, files: downloadedFiles,
    destination: interactiveDest,
    onToolUse: interactiveCallbacks.onToolUse, onPlanWritten: interactiveCallbacks.onPlanWritten, onAskUserQuestion: interactiveCallbacks.onAskUserQuestion,
  });
  const startSummaryText = buildThreadSummary(threadResult);
  await adapter.updateMessage(statusMsg, {
    text: startSummaryText,
    richBlocks: buildSealedStatusActionBlocks(startSummaryText, startBlocksTemplate),
  });
  return statusMsg;
}


// --- Message buffering (Phase 6) ---

/** Append a user message to thread.metadata.pendingMessages for inclusion
 *  in the next step's prompt. Used when a step is currently executing
 *  and we can't safely call continueThread + runThread concurrently. */
async function bufferUserMessage(ctx: ThreadExecCtx): Promise<void> {
  const { adapter, channel, threadTs } = ctx;
  const interactiveDest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  const thread = ctx.existingThread;
  const text = ctx.agentMessage || ctx.message.text || '';

  // Synchronously append to in-memory metadata so the next buildStepPrompt
  // call (within the same event-loop tick) sees it immediately.
  // NOTE: Uses threadStore.set() (not mutate()) intentionally — mutate() awaits
  // _pendingPersist which introduces a microtask delay, breaking the synchronous
  // visibility guarantee required by the runThread main loop. The in-memory ref is
  // updated first, then the fire-and-forget set() persists the whole record.
  if (!thread.metadata) thread.metadata = {};
  if (!Array.isArray(thread.metadata.pendingMessages)) thread.metadata.pendingMessages = [];
  // Cap at 10 to prevent unbounded prompt growth
  if (thread.metadata.pendingMessages.length >= 10) {
    thread.metadata.pendingMessages.shift();
  }
  thread.metadata.pendingMessages.push(text);

  // Fire-and-forget persist — .set() is deliberate (see NOTE above). Errors are
  // dropped because the in-memory state is authoritative and will be persisted by
  // the next conventional mutate() call on this thread.
  threadStore.set(thread).catch(() => {});

  await adapter.postMessage(interactiveDest, {
    text: ':inbox_tray: Message buffered — will be included in the next step’s prompt',
  }, threadTs ? { threadId: threadTs } : undefined);
}

// --- Shared helper ---

async function downloadFiles(files: PlatformFileRef[] | undefined, hasFiles: boolean, adapter: PlatformAdapter): Promise<DownloadedFile[]> {
  if (!hasFiles || !files) return [];
  return downloadPlatformFiles(files, adapter, TEMP_DIR);
}
