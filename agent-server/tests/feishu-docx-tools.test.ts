// input:  node:test, registerDocxTools with a mock lark client
// output: Unit tests asserting feishu_docx_* tools call correct SDK methods + payloads
// pos:    TDD spec for docx tool handlers (injected mock client, no network)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import { registerDocxTools } from '../src/domain/mcp/feishu/docx.js';

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
    docx: {
      v1: {
        document: {
          create: rec('doc.create', { document: { document_id: 'doc1', title: 'T' } }),
          rawContent: rec('doc.rawContent', { content: 'plain text' }),
        },
        documentBlock: {
          list: rec('block.list', {
            items: [{ block_id: 'b1', parent_id: 'root', block_type: 2, text: { elements: [{ text_run: { content: 'hi' } }] } }],
            page_token: 'pt',
            has_more: false,
          }),
          patch: rec('block.patch', { document_revision_id: 9 }),
        },
        documentBlockChildren: {
          create: rec('children.create', { children: [{ block_id: 'nb1' }], document_revision_id: 7 }),
          batchDelete: rec('children.batchDelete', { document_revision_id: 8 }),
        },
      },
    },
    drive: {
      v1: {
        file: { delete: rec('file.delete', {}) },
        meta: { batchQuery: rec('meta.batchQuery', { metas: [{ doc_token: 'doc1', url: 'https://tenant.feishu.cn/docx/doc1' }] }) },
        permissionPublic: { patch: rec('perm.patch', {}) },
      },
    },
  };
  return { client: client as any, calls };
}

function setup() {
  const { server, tools } = fakeServer();
  const { client, calls } = makeMockClient();
  registerDocxTools(server, { client });
  return { tools, calls };
}

test('registers all 8 docx tools', () => {
  const { tools } = setup();
  for (const n of [
    'feishu_docx_create', 'feishu_docx_get_content', 'feishu_docx_list_blocks',
    'feishu_docx_append', 'feishu_docx_insert', 'feishu_docx_update_block',
    'feishu_docx_delete_blocks', 'feishu_docx_delete',
  ]) {
    assert.ok(tools.has(n), `missing ${n}`);
  }
});

test('create calls document.create, link-shares to tenant, and returns the canonical url', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_docx_create')!({ title: 'T', folder_token: 'fld' });
  assert.deepEqual(calls['doc.create'].data, { title: 'T', folder_token: 'fld' });
  // default share = tenant_edit → permissionPublic.patch with tenant_editable
  assert.deepEqual(calls['perm.patch'].path, { token: 'doc1' });
  assert.equal(calls['perm.patch'].params.type, 'docx');
  assert.equal(calls['perm.patch'].data.link_share_entity, 'tenant_editable');
  const out = JSON.parse(r.content[0].text);
  assert.equal(out.document_id, 'doc1');
  assert.equal(out.shared, true);
  // canonical (tenant-subdomain) url from drive.meta, not a hand-built feishu.cn link
  assert.equal(out.url, 'https://tenant.feishu.cn/docx/doc1');
});

test('create with share=none skips link-share and falls back to a constructed url', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_docx_create')!({ title: 'T', share: 'none' });
  assert.equal(calls['perm.patch'], undefined);
  const out = JSON.parse(r.content[0].text);
  assert.equal(out.shared, false);
  // meta still resolves the canonical url
  assert.equal(out.url, 'https://tenant.feishu.cn/docx/doc1');
});

test('append converts markdown to blocks and posts under document root', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_docx_append')!({ document_id: 'doc1', markdown: '# Title' });
  const p = calls['children.create'];
  assert.deepEqual(p.path, { document_id: 'doc1', block_id: 'doc1' });
  assert.equal(p.params.document_revision_id, -1);
  assert.equal(p.data.children[0].block_type, 3); // heading1
  const out = JSON.parse(r.content[0].text);
  assert.deepEqual(out.created_block_ids, ['nb1']);
});

test('append uses raw blocks escape hatch when provided (bypasses markdown)', async () => {
  const { tools, calls } = setup();
  const raw = [{ block_type: 22, divider: {} }];
  await tools.get('feishu_docx_append')!({ document_id: 'doc1', markdown: '# ignored', blocks: raw });
  assert.deepEqual(calls['children.create'].data.children, raw);
});

test('append under explicit parent_block_id', async () => {
  const { tools, calls } = setup();
  await tools.get('feishu_docx_append')!({ document_id: 'doc1', markdown: 'x', parent_block_id: 'p9' });
  assert.equal(calls['children.create'].path.block_id, 'p9');
});

test('insert passes 0-based index into data', async () => {
  const { tools, calls } = setup();
  await tools.get('feishu_docx_insert')!({ document_id: 'doc1', index: 2, markdown: 'x' });
  assert.equal(calls['children.create'].data.index, 2);
});

test('list_blocks summarizes items', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_docx_list_blocks')!({ document_id: 'doc1' });
  assert.equal(calls['block.list'].params.document_revision_id, -1);
  const out = JSON.parse(r.content[0].text);
  assert.deepEqual(out.blocks, [{ block_id: 'b1', type: 'text', parent_id: 'root', text: 'hi' }]);
  assert.equal(out.page_token, 'pt');
});

test('update_block patches first block elements via update_text_elements', async () => {
  const { tools, calls } = setup();
  await tools.get('feishu_docx_update_block')!({ document_id: 'doc1', block_id: 'b1', markdown: '**bold**' });
  const p = calls['block.patch'];
  assert.deepEqual(p.path, { document_id: 'doc1', block_id: 'b1' });
  assert.deepEqual(p.data.update_text_elements.elements, [
    { text_run: { content: 'bold', text_element_style: { bold: true } } },
  ]);
});

test('delete_blocks calls batchDelete with index range', async () => {
  const { tools, calls } = setup();
  await tools.get('feishu_docx_delete_blocks')!({ document_id: 'doc1', parent_block_id: 'doc1', start_index: 1, end_index: 3 });
  assert.deepEqual(calls['children.batchDelete'].data, { start_index: 1, end_index: 3 });
});

test('delete calls drive.file.delete with type docx', async () => {
  const { tools, calls } = setup();
  const r = await tools.get('feishu_docx_delete')!({ document_id: 'doc1' });
  assert.deepEqual(calls['file.delete'].path, { file_token: 'doc1' });
  assert.equal(calls['file.delete'].params.type, 'docx');
  assert.equal(JSON.parse(r.content[0].text).deleted, true);
});

test('no client → friendly isError result', async () => {
  const { server, tools } = fakeServer();
  registerDocxTools(server, { client: null });
  const r = await tools.get('feishu_docx_create')!({ title: 'x' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not configured/i);
});

test('API error code surfaces as isError', async () => {
  const { server, tools } = fakeServer();
  const client: any = {
    docx: { v1: { document: { create: async () => ({ code: 99, msg: 'boom' }) } } },
  };
  registerDocxTools(server, { client });
  const r = await tools.get('feishu_docx_create')!({ title: 'x' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /99|boom/);
});
