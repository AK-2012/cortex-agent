// Pure thread utility helpers — no I/O, no config.
// input:  thread-store, thread-types
// output: isDefaultThread / isAdHocThread / getSessionKey / parseTarget / resolveStageName

import { threadStore } from '@store/thread-repo.js';
import type { AgentDefinition, AgentSlotConfig, AgentSlotId } from '@core/types/thread-types.js';

/** Check if a thread is using the default single-agent template */
export function isDefaultThread(threadId: string): boolean {
  const thread = threadStore.get(threadId);
  if (!thread) return false;
  return thread.templateName === 'default';
}

/** Check if a thread is ad-hoc (no template) */
export function isAdHocThread(threadId: string): boolean {
  const thread = threadStore.get(threadId);
  if (!thread) return false;
  return thread.templateName === null;
}

/** Get the session key for a specific agent slot in a thread */
export function getSessionKey(threadId: string, slotId: AgentSlotId): string {
  return `thr:${threadId}:${slotId}`;
}

/** Parse a transition endpoint string — either `"agent"` or `"agent:stage"` — into its components.
 *  When the stage suffix is absent, resolve to the agent's `entryStage` (or the first declared
 *  stage, or null for agents with no `stages` map). The agent itself need not be loaded to parse;
 *  `getStageEntry` on the returned shape handles unknown agents gracefully. */
export function parseTarget(endpoint: string): { agent: string; stage: string | null } {
  const colon = endpoint.indexOf(':');
  if (colon < 0) return { agent: endpoint, stage: null };
  const agent = endpoint.slice(0, colon);
  const stage = endpoint.slice(colon + 1);
  return { agent, stage: stage.length > 0 ? stage : null };
}

/** Resolve the stage name that should actually run for an agent given an explicit stage or null.
 *  Returns null for single-stage agents (no `stages` map). Falls back to entryStage, then to
 *  the first declared stage name. */
export function resolveStageName(agentDef: AgentDefinition | AgentSlotConfig | null, explicit: string | null): string | null {
  if (!agentDef || !agentDef.stages) return null;
  const stageNames = Object.keys(agentDef.stages);
  if (stageNames.length === 0) return null;
  if (explicit && agentDef.stages[explicit]) return explicit;
  if (agentDef.entryStage && agentDef.stages[agentDef.entryStage]) return agentDef.entryStage;
  return stageNames[0];
}
