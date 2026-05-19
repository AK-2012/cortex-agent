import type { PlatformAdapter } from '@platform/index.js';
import type { CommandResult } from './command-context.js';
import type { CommandActionRouter } from '@orch/interactions/command-action-router.js';
import type { ModalDefinition } from '@platform/types.js';
import { channelRepo } from '@store/channel-repo.js';
import { projectDirRepo } from '@store/project-dir-repo.js';
import { getMachineRegistry } from '@domain/tasks/dispatch-utils.js';

export async function handleProjectsCmd(channel: string, adapter: PlatformAdapter): Promise<void> {
  const projects = await channelRepo.listProjects();
  if (projects.length === 0) {
    await adapter.postMessage(channel, { text: 'No projects found.' });
    return;
  }
  const registrations = await channelRepo.getAllRegistrations();
  const lines = projects.map(p => {
    const ch = registrations[p];
    const status = ch ? ` → <#${ch}>` : '';
    return `• \`${p}\`${status}`;
  });
  await adapter.postMessage(channel, { text: `*Projects*\n${lines.join('\n')}` });
}

const MAX_PROJECT_BUTTONS = 10;

export function createRegisterHandler(router?: CommandActionRouter) {
  if (router) {
    const registerHandler = async (ctx: import('@platform/index.js').ActionContext) => {
      const adapter = router.getAdapter();
      if (!adapter) return;
      const project = ctx.value;
      try {
        await channelRepo.setProjectChannel(project, ctx.channelId);
        if (ctx.messageRef) {
          await adapter.updateMessage(ctx.messageRef, {
            text: `:white_check_mark: Registered for \`${project}\` task notifications.`,
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
    const args = trimmedMessage.split(/\s+/).slice(1);

    if (args.length > 0) {
      const project = args[0];
      const projects = await channelRepo.listProjects();
      if (!projects.includes(project)) {
        await adapter.postMessage(channel, { text: `:x: Unknown project: \`${project}\`\nAvailable: ${projects.map(p => `\`${p}\``).join(', ')}` });
        return;
      }
      await channelRepo.setProjectChannel(project, channel);
      await adapter.postMessage(channel, { text: `:white_check_mark: This channel is now registered for project \`${project}\` task notifications.` });
      return;
    }

    const registrations = await channelRepo.getAllRegistrations();
    const bound = Object.entries(registrations).filter(([, ch]) => ch === channel).map(([p]) => p);
    const projects = await channelRepo.listProjects();
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
      await adapter.postMessage(channel, { text });
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
  const args = trimmedMessage.split(/\s+/).slice(1);
  if (args.length === 0) {
    await adapter.postMessage(channel, { text: 'Usage: `!unregister <project>`' });
    return;
  }
  const project = args[0];
  const current = await channelRepo.getProjectChannel(project);
  if (!current || current !== channel) {
    await adapter.postMessage(channel, { text: `:x: This channel is not registered for project \`${project}\`.` });
    return;
  }
  await channelRepo.removeProjectChannel(project);
  await adapter.postMessage(channel, { text: `:white_check_mark: Unregistered this channel from project \`${project}\`.` });
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
          const project = ctx.values?.pd_project?.text?.value;
          const machine = ctx.values?.pd_machine?.selection?.selectedOption?.value;
          const dirPath = ctx.values?.pd_path?.text?.value;
          if (!project || !machine || !dirPath) return;
          await projectDirRepo.setProjectDir(project, machine, dirPath);
          await adapter.postMessage(channel, {
            text: `:white_check_mark: \`${project}\` on \`${machine}\` → \`${dirPath}\``,
          });
        },
      }],
    });
  }

  return async function handleProjectDirCmdInteractive(
    channel: string, adapter: PlatformAdapter, trimmedMessage: string,
  ): Promise<CommandResult | void> {
    const args = trimmedMessage.split(/\s+/).slice(1);

    if (args.length > 0) {
      if (args.length < 2) {
        await adapter.postMessage(channel, { text: ':x: Usage: `!project-dir <project> <machine> <path>` or `!project-dir <project> <machine> --remove`' });
        return;
      }
      const [project, machine] = args;
      const validMachines = Object.keys(getMachineRegistry());
      if (!validMachines.includes(machine)) {
        await adapter.postMessage(channel, { text: `:x: Unknown machine: \`${machine}\`\nValid: ${validMachines.map(m => `\`${m}\``).join(', ')}` });
        return;
      }
      if (args.length === 2 || args[2] === '--remove') {
        if (args[2] === '--remove') {
          await projectDirRepo.removeProjectDir(project, machine);
          await adapter.postMessage(channel, { text: `:white_check_mark: Removed \`${project}\` directory on \`${machine}\`.` });
        } else {
          const dir = await projectDirRepo.getProjectDir(project, machine);
          if (dir) {
            await adapter.postMessage(channel, { text: `\`${project}\` on \`${machine}\` → \`${dir}\`` });
          } else {
            await adapter.postMessage(channel, { text: `No directory registered for \`${project}\` on \`${machine}\`.` });
          }
        }
        return;
      }
      const dirPath = args.slice(2).join(' ');
      await projectDirRepo.setProjectDir(project, machine, dirPath);
      await adapter.postMessage(channel, { text: `:white_check_mark: \`${project}\` on \`${machine}\` → \`${dirPath}\`` });
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
      await adapter.postMessage(channel, { text });
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
