// input:  ../adapter.js, ./slack.js, ./feishu.js, ../testing.js, ./tui/index.js, ./composite-adapter.js
// output: PlatformType + AdapterConfig + createAdapter factory + createAdapterFromEnv + createPrimaryAdapterFromEnv
// pos:    Select the specific adapter based on CORTEX_PLATFORM / CORTEX_TUI
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { PlatformAdapter } from '../adapter.js';
import { SlackAdapter } from './slack.js';
import type { SlackAdapterConfig } from './slack.js';
import { FeishuAdapter } from './feishu.js';
import type { FeishuAdapterConfig } from './feishu.js';
import { MockAdapter } from '../testing.js';
import { TuiGatewayAdapter } from './tui/index.js';
import { CompositeAdapter } from './composite-adapter.js';

export type PlatformType = 'slack' | 'discord' | 'telegram' | 'feishu' | 'tui' | 'test';

export interface AdapterConfig {
  platform: PlatformType;
  slack?: SlackAdapterConfig;
  feishu?: FeishuAdapterConfig;
}

export function createAdapter(config: AdapterConfig): PlatformAdapter {
  switch (config.platform) {
    case 'slack':
      if (!config.slack) {
        throw new Error('Slack adapter requires slack config (botToken, signingSecret, appToken)');
      }
      return new SlackAdapter(config.slack);

    case 'feishu':
      if (!config.feishu) {
        throw new Error('Feishu adapter requires feishu config (appId, appSecret)');
      }
      return new FeishuAdapter(config.feishu);

    case 'discord':
    case 'telegram':
      throw new Error(`Platform "${config.platform}" is not yet implemented. Contributions welcome!`);

    default:
      throw new Error(`Unknown platform: ${config.platform}`);
  }
}

/** Options injected from the composition root for capabilities that cross layer boundaries. */
export interface AdapterOverrides {}

// ─── Primary adapter from env (existing detection logic factored out) ───

/**
 * Detect and create a primary (Slack / Feishu / test) adapter from environment
 * variables. Returns `null` when no primary platform is configured — allowing
 * the caller (createAdapterFromEnv) to fall back to TUI-only mode.
 */
export function createPrimaryAdapterFromEnv(): PlatformAdapter | null {
  const platform = (process.env.CORTEX_PLATFORM || 'slack') as PlatformType;

  if (platform === 'slack') {
    const botToken = process.env.SLACK_BOT_TOKEN;
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    const appToken = process.env.SLACK_APP_TOKEN;

    if (!botToken || !signingSecret || !appToken) {
      return null;
    }

    return new SlackAdapter({
      botToken,
      signingSecret,
      appToken,
      adminChannel: process.env.CORTEX_ADMIN_CHANNEL || undefined,
    });
  }

  if (platform === 'feishu') {
    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;

    if (!appId || !appSecret) {
      return null;
    }

    return new FeishuAdapter({
      appId,
      appSecret,
      encryptKey: process.env.FEISHU_ENCRYPT_KEY || undefined,
      verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || undefined,
      adminChannel: process.env.CORTEX_ADMIN_CHANNEL || undefined,
      domain: (process.env.FEISHU_DOMAIN as 'feishu' | 'lark') || undefined,
    });
  }

  if (platform === 'test') {
    return new MockAdapter({ adminChannel: process.env.CORTEX_ADMIN_CHANNEL || 'test-admin' });
  }

  return null;
}

// ─── TUI auto-enable logic ─────────────────────────────────────────────

/**
 * Decide whether to enable the TUI gateway.
 * - CORTEX_TUI='1' → enabled
 * - CORTEX_TUI='0' → disabled
 * - unset → enabled (auto; EADDRINUSE soft-fails cheaply)
 */
function decideTuiEnabled(): boolean {
  const flag = process.env.CORTEX_TUI;
  if (flag === '1') return true;
  if (flag === '0') return false;
  return true; // auto: default enabled
}

/** Return the configured TUI port (default 3003). */
function tuiPort(): number {
  return Number(process.env.CORTEX_TUI_PORT) || 3003;
}

// ─── createAdapterFromEnv (rewritten with 4-branch logic) ──────────────

/**
 * Create a PlatformAdapter from environment variables.
 *
 * Four branches:
 *   no primary + TUI disabled → throw
 *   no primary + TUI enabled  → TuiGatewayAdapter only
 *   primary   + TUI disabled → primary adapter only
 *   primary   + TUI enabled  → CompositeAdapter(primary, gateway)
 */
export function createAdapterFromEnv(): PlatformAdapter {
  const primary = createPrimaryAdapterFromEnv();
  const tuiEnabled = decideTuiEnabled();

  if (!primary && !tuiEnabled) {
    throw new Error(
      'No platform configured. Set Slack/Feishu environment variables or enable CORTEX_TUI=1.',
    );
  }
  if (!primary && tuiEnabled) {
    return new TuiGatewayAdapter({ port: tuiPort() });
  }
  if (primary && !tuiEnabled) {
    return primary;
  }
  // primary + tuiEnabled
  return new CompositeAdapter(primary, new TuiGatewayAdapter({ port: tuiPort() }));
}

export { SlackAdapter } from './slack.js';
export type { SlackAdapterConfig } from './slack.js';
export { FeishuAdapter } from './feishu.js';
export type { FeishuAdapterConfig } from './feishu.js';
