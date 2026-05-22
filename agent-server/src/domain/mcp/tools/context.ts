// input:  McpServer + route-context-file + CORTEX_* env + thread/session stores
// output: cortex_context tool registration
// pos:    MCP tool letting the running LLM self-discover its channel/thread/session/profile,
//         so cortex_schedule_add can target the current scope without guessing IDs.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'fs';
import { sessionStore } from '@store/session-registry-repo.js';

export interface ContextToolDeps {
  /** Path to the per-route context.json written by Codex's writeRouteContext (codex backend only). Null on Claude. */
  routeContextFile: string | null;
}

interface RouteContextFile {
  channel?: string | null;
  callbackSource?: string | null;
  sessionId?: string | null;
  threadId?: string | null;
  profile?: string | null;
  project?: string | null;
  sessionName?: string | null;
  updatedAt?: string;
}

interface CortexContextResponse {
  channel: string | null;
  sessionId: string | null;
  sessionName: string | null;
  threadId: string | null;
  profile: string | null;
  project: string | null;
  backend: string | null;
  scheduleTaskId: string | null;
  callbackSource: string | null;
}

function readRouteContext(routeContextFile: string | null): RouteContextFile | null {
  if (!routeContextFile) return null;
  try {
    return JSON.parse(fs.readFileSync(routeContextFile, 'utf8'));
  } catch {
    return null;
  }
}

/** Resolve the Cortex execution context from route-context.json (preferred — refreshed
 *  per turn for Codex) and falling back to the env vars set at MCP server spawn time
 *  (Claude path; sticky for the session lifetime). When sessionId is known but sessionName
 *  is not, look up the session-registry to get the cortex-XXXX short name. */
export async function resolveCortexContext(deps: ContextToolDeps): Promise<CortexContextResponse> {
  const route = readRouteContext(deps.routeContextFile);
  const sessionId = route?.sessionId ?? process.env.CORTEX_SESSION_ID ?? null;
  let sessionName = route?.sessionName ?? process.env.CORTEX_SESSION_NAME ?? null;
  if (!sessionName && sessionId) {
    sessionName = await sessionStore.lookupBySessionId(sessionId);
  }
  return {
    channel: route?.channel ?? process.env.SLACK_CHANNEL ?? null,
    sessionId,
    sessionName,
    threadId: route?.threadId ?? process.env.CORTEX_THREAD_ID ?? null,
    profile: route?.profile ?? process.env.CORTEX_PROFILE ?? null,
    project: route?.project ?? process.env.CORTEX_PROJECT ?? null,
    backend: process.env.CORTEX_BACKEND ?? null,
    scheduleTaskId: process.env.CORTEX_SCHEDULE_TASK_ID ?? null,
    callbackSource: route?.callbackSource ?? process.env.CORTEX_CALLBACK_SOURCE ?? null,
  };
}

export function registerContextTools(server: McpServer, deps: ContextToolDeps): void {
  server.tool(
    'cortex_context',
    'Return the current Cortex execution context: channel, sessionId, sessionName (cortex-XXXX), threadId, profile, project, backend. Use this to discover the current scope before calling cortex_schedule_add with target=current-project/current-session/current-thread.',
    {},
    { readOnlyHint: true },
    async () => {
      try {
        const ctxResponse = await resolveCortexContext(deps);
        return { content: [{ type: 'text', text: JSON.stringify(ctxResponse, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Failed to resolve context: ${(e as Error).message}` }], isError: true };
      }
    },
  );
}
