// input:  @platform/index.js + @orch/interactions/command-action-router.js + @domain/system/update-prompt.js
// output: createSlackUpdatePrompt(adapter, router, opts?) => UpdatePrompt
// pos:    Slack-specific UpdatePrompt implementation — pre-registers three actionIds on router,
//         posts interactive message to system-notice, resolves ask() promise on button click.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { PlatformAdapter, ActionElement, MessageRef } from '@platform/index.js';
import type { CommandActionRouter } from '@orch/interactions/command-action-router.js';
import type { UpdateChoice, UpdatePrompt } from '@domain/system/update-prompt.js';

// --- Internal state ---

interface PendingState {
  resolve: (value: UpdateChoice | null) => void;
  messageRef: MessageRef;
  latestVersion: string;
}

const DEFAULT_TIMEOUT_MS = 86_400_000; // 24h

// --- Factory ---

export function createSlackUpdatePrompt(
  adapter: PlatformAdapter,
  router: CommandActionRouter,
  opts?: { timeoutMs?: number },
): UpdatePrompt {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let pending: PendingState | null = null;
  let timerHandle: ReturnType<typeof setTimeout> | undefined;

  // --- Internal helpers ---

  const clearPending = () => {
    if (timerHandle !== undefined) {
      clearTimeout(timerHandle);
      timerHandle = undefined;
    }
    pending = null;
  };

  const resolveText = (choice: UpdateChoice, version: string): string => {
    switch (choice) {
      case 'apply':
        return `Installing @cortex-agent/server@${version}... daemon will restart shortly.`;
      case 'skip':
        return `Skipped version ${version}.`;
      case 'cancel':
        return `Update cancelled. Will check again at next interval.`;
    }
  };

  // --- Build click handlers ---

  const buildHandler = (choice: UpdateChoice) => {
    return async (ctx: import('@platform/index.js').ActionContext): Promise<void> => {
      if (!pending) return; // stale click — no pending prompt

      const p = pending;
      const version = p.latestVersion;
      clearPending();
      p.resolve(choice);

      if (ctx.messageRef) {
        await adapter.updateMessage(ctx.messageRef, { text: resolveText(choice, version) }).catch(() => {});
      }
    };
  };

  // --- Pre-register three actionIds on router ---

  router.registerCommand('update', {
    actions: [
      { actionId: 'apply', handler: buildHandler('apply') },
      { actionId: 'skip', handler: buildHandler('skip') },
      { actionId: 'cancel', handler: buildHandler('cancel') },
    ],
  });

  // --- Button templates (value filled in at ask time) ---

  const buttonTemplates: ActionElement[] = [
    { type: 'button', text: 'Update', actionId: 'cmd:update:apply', value: '', style: 'primary' },
    { type: 'button', text: 'Skip this version', actionId: 'cmd:update:skip', value: '' },
    { type: 'button', text: 'Cancel', actionId: 'cmd:update:cancel', value: '', style: 'danger' },
  ];

  // --- Return the UpdatePrompt implementation ---

  return {
    async ask(spec) {
      // Resolve any existing pending prompt
      if (pending) {
        const old = pending;
        clearPending();
        old.resolve(null);
        if (old.messageRef) {
          await adapter.updateMessage(old.messageRef, { text: 'Superseded by a newer update prompt.' }).catch(() => {});
        }
      }

      // Stamp version onto buttons
      const versionedButtons = buttonTemplates.map(b => ({ ...b, value: spec.latestVersion }));

      // Post interactive message to admin DM
      const messageRef = await adapter.postInteractive(
        { type: 'system-notice' },
        {
          text: `Cortex Server v${spec.latestVersion} is available. Update now?`,
          richBlocks: [
            { type: 'section', text: `Cortex Server v${spec.latestVersion} is available.` },
            { type: 'actions', elements: versionedButtons },
          ],
          actions: versionedButtons,
        },
      );

      // Create new pending promise
      return new Promise<UpdateChoice | null>((resolve) => {
        pending = { resolve, messageRef, latestVersion: spec.latestVersion };

        timerHandle = setTimeout(() => {
          if (!pending || pending.resolve !== resolve) return; // already handled
          const ref = pending.messageRef;
          clearPending();
          resolve(null);
          adapter.updateMessage(ref, { text: 'Update prompt timed out.' }).catch(() => {});
        }, timeoutMs).unref();
      });
    },
  };
}
