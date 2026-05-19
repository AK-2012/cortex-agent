// input:  orch/orchestrator, domain/threads, store/thread-repo
// output: registerMessageHandler(app, deps) — thin wrapper that delegates routing to orchestrator
// pos:    Slack message event entry point; two-branch decision tree handled by orch/orchestrator ([S8-B] old paths deleted)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<
import type { PlatformAdapter, IncomingMessage, MessageEditContext } from '@platform/index.js';
import { normalizeSkillCommandPrefix } from '@domain/memory/skill-scanner.js';
import { createLogger } from '@core/log.js';
import { extractForwardedContent } from '../status-helpers.js';
import { threadStore } from '@store/thread-repo.js';

const log = createLogger('app');
import { getTemplate, getAgent } from '@domain/threads/index.js';
import { orchestrator } from '../orchestrator.js';

export interface MessageHandlerDeps {
  dispatchCommand: (text: string | undefined, channel: string, adapter: PlatformAdapter, threadTs?: string | null) => boolean;
  handleMessageEdit: (ctx: MessageEditContext, adapter: PlatformAdapter) => void;
}

const THREAD_RESERVED_SUBCOMMANDS = new Set(['cancel', 'list', 'agents', 'templates']);

export function registerMessageHandler(adapter: PlatformAdapter, deps: MessageHandlerDeps): void {
  const { dispatchCommand, handleMessageEdit } = deps;

  adapter.onMessageEdit(async (ctx) => {
    handleMessageEdit(ctx, adapter);
  });

  adapter.onMessage(async (ctx) => {
    const message = ctx.message;
    log.info('Message event:', JSON.stringify({ subtype: message.subtype, isBot: message.isBot, text: message.text?.substring(0, 50), files: message.files?.length, threadId: message.ref.threadId }));

    if (routeBotMessage(message)) { /* stripped BRANCH_CALLBACK prefix, continue */ }
    else if (message.isBot) return;

    if (message.subtype && message.subtype !== 'file_share') return;

    const hasFiles = (message.files?.length || 0) > 0;
    const userMessage = message.text;
    const trimmedMessage = userMessage?.trim();
    const forwardedContent = extractForwardedContent(message);
    if (!userMessage && !hasFiles && !forwardedContent) return;

    const threadTs = message.ref.threadId || null;

    if (shouldSkipForCommandDispatch(trimmedMessage, dispatchCommand, message.ref.channel, adapter, threadTs)) return;

    const channel = message.ref.channel;

    let agentMessage = normalizeSkillCommandPrefix(userMessage || '');
    if (forwardedContent) {
      agentMessage = `[Forwarded message]\n${forwardedContent}\n[End forwarded message]\n\n${agentMessage || 'The user forwarded the above message to you.'}`;
    }

    const threadAddMatch = trimmedMessage?.match(/^!thread\s+add\s+(\S+)(?:\s+([\s\S]+))?$/) ?? null;
    const threadStartMatch = trimmedMessage?.match(/^!thread\s+(\S+)\s+([\s\S]+)/) ?? null;
    const existingThread = threadTs ? threadStore.findByPlatformThread(channel, threadTs) : null;
    const isActiveThread = !!(existingThread && (existingThread.status === 'running' || existingThread.status === 'waiting'));

    await orchestrator.handleMessage({
      message, channel, adapter, threadTs, hasFiles,
      userMessage: userMessage || '', agentMessage,
      threadAddMatch, threadStartMatch, existingThread, isActiveThread,
    });
  });
}

// --- Bot message filter ---

function routeBotMessage(message: IncomingMessage): boolean {
  if (!message.isBot) return false;
  if (message.text?.startsWith('[BRANCH_CALLBACK]')) {
    // Intentional mutation: downstream `userMessage = message.text` must see the cleaned text
    message.text = message.text.replace('[BRANCH_CALLBACK]', '').trim();
    return true;
  }
  return false;
}

// --- Command dispatch check ---

function shouldSkipForCommandDispatch(trimmedMessage: string | undefined, dispatchCommand: MessageHandlerDeps['dispatchCommand'], channel: string, adapter: PlatformAdapter, threadTs: string | null): boolean {
  const threadAddMatch = trimmedMessage?.match(/^!thread\s+add\s+(\S+)(?:\s+([\s\S]+))?$/);
  const isThreadExecCmd = (() => {
    if (threadAddMatch) return true;
    const m = trimmedMessage?.match(/^!thread\s+(\S+)\s+([\s\S]+)/);
    if (!m || THREAD_RESERVED_SUBCOMMANDS.has(m[1])) return false;
    return getTemplate(m[1]) != null || getAgent(m[1]) != null;
  })();
  return !isThreadExecCmd && dispatchCommand(trimmedMessage, channel, adapter, threadTs);
}
