// input:  node:test, drive helpers + registerDriveTools with a mock lark client
// output: assert resolveDriveUrl / setLinkShare / feishu_drive_set_link_share behavior
// pos:    TDD spec for feishu drive sharing + canonical-URL resolution (no network)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDriveUrl, setLinkShare, registerDriveTools } from '../src/domain/mcp/feishu/drive.js';

type Handler = (args: any) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

function fakeServer() {
  const tools = new Map<string, Handler>();
  const server = { tool: (name: string, _d: string, _s: unknown, h: Handler) => tools.set(name, h) };
  return { server: server as any, tools };
}

function makeMockClient() {
  const calls: Record<string, any> = {};
  const rec = (key: string, ret: any) => async (payload: any) => { calls[key] = payload; return { code: 0, data: ret }; };
  const client = {
    drive: {
      v1: {
        meta: { batchQuery: rec('meta', { metas: [{ doc_token: 't1', url: 'https://tenant.feishu.cn/docx/t1' }] }) },
        permissionPublic: { patch: rec('perm', {}) },
      },
    },
  };
  return { client: client as any, calls };
}

test('resolveDriveUrl returns the canonical url from meta.batchQuery', async () => {
  const { client, calls } = makeMockClient();
  const url = await resolveDriveUrl(client, 't1', 'docx');
  assert.equal(url, 'https://tenant.feishu.cn/docx/t1');
  assert.deepEqual(calls['meta'].data.request_docs, [{ doc_token: 't1', doc_type: 'docx' }]);
  assert.equal(calls['meta'].data.with_url, true);
});

test('resolveDriveUrl returns null on failure (caller falls back)', async () => {
  const client: any = { drive: { v1: { meta: { batchQuery: async () => { throw new Error('nope'); } } } } };
  assert.equal(await resolveDriveUrl(client, 't1', 'docx'), null);
});

test('setLinkShare maps tenant_edit → tenant_editable via permissionPublic.patch', async () => {
  const { client, calls } = makeMockClient();
  const applied = await setLinkShare(client, 't1', 'docx', 'tenant_edit');
  assert.equal(applied, true);
  assert.deepEqual(calls['perm'].path, { token: 't1' });
  assert.equal(calls['perm'].params.type, 'docx');
  assert.equal(calls['perm'].data.link_share_entity, 'tenant_editable');
});

test('setLinkShare maps tenant_view → tenant_readable', async () => {
  const { client, calls } = makeMockClient();
  await setLinkShare(client, 't1', 'sheet', 'tenant_view');
  assert.equal(calls['perm'].data.link_share_entity, 'tenant_readable');
});

test('setLinkShare with none is a no-op (no API call, returns false)', async () => {
  const { client, calls } = makeMockClient();
  const applied = await setLinkShare(client, 't1', 'docx', 'none');
  assert.equal(applied, false);
  assert.equal(calls['perm'], undefined);
});

test('registers feishu_drive_set_link_share tool', () => {
  const { server, tools } = fakeServer();
  const { client } = makeMockClient();
  registerDriveTools(server, { client });
  assert.ok(tools.has('feishu_drive_set_link_share'));
});

test('feishu_drive_set_link_share applies share and returns canonical url', async () => {
  const { server, tools } = fakeServer();
  const { client, calls } = makeMockClient();
  registerDriveTools(server, { client });
  const r = await tools.get('feishu_drive_set_link_share')!({ token: 't1', type: 'docx', level: 'tenant_edit' });
  assert.equal(calls['perm'].data.link_share_entity, 'tenant_editable');
  const out = JSON.parse(r.content[0].text);
  assert.equal(out.shared, true);
  assert.equal(out.url, 'https://tenant.feishu.cn/docx/t1');
});

test('feishu_drive_set_link_share level=none revokes via closed entity', async () => {
  const { server, tools } = fakeServer();
  const { client, calls } = makeMockClient();
  registerDriveTools(server, { client });
  const r = await tools.get('feishu_drive_set_link_share')!({ token: 't1', type: 'docx', level: 'none' });
  assert.equal(calls['perm'].data.link_share_entity, 'closed');
  assert.equal(JSON.parse(r.content[0].text).shared, false);
});

test('no client → friendly isError result', async () => {
  const { server, tools } = fakeServer();
  registerDriveTools(server, { client: null });
  const r = await tools.get('feishu_drive_set_link_share')!({ token: 't1', type: 'docx', level: 'tenant_edit' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not configured/i);
});
