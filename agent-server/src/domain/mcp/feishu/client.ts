// input:  @larksuiteoapi/node-sdk, env (FEISHU_APP_ID/SECRET/DOMAIN)
// output: buildFeishuClient() → lark.Client | null (null when unconfigured)
// pos:    Shared Feishu OpenAPI client for all feishu_* MCP doc tools
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as lark from '@larksuiteoapi/node-sdk';

export type LarkClient = lark.Client;

export interface FeishuClientConfig {
  appId: string;
  appSecret: string;
  domain?: 'feishu' | 'lark';
}

/** Construct a Feishu OpenAPI client (mirrors FeishuAdapter's constructor). */
export function createFeishuClient(config: FeishuClientConfig): LarkClient {
  const domain = config.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu;
  return new lark.Client({
    appId: config.appId,
    appSecret: config.appSecret,
    appType: lark.AppType.SelfBuild,
    domain,
  });
}

/**
 * Build a client from environment variables. Returns null when credentials are
 * absent so the server can register tools that fail with a friendly message
 * rather than crashing at startup.
 */
export function buildFeishuClientFromEnv(env: NodeJS.ProcessEnv = process.env): LarkClient | null {
  const appId = env.FEISHU_APP_ID;
  const appSecret = env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) return null;
  return createFeishuClient({
    appId,
    appSecret,
    domain: (env.FEISHU_DOMAIN as 'feishu' | 'lark') || undefined,
  });
}
