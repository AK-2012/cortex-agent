// input:  MCP SDK, Slack WebClient, 4 tool-family modules (no remote_* — those live in core-server.ts)
// output: MCP stdio service, exposing slack/cost/query/context/schedule tools
// pos:    Ext MCP server — direct-agent-only tools (Slack, cost, executions, context, schedule)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebClient } from '@slack/web-api';
import { registerSlackTools, type SlackToolDeps } from './tools/slack.js';
import { registerCostTools } from './tools/cost.js';
import { registerExecutionTools } from './tools/executions.js';
import { registerContextTools, type ContextToolDeps } from './tools/context.js';
import { registerScheduleTools } from './tools/schedule.js';
import { isMainModule } from '@core/utils.js';
import { createLogger } from '@core/log.js';
import { CORTEX_VERSION } from '@core/version.js';

const log = createLogger('mcp-server');

// --- Config from env / CLI args ---

const token = process.env.SLACK_BOT_TOKEN;
const fallbackChannel = process.env.SLACK_CHANNEL;
const branchMachine: string | undefined = process.env.CORTEX_BRANCH_MACHINE;
const fallbackCallbackSource: string | undefined = process.env.CORTEX_CALLBACK_SOURCE;

function getCliArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  const prefixed = process.argv.find(a => a.startsWith(`${name}=`));
  if (prefixed) return prefixed.slice(name.length + 1);
  return null;
}

const routeContextFile: string | null =
  getCliArg('--route-context-file') ||
  process.env.CORTEX_ROUTE_CONTEXT_FILE ||
  null;

// --- Slack client ---

const slack: WebClient | null = token ? new WebClient(token) : null;

// --- McpServer + tool registration ---

const server = new McpServer({ name: 'cortex', version: CORTEX_VERSION });

const slackDeps: SlackToolDeps = {
  slack,
  fallbackChannel,
  routeContextFile,
  branchMachine,
  callbackSource: fallbackCallbackSource,
};

const contextDeps: ContextToolDeps = { routeContextFile };

registerSlackTools(server, slackDeps);
registerCostTools(server);
registerExecutionTools(server);
registerContextTools(server, contextDeps);
registerScheduleTools(server, contextDeps);

// --- Exported tool name list (for verification) ---

export const TOOL_NAMES: readonly string[] = [
  'slack_send_file',
  'cost_query',
  'query_executions',
  'cortex_context',
  'cortex_schedule_add',
  'cortex_schedule_list',
  'cortex_schedule_get',
  'cortex_schedule_remove',
  'cortex_schedule_pause',
  'cortex_schedule_resume',
];

// --- Start (called by barrel when run as standalone) ---

export async function startServer(): Promise<void> {
  if (!token || !fallbackChannel) {
    log.warn('SLACK_BOT_TOKEN or SLACK_CHANNEL not set — slack_send_file will be unavailable');
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export { uploadFileToSlack } from './tools/slack.js';

if (isMainModule(import.meta.url)) {
  startServer().catch((e) => {
    log.error(e);
    process.exit(1);
  });
}
