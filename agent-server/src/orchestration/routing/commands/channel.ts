import type { PlatformAdapter, Destination } from '@platform/index.js';
import type { CommandResult } from './command-context.js';
import type { CommandActionRouter } from '@orch/interactions/command-action-router.js';
import type { ModalDefinition } from '@platform/types.js';
import { projectStore } from '@domain/projects/index.js';
import { projectDirRepo } from '@store/project-dir-repo.js';
import { Icons } from '../../../core/icons.js';
import { getMachineRegistry } from '@domain/tasks/dispatch-utils.js';

/**
 * Render a (possibly platform-prefixed) conduit for display.
 * Slack channels become a `<#id>` mention; other platforms (Feishu/TUI) show
 * the bare id in code formatting since `<#…>` is Slack-only syntax.
 */
function displayConduit(conduit: string): string {
  if (conduit.startsWith('slack:')) return `<#${conduit.slice('slack:'.length)}>`;
  const colon = conduit.indexOf(':');
  const bare = colon === -1 ? conduit : conduit.slice(colon + 1);
  return `\`${bare}\``;
}

export async function handleProjectsCmd(channel: string, adapter: PlatformAdapter): Promise<void> {
  const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  const projects = projectStore.list().map(p => p.id);
  if (projects.length === 0) {
    await adapter.postMessage(dest, { text: 'No projects found.' });
    return;
  }
  const registrations = await adapter.getProjectConduits();
  const lines = projects.map(p => {
    const ch = registrations[p];
    const status = ch ? ` → ${displayConduit(ch)}` : '';
    return `• \`${p}\`${status}`;
  });
  await adapter.postMessage(dest, { text: `*Projects*\n${lines.join('\n')}` });
}

const MAX_PROJECT_BUTTONS = 10;

export function createRegisterHandler(router?: CommandActionRouter) {
  if (router) {
    const registerHandler = async (ctx: import('@platform/index.js').ActionContext) => {
      const adapter = router.getAdapter();
      if (!adapter) return;
      const project = ctx.value;
      try {
        await adapter.bindProjectConduit(project, ctx.channelId);
        if (ctx.messageRef) {
          await adapter.updateMessage(ctx.messageRef, {
            text: `${Icons.ok} Registered for \`${project}\` task notifications.`,
          }).catch(() => {});
        }
      } catch { /* ignore */ }
    };
    router.registerCommand('register', {
      actions: Array.from({ length: MAX_PROJECT_BUTTONS }, (_, i) => ({
        actionId: `project-${i}`,
        handler: registerHandler,
      })),
    });
  }

  return async function handleRegisterCmdInteractive(
    channel: string, adapter: PlatformAdapter, trimmedMessage: string,
  ): Promise<CommandResult | void> {
    const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
    const args = trimmedMessage.split(/\s+/).slice(1);

    if (args.length > 0) {
      const project = args[0];
      const projects = projectStore.list().map(p => p.id);
      if (!projects.includes(project)) {
        await adapter.postMessage(dest, { text: `${Icons.error} Unknown project: \`${project}\`\nAvailable: ${projects.map(p => `\`${p}\``).join(', ')}` });
        return;
      }
      await adapter.bindProjectConduit(project, channel);
      await adapter.postMessage(dest, { text: `${Icons.ok} This channel is now registered for project \`${project}\` task notifications.` });
      return;
    }

    const registrations = await adapter.getProjectConduits();
    const bound = Object.entries(registrations).filter(([, ch]) => ch === channel).map(([p]) => p);
    const projects = projectStore.list().map(p => p.id);
    const unbound = projects.filter(p => !bound.includes(p));

    const lines: string[] = [];
    if (bound.length > 0) {
      lines.push(`Registered: ${bound.map(p => `\`${p}\``).join(', ')}`);
    } else {
      lines.push('This channel is not registered to any project.');
    }
    if (unbound.length > 0) {
      lines.push(`Available: ${unbound.map(p => `\`${p}\``).join(', ')}`);
    }
    const text = lines.join('\n');

    if (!router || unbound.length === 0) {
      await adapter.postMessage(dest, { text });
      return;
    }

    return {
      text,
      richBlocks: [{ type: 'section' as const, text }],
      actions: unbound.slice(0, MAX_PROJECT_BUTTONS).map((p, i) => ({
        type: 'button' as const,
        text: p.length > 20 ? p.slice(0, 17) + '...' : p,
        actionId: `cmd:register:project-${i}`,
        value: p,
        style: 'primary' as const,
      })),
    };
  };
}

/** @deprecated Use createRegisterHandler() instead. */
export async function handleRegisterCmd(channel: string, adapter: PlatformAdapter, trimmedMessage: string): Promise<void> {
  const handler = createRegisterHandler();
  await handler(channel, adapter, trimmedMessage);
}

export async function handleUnregisterCmd(channel: string, adapter: PlatformAdapter, trimmedMessage: string): Promise<void> {
  const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  const args = trimmedMessage.split(/\s+/).slice(1);
  if (args.length === 0) {
    await adapter.postMessage(dest, { text: 'Usage: `!unregister <project>`' });
    return;
  }
  const project = args[0];
  const registrations = await adapter.getProjectConduits();
  const current = registrations[project] ?? null;
  if (!current || current !== channel) {
    await adapter.postMessage(dest, { text: `${Icons.error} This channel is not registered for project \`${project}\`.` });
    return;
  }
  await adapter.unbindProjectConduit(project);
  await adapter.postMessage(dest, { text: `${Icons.ok} Unregistered this channel from project \`${project}\`.` });
}

