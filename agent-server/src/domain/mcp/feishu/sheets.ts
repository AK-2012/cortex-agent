// input:  MCP SDK, zod, types (guard/ok/unwrap), lark client (typed v3 + raw request for v2 values)
// output: registerSheetsTools — feishu_sheets_* tools (电子表格 create/read/write/append/sheet CRUD)
// pos:    Feishu 电子表格 (sheets) spreadsheet authoring & cell I/O for agents
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { guard, ok, unwrap, type FeishuToolDeps } from './types.js';
import { resolveDriveUrl, setLinkShare, type LinkShareLevel } from './drive.js';

function sheetsHost(): string {
  return process.env.FEISHU_DOMAIN === 'lark' ? 'larksuite.com' : 'feishu.cn';
}

function sheetUrl(token: string): string {
  return `https://${sheetsHost()}/sheets/${token}`;
}

const V2 = (token: string, suffix: string): string =>
  `/open-apis/sheets/v2/spreadsheets/${token}/${suffix}`;

export function registerSheetsTools(server: McpServer, deps: FeishuToolDeps): void {
  server.tool(
    'feishu_sheets_create',
    'Create a new Feishu spreadsheet (电子表格). Returns spreadsheet_token + url. By default link-shared to the tenant (anyone in the org with the link can edit) so a human can open it. Use feishu_sheets_get to list its worksheets, then feishu_sheets_write_range to fill cells.',
    {
      title: z.string().optional().describe('Spreadsheet title'),
      folder_token: z.string().optional().describe('Drive folder token to create the sheet in (root of the app space if omitted)'),
      share: z.enum(['tenant_edit', 'tenant_view', 'none']).optional().describe('Link-share level (default tenant_edit). none = keep private to the app.'),
    },
    async ({ title, folder_token, share }) =>
      guard(deps.client, async (client) => {
        const res = await client.sheets.v3.spreadsheet.create({ data: { title, folder_token } } as any);
        const data = unwrap<{ spreadsheet?: { spreadsheet_token?: string; title?: string; url?: string } }>(res);
        const token = data.spreadsheet?.spreadsheet_token ?? '';
        const level: LinkShareLevel = share ?? 'tenant_edit';
        let shared = false;
        if (level !== 'none') {
          try { shared = await setLinkShare(client, token, 'sheet', level); }
          catch { /* best-effort */ }
        }
        const url = data.spreadsheet?.url ?? (await resolveDriveUrl(client, token, 'sheet')) ?? sheetUrl(token);
        return ok({ spreadsheet_token: token, title: data.spreadsheet?.title ?? title, url, shared });
      }),
  );

  server.tool(
    'feishu_sheets_get',
    'Get a spreadsheet\'s metadata and the list of its worksheets (sheet_id, title, index). You need a sheet_id/title to build A1 ranges like "Sheet1!A1:C10".',
    {
      spreadsheet_token: z.string().describe('The spreadsheet_token'),
    },
    async ({ spreadsheet_token }) =>
      guard(deps.client, async (client) => {
        const metaRes = await client.sheets.v3.spreadsheet.get({ path: { spreadsheet_token } } as any);
        const meta = unwrap<{ spreadsheet?: any }>(metaRes);
        const sheetsRes = await client.sheets.v3.spreadsheetSheet.query({ path: { spreadsheet_token } } as any);
        const sheetsData = unwrap<{ sheets?: any[] }>(sheetsRes);
        return ok({ spreadsheet_token, spreadsheet: meta.spreadsheet ?? null, sheets: sheetsData.sheets ?? [] });
      }),
  );

  server.tool(
    'feishu_sheets_read_range',
    'Read cell values from an A1 range (e.g. "Sheet1!A1:C10"). Returns a 2D `values` array.',
    {
      spreadsheet_token: z.string().describe('The spreadsheet_token'),
      range: z.string().describe('A1-notation range, e.g. "Sheet1!A1:C10"'),
    },
    async ({ spreadsheet_token, range }) =>
      guard(deps.client, async (client) => {
        const res = await client.request({
          method: 'GET',
          url: V2(spreadsheet_token, `values/${range}`),
        } as any);
        const data = unwrap<{ valueRange?: { range?: string; values?: unknown[][] } }>(res);
        return ok({ spreadsheet_token, range: data.valueRange?.range ?? range, values: data.valueRange?.values ?? [] });
      }),
  );

  server.tool(
    'feishu_sheets_write_range',
    'Write cell values into an A1 range. `values` is a 2D array matching the range shape. Overwrites existing cells.',
    {
      spreadsheet_token: z.string().describe('The spreadsheet_token'),
      range: z.string().describe('A1-notation range, e.g. "Sheet1!A1:C10"'),
      values: z.array(z.array(z.any())).describe('2D array of cell values (rows of columns)'),
    },
    async ({ spreadsheet_token, range, values }) =>
      guard(deps.client, async (client) => {
        const res = await client.request({
          method: 'PUT',
          url: V2(spreadsheet_token, 'values'),
          data: { valueRange: { range, values } },
        } as any);
        const data = unwrap<{ updatedRange?: string; updatedRows?: number; updatedColumns?: number; updatedCells?: number }>(res);
        return ok({ spreadsheet_token, updatedRange: data.updatedRange, updatedRows: data.updatedRows, updatedCells: data.updatedCells });
      }),
  );

  server.tool(
    'feishu_sheets_append_rows',
    'Append rows after the last non-empty row of a range (does not overwrite existing data). `values` is a 2D array of the rows to add.',
    {
      spreadsheet_token: z.string().describe('The spreadsheet_token'),
      range: z.string().describe('A1-notation range whose sheet/columns the rows are appended to'),
      values: z.array(z.array(z.any())).describe('2D array of rows to append'),
    },
    async ({ spreadsheet_token, range, values }) =>
      guard(deps.client, async (client) => {
        const res = await client.request({
          method: 'POST',
          url: V2(spreadsheet_token, 'values_append'),
          data: { valueRange: { range, values } },
        } as any);
        const data = unwrap<{ updates?: { updatedRange?: string; updatedRows?: number; updatedCells?: number } }>(res);
        return ok({ spreadsheet_token, appended: data.updates ?? null });
      }),
  );

  server.tool(
    'feishu_sheets_add_sheet',
    'Add a new worksheet (tab) to a spreadsheet. Returns the batch-update replies (including the new sheetId).',
    {
      spreadsheet_token: z.string().describe('The spreadsheet_token'),
      title: z.string().describe('Title for the new worksheet'),
      index: z.number().int().min(0).optional().describe('0-based tab position (appended to the end if omitted)'),
    },
    async ({ spreadsheet_token, title, index }) =>
      guard(deps.client, async (client) => {
        const properties: Record<string, unknown> = { title };
        if (index != null) properties.index = index;
        const res = await client.request({
          method: 'POST',
          url: V2(spreadsheet_token, 'sheets_batch_update'),
          data: { requests: [{ addSheet: { properties } }] },
        } as any);
        const data = unwrap<{ replies?: any[] }>(res);
        return ok({ spreadsheet_token, replies: data.replies ?? [] });
      }),
  );

  server.tool(
    'feishu_sheets_delete_sheet',
    'Delete a worksheet (tab) from a spreadsheet by sheet_id. Irreversible. Find sheet_id with feishu_sheets_get.',
    {
      spreadsheet_token: z.string().describe('The spreadsheet_token'),
      sheet_id: z.string().describe('The worksheet sheet_id to delete'),
    },
    async ({ spreadsheet_token, sheet_id }) =>
      guard(deps.client, async (client) => {
        const res = await client.request({
          method: 'POST',
          url: V2(spreadsheet_token, 'sheets_batch_update'),
          data: { requests: [{ deleteSheet: { sheetId: sheet_id } }] },
        } as any);
        const data = unwrap<{ replies?: any[] }>(res);
        return ok({ spreadsheet_token, sheet_id, deleted: true, replies: data.replies ?? [] });
      }),
  );
}
