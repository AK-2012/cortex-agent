// input:  MCP SDK, register*Tools modules, FeishuToolDeps
// output: registerFeishuTools — aggregate all feishu_* doc tools onto a server
// pos:    Single entry the cortex-feishu MCP server calls to wire doc tools
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDocxTools } from './docx.js';
import type { FeishuToolDeps } from './types.js';

/** Tool names exposed by the cortex-feishu MCP server (kept in sync for verification). */
export const FEISHU_TOOL_NAMES: readonly string[] = [
  'feishu_docx_create',
  'feishu_docx_get_content',
  'feishu_docx_list_blocks',
  'feishu_docx_append',
  'feishu_docx_insert',
  'feishu_docx_update_block',
  'feishu_docx_delete_blocks',
  'feishu_docx_delete',
];

export function registerFeishuTools(server: McpServer, deps: FeishuToolDeps): void {
  registerDocxTools(server, deps);
  // Phase 2/3: registerWikiTools, registerBitableTools, registerSheetsTools
}

export type { FeishuToolDeps } from './types.js';
