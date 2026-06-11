// input:  MCP SDK, register*Tools modules, FeishuToolDeps
// output: registerFeishuTools — aggregate all feishu_* doc/wiki/bitable/sheets tools onto a server
// pos:    Single entry the cortex-feishu MCP server calls to wire all Feishu tools
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDocxTools } from './docx.js';
import { registerWikiTools } from './wiki.js';
import { registerBitableTools } from './bitable.js';
import { registerSheetsTools } from './sheets.js';
import { registerDriveTools } from './drive.js';
import { registerFileTools } from './file.js';
import type { FeishuToolDeps } from './types.js';

/** Tool names exposed by the cortex-feishu MCP server (kept in sync for verification). */
export const FEISHU_TOOL_NAMES: readonly string[] = [
  // file — send files to chats
  'feishu_send_file',
  // docx — cloud documents
  'feishu_docx_create',
  'feishu_docx_get_content',
  'feishu_docx_list_blocks',
  'feishu_docx_append',
  'feishu_docx_insert',
  'feishu_docx_update_block',
  'feishu_docx_delete_blocks',
  'feishu_docx_delete',
  // wiki — knowledge base
  'feishu_wiki_list_spaces',
  'feishu_wiki_list_nodes',
  'feishu_wiki_get_node',
  'feishu_wiki_create_node',
  'feishu_wiki_update_node_title',
  // bitable — 多维表格
  'feishu_bitable_create_app',
  'feishu_bitable_delete_app',
  'feishu_bitable_list_tables',
  'feishu_bitable_create_table',
  'feishu_bitable_delete_table',
  'feishu_bitable_list_fields',
  'feishu_bitable_create_field',
  'feishu_bitable_list_records',
  'feishu_bitable_create_records',
  'feishu_bitable_update_records',
  'feishu_bitable_delete_records',
  // sheets — 电子表格
  'feishu_sheets_create',
  'feishu_sheets_delete',
  'feishu_sheets_get',
  'feishu_sheets_read_range',
  'feishu_sheets_write_range',
  'feishu_sheets_append_rows',
  'feishu_sheets_add_sheet',
  'feishu_sheets_delete_sheet',
  // drive — sharing & permissions
  'feishu_drive_set_link_share',
];

export function registerFeishuTools(server: McpServer, deps: FeishuToolDeps): void {
  registerFileTools(server, deps);
  registerDocxTools(server, deps);
  registerWikiTools(server, deps);
  registerBitableTools(server, deps);
  registerSheetsTools(server, deps);
  registerDriveTools(server, deps);
}

export type { FeishuToolDeps } from './types.js';
