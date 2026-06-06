// input:  node:test, registerBitableTools with a mock lark client
// output: Unit tests asserting feishu_bitable_* tools call correct SDK methods + payloads
// pos:    TDD spec for bitable tool handlers (injected mock client, no network)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import { registerBitableTools } from '../src/domain/mcp/feishu/bitable.js';

type Handler = (args: any) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

function fakeServer() {
  const tools = new Map<string, Handler>();
  const server = { tool: (name: string, _d: string, _s: unknown, h: Handler) => tools.set(name, h) };
  return { server: server as any, tools };
}

function makeMockClient() {
  const calls: Record<string, any> = {};
  const rec = (key: string, ret: any) => async (payload: any) => {
    calls[key] = payload;
    return { code: 0, data: ret };
  };
  const client = {
    bitable: {
      v1: {
        app: {
          create: rec('app.create', { app: { app_token: 'app1', name: 'Base', url: 'https://tenant.feishu.cn/base/app1' } }),
        },
        appTable: {
          list: rec('table.list', { items: [{ table_id: 't1', name: 'T' }], page_token: 'pt', has_more: false }),
          create: rec('table.create', { table_id: 'tNew' }),
          delete: rec('table.delete', {}),
        },
        appTableField: {
          list: rec('field.list', { items: [{ field_id: 'f1', field_name: 'Name', type: 1 }], page_token: 'pt', has_more: false }),
          create: rec('field.create', { field: { field_id: 'fNew', field_name: 'Age', type: 2 } }),
        },
        appTableRecord: {
          search: rec('record.search', { items: [{ record_id: 'r1', fields: { Name: 'A' } }], page_token: 'pt', has_more: false }),
          batchCreate: rec('record.batchCreate', { records: [{ record_id: 'rNew', fields: { Name: 'B' } }] }),
          batchUpdate: rec('record.batchUpdate', { records: [{ record_id: 'r1', fields: { Name: 'C' } }] }),
          batchDelete: rec('record.batchDelete', { records: [{ record_id: 'r1', deleted: true }] }),
        },
      },
    },
    drive: {
      v1: {
        meta: { batchQuery: rec('meta', { metas: [{ doc_token: 'app1', url: 'https://tenant.feishu.cn/base/app1' }] }) },
        permissionPublic: { patch: rec('perm.patch', {}) },
      },
    },
  };
  return { client: client as any, calls };
}

function setup() {
  const { server, tools } = fakeServer();
  const { client, calls } = makeMockClient();
  registerBitableTools(server, { client });
  return { tools, calls };
}

test('registers all 10 bitable tools', () => {
  const { tools } = setup();
  for (const n of [
    'feishu_bitable_create_app', 'feishu_bitable_list_tables', 'feishu_bitable_create_table',
    'feishu_bitable_delete_table', 'feishu_bitable_list_fields', 'feishu_bitable_create_field',
    'feishu_bitable_list_records', 'feishu_bitable_create_records', 'feishu_bitable_update_records',
    'feishu_bitable_delete_records',
  ]) {
    assert.ok(tools.has(n), `missing ${n}`);
  }
});

test('create_app posts name + folder_token, link-shares to tenant, returns app_token + url', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_bitable_create_app')!({ name: 'Base', folder_token: 'fld' });
  assert.deepEqual(calls['app.create'].data, { name: 'Base', folder_token: 'fld' });
  assert.equal(calls['perm.patch'].params.type, 'bitable');
  assert.equal(calls['perm.patch'].data.link_share_entity, 'tenant_editable');
  const out = JSON.parse(r.content[0].text);
  assert.equal(out.app_token, 'app1');
  assert.equal(out.shared, true);
  assert.match(out.url, /app1/);
});

test('list_tables passes app_token in path', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_bitable_list_tables')!({ app_token: 'app1', page_size: 50 });
  assert.deepEqual(calls['table.list'].path, { app_token: 'app1' });
  assert.equal(calls['table.list'].params.page_size, 50);
  const out = JSON.parse(r.content[0].text);
  assert.equal(out.tables[0].table_id, 't1');
});

test('create_table with name only omits default_view_name/fields (Feishu rejects view without fields)', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_bitable_create_table')!({ app_token: 'app1', name: 'NewT', default_view_name: 'Grid' });
  assert.deepEqual(calls['table.create'].path, { app_token: 'app1' });
  assert.deepEqual(calls['table.create'].data.table, { name: 'NewT' });
  assert.equal(JSON.parse(r.content[0].text).table_id, 'tNew');
});

