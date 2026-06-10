// input:  McpServer, webhook proxy, CORTEX_* env (channel/project/depth)
// output: thread_start/status/result/list_templates/cancel tool registrations
// pos:    MCP tools letting any agent drive the Thread (multi-agent pipeline) system, proxied
//         through the daemon webhook. Async: thread_start fires-and-returns a threadId; poll
//         thread_status / thread_result. Depth guard caps agent→thread→agent recursion.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Thread operations proxied through the daemon webhook (separate process, no shared memory with
// the thread runner / store / live PlatformAdapter, all of which live in the daemon).
const WEBHOOK_BASE = `http://127.0.0.1:${process.env.WEBHOOK_PORT || '3001'}`;

async function proxyThreadOp(action: string, payload: Record<string, any>): Promise<any> {
  const res = await fetch(`${WEBHOOK_BASE}/webhook/thread-op`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json() as any;
  if (!data.success) throw new Error(data.error || 'thread-op failed');
  return data.data;
}

export function registerThreadTools(server: McpServer): void {
  // --- thread_start ---

  server.tool(
    'thread_start',
    'Start a Thread (multi-agent pipeline) and return its threadId immediately (async — does NOT wait for completion). Provide exactly one of `template` (a multi-agent pipeline) or `agent` (a single ad-hoc agent); use thread_list_templates to discover both. '
    + 'For substantive delegated work, pass a structured contract (goal / done_when / deliverable_path / context_files / budget_usd) — your child is graded against done_when and you must verify its deliverable before accepting. Reserve bare-message calls for small, quick side-quests; substantial multi-step work belongs in the task system ([SPLIT]) instead. '
    + 'If you are an agent inside a thread: spawns default to wait=true — after spawning, end your current step with the marker [WAIT_CHILDREN] to suspend; you will be re-entered with each child\'s result once ALL awaited children finish. Pass wait=false for fire-and-forget. Interactive (non-thread) callers are woken automatically on completion. Spawns can be rejected by tree guards (max children / nodes / budget) — do not retry a rejected spawn; fold the work in or escalate.',
    {
      template: z.string().optional().describe('Template name for a multi-agent pipeline (mutually exclusive with `agent`)'),
      agent: z.string().optional().describe('Agent name for a single ad-hoc agent (mutually exclusive with `template`)'),
      message: z.string().min(1).describe('The initial user message / task prompt for the thread'),
      project: z.string().optional().describe('Project id for cost attribution & routing. Defaults to the current context project, else "general".'),
      goal: z.string().optional().describe('One-line objective of this delegation (becomes the child\'s mission-chain entry). Defaults to the message when other contract fields are set.'),
      done_when: z.string().optional().describe('Verifiable completion criteria. You (the parent) must check the deliverable against these before accepting the result.'),
      context_files: z.array(z.string()).optional().describe('Absolute paths the child must read before working.'),
      deliverable_path: z.string().optional().describe('Where the child must write its output.'),
      budget_usd: z.number().optional().describe('Budget for the child\'s subtree in USD. Exhaustion trips the circuit breaker.'),
      wait: z.boolean().optional().describe('Thread-parent only. true (default): child is awaited — emit [WAIT_CHILDREN] to suspend until all awaited children finish. false: fire-and-forget (result still lands in your pendingMessages).'),
    },
    async ({ template, agent, message, project, goal, done_when, context_files, deliverable_path, budget_usd, wait }: {
      template?: string; agent?: string; message: string; project?: string;
      goal?: string; done_when?: string; context_files?: string[]; deliverable_path?: string; budget_usd?: number; wait?: boolean;
    }) => {
      try {
        if ((template && agent) || (!template && !agent)) {
          return { content: [{ type: 'text', text: 'thread_start error: provide exactly one of `template` or `agent`.' }], isError: true };
        }
        const projectId = project || process.env.CORTEX_PROJECT || undefined;
        const channel = process.env.SLACK_CHANNEL || undefined;
        const depth = parseInt(process.env.CORTEX_THREAD_DEPTH || '0', 10) || 0;
        const parentSessionId = process.env.CORTEX_SESSION_ID || null;
        const parentThreadId = process.env.CORTEX_THREAD_ID || null;
        const parentChannel = process.env.SLACK_CHANNEL || null;
        const parentProfile = process.env.CORTEX_PROFILE || null;
        const result = await proxyThreadOp('start', {
          template, agent, message, projectId, channel, depth, parentSessionId, parentThreadId, parentChannel, parentProfile,
          goal, done_when, context_files, deliverable_path, budget_usd, wait,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `thread_start error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  // --- thread_status ---

  server.tool(
    'thread_status',
    'Query a thread\'s execution status: status (running/waiting/completed/failed/cancelled/aborted), active agent, step count, accumulated cost, abort reason, and artifact path.',
    {
      threadId: z.string().describe('Thread id (thr_XXXX) returned by thread_start'),
    },
    { readOnlyHint: true },
    async ({ threadId }: { threadId: string }) => {
      try {
        const result = await proxyThreadOp('status', { threadId });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `thread_status error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  // --- thread_result ---

  server.tool(
    'thread_result',
    'Fetch a thread\'s output: the shared artifact.md content plus the last agent step\'s output. If the thread is not yet terminal, the result is partial (a note flags this) — poll thread_status until terminal for the final result.',
    {
      threadId: z.string().describe('Thread id (thr_XXXX) returned by thread_start'),
    },
    { readOnlyHint: true },
    async ({ threadId }: { threadId: string }) => {
      try {
        const result = await proxyThreadOp('result', { threadId });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `thread_result error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  // --- thread_list ---

  server.tool(
    'thread_list',
    'List threads you started, newest first. scope "mine" (default) returns threads spawned from your current session; "project" returns all threads in the current project. Each entry has threadId, status, template/agent, step count, cost, and timestamps — use thread_status / thread_result for full detail.',
    {
      scope: z.enum(['mine', 'project']).optional().describe('"mine" (default): threads you started from this session. "project": all threads in the current project (any starter).'),
      limit: z.number().optional().describe('Max threads to return (default 50, newest first).'),
      view: z.enum(['flat', 'tree']).optional().describe('"flat" (default): newest-first list. "tree": nested thread trees (children under parents) with per-root rollups (nodeCount / totalCostUsd / byStatus / maxDepth).'),
    },
    { readOnlyHint: true },
    async ({ scope, limit, view }: { scope?: 'mine' | 'project'; limit?: number; view?: 'flat' | 'tree' }) => {
      try {
        const parentSessionId = process.env.CORTEX_SESSION_ID || null;
        const projectId = process.env.CORTEX_PROJECT || undefined;
        const result = await proxyThreadOp('list-threads', { scope: scope || 'mine', parentSessionId, projectId, limit, view });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `thread_list error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  // --- thread_list_templates ---

  server.tool(
    'thread_list_templates',
    'List available thread templates (multi-agent pipelines) and agents (single ad-hoc roles) with their descriptions. Use to discover what can be passed to thread_start.',
    {},
    { readOnlyHint: true },
    async () => {
      try {
        const result = await proxyThreadOp('list', {});
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `thread_list_templates error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  // --- thread_cancel ---

  server.tool(
    'thread_cancel',
    'Cancel a running thread. Returns whether a running thread was found and cancelled.',
    {
      threadId: z.string().describe('Thread id (thr_XXXX) to cancel'),
    },
    async ({ threadId }: { threadId: string }) => {
      try {
        const result = await proxyThreadOp('cancel', { threadId });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `thread_cancel error: ${(e as Error).message}` }], isError: true };
      }
    },
  );
}
