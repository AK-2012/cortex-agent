// input:  node:test, registerSheetsTools with a mock lark client
// output: Unit tests asserting feishu_sheets_* tools call correct SDK methods / raw requests
// pos:    TDD spec for sheets tool handlers (injected mock client, no network)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import { registerSheetsTools } from '../src/domain/mcp/feishu/sheets.js';

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
  // Raw request: key by "METHOD url" so each endpoint is asserted independently.
  const requestReturns: Record<string, any> = {
    'GET /open-apis/sheets/v2/spreadsheets/ss1/values/Sheet1!A1:B2': { valueRange: { range: 'Sheet1!A1:B2', values: [['a', 'b'], ['c', 'd']] } },
    'PUT /open-apis/sheets/v2/spreadsheets/ss1/values': { updatedRange: 'Sheet1!A1:B2', updatedRows: 2 },
    'POST /open-apis/sheets/v2/spreadsheets/ss1/values_append': { updates: { updatedRows: 1 } },
    'POST /open-apis/sheets/v2/spreadsheets/ss1/sheets_batch_update': { replies: [{ addSheet: { properties: { sheetId: 'shNew', title: 'S2' } } }] },
  };
  const request = async (opts: any) => {
    const key = `${opts.method} ${opts.url}`;
    calls['request'] = calls['request'] || [];
    calls['request'].push(opts);
    calls[key] = opts;
    return { code: 0, data: requestReturns[key] ?? {} };
  };
  const client = {
    request,
    sheets: {
      v3: {
        spreadsheet: {
          create: rec('ss.create', { spreadsheet: { spreadsheet_token: 'ss1', title: 'Book', url: 'https://tenant.feishu.cn/sheets/ss1' } }),
          get: rec('ss.get', { spreadsheet: { title: 'Book', token: 'ss1' } }),
        },
        spreadsheetSheet: {
          query: rec('sheet.query', { sheets: [{ sheet_id: 'sh1', title: 'Sheet1', index: 0 }] }),
        },
      },
    },
    drive: {
      v1: {
        meta: { batchQuery: rec('meta', { metas: [{ doc_token: 'ss1', url: 'https://tenant.feishu.cn/sheets/ss1' }] }) },
        permissionPublic: { patch: rec('perm.patch', {}) },
        file: { delete: rec('file.delete', {}) },
      },
    },
  };
  return { client: client as any, calls };
}

function setup() {
  const { server, tools } = fakeServer();
  const { client, calls } = makeMockClient();
  registerSheetsTools(server, { client });
  return { tools, calls };
}

test('registers all 8 sheets tools', () => {
  const { tools } = setup();
  for (const n of [
    'feishu_sheets_create', 'feishu_sheets_get', 'feishu_sheets_read_range',
    'feishu_sheets_write_range', 'feishu_sheets_append_rows', 'feishu_sheets_add_sheet',
    'feishu_sheets_delete_sheet', 'feishu_sheets_delete',
  ]) {
    assert.ok(tools.has(n), `missing ${n}`);
  }
});

test('create calls spreadsheet.create, link-shares to tenant, returns token + url', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_sheets_create')!({ title: 'Book', folder_token: 'fld' });
  assert.equal(calls['ss.create'].data.title, 'Book');
  assert.equal(calls['ss.create'].data.folder_token, 'fld');
  assert.equal(calls['perm.patch'].params.type, 'sheet');
  assert.equal(calls['perm.patch'].data.link_share_entity, 'tenant_editable');
  const out = JSON.parse(r.content[0].text);
  assert.equal(out.spreadsheet_token, 'ss1');
  assert.equal(out.shared, true);
  assert.match(out.url, /ss1/);
});

test('create with share=none skips link-share', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_sheets_create')!({ title: 'Book', share: 'none' });
  assert.equal(calls['perm.patch'], undefined);
  assert.equal(JSON.parse(r.content[0].text).shared, false);
});

