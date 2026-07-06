// Zod input schemas for every ui-service query scope and mutate op.
// These mirror QueryParamMap / MutateArgsMap in agent-server (see contract.parity.ts
// for the compile-time drift guard that keeps them in lock-step). Task 3's tRPC
// router consumes queryInputSchemas / mutateInputSchemas by key.

import { z } from 'zod';
import type { QueryScope, MutateOp } from './dto.js';

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

export const costSummaryInput = z.object({
  projectId: z.string().nullish(),
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
  'tasks.list': tasksListInput,
  'schedules.list': schedulesListInput,
  'executions.list': executionsListInput,
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
