import { createLogger } from '@core/log.js';
import type { PlatformAdapter } from '@platform/index.js';
import type { CommandResult } from './command-context.js';
import type { CommandActionRouter } from '@orch/interactions/command-action-router.js';
import { closeSession, getActiveBackend, getActiveProfile, setActiveProfile, resolveBackendForChannel } from '@domain/agents/index.js';
import { deleteSessionAsync, setSessionAsync } from '@domain/sessions/session.js';
import { fireAndForgetPreCloseHook } from '@domain/sessions/session-hooks.js';
import { sessionStore } from '@store/session-registry-repo.js';
import { conversationLedger } from '@store/conversation-ledger-repo.js';
import * as sessionBackup from '@domain/sessions/session-backup.js';
import { planApprovals } from '../../interactions/plan-approvals.js';

const log = createLogger('session');

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Resolve the Slack thread timestamp for the session:
 *  1. Command-level threadTs (user typed !new in-thread)
 *  2. Conversation ledger's last status message ts (session's thread parent)
 *  3. null (no thread context available) */
async function resolveSessionThreadTs(channel: string, threadTs?: string | null): Promise<string | null> {
  if (threadTs) return threadTs;
  const conv = await conversationLedger.getConversation(channel);
  if (conv?.turns.length) {
    // Walk backwards to find the last turn with a statusMessageTs
    for (let i = conv.turns.length - 1; i >= 0; i--) {
      if (conv.turns[i].statusMessageTs) return conv.turns[i].statusMessageTs;
    }
  }
  return null;
}

export async function handleNewCmd(
  channel: string,
  adapter: PlatformAdapter,
  opts: { skipHook?: boolean } = {},
  threadTs?: string | null,
): Promise<void> {
  if (!opts.skipHook) {
    const resolvedThreadTs = await resolveSessionThreadTs(channel, threadTs);
    void fireAndForgetPreCloseHook(channel, adapter, resolvedThreadTs);
  }

  closeSession(channel);

  const conv = await conversationLedger.getConversation(channel);
  const profileName = getActiveProfile(channel) || 'default';
  if (conv) {
    sessionBackup.cleanupAllBackups(conv.sessionId);
    await conversationLedger.clearConversation(channel);
  }
  // Clear sessions for ALL backends, not just the current one — otherwise switching
  // profiles after !newq can resurrect a stale session from the previous backend
  // (e.g. !newq on PI backend leaves claude:C<channel> intact; switching to Claude
  //  backend then tries to --resume a session whose claude-side file is gone).
  const ALL_BACKENDS = ['claude', 'pi', 'codex'];
  await Promise.all(ALL_BACKENDS.map(b => deleteSessionAsync(channel, b).catch(() => {})));
  const cleared = planApprovals.clearByChannel(channel);
  if (cleared > 0) log.info('Cleared pending plan for channel:', channel);
  log.info('New conversation started in channel:', channel);
  await adapter.postMessage(channel, { text: `--- new conversation --- (profile: ${profileName})` });
}

const MAX_RESUME_BUTTONS = 10;

export function createResumeHandler(router?: CommandActionRouter) {
  if (router) {
    const switchHandler = async (ctx: import('@platform/index.js').ActionContext) => {
      const adapter = router.getAdapter();
      if (!adapter) return;
      const name = ctx.value;
      const record = await sessionStore.lookupSession(name);
      if (!record) {
        if (ctx.messageRef) {
          await adapter.updateMessage(ctx.messageRef, {
            text: `:x: Session \`${name}\` not found.`,
          }).catch(() => {});
        }
        return;
      }
      if (record.profileName) setActiveProfile(record.profileName, ctx.channelId);
      await setSessionAsync(ctx.channelId, record.sessionId, record.backend);
      await conversationLedger.switchSession(ctx.channelId, { sessionId: record.sessionId, sessionName: name, backend: record.backend, profileName: record.profileName });
      const profileNote = record.profileName ? ` (profile: ${record.profileName})` : '';
      if (ctx.messageRef) {
        await adapter.updateMessage(ctx.messageRef, {
          text: `:arrows_counterclockwise: Switched to session \`${name}\`${profileNote}`,
        }).catch(() => {});
      }
    };
    router.registerCommand('resume', {
      actions: Array.from({ length: MAX_RESUME_BUTTONS }, (_, i) => ({
        actionId: `switch-${i}`,
        handler: switchHandler,
      })),
    });
  }

  return async function handleResumeCmdInteractive(
    channel: string, adapter: PlatformAdapter, trimmedMessage: string,
  ): Promise<CommandResult | void> {
    const args = trimmedMessage.split(/\s+/).slice(1);

    if (args.length > 0) {
      const name = args[0];
      const record = await sessionStore.lookupSession(name);
      if (!record) {
        await adapter.postMessage(channel, { text: `:x: Session \`${name}\` not found. Run \`!resume\` to list sessions.` });
        return;
      }
      if (record.profileName) setActiveProfile(record.profileName, channel);
      await setSessionAsync(channel, record.sessionId, record.backend);
      await conversationLedger.switchSession(channel, { sessionId: record.sessionId, sessionName: name, backend: record.backend, profileName: record.profileName });
      const profileNote = record.profileName ? ` (profile: ${record.profileName})` : '';
      await adapter.postMessage(channel, { text: `:arrows_counterclockwise: Switched to session \`${name}\`${profileNote}` });
      return;
    }

    const sessions = await sessionStore.listRecentSessions(10);
    if (sessions.length === 0) {
      await adapter.postMessage(channel, { text: 'No sessions recorded yet.' });
      return;
    }
    const activeId = await sessionStore.getActiveSessionName(channel, getActiveBackend());
    const now = Date.now();
    const lines = ['*Recent sessions*'];
    for (const s of sessions) {
      const isActive = s.name === activeId;
      const activeTag = isActive ? ' *(active)*' : '';
      const ago = formatTimeAgo(now - new Date(s.lastUsedAt).getTime());
      const label = s.label ? ` — ${s.label}` : '';
      const kind = s.kind === 'scheduled' ? ' :clock1:' : '';
      lines.push(`• \`${s.name}\`${activeTag}${kind}${label} — ${ago}`);
    }
    const text = lines.join('\n');

    if (!router) {
      await adapter.postMessage(channel, { text });
      return;
    }

    return {
      text,
      richBlocks: [{ type: 'section' as const, text }],
      actions: sessions.slice(0, MAX_RESUME_BUTTONS).map((s, i) => ({
        type: 'button' as const,
        text: s.name.length > 20 ? s.name.slice(0, 17) + '...' : s.name,
        actionId: `cmd:resume:switch-${i}`,
        value: s.name,
      })),
    };
  };
}

/** @deprecated Use createResumeHandler() instead. */
export async function handleResumeCmd(channel: string, adapter: PlatformAdapter, trimmedMessage: string): Promise<void> {
  const handler = createResumeHandler();
  await handler(channel, adapter, trimmedMessage);
}
