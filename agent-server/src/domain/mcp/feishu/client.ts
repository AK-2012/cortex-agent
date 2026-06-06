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

/**
 * Logger that routes ALL lark SDK output to stderr. CRITICAL for the cortex-feishu MCP server:
 * it speaks the MCP JSON-RPC protocol over stdout, but the lark SDK logs via console.log (stdout)
 * by default. Any SDK info/error log emitted during a tool call (e.g. a Feishu API permission
 * error) would otherwise interleave with the protocol stream and corrupt the response. Console.error
 * writes to stderr, which the MCP transport ignores.
 */
export const stderrLogger = {
  error: (...m: unknown[]): void => console.error('[lark:error]', ...m),
  warn: (...m: unknown[]): void => console.error('[lark:warn]', ...m),
  info: (...m: unknown[]): void => console.error('[lark:info]', ...m),
  debug: (...m: unknown[]): void => console.error('[lark:debug]', ...m),
  trace: (...m: unknown[]): void => console.error('[lark:trace]', ...m),
};

/** Construct a Feishu OpenAPI client (mirrors FeishuAdapter's constructor). */
export function createFeishuClient(config: FeishuClientConfig): LarkClient {
  const domain = config.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu;
  return new lark.Client({
    appId: config.appId,
    appSecret: config.appSecret,
    appType: lark.AppType.SelfBuild,
    domain,
    // Force SDK logs to stderr — stdout carries the MCP JSON-RPC protocol (see stderrLogger).
    logger: stderrLogger,
    loggerLevel: lark.LoggerLevel.warn,
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
