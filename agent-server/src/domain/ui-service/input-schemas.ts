// input:  zod + ui-service scope/op unions (./types.js)
// output: zod input schema per QueryScope / MutateOp + keyed maps (queryInputSchemas /
//         mutateInputSchemas). Single source of truth; consumed by the tRPC AppRouter
//         and re-exported (runtime) by @cortex-agent/ui-contract for the browser.
// pos:    leaf schema module for the ui-service contract. Kept HERE (not in ui-contract)
//         so the router can consume it without agent-server importing ui-contract — that
//         import would close a workspace build cycle (ui-contract re-exports agent-server
//         types). Contract stays acyclic: agent-server ← ui-contract ← web.
// >>> If I am updated, update CORTEX.md and the parent folder's CORTEX.md <<<

import { z } from 'zod';
import type { QueryScope, MutateOp } from './types.js';

// ── Query input schemas ───────────────────────────────────────────

export const projectsListInput = z.object({});

export const sessionsListInput = z.object({
  projectId: z.string().optional(),
  resumable: z.boolean().optional(),
});

export const threadsListInput = z.object({
  projectId: z.string().optional(),
  status: z.array(z.string()).optional(),
});

export const threadsGetInput = z.object({
  threadId: z.string(),
});

export const tasksListInput = z.object({
  projectId: z.string().optional(),
  status: z.enum(['open', 'done']).optional(),
  actionable: z.boolean().optional(),
});

export const schedulesListInput = z.object({
  projectId: z.string().optional(),
  paused: z.boolean().optional(),
});

export const executionsListInput = z.object({
  status: z.array(z.string()).optional(),
  limit: z.number().optional(),
});

export const executionsGetInput = z.object({
  executionId: z.string(),
});

export const costSummaryInput = z.object({
  projectId: z.string().nullish(),
});

// ── Subscription input schemas ────────────────────────────────────
// Subscriptions are not part of the query/mutate keyed maps; their input schemas live here too so
// the AppRouter and the browser (@cortex-agent/ui-contract) share one source of truth (B2-C).

export const executionsLogInput = z.object({
  executionId: z.string(),
});

// ── Mutate input schemas ──────────────────────────────────────────

export const threadsCancelInput = z.object({
  threadId: z.string(),
});

export const executionsCancelInput = z.object({
  executionId: z.string(),
});

export const scheduleActionInput = z.object({
  scheduleId: z.string(),
});

export const taskActionInput = z.object({
  projectId: z.string(),
  taskId: z.string(),
});

export const taskCompleteInput = z.object({
  projectId: z.string(),
  taskId: z.string(),
  note: z.string().optional(),
});

export const taskBlockInput = z.object({
  projectId: z.string(),
  taskId: z.string(),
  reason: z.string(),
});

// ── Keyed maps (one entry per QueryScope / MutateOp) ──────────────

export const queryInputSchemas = {
  'projects.list': projectsListInput,
  'sessions.list': sessionsListInput,
  'threads.list': threadsListInput,
  'threads.get': threadsGetInput,
  'tasks.list': tasksListInput,
  'schedules.list': schedulesListInput,
  'executions.list': executionsListInput,
  'executions.get': executionsGetInput,
  'cost.summary': costSummaryInput,
} satisfies Record<QueryScope, z.ZodType>;

export const mutateInputSchemas = {
  'threads.cancel': threadsCancelInput,
  'executions.cancel': executionsCancelInput,
  'schedules.pause': scheduleActionInput,
  'schedules.resume': scheduleActionInput,
  'schedules.remove': scheduleActionInput,
  'tasks.claim': taskActionInput,
  'tasks.unclaim': taskActionInput,
  'tasks.complete': taskCompleteInput,
  'tasks.block': taskBlockInput,
  'tasks.unblock': taskActionInput,
} satisfies Record<MutateOp, z.ZodType>;
