// input:  MCP SDK, zod, markdown-to-blocks, blocks-to-text, types, client
// output: registerDocxTools — feishu_docx_* tools (create/read/list/append/insert/update/delete)
// pos:    Feishu 云文档 (docx) block-level authoring & editing for agents
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { markdownToBlocks, type BlockDescriptor } from './markdown-to-blocks.js';
import { summarizeBlocks } from './blocks-to-text.js';
import { guard, ok, unwrap, type FeishuToolDeps } from './types.js';
import { BLOCK_TYPE_KEY } from './block-types.js';

const REV = -1; // document_revision_id: -1 = latest

function docUrl(documentId: string): string {
  const host = process.env.FEISHU_DOMAIN === 'lark' ? 'larksuite.com' : 'feishu.cn';
  return `https://${host}/docx/${documentId}`;
}

/** Resolve tool input into block descriptors: raw `blocks` wins, else parse markdown. */
function resolveChildren(markdown?: string, blocks?: unknown[]): BlockDescriptor[] {
  if (Array.isArray(blocks) && blocks.length > 0) return blocks as BlockDescriptor[];
  if (typeof markdown === 'string') return markdownToBlocks(markdown);
  return [];
}

/** Extract the inline `elements` array from a single block descriptor (for patch). */
function elementsOf(block: BlockDescriptor): unknown[] {
  const key = BLOCK_TYPE_KEY[block.block_type];
  const payload = key ? (block[key] as { elements?: unknown[] } | undefined) : undefined;
  return payload?.elements ?? [];
}

