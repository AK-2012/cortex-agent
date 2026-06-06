// input:  node:test, registerWikiTools with a mock lark client
// output: Unit tests asserting feishu_wiki_* tools call correct SDK methods + payloads
// pos:    TDD spec for wiki tool handlers (injected mock client, no network)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import { registerWikiTools } from '../src/domain/mcp/feishu/wiki.js';

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
    wiki: {
      v2: {
        space: {
          list: rec('space.list', { items: [{ space_id: 's1', name: 'KB' }], page_token: 'pt', has_more: false }),
          getNode: rec('space.getNode', { node: { node_token: 'nt1', obj_token: 'doc9', obj_type: 'docx', title: 'Doc' } }),
        },
        spaceNode: {
          list: rec('spaceNode.list', { items: [{ node_token: 'nt1', title: 'Child', obj_type: 'docx', obj_token: 'doc9' }], page_token: 'pt', has_more: false }),
          create: rec('spaceNode.create', { node: { node_token: 'ntNew', obj_token: 'docNew', obj_type: 'docx', title: 'New' } }),
          updateTitle: rec('spaceNode.updateTitle', {}),
        },
      },
    },
  };
  return { client: client as any, calls };
}

function setup() {
  const { server, tools } = fakeServer();
  const { client, calls } = makeMockClient();
  registerWikiTools(server, { client });
  return { tools, calls };
}

test('registers all 5 wiki tools', () => {
  const { tools } = setup();
  for (const n of [
    'feishu_wiki_list_spaces', 'feishu_wiki_list_nodes', 'feishu_wiki_get_node',
    'feishu_wiki_create_node', 'feishu_wiki_update_node_title',
  ]) {
    assert.ok(tools.has(n), `missing ${n}`);
  }
});

test('list_spaces calls wiki.v2.space.list and returns items', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_wiki_list_spaces')!({ page_size: 20 });
  assert.equal(calls['space.list'].params.page_size, 20);
  const out = JSON.parse(r.content[0].text);
  assert.deepEqual(out.spaces[0], { space_id: 's1', name: 'KB' });
  assert.equal(out.page_token, 'pt');
});

test('list_nodes passes space_id in path and parent_node_token in params', async () => {
  const { tools, calls } = setup();
  await tools.get('feishu_wiki_list_nodes')!({ space_id: 's1', parent_node_token: 'pn', page_size: 50 });
  assert.deepEqual(calls['spaceNode.list'].path, { space_id: 's1' });
  assert.equal(calls['spaceNode.list'].params.parent_node_token, 'pn');
  assert.equal(calls['spaceNode.list'].params.page_size, 50);
});

test('get_node passes token in params and surfaces obj_token/obj_type', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_wiki_get_node')!({ token: 'nt1' });
  assert.equal(calls['space.getNode'].params.token, 'nt1');
  const out = JSON.parse(r.content[0].text);
  assert.equal(out.node.obj_token, 'doc9');
  assert.equal(out.node.obj_type, 'docx');
});

test('create_node defaults obj_type=docx and node_type=origin', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_wiki_create_node')!({ space_id: 's1', title: 'New', parent_node_token: 'p1' });
  assert.deepEqual(calls['spaceNode.create'].path, { space_id: 's1' });
  assert.equal(calls['spaceNode.create'].data.obj_type, 'docx');
  assert.equal(calls['spaceNode.create'].data.node_type, 'origin');
  assert.equal(calls['spaceNode.create'].data.parent_node_token, 'p1');
  assert.equal(calls['spaceNode.create'].data.title, 'New');
  const out = JSON.parse(r.content[0].text);
  assert.equal(out.node.node_token, 'ntNew');
});

test('create_node honors explicit obj_type', async () => {
  const { tools, calls } = setup();
  await tools.get('feishu_wiki_create_node')!({ space_id: 's1', title: 'Sheet', obj_type: 'sheet' });
  assert.equal(calls['spaceNode.create'].data.obj_type, 'sheet');
});

test('update_node_title patches via spaceNode.updateTitle', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_wiki_update_node_title')!({ space_id: 's1', node_token: 'nt1', title: 'Renamed' });
  assert.deepEqual(calls['spaceNode.updateTitle'].path, { space_id: 's1', node_token: 'nt1' });
  assert.equal(calls['spaceNode.updateTitle'].data.title, 'Renamed');
  assert.equal(JSON.parse(r.content[0].text).updated, true);
});

test('no client → friendly isError result', async () => {
  const { server, tools } = fakeServer();
  registerWikiTools(server, { client: null });
  const r = await tools.get('feishu_wiki_list_spaces')!({});
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not configured/i);
});

test('API error code surfaces as isError', async () => {
  const { server, tools } = fakeServer();
  const client: any = { wiki: { v2: { space: { list: async () => ({ code: 99, msg: 'boom' }) } } } };
  registerWikiTools(server, { client });
  const r = await tools.get('feishu_wiki_list_spaces')!({});
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /99|boom/);
});
