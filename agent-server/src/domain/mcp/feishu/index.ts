// input:  MCP SDK, registerFileTools, FeishuToolDeps
// output: registerFeishuTools — wire the feishu_send_file tool onto a server
// pos:    Single entry the cortex-feishu MCP server calls to wire all Feishu tools.
//         Document/table/wiki tooling was removed in favor of the official lark-cli
//         (see the feishu-doc skill); this MCP now only exposes file sending.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerFileTools } from './file.js';
import type { FeishuToolDeps } from './types.js';

/** Tool names exposed by the cortex-feishu MCP server (kept in sync for verification). */
export const FEISHU_TOOL_NAMES: readonly string[] = [
  // file — send files to chats
  'feishu_send_file',
];

export function registerFeishuTools(server: McpServer, deps: FeishuToolDeps): void {
  registerFileTools(server, deps);
}

export type { FeishuToolDeps } from './types.js';
