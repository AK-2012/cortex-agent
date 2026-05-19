// input:  MCP SDK, task-ops tool module
// output: MCP stdio service, exposing remote_* tools only
// pos:    Core MCP server — thread agents load only this one (no Slack/cost/schedule tools)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTaskOpsTools } from './tools/task-ops.js';
import { isMainModule } from '@core/utils.js';
import { createLogger } from '@core/log.js';
import { CORTEX_VERSION } from '@core/version.js';

const log = createLogger('mcp-core');

// --- McpServer + tool registration ---

const server = new McpServer({ name: 'cortex-core', version: CORTEX_VERSION });

registerTaskOpsTools(server);

// --- Exported tool name list (for verification) ---

export const TOOL_NAMES: readonly string[] = [
  'remote_bash',
  'remote_read',
  'remote_write',
  'remote_edit',
  'remote_glob',
  'remote_grep',
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
