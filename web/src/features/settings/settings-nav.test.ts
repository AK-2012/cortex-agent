import { describe, it, expect } from 'vitest';
import { SETTINGS_NAV, SETTINGS_SECTION_META, sectionMeta } from './settings-nav';

describe('settings-nav', () => {
  it('lists the 9 panels in the prototype order (L2379–2388)', () => {
    expect(SETTINGS_NAV.map((n) => n.key)).toEqual([
      'platform',
      'profiles',
      'budget',
      'machines',
      'templates',
      'mcp',
      'notifications',
      'hooks',
      'advanced',
    ]);
  });

  it('carries the exact label + file tag for each panel', () => {
    const byKey = Object.fromEntries(SETTINGS_NAV.map((n) => [n.key, n]));
    expect(byKey.platform).toMatchObject({ label: 'Platform', file: '.env' });
    expect(byKey.templates).toMatchObject({ label: 'Thread templates', file: 'thread-templates' });
    expect(byKey.mcp).toMatchObject({ label: 'MCP servers', file: 'mcp-config.json' });
    expect(byKey.hooks).toMatchObject({ label: 'Hooks', file: 'hooks/*.mjs' });
    expect(byKey.advanced).toMatchObject({ label: 'Advanced', file: 'feature flags' });
  });

  it('has section meta for every nav key with verbatim EN copy', () => {
    for (const n of SETTINGS_NAV) {
      expect(SETTINGS_SECTION_META[n.key]).toBeDefined();
    }
    expect(sectionMeta('budget').sub).toContain('hot-read, applies immediately');
    expect(sectionMeta('platform').sub).toContain('the only restart-required config');
  });
});