export function registerDocxTools(server: McpServer, deps: FeishuToolDeps): void {
  server.tool(
    'feishu_docx_create',
    'Create a new Feishu cloud document (docx). Returns document_id + url. The doc starts empty — use feishu_docx_append to add markdown content.',
    {
      title: z.string().optional().describe('Document title'),
      folder_token: z.string().optional().describe('Drive folder token to create the doc in (root if omitted)'),
    },
    async ({ title, folder_token }) =>
      guard(deps.client, async (client) => {
        const res = await client.docx.v1.document.create({ data: { title, folder_token } } as any);
        const doc = unwrap<{ document?: { document_id?: string; title?: string } }>(res);
        const id = doc.document?.document_id ?? '';
        return ok({ document_id: id, title: doc.document?.title ?? title, url: docUrl(id) });
      }),
  );

  server.tool(
    'feishu_docx_get_content',
    'Read a Feishu doc as plain text (human-readable, no block IDs). To edit specific blocks, use feishu_docx_list_blocks instead to obtain block_ids.',
    {
      document_id: z.string().describe('The docx document_id'),
    },
    async ({ document_id }) =>
      guard(deps.client, async (client) => {
        const res = await client.docx.v1.document.rawContent({ path: { document_id }, params: { lang: 0 } } as any);
        const data = unwrap<{ content?: string }>(res);
        return ok({ document_id, content: data.content ?? '' });
      }),
  );

  server.tool(
    'feishu_docx_list_blocks',
    'List a docx\'s blocks with block_id, type, parent_id and text. Call this before update_block / delete_blocks to locate the target block.',
    {
      document_id: z.string().describe('The docx document_id'),
      page_token: z.string().optional().describe('Pagination token from a previous call'),
      page_size: z.number().int().min(1).max(500).optional().describe('Page size (default 500)'),
    },
    async ({ document_id, page_token, page_size }) =>
      guard(deps.client, async (client) => {
        const res = await client.docx.v1.documentBlock.list({
          path: { document_id },
          params: { page_size: page_size ?? 500, page_token, document_revision_id: REV },
        } as any);
        const data = unwrap<{ items?: any[]; page_token?: string; has_more?: boolean }>(res);
        return ok({
          document_id,
          blocks: summarizeBlocks(data.items ?? []),
          page_token: data.page_token,
          has_more: data.has_more ?? false,
        });
      }),
  );

  server.tool(
    'feishu_docx_append',
    'Append content to the end of a docx (or under a parent block). Provide `markdown` (preferred — supports headings, lists, code, quotes, bold/italic/links) and/or raw `blocks` JSON for Feishu-only features (tables, colors, callouts) markdown cannot express.',
    {
      document_id: z.string().describe('The docx document_id'),
      markdown: z.string().optional().describe('Markdown content to convert into blocks'),
      blocks: z.array(z.any()).optional().describe('Raw Feishu block descriptors (escape hatch; bypasses markdown)'),
      parent_block_id: z.string().optional().describe('Append under this block (default: document root)'),
    },
    async ({ document_id, markdown, blocks, parent_block_id }) =>
      guard(deps.client, async (client) => {
        const children = resolveChildren(markdown, blocks);
        if (children.length === 0) return ok({ document_id, created: 0, note: 'No content provided' });
        const res = await client.docx.v1.documentBlockChildren.create({
          path: { document_id, block_id: parent_block_id || document_id },
          data: { children: children as any },
          params: { document_revision_id: REV },
        } as any);
        const data = unwrap<{ children?: Array<{ block_id?: string }>; document_revision_id?: number }>(res);
        return ok({
          document_id,
          created_block_ids: (data.children ?? []).map((c) => c.block_id),
          document_revision_id: data.document_revision_id,
        });
      }),
  );

  server.tool(
    'feishu_docx_insert',
    'Insert content at a specific position under a parent block. Same content rules as feishu_docx_append, plus a 0-based `index` among the parent\'s children.',
    {
      document_id: z.string().describe('The docx document_id'),
      index: z.number().int().min(0).describe('0-based insertion position among the parent block\'s children'),
      markdown: z.string().optional().describe('Markdown content to convert into blocks'),
      blocks: z.array(z.any()).optional().describe('Raw Feishu block descriptors (escape hatch)'),
      parent_block_id: z.string().optional().describe('Parent block (default: document root)'),
    },
    async ({ document_id, index, markdown, blocks, parent_block_id }) =>
      guard(deps.client, async (client) => {
        const children = resolveChildren(markdown, blocks);
        if (children.length === 0) return ok({ document_id, created: 0, note: 'No content provided' });
        const res = await client.docx.v1.documentBlockChildren.create({
          path: { document_id, block_id: parent_block_id || document_id },
          data: { children: children as any, index },
          params: { document_revision_id: REV },
        } as any);
        const data = unwrap<{ children?: Array<{ block_id?: string }>; document_revision_id?: number }>(res);
        return ok({
          document_id,
          created_block_ids: (data.children ?? []).map((c) => c.block_id),
          document_revision_id: data.document_revision_id,
        });
      }),
  );

  server.tool(
    'feishu_docx_update_block',
    'Replace the inline text content of a single existing block (text/heading/list/quote/todo). Supply `markdown` (first block\'s inline content is used) or raw `elements` via blocks. Locate block_id with feishu_docx_list_blocks first.',
    {
      document_id: z.string().describe('The docx document_id'),
      block_id: z.string().describe('The block to update'),
      markdown: z.string().optional().describe('New inline content (markdown; first line/block used)'),
      blocks: z.array(z.any()).optional().describe('Raw Feishu elements[] (escape hatch; bypasses markdown)'),
    },
    async ({ document_id, block_id, markdown, blocks }) =>
      guard(deps.client, async (client) => {
        let elements: unknown[];
        if (Array.isArray(blocks) && blocks.length > 0) {
          elements = blocks;
        } else {
          const parsed = markdownToBlocks(markdown ?? '');
          elements = parsed.length > 0 ? elementsOf(parsed[0]) : [];
        }
        const res = await client.docx.v1.documentBlock.patch({
          path: { document_id, block_id },
          data: { update_text_elements: { elements: elements as any } },
          params: { document_revision_id: REV },
        } as any);
        const data = unwrap<{ document_revision_id?: number }>(res);
        return ok({ document_id, block_id, document_revision_id: data.document_revision_id });
      }),
  );

  server.tool(
    'feishu_docx_delete_blocks',
    'Delete a contiguous range of child blocks under a parent block, by 0-based index (end_index exclusive). Use feishu_docx_list_blocks to find indices.',
    {
      document_id: z.string().describe('The docx document_id'),
      parent_block_id: z.string().describe('Parent block whose children are deleted (document_id for root)'),
      start_index: z.number().int().min(0).describe('First child index to delete (inclusive)'),
      end_index: z.number().int().min(0).describe('Index to stop at (exclusive)'),
    },
    async ({ document_id, parent_block_id, start_index, end_index }) =>
      guard(deps.client, async (client) => {
        const res = await client.docx.v1.documentBlockChildren.batchDelete({
          path: { document_id, block_id: parent_block_id },
          data: { start_index, end_index },
          params: { document_revision_id: REV },
        } as any);
        const data = unwrap<{ document_revision_id?: number }>(res);
        return ok({ document_id, deleted: `[${start_index}, ${end_index})`, document_revision_id: data.document_revision_id });
      }),
  );

  server.tool(
    'feishu_docx_delete',
    'Delete (trash) an entire Feishu doc. This removes the whole document — irreversible from the API. Use feishu_docx_delete_blocks to remove content instead.',
    {
      document_id: z.string().describe('The docx document_id to delete'),
    },
    async ({ document_id }) =>
      guard(deps.client, async (client) => {
        const res = await client.drive.v1.file.delete({
          path: { file_token: document_id },
          params: { type: 'docx' },
        } as any);
        unwrap(res);
        return ok({ document_id, deleted: true });
      }),
  );
}