test('create_table includes fields + default_view_name when fields are provided', async () => {
  const { tools, calls } = setup();
  const fields = [{ field_name: 'Title', type: 1 }];
  await tools.get('feishu_bitable_create_table')!({ app_token: 'app1', name: 'NewT', default_view_name: 'Grid', fields });
  assert.deepEqual(calls['table.create'].data.table.fields, fields);
  assert.equal(calls['table.create'].data.table.default_view_name, 'Grid');
});

test('delete_table passes app_token + table_id in path', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_bitable_delete_table')!({ app_token: 'app1', table_id: 't1' });
  assert.deepEqual(calls['table.delete'].path, { app_token: 'app1', table_id: 't1' });
  assert.equal(JSON.parse(r.content[0].text).deleted, true);
});

test('list_fields passes app_token + table_id in path', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_bitable_list_fields')!({ app_token: 'app1', table_id: 't1' });
  assert.deepEqual(calls['field.list'].path, { app_token: 'app1', table_id: 't1' });
  assert.equal(JSON.parse(r.content[0].text).fields[0].field_name, 'Name');
});

test('create_field posts field_name + type', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_bitable_create_field')!({ app_token: 'app1', table_id: 't1', field_name: 'Age', type: 2 });
  assert.deepEqual(calls['field.create'].path, { app_token: 'app1', table_id: 't1' });
  assert.equal(calls['field.create'].data.field_name, 'Age');
  assert.equal(calls['field.create'].data.type, 2);
  assert.equal(JSON.parse(r.content[0].text).field.field_id, 'fNew');
});

test('list_records uses appTableRecord.search with filter + sort', async () => {
  const { tools, calls } = setup();
  const filter = { conjunction: 'and', conditions: [{ field_name: 'Name', operator: 'is', value: ['A'] }] };
  const sort = [{ field_name: 'Name', desc: false }];
  const r = await tools.get('feishu_bitable_list_records')!({ app_token: 'app1', table_id: 't1', filter, sort, page_size: 100 });
  assert.deepEqual(calls['record.search'].path, { app_token: 'app1', table_id: 't1' });
  assert.deepEqual(calls['record.search'].data.filter, filter);
  assert.deepEqual(calls['record.search'].data.sort, sort);
  assert.equal(calls['record.search'].params.page_size, 100);
  const out = JSON.parse(r.content[0].text);
  assert.equal(out.records[0].record_id, 'r1');
});

test('list_records omits filter/sort when not provided', async () => {
  const { tools, calls } = setup();
  await tools.get('feishu_bitable_list_records')!({ app_token: 'app1', table_id: 't1' });
  assert.equal(calls['record.search'].data.filter, undefined);
  assert.equal(calls['record.search'].data.sort, undefined);
});

test('create_records maps records into data.records via batchCreate', async () => {
  const { tools, calls } = setup();
  const records = [{ fields: { Name: 'B' } }];
  const r = await tools.get('feishu_bitable_create_records')!({ app_token: 'app1', table_id: 't1', records });
  assert.deepEqual(calls['record.batchCreate'].data.records, records);
  assert.equal(JSON.parse(r.content[0].text).records[0].record_id, 'rNew');
});

test('update_records sends records with record_id via batchUpdate', async () => {
  const { tools, calls } = setup();
  const records = [{ record_id: 'r1', fields: { Name: 'C' } }];
  await tools.get('feishu_bitable_update_records')!({ app_token: 'app1', table_id: 't1', records });
  assert.deepEqual(calls['record.batchUpdate'].data.records, records);
});

test('delete_records wraps record_ids into data.records', async () => {
  const { tools, calls } = setup();
  await tools.get('feishu_bitable_delete_records')!({ app_token: 'app1', table_id: 't1', record_ids: ['r1', 'r2'] });
  assert.deepEqual(calls['record.batchDelete'].data.records, ['r1', 'r2']);
});

test('no client → friendly isError result', async () => {
  const { server, tools } = fakeServer();
  registerBitableTools(server, { client: null });
  const r = await tools.get('feishu_bitable_list_tables')!({ app_token: 'x' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not configured/i);
});

test('API error code surfaces as isError', async () => {
  const { server, tools } = fakeServer();
  const client: any = { bitable: { v1: { app: { create: async () => ({ code: 99, msg: 'boom' }) } } } };
  registerBitableTools(server, { client });
  const r = await tools.get('feishu_bitable_create_app')!({ name: 'x' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /99|boom/);
});
