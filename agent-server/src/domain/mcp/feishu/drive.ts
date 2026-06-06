// input:  MCP SDK, zod, types (guard/ok/unwrap), lark client
// output: drive helpers (resolveDriveUrl, setLinkShare) + registerDriveTools (feishu_drive_set_link_share)
// pos:    Feishu drive sharing & canonical-URL resolution — shared by the create tools + a standalone tool
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { guard, ok, unwrap, type FeishuToolDeps } from './types.js';
import type { LarkClient } from './client.js';

/** Drive file type token used by the meta / permission APIs. */
export type DriveFileType = 'doc' | 'docx' | 'sheet' | 'bitable' | 'file' | 'wiki' | 'slides' | 'mindnote';

/** Friendly link-share levels mapped to Feishu's link_share_entity values. */
export type LinkShareLevel = 'tenant_edit' | 'tenant_view' | 'none';

const LINK_SHARE_ENTITY: Record<Exclude<LinkShareLevel, 'none'>, string> = {
  tenant_edit: 'tenant_editable',
  tenant_view: 'tenant_readable',
};

/**
 * Resolve a drive file's canonical (tenant-subdomain) URL via drive.meta.batchQuery. App-created
 * files live on the tenant subdomain (e.g. https://<tenant>.feishu.cn/docx/<id>), which a hand-built
 * "feishu.cn/docx/<id>" URL does not match — so the create tools call this to return a link that
 * actually opens. Returns null on any failure so callers fall back to a constructed URL.
 */
export async function resolveDriveUrl(client: LarkClient, token: string, docType: DriveFileType): Promise<string | null> {
  try {
    const res = await (client as any).drive.v1.meta.batchQuery({
      data: { request_docs: [{ doc_token: token, doc_type: docType }], with_url: true },
    });
    const data = unwrap<{ metas?: Array<{ url?: string }> }>(res);
    return data.metas?.[0]?.url ?? null;
  } catch {
    return null;
  }
}

/**
 * Set a drive file's link-share so tenant members can open it by URL. This is how an app-created
 * (bot-owned) file becomes visible to a human user: without it the file sits in the app's space,
 * owned by the app identity, invisible in any person's drive. `none` is a no-op here (use the
 * standalone tool to actively revoke). Throws on a non-zero API code so callers can decide whether
 * to treat sharing as best-effort.
 */
export async function setLinkShare(client: LarkClient, token: string, type: DriveFileType, level: LinkShareLevel): Promise<boolean> {
  if (level === 'none') return false;
  const res = await (client as any).drive.v1.permissionPublic.patch({
    path: { token },
    params: { type },
    data: { link_share_entity: LINK_SHARE_ENTITY[level] },
  });
  unwrap(res);
  return true;
}

export function registerDriveTools(server: McpServer, deps: FeishuToolDeps): void {
  server.tool(
    'feishu_drive_set_link_share',
    'Control a Feishu file\'s link-share. Use this to make an app-created (bot-owned) doc/sheet/base visible: set level=tenant_edit (anyone in the org with the link can edit) or tenant_view (view only); level=none revokes link access. Returns the canonical URL to open.',
    {
      token: z.string().describe('The file token (docx document_id, sheet spreadsheet_token, bitable app_token, …)'),
      type: z.enum(['docx', 'sheet', 'bitable', 'file', 'doc', 'slides', 'mindnote']).describe('The file type'),
      level: z.enum(['tenant_edit', 'tenant_view', 'none']).describe('tenant_edit | tenant_view | none (revoke)'),
    },
    async ({ token, type, level }) =>
      guard(deps.client, async (client) => {
        if (level === 'none') {
          const res = await (client as any).drive.v1.permissionPublic.patch({
            path: { token },
            params: { type },
            data: { link_share_entity: 'closed' },
          });
          unwrap(res);
          return ok({ token, type, level: 'none', shared: false });
        }
        await setLinkShare(client, token, type as DriveFileType, level);
        const url = await resolveDriveUrl(client, token, type as DriveFileType);
        return ok({ token, type, level, shared: true, url });
      }),
  );
}