test('get returns metadata + worksheet list', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_sheets_get')!({ spreadsheet_token: 'ss1' });
  assert.deepEqual(calls['ss.get'].path, { spreadsheet_token: 'ss1' });
  assert.deepEqual(calls['sheet.query'].path, { spreadsheet_token: 'ss1' });
  const out = JSON.parse(r.content[0].text);
  assert.equal(out.sheets[0].sheet_id, 'sh1');
});

test('read_range issues GET to the v2 values endpoint with the range in the url', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_sheets_read_range')!({ spreadsheet_token: 'ss1', range: 'Sheet1!A1:B2' });
  const key = 'GET /open-apis/sheets/v2/spreadsheets/ss1/values/Sheet1!A1:B2';
  assert.ok(calls[key], 'expected GET to values endpoint');
  assert.equal(calls[key].method, 'GET');
  const out = JSON.parse(r.content[0].text);
  assert.deepEqual(out.values, [['a', 'b'], ['c', 'd']]);
});

test('write_range issues PUT with valueRange body', async () => {
  const { tools, calls } = setup();
  const values = [['x', 'y']];
  const r = await tools.get('feishu_sheets_write_range')!({ spreadsheet_token: 'ss1', range: 'Sheet1!A1:B2', values });
  const key = 'PUT /open-apis/sheets/v2/spreadsheets/ss1/values';
  assert.ok(calls[key], 'expected PUT to values endpoint');
  assert.deepEqual(calls[key].data.valueRange, { range: 'Sheet1!A1:B2', values });
  assert.equal(JSON.parse(r.content[0].text).updatedRows, 2);
});

test('append_rows issues POST to values_append with valueRange body', async () => {
  const { tools, calls } = setup();
  const values = [['n1', 'n2']];
  await tools.get('feishu_sheets_append_rows')!({ spreadsheet_token: 'ss1', range: 'Sheet1!A1:B2', values });
  const key = 'POST /open-apis/sheets/v2/spreadsheets/ss1/values_append';
  assert.ok(calls[key], 'expected POST to values_append');
  assert.deepEqual(calls[key].data.valueRange, { range: 'Sheet1!A1:B2', values });
});

test('add_sheet issues sheets_batch_update with addSheet request', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_sheets_add_sheet')!({ spreadsheet_token: 'ss1', title: 'S2' });
  const key = 'POST /open-apis/sheets/v2/spreadsheets/ss1/sheets_batch_update';
  assert.ok(calls[key], 'expected POST to sheets_batch_update');
  assert.deepEqual(calls[key].data.requests, [{ addSheet: { properties: { title: 'S2' } } }]);
  assert.ok(JSON.parse(r.content[0].text).replies);
});

test('delete_sheet issues sheets_batch_update with deleteSheet request', async () => {
  const { tools, calls } = setup();
  await tools.get('feishu_sheets_delete_sheet')!({ spreadsheet_token: 'ss1', sheet_id: 'sh1' });
  const key = 'POST /open-apis/sheets/v2/spreadsheets/ss1/sheets_batch_update';
  assert.deepEqual(calls[key].data.requests, [{ deleteSheet: { sheetId: 'sh1' } }]);
});

test('delete trashes the whole spreadsheet via drive file.delete (type sheet)', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_sheets_delete')!({ spreadsheet_token: 'ss1' });
  assert.equal(calls['file.delete'].path.file_token, 'ss1');
  assert.equal(calls['file.delete'].params.type, 'sheet');
  assert.equal(JSON.parse(r.content[0].text).deleted, true);
});

test('no client → friendly isError result', async () => {
  const { server, tools } = fakeServer();
  registerSheetsTools(server, { client: null });
  const r = await tools.get('feishu_sheets_read_range')!({ spreadsheet_token: 'ss1', range: 'A1' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not configured/i);
});

test('API error code surfaces as isError', async () => {
  const { server, tools } = fakeServer();
  const client: any = { sheets: { v3: { spreadsheet: { create: async () => ({ code: 99, msg: 'boom' }) } } } };
  registerSheetsTools(server, { client });
  const r = await tools.get('feishu_sheets_create')!({ title: 'x' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /99|boom/);
});
