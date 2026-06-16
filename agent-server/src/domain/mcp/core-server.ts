// input:  MCP SDK, task-ops + time + thread-ops tool modules
// output: MCP stdio service, exposing remote_* tools, current_time, and thread_* tools
// pos:    Core MCP server — thread agents load only this one (no Slack/cost/schedule tools).
//         thread_* tools let any agent drive the Thread system via the daemon webhook.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTaskOpsTools } from './tools/task-ops.js';
import { registerTimeTools } from './tools/time.js';
import { registerThreadTools } from './tools/thread-ops.js';
import { isMainModule } from '@core/utils.js';
import { createLogger } from '@core/log.js';
import { CORTEX_VERSION } from '@core/version.js';

const log = createLogger('mcp-core');

// --- McpServer + tool registration ---

const server = new McpServer({ name: 'cortex-core', version: CORTEX_VERSION });

registerTaskOpsTools(server);
registerTimeTools(server);
registerThreadTools(server);

// --- Exported tool name list (for verification) ---

export const TOOL_NAMES: readonly string[] = [
  'remote_bash',
  'remote_read',
  'remote_write',
  'remote_edit',
  'remote_glob',
  'remote_grep',
  'current_time',
  'thread_start',
  'thread_status',
  'thread_result',
  'thread_list',
  'thread_list_templates',
  'thread_cancel',
  // DR-0015 control plane: an agent signals its own thread (abort / split / wait).
  'thread_abort',
  'thread_split',
  'thread_wait',
];

// --- Start (called by barrel when run as standalone) ---

export async function startServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isMainModule(import.meta.url)) {
  startServer().catch((e) => {
    log.error(e);
    process.exit(1);
  });
}
