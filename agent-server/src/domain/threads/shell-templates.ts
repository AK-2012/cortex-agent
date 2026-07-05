// input:  ShellTemplateBinding + the loaded agents map
// output: expandShellTemplate / isShellBinding — expand a shell binding into a full ThreadTemplate
// pos:    DR-0017 D6 Phase 2 — collapse structurally identical worker-review templates to a
//         parameterized shell + thin {worker, reviewer} bindings. Transition graphs live here
//         as code (one expander per shell) instead of being duplicated across the config.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { AgentDefinition, ThreadTemplate, ShellTemplateBinding } from '@core/types/thread-types.js';

// --- worker-review shell constants (the standard produce → review → converge loop) ---
const APPROVED_MARKER = '[APPROVED]';
const REVISED_PATTERN = '\\[REVISED\\]';
const RETRY_STAGE = 'retry';
const DEFAULT_MAX_STEPS = 4;
const POST_TASK_HOOK_COMMAND = 'node ~/.cortex/hooks/post-task-hook.mjs';
const POST_TASK_HOOK_TIMEOUT = 10000;

type ShellExpander = (
  name: string,
  binding: ShellTemplateBinding,
  agents: Record<string, AgentDefinition>,
) => ThreadTemplate;

/** Type guard: a config template entry is a shell binding (needs expansion) vs a full template. */
export function isShellBinding(value: unknown): value is ShellTemplateBinding {
  return typeof value === 'object' && value !== null && typeof (value as any).shell === 'string';
}

/**
 * worker-review shell: worker(produce) → reviewer → (if not [APPROVED]) worker(retry, [REVISED]) → END.
 * The produce stage is derived from the worker agent's `entryStage`; the retry stage is fixed.
 */
function expandWorkerReview(
  name: string,
  binding: ShellTemplateBinding,
  agents: Record<string, AgentDefinition>,
): ThreadTemplate {
  const { worker, reviewer } = binding;
  if (typeof worker !== 'string' || !worker) throw new Error(`shell template "${name}": missing "worker" binding`);
  if (typeof reviewer !== 'string' || !reviewer) throw new Error(`shell template "${name}": missing "reviewer" binding`);

  const workerAgent = agents[worker];
  if (!workerAgent) throw new Error(`shell template "${name}": worker agent "${worker}" not found`);
  const reviewerAgent = agents[reviewer];
  if (!reviewerAgent) throw new Error(`shell template "${name}": reviewer agent "${reviewer}" not found`);

  const produceStage = workerAgent.entryStage;
  if (!produceStage) throw new Error(`shell template "${name}": worker agent "${worker}" has no entryStage (needed as the produce stage)`);
  if (!workerAgent.stages?.[RETRY_STAGE]) throw new Error(`shell template "${name}": worker agent "${worker}" has no "${RETRY_STAGE}" stage`);

  return {
    name,
    description: binding.description ?? `${worker} produces → ${reviewer} reviews → converge (max 1 retry)`,
    agents: [worker, reviewer],
    transitions: [
      { from: `${worker}:${produceStage}`, to: reviewer, condition: { type: 'always' } },
      { from: reviewer, to: `${worker}:${RETRY_STAGE}`, condition: { type: 'convergence', marker: APPROVED_MARKER, maxIterations: 1 } },
      { from: `${worker}:${RETRY_STAGE}`, to: reviewer, condition: { type: 'output_not_contains', pattern: REVISED_PATTERN } },
    ],
    entryAgent: worker,
    entryStage: produceStage,
    maxTotalSteps: binding.maxTotalSteps ?? DEFAULT_MAX_STEPS,
    hooks: { onEnd: { command: POST_TASK_HOOK_COMMAND, args: [worker], timeout: POST_TASK_HOOK_TIMEOUT } },
  };
}

const SHELL_EXPANDERS: Record<string, ShellExpander> = {
  'worker-review': expandWorkerReview,
};

/** Expand a shell binding into a full ThreadTemplate. Throws on unknown shell or invalid binding. */
export function expandShellTemplate(
  name: string,
  binding: ShellTemplateBinding,
  agents: Record<string, AgentDefinition>,
): ThreadTemplate {
  const expander = SHELL_EXPANDERS[binding.shell];
  if (!expander) throw new Error(`shell template "${name}": unknown shell "${binding.shell}"`);
  return expander(name, binding, agents);
}
