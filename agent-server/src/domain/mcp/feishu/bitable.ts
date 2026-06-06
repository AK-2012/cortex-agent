// input:  MCP SDK, zod, types (guard/ok/unwrap), lark client
// output: registerBitableTools — feishu_bitable_* tools (多维表格 app/table/field/record CRUD)
// pos:    Feishu 多维表格 (bitable) structured-data authoring & querying for agents
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { guard, ok, unwrap, type FeishuToolDeps } from './types.js';
import { resolveDriveUrl, setLinkShare, type LinkShareLevel } from './drive.js';

function bitableHost(): string {
  return process.env.FEISHU_DOMAIN === 'lark' ? 'larksuite.com' : 'feishu.cn';
}

/** A bitable app's URL (token is the app_token / base id). */
function bitableUrl(appToken: string): string {
  return `https://${bitableHost()}/base/${appToken}`;
}

export function registerBitableTools(server: McpServer, deps: FeishuToolDeps): void {
  server.tool(
    'feishu_bitable_create_app',
    'Create a new Feishu bitable (多维表格) app. Returns app_token + url. By default link-shared to the tenant (anyone in the org with the link can edit) so a human can open it. Then use feishu_bitable_create_table to add tables.',
    {
      name: z.string().optional().describe('App (base) name'),
      folder_token: z.string().optional().describe('Drive folder token to create the base in (root of the app space if omitted)'),
      share: z.enum(['tenant_edit', 'tenant_view', 'none']).optional().describe('Link-share level (default tenant_edit). none = keep private to the app.'),
    },
    async ({ name, folder_token, share }) =>
      guard(deps.client, async (client) => {
        const res = await client.bitable.v1.app.create({ data: { name, folder_token } } as any);
        const data = unwrap<{ app?: { app_token?: string; name?: string; url?: string } }>(res);
        const token = data.app?.app_token ?? '';
        const level: LinkShareLevel = share ?? 'tenant_edit';
        let shared = false;
        if (level !== 'none') {
          try { shared = await setLinkShare(client, token, 'bitable', level); }
          catch { /* best-effort */ }
        }
        const url = data.app?.url ?? (await resolveDriveUrl(client, token, 'bitable')) ?? bitableUrl(token);
        return ok({ app_token: token, name: data.app?.name ?? name, url, shared });
      }),
  );

  server.tool(
    'feishu_bitable_list_tables',
    'List the tables in a bitable app. Returns table_id + name for each. Use a table_id with the record/field tools.',
    {
      app_token: z.string().describe('The bitable app_token'),
      page_token: z.string().optional().describe('Pagination token from a previous call'),
      page_size: z.number().int().min(1).max(100).optional().describe('Page size (default 100)'),
    },
    async ({ app_token, page_token, page_size }) =>
      guard(deps.client, async (client) => {
        const res = await client.bitable.v1.appTable.list({
          path: { app_token },
          params: { page_size: page_size ?? 100, page_token },
        } as any);
        const data = unwrap<{ items?: any[]; page_token?: string; has_more?: boolean }>(res);
        return ok({ app_token, tables: data.items ?? [], page_token: data.page_token, has_more: data.has_more ?? false });
      }),
  );

  server.tool(
    'feishu_bitable_create_table',
    'Create a table in a bitable app. Optionally seed fields (each {field_name, type}). Returns the new table_id.',
    {
      app_token: z.string().describe('The bitable app_token'),
      name: z.string().describe('Table name'),
      default_view_name: z.string().optional().describe('Name for the default grid view'),
      fields: z.array(z.any()).optional().describe('Initial field descriptors [{field_name, type, property?}]'),
    },
    async ({ app_token, name, default_view_name, fields }) =>
      guard(deps.client, async (client) => {
        // Feishu rejects the body (1254001 WrongRequestBody) if default_view_name is sent without
        // fields. Build the table object with only the keys that are valid for the given input:
        // include fields when provided, and only attach default_view_name alongside fields.
        const table: Record<string, unknown> = { name };
        const hasFields = Array.isArray(fields) && fields.length > 0;
        if (hasFields) {
          table.fields = fields;
          if (default_view_name) table.default_view_name = default_view_name;
        }
        const res = await client.bitable.v1.appTable.create({
          path: { app_token },
          data: { table },
        } as any);
        const data = unwrap<{ table_id?: string; default_view_id?: string; field_id_list?: string[] }>(res);
        return ok({ app_token, table_id: data.table_id, default_view_id: data.default_view_id });
      }),
  );

  server.tool(
    'feishu_bitable_delete_table',
    'Delete a table from a bitable app. Irreversible — the table and all its records are removed.',
    {
      app_token: z.string().describe('The bitable app_token'),
      table_id: z.string().describe('The table to delete'),
    },
    async ({ app_token, table_id }) =>
      guard(deps.client, async (client) => {
        const res = await client.bitable.v1.appTable.delete({ path: { app_token, table_id } } as any);
        unwrap(res);
        return ok({ app_token, table_id, deleted: true });
      }),
  );

  server.tool(
    'feishu_bitable_list_fields',
    'List the fields (columns) of a bitable table. Returns field_id, field_name and type. Call before create/update records to learn the schema.',
    {
      app_token: z.string().describe('The bitable app_token'),
      table_id: z.string().describe('The table_id'),
      page_token: z.string().optional().describe('Pagination token from a previous call'),
      page_size: z.number().int().min(1).max(100).optional().describe('Page size (default 100)'),
    },
    async ({ app_token, table_id, page_token, page_size }) =>
      guard(deps.client, async (client) => {
        const res = await client.bitable.v1.appTableField.list({
          path: { app_token, table_id },
          params: { page_size: page_size ?? 100, page_token },
        } as any);
        const data = unwrap<{ items?: any[]; page_token?: string; has_more?: boolean }>(res);
        return ok({ app_token, table_id, fields: data.items ?? [], page_token: data.page_token, has_more: data.has_more ?? false });
      }),
  );

  server.tool(
    'feishu_bitable_create_field',
    'Add a field (column) to a bitable table. `type` is the Feishu field type code (1=text, 2=number, 3=single-select, 4=multi-select, 5=datetime, 7=checkbox, 11=user, …).',
    {
      app_token: z.string().describe('The bitable app_token'),
      table_id: z.string().describe('The table_id'),
      field_name: z.string().describe('Field (column) name'),
      type: z.number().int().describe('Feishu field type code'),
      property: z.any().optional().describe('Type-specific property object (e.g. select options)'),
    },
    async ({ app_token, table_id, field_name, type, property }) =>
      guard(deps.client, async (client) => {
        const res = await client.bitable.v1.appTableField.create({
          path: { app_token, table_id },
          data: { field_name, type, property },
        } as any);
        const data = unwrap<{ field?: any }>(res);
        return ok({ app_token, table_id, field: data.field ?? null });
      }),
  );

  server.tool(
    'feishu_bitable_list_records',
    'Query records (rows) from a bitable table. Supports optional `filter` (conditions + conjunction) and `sort`. Returns records with record_id + fields.',
    {
      app_token: z.string().describe('The bitable app_token'),
      table_id: z.string().describe('The table_id'),
      filter: z.any().optional().describe('Filter: { conjunction: "and"|"or", conditions: [{ field_name, operator, value }] }'),
      sort: z.array(z.any()).optional().describe('Sort: [{ field_name, desc }]'),
      field_names: z.array(z.string()).optional().describe('Restrict returned fields by name'),
      page_token: z.string().optional().describe('Pagination token from a previous call'),
      page_size: z.number().int().min(1).max(500).optional().describe('Page size (default 100, max 500)'),
    },
    async ({ app_token, table_id, filter, sort, field_names, page_token, page_size }) =>
      guard(deps.client, async (client) => {
        const res = await client.bitable.v1.appTableRecord.search({
          path: { app_token, table_id },
          params: { page_size: page_size ?? 100, page_token },
          data: { filter, sort, field_names },
        } as any);
        const data = unwrap<{ items?: any[]; page_token?: string; has_more?: boolean }>(res);
        return ok({ app_token, table_id, records: data.items ?? [], page_token: data.page_token, has_more: data.has_more ?? false });
      }),
  );

  server.tool(
    'feishu_bitable_create_records',
    'Create one or more records (rows) in a bitable table. `records` is an array of { fields: { <field_name>: <value> } }. Returns the created records with record_ids.',
    {
      app_token: z.string().describe('The bitable app_token'),
      table_id: z.string().describe('The table_id'),
      records: z.array(z.any()).describe('Records to create: [{ fields: { name: value, … } }]'),
    },
    async ({ app_token, table_id, records }) =>
      guard(deps.client, async (client) => {
        const res = await client.bitable.v1.appTableRecord.batchCreate({
          path: { app_token, table_id },
          data: { records },
        } as any);
        const data = unwrap<{ records?: any[] }>(res);
        return ok({ app_token, table_id, records: data.records ?? [] });
      }),
  );

  server.tool(
    'feishu_bitable_update_records',
    'Update one or more existing records. `records` is an array of { record_id, fields: { <field_name>: <value> } }. Locate record_ids with feishu_bitable_list_records.',
    {
      app_token: z.string().describe('The bitable app_token'),
      table_id: z.string().describe('The table_id'),
      records: z.array(z.any()).describe('Records to update: [{ record_id, fields: { name: value, … } }]'),
    },
    async ({ app_token, table_id, records }) =>
      guard(deps.client, async (client) => {
        const res = await client.bitable.v1.appTableRecord.batchUpdate({
          path: { app_token, table_id },
          data: { records },
        } as any);
        const data = unwrap<{ records?: any[] }>(res);
        return ok({ app_token, table_id, records: data.records ?? [] });
      }),
  );

  server.tool(
    'feishu_bitable_delete_records',
    'Delete records by id. `record_ids` is an array of record_id strings.',
    {
      app_token: z.string().describe('The bitable app_token'),
      table_id: z.string().describe('The table_id'),
      record_ids: z.array(z.string()).describe('Record ids to delete'),
    },
    async ({ app_token, table_id, record_ids }) =>
      guard(deps.client, async (client) => {
        const res = await client.bitable.v1.appTableRecord.batchDelete({
          path: { app_token, table_id },
          data: { records: record_ids },
        } as any);
        const data = unwrap<{ records?: any[] }>(res);
        return ok({ app_token, table_id, deleted: data.records ?? record_ids });
      }),
  );
}
