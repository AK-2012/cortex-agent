// input:  MCP SDK + tui-plan + tui-ask tool modules + agent-server webhook
// output: MCP stdio service for TUI-mode Claude — exposes cortex_plan_enter / cortex_plan_exit / cortex_ask_user
// pos:    DR-0012 Phase 3 — cortex-tui-bridge MCP server, loaded ONLY by Claude TUI sessions
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { isMainModule } from '@core/utils.js';
import { createLogger } from '@core/log.js';
import { CORTEX_VERSION } from '@core/version.js';
import { registerTuiPlanTools, type TuiToolDeps } from './tools/tui-plan.js';
import { registerTuiAskTools } from './tools/tui-ask.js';

const log = createLogger('mcp-tui');

// --- Resolve env-driven deps at module load time ---

const channel = process.env.SLACK_CHANNEL ?? null;
const sessionId = process.env.CORTEX_SESSION_ID ?? null;
const threadId = process.env.CORTEX_THREAD_ID ?? null;
const webhookPort = parseInt(process.env.WEBHOOK_PORT || '3001', 10);
const webhookBaseUrl = `http://127.0.0.1:${webhookPort}`;

/** Production HTTP POST: thin wrapper over global fetch returning { status, body }. */
async function defaultHttpPost(url: string, body: any): Promise<{ status: number; body: any }> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let parsed: any = null;
  const text = await r.text();
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { _raw: text }; }
  return { status: r.status, body: parsed };
}

const deps: TuiToolDeps = {
  channel,
  sessionId,
  threadId,
  webhookBaseUrl,
  httpPost: defaultHttpPost,
};

// --- McpServer + tool registration ---

const server = new McpServer({ name: 'cortex-tui-bridge', version: CORTEX_VERSION });

registerTuiPlanTools(server, deps);
registerTuiAskTools(server, deps);

// --- Exported tool name list (for verification) ---

export const TOOL_NAMES: readonly string[] = [
  'cortex_plan_enter',
  'cortex_plan_exit',
  'cortex_ask_user',
];

// --- Start (called by barrel when run as standalone) ---

export async function startServer(): Promise<void> {
  if (!channel) {
    log.warn('SLACK_CHANNEL not set — cortex_plan_exit / cortex_ask_user will error out at call time');
  }
  if (!sessionId) {
    log.warn('CORTEX_SESSION_ID not set — webhook will receive null sessionId');
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isMainModule(import.meta.url)) {
  startServer().catch((e) => {
    log.error(e);
    process.exit(1);
  });
}
