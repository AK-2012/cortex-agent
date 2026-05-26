// input:  PlatformAdapter, threadStore, domain/threads APIs
// output: handleThreadCmd(channel, adapter, msg)
// pos:    !thread sub-command family handlers
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { createLogger } from '@core/log.js';
import { Icons } from '../../../core/icons.js';
import type { Destination, PlatformAdapter } from '@platform/index.js';
import { threadStore } from '@store/thread-repo.js';
import { listTemplates, listAgents } from '@domain/threads/index.js';
import { runningExecutions } from '../../../core/running-executions.js';
import { conduitQueues } from '../../conduit-queue.js';

const log = createLogger('thread-handlers');

async function handleThreadStatus(channel: string, adapter: PlatformAdapter) {
  const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  const active = threadStore.findActive(channel);
  if (!active) {
    await adapter.postMessage(dest, { text: 'No active thread in this channel.' });
    return;
  }
  const agents = Object.keys(active.agents).join(', ');
  const modeLabel = active.templateName ? active.templateName : 'ad-hoc';
  const lines = [
    `*Active Thread* \`${active.id}\` (${modeLabel})`,
    `Status: ${active.status} | Active agent: ${active.activeAgent}`,
    `Steps: ${active.steps.length} | Cost: $${active.totalCostUsd.toFixed(4)}`,
    `Agents: ${agents}`,
  ];
  if (active.status === 'aborted' && active.abortReason) {
    lines.push(`Abort reason: ${active.abortReason}`);
  }
  await adapter.postMessage(dest, { text: lines.join('\n') });
}

async function handleThreadTemplates(channel: string, adapter: PlatformAdapter) {
  const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  const templates = listTemplates();
  if (templates.length === 0) {
    await adapter.postMessage(dest, { text: 'No thread templates configured.' });
    return;
  }
  const lines = ['*Available Thread Templates*'];
  for (const t of templates) {
    const agentList = t.agents.map(a => typeof a === 'string' ? a : a.ref).join(', ');
    lines.push(`• \`${t.name}\` — ${t.description} [agents: ${agentList}]`);
  }
  await adapter.postMessage(dest, { text: lines.join('\n') });
}

async function handleThreadAgents(channel: string, adapter: PlatformAdapter) {
  const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  const agentDefs = listAgents();
  const lines: string[] = [];
  if (agentDefs.length > 0) {
    lines.push('*Available Agents*');
    for (const a of agentDefs) {
      lines.push(`• \`${a.name}\` (${a.profile}) — ${a.description || ''}`);
    }
  } else {
    lines.push('No agents configured.');
  }
  const active = threadStore.findActive(channel);
  if (active) {
    lines.push('');
    lines.push(`*Active Thread* \`${active.id}\``);
    for (const [slotId, slot] of Object.entries(active.agents)) {
      const isActiveAgent = slotId === active.activeAgent ? ` ${Icons.arrowLeft}` : '';
      const sessionStr = slot.sessionName || 'no session';
      lines.push(`  • *${slotId}* (${slot.profile}) — ${slot.status} | ${sessionStr}${isActiveAgent}`);
    }
  }
  await adapter.postMessage(dest, { text: lines.join('\n') });
}

async function handleThreadCancelAlias(channel: string, adapter: PlatformAdapter) {
  const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  // Alias for !cancel — delegate to the same killByKey behavior
  if (runningExecutions.killByKey(channel)) {
    log.info('Cancel requested for channel:', channel);
    conduitQueues.delete(channel);
    await adapter.postMessage(dest, { text: `${Icons.stopped} Cancelled. Session preserved — next message will resume.` });
  } else {
    await adapter.postMessage(dest, { text: 'Nothing running to cancel.' });
  }
}

async function handleThreadList(channel: string, adapter: PlatformAdapter) {
  const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  const threads = threadStore.findByChannel(channel).slice(0, 10);
  if (threads.length === 0) {
    await adapter.postMessage(dest, { text: 'No threads found for this channel.' });
    return;
  }
  const lines = ['*Recent Threads*'];
  for (const t of threads) {
    const modeLabel = t.templateName || 'ad-hoc';
    lines.push(`• \`${t.id}\` ${modeLabel} — ${t.status} | ${t.steps.length} steps | $${t.totalCostUsd.toFixed(4)}`);
  }
  await adapter.postMessage(dest, { text: lines.join('\n') });
}

async function handleThreadListRunning(channel: string, adapter: PlatformAdapter) {
  const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  const executions = runningExecutions.getAll().filter(e => e.threadId);
  if (executions.length === 0) {
    await adapter.postMessage(dest, { text: 'No running threads.' });
    return;
  }
  const lines = ['*Running Threads*'];
  for (const exec of executions) {
    const thread = exec.threadId ? threadStore.get(exec.threadId) : null;
    const modeLabel = thread?.templateName || 'ad-hoc';
    const stepCount = thread?.steps.length ?? 0;
    const cost = thread?.totalCostUsd ?? 0;
    lines.push(`• \`${exec.threadId}\` — ${exec.channel || '?'} | ${modeLabel} | ${stepCount} step(s) | $${cost.toFixed(4)}`);
  }
  await adapter.postMessage(dest, { text: lines.join('\n') });
}

async function sendThreadUsage(channel: string, adapter: PlatformAdapter) {
  const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  await adapter.postMessage(dest, {
    text: [
      '*Thread Commands*',
      '`!thread` — show active thread status',
      '`!thread agents` — list available agents',
      '`!thread templates` — list available templates',
      '`!thread <agent> <message>` — start ad-hoc thread with one agent',
      '`!thread <template> <message>` — start template-based thread',
      '`!thread add <agent> [message]` — add agent to current thread',
      '`!cancel` — cancel active thread (also `!thread cancel`)',
      '`!thread list` — list recent threads',
      '`!thread list --running` — list running threads across channels',
    ].join('\n'),
  });
}

export async function handleThreadCmd(channel: string, adapter: PlatformAdapter, msg: string) {
  const args = msg.replace(/^!thread\s*/, '').trim();
  if (!args) return handleThreadStatus(channel, adapter);
  if (args === 'templates') return handleThreadTemplates(channel, adapter);
  if (args === 'agents') return handleThreadAgents(channel, adapter);
  if (args === 'cancel') return handleThreadCancelAlias(channel, adapter);
  if (args === 'list') return handleThreadList(channel, adapter);
  if (args === 'list --running') return handleThreadListRunning(channel, adapter);
  return sendThreadUsage(channel, adapter);
}
