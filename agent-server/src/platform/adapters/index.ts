// input:  ../adapter.js, ./slack.js, ./feishu.js, ../testing.js
// output: PlatformType + AdapterConfig + createAdapter factory
// pos:    Select the specific adapter based on CORTEX_PLATFORM
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { PlatformAdapter } from '../adapter.js';
import { SlackAdapter } from './slack.js';
import type { SlackAdapterConfig } from './slack.js';
import { FeishuAdapter } from './feishu.js';
import type { FeishuAdapterConfig } from './feishu.js';
import { MockAdapter } from '../testing.js';

export type PlatformType = 'slack' | 'discord' | 'telegram' | 'feishu' | 'test';

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

/** Create adapter from environment variables (auto-detect platform). */
export function createAdapterFromEnv(overrides?: AdapterOverrides): PlatformAdapter {
  const platform = (process.env.CORTEX_PLATFORM || 'slack') as PlatformType;

  if (platform === 'slack') {
    const botToken = process.env.SLACK_BOT_TOKEN;
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    const appToken = process.env.SLACK_APP_TOKEN;

    if (!botToken || !signingSecret || !appToken) {
      throw new Error('Missing required Slack env vars: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_APP_TOKEN');
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
      throw new Error('Missing required Feishu env vars: FEISHU_APP_ID, FEISHU_APP_SECRET');
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

  return createAdapter({ platform });
}

export { SlackAdapter } from './slack.js';
export type { SlackAdapterConfig } from './slack.js';
export { FeishuAdapter } from './feishu.js';
export type { FeishuAdapterConfig } from './feishu.js';
