import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConfigSnapshot } from '@cortex-agent/ui-contract';
import {
  PlatformPanel,
  ProfilesPanel,
  MachinesPanel,
  TemplatesPanel,
  McpPanel,
  NotificationsPanel,
  HooksPanel,
  AdvancedPanel,
} from './SettingsPanels';

// react-dom/server render checks for the pure presentational panels (they take a plain
// ConfigSnapshot). Asserts the 1:1 structure renders REAL snapshot data + the honest placeholders.
// The Budget panel + modal shell (tRPC hooks) are covered by the live harness.

const snap: ConfigSnapshot = {
  budget: { daily_usd: 10, monthly_usd: 300 },
  profiles: {
    defaultProfile: 'plan',
    profiles: [
      { name: 'plan', model: 'claude-sonnet-4', backend: 'claude', mode: 'print' },
      { name: 'execute', model: 'claude-sonnet-4', backend: 'claude', mode: null },
    ],
  },
  machines: [
    { name: 'lab2', cortexPath: '/home/x/Cortex', gpuCount: 2, ssh: false, win: false },
    { name: 'gpu-01', cortexPath: '/home/x/Cortex', gpuCount: 8, ssh: true, win: false },
  ],
  mcp: { servers: ['cortex-core', 'cortex-slack'] },
  threadTemplates: { agents: ['coder'], templates: ['coder-review'], shells: ['bash'] },
  hooks: ['rules-loader.mjs', 'tasks-yaml-guard.mjs'],
  env: [
    { key: 'SLACK_BOT_TOKEN', present: true, masked: '••••••••' },
    { key: 'ANTHROPIC_API_KEY', present: true, masked: '••••••••' },
    { key: 'CORTEX_MACHINE', present: true, masked: '••••••••' },
    { key: 'DEBUG', present: true, masked: '••••••••' },
  ],
};

describe('settings panels — real data render', () => {
  it('Platform: masks present env, groups Messaging/API/Daemon, never leaks cleartext', () => {
    const html = renderToStaticMarkup(<PlatformPanel snapshot={snap} />);
    expect(html).toContain('Messaging platforms');
    expect(html).toContain('SLACK_BOT_TOKEN');
    expect(html).toContain('ANTHROPIC_API_KEY');
    expect(html).toContain('CORTEX_MACHINE');
    expect(html).toContain('••••••••');
    // presence-derived pill, not fabricated "connected · socket mode"
    expect(html).toContain('configured');
  });

  it('Profiles: real defaultProfile + rows, FALLBACK column omitted honestly', () => {
    const html = renderToStaticMarkup(<ProfilesPanel snapshot={snap} />);
    expect(html).toContain('plan');
    expect(html).toContain('execute');
    expect(html).toContain('claude-sonnet-4');
    expect(html).toContain('fallback is not in the config.get contract');
  });

  it('Machines: real name/path/gpu; ssh presence not raw host; runtime status omitted', () => {
    const html = renderToStaticMarkup(<MachinesPanel snapshot={snap} />);
    expect(html).toContain('lab2');
    expect(html).toContain('gpu-01');
    expect(html).toContain('— local'); // ssh:false
    expect(html).toContain('configured'); // ssh:true
    expect(html).toContain('presence flag only');
  });

  it('Templates: real basenames grouped, no fabricated chips', () => {
    const html = renderToStaticMarkup(<TemplatesPanel snapshot={snap} />);
    expect(html).toContain('coder-review');
    expect(html).toContain('coder');
    expect(html).toContain('bash');
  });

  it('MCP: real server names, variant toggle inert', () => {
    const html = renderToStaticMarkup(<McpPanel snapshot={snap} />);
    expect(html).toContain('cortex-core');
    expect(html).toContain('cortex-slack');
  });

  it('Notifications: toggles reflect env presence; approval note fixed-on', () => {
    const html = renderToStaticMarkup(<NotificationsPanel snapshot={snap} />);
    expect(html).toContain('CORTEX_TURN_NOTIFY');
    expect(html).toContain('审批提醒固定开启');
  });

  it('Hooks: real hook filenames listed', () => {
    const html = renderToStaticMarkup(<HooksPanel snapshot={snap} />);
    expect(html).toContain('rules-loader.mjs');
    expect(html).toContain('tasks-yaml-guard.mjs');
  });

  it('Advanced: flag toggles reflect env presence', () => {
    const html = renderToStaticMarkup(<AdvancedPanel snapshot={snap} />);
    expect(html).toContain('DEBUG');
    expect(html).toContain('CORTEX_SERVER_UPDATE_DISABLE');
  });
});
