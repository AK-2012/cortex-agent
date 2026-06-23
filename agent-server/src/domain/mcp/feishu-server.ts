// input:  MCP SDK, feishu/ tool registration, lark client builder
// output: cortex-feishu MCP stdio server — Feishu file sending (feishu_send_file).
//         Document/table/wiki tooling moved to the official lark-cli (see feishu-doc skill).
// pos:    Standalone MCP server (peer of core-server.ts & server.ts); loaded only for Feishu-originated
//         sessions (channel carries the `feishu:` prefix) — Claude via mcp-config-feishu.json layering,
//         PI via the mcp-bridge feishu handle. Not loaded for thread/core sessions.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerFeishuTools, FEISHU_TOOL_NAMES } from './feishu/index.js';
import { buildFeishuClientFromEnv } from './feishu/client.js';
import { isMainModule } from '@core/utils.js';
import { createLogger } from '@core/log.js';
import { CORTEX_VERSION } from '@core/version.js';

const log = createLogger('mcp-feishu');

// --- Client from env (null when unconfigured → tools fail with friendly message) ---

const client = buildFeishuClientFromEnv();

// --- McpServer + tool registration ---

const server = new McpServer({ name: 'cortex-feishu', version: CORTEX_VERSION });
registerFeishuTools(server, { client });

export const TOOL_NAMES = FEISHU_TOOL_NAMES;

export async function startServer(): Promise<void> {
  if (!client) {
    log.warn(
      'FEISHU_APP_ID / FEISHU_APP_SECRET not set — feishu_send_file will return a not-configured error',
    );
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
