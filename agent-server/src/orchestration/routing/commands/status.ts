import type { PlatformAdapter } from '@platform/index.js';
import type { CommandResult } from './command-context.js';
import type { CommandActionRouter } from '@orch/interactions/command-action-router.js';

export function createStatusHandler(getExecutionStatusReport: (() => string) | null, router?: CommandActionRouter) {
  // Register refresh action handler
  if (router) {
    router.registerCommand('status', {
      actions: [{
        actionId: 'refresh',
        handler: async (ctx) => {
          const adapter = router.getAdapter();
          if (!adapter || !getExecutionStatusReport || !ctx.messageRef) return;
          const text = getExecutionStatusReport();
          await adapter.updateMessage(ctx.messageRef, {
            text,
            richBlocks: [
              { type: 'section', text },
              {
                type: 'actions',
                elements: [{
                  type: 'button',
                  text: 'Refresh',
                  actionId: 'cmd:status:refresh',
                  value: 'refresh',
                }],
              },
            ],
          }).catch(() => {});
        },
      }],
    });
  }

  return async function handleStatusCmd(channel: string, adapter: PlatformAdapter): Promise<CommandResult | void> {
    const text = getExecutionStatusReport ? getExecutionStatusReport() : 'Execution status reporting is not available in this process.';

    if (!router) {
      await adapter.postMessage({ type: 'interactive-reply', conduit: channel, sessionId: '' }, { text });
      return;
    }

    return {
      text,
      richBlocks: [{ type: 'section' as const, text }],
      actions: [{
        type: 'button',
        text: 'Refresh',
        actionId: 'cmd:status:refresh',
        value: 'refresh',
      }],
    };
  };
}

// --- Help command categories ---

const HELP_CATEGORIES: Record<string, { label: string; commands: string[] }> = {
  session: {
    label: 'Session',
    commands: [
      '`!new` — start a new conversation; runs pre-close hook (`!newq` to skip)',
      '`!cancel [taskId]` — stop current task, or a dispatched task by id',
      '`!resume [cortex-XXXX]` — list recent sessions, or switch to one',
    ],
  },
  config: {
    label: 'Config',
    commands: [
      '`!mode` — toggle API / Plan mode',
      '`!backend` — toggle Claude Code / Codex backend',
      '`!model [name]` — show or set Claude model',
      '`!profile [name]` — show active profile or switch to one',
      '`!skills` — list available skills',
    ],
  },
  monitoring: {
    label: 'Monitoring',
    commands: [
      '`!cost [project]` — show cost summary (global or per-project)',
      '`!status` — show running execution summary',
      '`!budget $X/d $Y/m` — set daily/monthly budget',
      '`!schedule` — list, add, pause, resume, or remove scheduled tasks',
    ],
  },
  tasks: {
    label: 'Tasks',
    commands: [
      '`!tasks <project>` — list all tasks with details for a project',
      '`!projects` — list projects and their registered channels',
      '`!register <project>` — register this channel for project task notifications',
      '`!unregister <project>` — unregister this channel from a project',
      '`!project-dir` — manage project code directories per machine',
    ],
  },
  devices: {
    label: 'Devices',
    commands: [
      '`!devices` — show online/offline status of all cortex-client devices',
      '`!nvidia-smi [machine]` — show GPU status (default: local)',
      '`!nvtop [machine|stop]` — live GPU monitor with sparkline view',
      '`!tail [stop]` — live-tail daemon.log',
      '`!sendFile <machine> <path>` — send a file to Slack',
    ],
  },
  threads: {
    label: 'Threads',
    commands: [
      '`!thread` — manage threads: status, start, add agent, cancel, list agents/templates',
      '`!agent [name|off]` — show, set, or disable default agent',
    ],
  },
};

function buildHelpText(category?: string): string {
  if (category && category !== 'all' && HELP_CATEGORIES[category]) {
    const cat = HELP_CATEGORIES[category];
    return `*Commands — ${cat.label}*\n${cat.commands.join('\n')}`;
  }
  const allCommands = Object.values(HELP_CATEGORIES).flatMap(c => c.commands);
  return ['*Commands*', ...allCommands, '`!help` — this message'].join('\n');
}

// Slack section blocks have a 3000-char limit; split into one block per category.
function buildHelpRichBlocks(category?: string): import('@platform/index.js').RichBlock[] {
  if (category && category !== 'all' && HELP_CATEGORIES[category]) {
    const cat = HELP_CATEGORIES[category];
    return [{ type: 'section' as const, text: `*Commands — ${cat.label}*\n${cat.commands.join('\n')}` }];
  }
  return Object.values(HELP_CATEGORIES).map(cat => ({
    type: 'section' as const,
    text: `*${cat.label}*\n${cat.commands.join('\n')}`,
  }));
}

const HELP_CATEGORY_KEYS = [...Object.keys(HELP_CATEGORIES), 'all'];

function buildHelpButtons(): import('@platform/index.js').ActionElement[] {
  const buttons: import('@platform/index.js').ActionElement[] = Object.entries(HELP_CATEGORIES).map(([key, cat]) => ({
    type: 'button' as const,
    text: cat.label,
    actionId: `cmd:help:cat-${key}`,
    value: key,
  }));
  buttons.push({
    type: 'button' as const,
    text: 'Show All',
    actionId: 'cmd:help:cat-all',
    value: 'all',
  });
  return buttons;
}

export function createHelpHandler(router?: CommandActionRouter) {
  if (router) {
    const categoryHandler = async (ctx: import('@platform/index.js').ActionContext) => {
      const adapter = router.getAdapter();
      if (!adapter || !ctx.messageRef) return;
      const text = buildHelpText(ctx.value);
      await adapter.updateMessage(ctx.messageRef, {
        text,
        richBlocks: [
          ...buildHelpRichBlocks(ctx.value),
          { type: 'actions', elements: buildHelpButtons() },
        ],
      }).catch(() => {});
    };
    router.registerCommand('help', {
      actions: HELP_CATEGORY_KEYS.map(key => ({
        actionId: `cat-${key}`,
        handler: categoryHandler,
      })),
    });
  }

  return async function handleHelpCmd(channel: string, adapter: PlatformAdapter): Promise<CommandResult | void> {
    const text = buildHelpText();

    if (!router) {
      await adapter.postMessage({ type: 'interactive-reply', conduit: channel, sessionId: '' }, { text });
      return;
    }

    return {
      text,
      richBlocks: buildHelpRichBlocks(),
      actions: buildHelpButtons(),
    };
  };
}

/** @deprecated Use createHelpHandler() instead. Kept for backward compat in tests. */
export async function handleHelp(channel: string, adapter: PlatformAdapter): Promise<void> {
  const handler = createHelpHandler();
  await handler(channel, adapter);
}
