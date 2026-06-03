import { createLogger } from '@core/log.js';
import { Icons } from '../../../core/icons.js';
import type { Destination, PlatformAdapter } from '@platform/index.js';
import type { CommandResult } from './command-context.js';
import type { CommandActionRouter } from '@orch/interactions/command-action-router.js';
import { runningExecutions } from '../../../core/running-executions.js';
import { conduitQueues } from '../../conduit-queue.js';
import { cancelThread as cancelThreadById } from '@domain/threads/index.js';
import { setSessionAsync } from '@domain/sessions/session.js';
import { getActiveBackend } from '@domain/agents/index.js';
import * as executionRegistry from '@domain/executions/registry.js';

/** Mark the persistent execution record as cancelled BEFORE the kill, so the kill-error path's
 *  failExecution becomes a terminal no-op and the record reads 'cancelled', not 'failed'. */
function markCancelled(executionId: string | null | undefined): void {
  if (executionId) executionRegistry.cancelExecution(executionId, {});
}

/** Matches thread IDs like `thr_a1b2c3d4`. */
const THREAD_ID_RE = /^thr_[0-9a-f]{8}$/;

const log = createLogger('cancel');

const MAX_CANCEL_BUTTONS = 10;

export function createCancelHandler(cancelDispatchedTask: ((opts: { taskId: string; channel: string }) => Promise<{ ok: boolean; message: string }>) | null, router?: CommandActionRouter) {
  if (router) {
    const cancelHandler = async (ctx: import('@platform/index.js').ActionContext) => {
      const { threadId, executionId } = JSON.parse(ctx.value);
      const adapter = router.getAdapter();
      if (!adapter) return;

      if (threadId) {
        const exec = runningExecutions.getByThreadId(threadId);
        markCancelled(exec?.executionId);
        runningExecutions.killByThreadId(threadId);
        await cancelThreadById(threadId).catch(() => {});
        if (exec?.sessionId) {
          await setSessionAsync(ctx.channelId, exec.sessionId, getActiveBackend()).catch(() => {});
        }
      } else if (executionId) {
        const exec = runningExecutions.getById(executionId);
        markCancelled(executionId);
        if (exec?.sessionId) {
          await setSessionAsync(ctx.channelId, exec.sessionId, getActiveBackend()).catch(() => {});
        }
        runningExecutions.killById(executionId);
      }
      conduitQueues.delete(ctx.channelId);

      if (ctx.messageRef) {
        await adapter.updateMessage(ctx.messageRef, {
          text: `${Icons.stopped} Cancelled (${threadId || executionId})`,
        }).catch(() => {});
      }
    };
    router.registerCommand('cancel', {
      actions: Array.from({ length: MAX_CANCEL_BUTTONS }, (_, i) => ({
        actionId: `exec-${i}`,
        handler: cancelHandler,
      })),
    });
  }

  return async function handleCancelCmd(channel: string, adapter: PlatformAdapter, trimmedMessage: string): Promise<CommandResult | void> {
    const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
    const args = trimmedMessage.split(/\s+/).slice(1);
    if (args.length > 0) {
      const firstArg = args[0];

      // --all: kill all running executions in the current channel
      if (firstArg === '--all') {
        const executions = runningExecutions.getByChannel(channel);
        if (executions.length === 0) {
          await adapter.postMessage(dest, { text: 'Nothing running to cancel.' });
          return;
        }
        for (const exec of executions) {
          if (exec.threadId) {
            await cancelThreadById(exec.threadId).catch(() => {});
          }
          if (exec.sessionId) {
            await setSessionAsync(channel, exec.sessionId, getActiveBackend()).catch(() => {});
          }
          markCancelled(exec.executionId);
          runningExecutions.killById(exec.registryKey);
        }
        conduitQueues.delete(channel);
        await adapter.postMessage(dest, { text: `${Icons.stopped} Cancelled ${executions.length} execution(s).` });
        return;
      }

      // Thread ID pattern: kill by threadId + cancel thread store record
      if (THREAD_ID_RE.test(firstArg)) {
        const exec = runningExecutions.getByThreadId(firstArg);
        markCancelled(exec?.executionId);
        if (runningExecutions.killByThreadId(firstArg)) {
          await cancelThreadById(firstArg).catch(() => {});
          if (exec?.sessionId) {
            await setSessionAsync(channel, exec.sessionId, getActiveBackend()).catch(() => {});
          }
          log.info('Cancel requested for thread:', firstArg);
          await adapter.postMessage(dest, { text: `${Icons.stopped} Thread \`${firstArg}\` cancelled.` });
        } else {
          await adapter.postMessage(dest, { text: `No running thread \`${firstArg}\` found to cancel.` });
        }
        return;
      }

      // Fallback: dispatched-task cancellation
      if (!cancelDispatchedTask) {
        await adapter.postMessage(dest, { text: 'Dispatched-task cancellation is not available in this process.' });
        return;
      }
      const result = await cancelDispatchedTask({ taskId: firstArg, channel });
      await adapter.postMessage(dest, { text: result.message });
      return;
    }

    // No args: check how many executions are running on this channel
    const executions = runningExecutions.getByChannel(channel);

    // 0 executions: nothing to cancel
    if (executions.length === 0) {
      await adapter.postMessage(dest, { text: 'Nothing running to cancel.' });
      return;
    }

    // 1 execution: cancel directly (existing default behavior)
    if (executions.length === 1) {
      const exec = executions[0];
      markCancelled(exec.executionId);
      if (exec.threadId) {
        await cancelThreadById(exec.threadId).catch(() => {});
      }
      runningExecutions.killById(exec.registryKey);
      if (exec.sessionId) {
        await setSessionAsync(channel, exec.sessionId, getActiveBackend()).catch(() => {});
      }
      conduitQueues.delete(channel);
      await adapter.postMessage(dest, { text: `${Icons.stopped} Cancelled. Session preserved — next message will resume.` });
      return;
    }

    // 2+ executions: show interactive list with cancel buttons
    return {
      text: `Running tasks (${executions.length}):`,
      richBlocks: executions.map(exec => ({
        type: 'section' as const,
        text: `\`${exec.threadId || exec.registryKey}\` · started ${new Date(exec.startTime).toLocaleTimeString()} · ${exec.backend}${exec.channel ? ` · ${exec.channel}` : ''}`,
      })),
      actions: executions.map((exec, i) => ({
        type: 'button' as const,
        text: `Cancel ${exec.threadId || exec.registryKey}`,
        actionId: `cmd:cancel:exec-${i}`,
        value: JSON.stringify({
          threadId: exec.threadId,
          executionId: exec.executionId,
        }),
        style: 'danger' as const,
      })),
    };
  };
}
