// input:  MCP SDK, zod, types (guard/ok/unwrap), lark client
// output: registerWikiTools — feishu_wiki_* tools (knowledge-base spaces & nodes)
// pos:    Feishu 知识库 (wiki) space/node browsing & authoring for agents
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { guard, ok, unwrap, type FeishuToolDeps } from './types.js';

function wikiHost(): string {
  return process.env.FEISHU_DOMAIN === 'lark' ? 'larksuite.com' : 'feishu.cn';
}

/** A wiki node's wiki-space URL (token is the node_token). */
function wikiUrl(token: string): string {
  return `https://${wikiHost()}/wiki/${token}`;
}

export function registerWikiTools(server: McpServer, deps: FeishuToolDeps): void {
  server.tool(
    'feishu_wiki_list_spaces',
    'List the Feishu knowledge-base (wiki) spaces the app can access. Returns space_id + name. Use a space_id with feishu_wiki_list_nodes to browse its pages.',
    {
      page_token: z.string().optional().describe('Pagination token from a previous call'),
      page_size: z.number().int().min(1).max(50).optional().describe('Page size (default 20, max 50)'),
    },
    async ({ page_token, page_size }) =>
      guard(deps.client, async (client) => {
        const res = await client.wiki.v2.space.list({
          params: { page_size: page_size ?? 20, page_token },
        } as any);
        const data = unwrap<{ items?: any[]; page_token?: string; has_more?: boolean }>(res);
        return ok({ spaces: data.items ?? [], page_token: data.page_token, has_more: data.has_more ?? false });
      }),
  );

  server.tool(
    'feishu_wiki_list_nodes',
    'List child nodes (pages) of a wiki space, optionally under a parent node. Each node carries node_token plus obj_token/obj_type — pass a docx node\'s obj_token as document_id to the feishu_docx_* tools to read/edit its content.',
    {
      space_id: z.string().describe('The wiki space_id (from feishu_wiki_list_spaces)'),
      parent_node_token: z.string().optional().describe('List children under this node (top level if omitted)'),
      page_token: z.string().optional().describe('Pagination token from a previous call'),
      page_size: z.number().int().min(1).max(50).optional().describe('Page size (default 50, max 50)'),
    },
    async ({ space_id, parent_node_token, page_token, page_size }) =>
      guard(deps.client, async (client) => {
        const res = await client.wiki.v2.spaceNode.list({
          path: { space_id },
          params: { page_size: page_size ?? 50, page_token, parent_node_token },
        } as any);
        const data = unwrap<{ items?: any[]; page_token?: string; has_more?: boolean }>(res);
        return ok({ space_id, nodes: data.items ?? [], page_token: data.page_token, has_more: data.has_more ?? false });
      }),
  );

  server.tool(
    'feishu_wiki_get_node',
    'Get a wiki node by its token. Returns obj_token + obj_type (e.g. docx/sheet/bitable) so you can hand off to the matching feishu_docx_* / feishu_sheets_* / feishu_bitable_* tools.',
    {
      token: z.string().describe('The wiki node_token (or a wiki-doc token)'),
      obj_type: z.string().optional().describe('Optional object type hint (wiki | docx | …)'),
    },
    async ({ token, obj_type }) =>
      guard(deps.client, async (client) => {
        const res = await client.wiki.v2.space.getNode({
          params: { token, obj_type },
        } as any);
        const data = unwrap<{ node?: any }>(res);
        return ok({ node: data.node ?? null });
      }),
  );

  server.tool(
    'feishu_wiki_create_node',
    'Create a new node (page) in a wiki space. Defaults to a docx document — after creating, use the returned obj_token as document_id with feishu_docx_append to add content.',
    {
      space_id: z.string().describe('The wiki space_id to create the node in'),
      title: z.string().optional().describe('Node title'),
      obj_type: z.string().optional().describe('Object type: docx (default), sheet, bitable, mindnote'),
      parent_node_token: z.string().optional().describe('Create under this node (space root if omitted)'),
    },
    async ({ space_id, title, obj_type, parent_node_token }) =>
      guard(deps.client, async (client) => {
        const res = await client.wiki.v2.spaceNode.create({
          path: { space_id },
          data: { obj_type: obj_type ?? 'docx', node_type: 'origin', parent_node_token, title },
        } as any);
        const data = unwrap<{ node?: any }>(res);
        const node = data.node ?? {};
        return ok({ node, url: node.node_token ? wikiUrl(node.node_token) : undefined });
      }),
  );

  server.tool(
    'feishu_wiki_update_node_title',
    'Rename a wiki node (updates its title only). Locate node_token with feishu_wiki_list_nodes first.',
    {
      space_id: z.string().describe('The wiki space_id'),
      node_token: z.string().describe('The node to rename'),
      title: z.string().describe('New title'),
    },
    async ({ space_id, node_token, title }) =>
      guard(deps.client, async (client) => {
        const res = await client.wiki.v2.spaceNode.updateTitle({
          path: { space_id, node_token },
          data: { title },
        } as any);
        unwrap(res);
        return ok({ space_id, node_token, title, updated: true });
      }),
  );

  // NOTE: wiki node *search* (wiki.v1.node.search) and *space creation* require a USER access token;
  // the cortex-feishu server authenticates as the app (tenant token) only, so those are intentionally
  // not exposed. The node tools above work once the app is added as a member of a wiki space.
}
