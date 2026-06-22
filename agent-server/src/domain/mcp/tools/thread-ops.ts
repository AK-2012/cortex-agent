// input:  McpServer, webhook proxy, CORTEX_THREAD_ID env
// output: thread_abort / thread_split / thread_wait registrations (DR-0015 control plane)
// pos:    Self-control of the CALLER'S OWN thread, proxied through the daemon webhook. An agent
//         signals its own thread (CORTEX_THREAD_ID) and the runner reads metadata.pendingControl at
//         the step boundary — no artifact string markers. The agent-facing thread spawn/monitor
//         tools (thread_start + thread_status/result/list/list_templates/cancel) were REMOVED:
//         delegation is now done via the task system (cortex-task spawn / add) and monitored via the
//         read-only task_* tools. thread_wait is the suspend primitive paired with cortex-task spawn.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Thread operations proxied through the daemon webhook (separate process, no shared memory with
// the thread runner / store / live PlatformAdapter, all of which live in the daemon).
const WEBHOOK_BASE = `http://127.0.0.1:${process.env.WEBHOOK_PORT || '3001'}`;

async function proxyThreadOp(action: string, payload: Record<string, any>): Promise<any> {
  const res = await fetch(`${WEBHOOK_BASE}/webhook/thread-op`, {
    method: 'POST',
    // Bearer token for the webhook auth gate. Inherited from the daemon's env (see core/auth.ts).
    headers: { 'Content-Type': 'application/json', 'x-cortex-token': process.env.CORTEX_WEBHOOK_TOKEN || '' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json() as any;
  if (!data.success) throw new Error(data.error || 'thread-op failed');
  return data.data;
}

export function registerThreadTools(server: McpServer): void {
  // --- Control plane (DR-0015): self-control of the CALLER'S OWN thread ---
  // All three target CORTEX_THREAD_ID (the thread you are running inside) — you never pass a
  // threadId. They write a structured intent the runner consumes at the next step boundary, then
  // your step should end. Calling outside a thread (no CORTEX_THREAD_ID) is an error.

  const selfThreadId = (): string => {
    const id = process.env.CORTEX_THREAD_ID;
    if (!id) throw new Error('not running inside a thread (CORTEX_THREAD_ID unset) — control tools only work from within a thread');
    return id;
  };

  // --- thread_abort ---

  server.tool(
    'thread_abort',
    'Abort (escalate) YOUR OWN thread when the task cannot be completed as scoped — terminal state `aborted`, distinct from `failed`. Use only when truly blocked: a missing prerequisite, contradictory requirements, or a task far bigger / mis-scoped than its description. A precise diagnosis is the most valuable thing you can produce — it beats a half-done grind. For a dispatch task this blocks the task with your diagnosis and escalates it (its manager, or a human, re-plans). Normal retries, minor issues, or disagreements with the plan are NOT abort cases. After calling, end your step.',
    {
      kind: z.enum(['too-big', 'mis-scoped', 'blocked-external']).describe('Why you are aborting: "too-big" (needs decomposition into independent units), "mis-scoped" (the task definition is wrong) — both route to a re-planning manager; "blocked-external" (a missing external resource / dependency you cannot obtain) routes to a human.'),
      diagnosis: z.string().min(1).describe('Required one-line diagnosis of the real structure / blocker. Becomes the abort reason and the task block reason.'),
    },
    async ({ kind, diagnosis }: { kind: string; diagnosis: string }) => {
      try {
        const threadId = selfThreadId();
        const result = await proxyThreadOp('control', { threadId, control: { action: 'abort', kind, diagnosis } });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `thread_abort error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  // --- thread_split ---

  server.tool(
    'thread_split',
    'Propose a decomposition of YOUR OWN (dispatch) task instead of doing it: the task is decomposed into the given children (keep-parent — your task becomes the join/acceptance node depending on all children), unclaimed, and the children flow through the normal dispatch queue. Use when the task is actually several independently verifiable units. After calling, end your step.',
    {
      subtasks: z.array(z.object({
        key: z.string().optional().describe('Local key for sibling depends_on references within this batch.'),
        text: z.string().describe('What this child must do (imperative, one unit of work).'),
        template: z.string().optional().describe('Thread template the child runs under (e.g. coder-review). Inherits the parent template when omitted.'),
        why: z.string().optional().describe('Why this child exists.'),
        done_when: z.string().optional().describe('Verifiable completion criteria for this child.'),
        priority: z.string().optional(),
        plan: z.string().optional(),
        depends_on: z.array(z.string()).optional().describe('Sibling keys (from this batch) or existing 4-hex task ids this child depends on.'),
      })).min(1).describe('Non-empty array of child subtasks (decomposeTask shape).'),
    },
    async ({ subtasks }: { subtasks: any[] }) => {
      try {
        const threadId = selfThreadId();
        const result = await proxyThreadOp('control', { threadId, control: { action: 'split', subtasks } });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `thread_split error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  // --- thread_wait ---

  server.tool(
    'thread_wait',
    'Suspend YOUR OWN thread until its awaited children finish (DR-0014 parent suspension). Call this after creating child tasks you depend on (cortex-task spawn) — you are re-entered once ALL awaited children are terminal, with their results injected. If nothing is left to wait on, the thread simply continues. After calling, end your step.',
    {
      on_tasks: z.array(z.string()).optional().describe('Optional explicit child task ids to wait on (otherwise inferred from the thread / task tree).'),
      on_threads: z.array(z.string()).optional().describe('Optional explicit child thread ids to wait on (otherwise inferred from spawned children).'),
    },
    async ({ on_tasks, on_threads }: { on_tasks?: string[]; on_threads?: string[] }) => {
      try {
        const threadId = selfThreadId();
        const result = await proxyThreadOp('control', { threadId, control: { action: 'wait', on_tasks, on_threads } });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `thread_wait error: ${(e as Error).message}` }], isError: true };
      }
    },
  );
}