function buildProjectDirModal(channel: string): ModalDefinition {
  const machines = Object.keys(getMachineRegistry());
  return {
    callbackId: 'cmd_project_dir_add',
    title: 'Add Project Directory',
    submitLabel: 'Save',
    privateMetadata: JSON.stringify({ channel }),
    fields: [
      { type: 'text_input', blockId: 'pd_project', label: 'Project name', actionId: 'text', placeholder: 'e.g. example-project-dataset' },
      {
        type: 'select', blockId: 'pd_machine', label: 'Machine', actionId: 'selection',
        options: machines.map(m => ({ label: m, value: m })),
      },
      { type: 'text_input', blockId: 'pd_path', label: 'Directory path', actionId: 'text', placeholder: 'e.g. /home/user/project' },
    ],
  };
}

export function createProjectDirHandler(router?: CommandActionRouter) {
  if (router) {
    router.registerCommand('project-dir', {
      actions: [{
        actionId: 'open-add',
        handler: async (ctx) => {
          const adapter = router.getAdapter();
          if (!adapter) return;
          await adapter.openModal(ctx.triggerId, buildProjectDirModal(ctx.channelId));
        },
      }],
      modals: [{
        callbackId: 'cmd_project_dir_add',
        handler: async (ctx) => {
          await ctx.ack();
          const adapter = router.getAdapter();
          if (!adapter) return;
          const { channel } = JSON.parse(ctx.privateMetadata);
          const modalDest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
          const project = ctx.values?.pd_project?.text?.value;
          const machine = ctx.values?.pd_machine?.selection?.selectedOption?.value;
          const dirPath = ctx.values?.pd_path?.text?.value;
          if (!project || !machine || !dirPath) return;
          await projectDirRepo.setProjectDir(project, machine, dirPath);
          await adapter.postMessage(modalDest, {
            text: `${Icons.ok} \`${project}\` on \`${machine}\` → \`${dirPath}\``,
          });
        },
      }],
    });
  }

  return async function handleProjectDirCmdInteractive(
    channel: string, adapter: PlatformAdapter, trimmedMessage: string,
  ): Promise<CommandResult | void> {
    const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
    const args = trimmedMessage.split(/\s+/).slice(1);

    if (args.length > 0) {
      if (args.length < 2) {
        await adapter.postMessage(dest, { text: `${Icons.error} Usage: \`!project-dir <project> <machine> <path>\` or \`!project-dir <project> <machine> --remove\`` });
        return;
      }
      const [project, machine] = args;
      const validMachines = Object.keys(getMachineRegistry());
      if (!validMachines.includes(machine)) {
        await adapter.postMessage(dest, { text: `${Icons.error} Unknown machine: \`${machine}\`\nValid: ${validMachines.map(m => `\`${m}\``).join(', ')}` });
        return;
      }
      if (args.length === 2 || args[2] === '--remove') {
        if (args[2] === '--remove') {
          await projectDirRepo.removeProjectDir(project, machine);
          await adapter.postMessage(dest, { text: `${Icons.ok} Removed \`${project}\` directory on \`${machine}\`.` });
        } else {
          const dir = await projectDirRepo.getProjectDir(project, machine);
          if (dir) {
            await adapter.postMessage(dest, { text: `\`${project}\` on \`${machine}\` → \`${dir}\`` });
          } else {
            await adapter.postMessage(dest, { text: `No directory registered for \`${project}\` on \`${machine}\`.` });
          }
        }
        return;
      }
      const dirPath = args.slice(2).join(' ');
      await projectDirRepo.setProjectDir(project, machine, dirPath);
      await adapter.postMessage(dest, { text: `${Icons.ok} \`${project}\` on \`${machine}\` → \`${dirPath}\`` });
      return;
    }

    const allDirs = await projectDirRepo.getAllProjectDirs();
    const entries = Object.entries(allDirs);
    const lines = entries.length > 0
      ? entries.flatMap(([project, machines]) =>
          Object.entries(machines).map(([machine, dir]) => `• \`${project}\` on \`${machine}\` → \`${dir}\``)
        )
      : ['No project directories registered.'];
    const text = `*Project Directories*\n${lines.join('\n')}`;

    if (!router) {
      await adapter.postMessage(dest, { text });
      return;
    }

    return {
      text,
      richBlocks: [{ type: 'section' as const, text }],
      actions: [{
        type: 'button' as const,
        text: 'Add',
        actionId: 'cmd:project-dir:open-add',
        value: 'add',
        style: 'primary' as const,
      }],
    };
  };
}

/** @deprecated Use createProjectDirHandler() instead. */
export async function handleProjectDirCmd(channel: string, adapter: PlatformAdapter, trimmedMessage: string): Promise<void> {
  const handler = createProjectDirHandler();
  await handler(channel, adapter, trimmedMessage);
}
