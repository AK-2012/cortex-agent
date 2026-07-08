// Pure nav model for the Settings modal (design 12a–g, prototype.dc.html L720–1090, script L2379).
// The 9 left-nav panels + their content-header title/sub copy (verbatim EN from the prototype
// secMeta, L2394–2404). Framework-free; no JSX, no hex. Precedent: features/overview/overview-vm.ts.

export type SettingsSectionKey =
  | 'platform'
  | 'profiles'
  | 'budget'
  | 'machines'
  | 'templates'
  | 'mcp'
  | 'notifications'
  | 'hooks'
  | 'advanced';

export interface SettingsNavEntry {
  key: SettingsSectionKey;
  label: string;
  /** The mono file tag shown right-aligned in the nav row (prototype `n.file`). */
  file: string;
}

export interface SettingsSectionMeta {
  /** Content-area title (prototype `setTitle`). */
  title: string;
  /** Content-area sub-line (prototype `setSub`). */
  sub: string;
}

// prototype L2379–2388 — order is authoritative.
export const SETTINGS_NAV: SettingsNavEntry[] = [
  { key: 'platform', label: 'Platform', file: '.env' },
  { key: 'profiles', label: 'Profiles', file: 'profiles.json' },
  { key: 'budget', label: 'Budget', file: 'budget.json' },
  { key: 'machines', label: 'Machines', file: 'machines.json' },
  { key: 'templates', label: 'Thread templates', file: 'thread-templates' },
  { key: 'mcp', label: 'MCP servers', file: 'mcp-config.json' },
  { key: 'notifications', label: 'Notifications', file: '.env' },
  { key: 'hooks', label: 'Hooks', file: 'hooks/*.mjs' },
  { key: 'advanced', label: 'Advanced', file: 'feature flags' },
];

// prototype L2394–2404 — EN copy verbatim (the app default language is EN).
export const SETTINGS_SECTION_META: Record<SettingsSectionKey, SettingsSectionMeta> = {
  platform: {
    title: 'Platform',
    sub: 'config/.env — loaded once at daemon startup; the only restart-required config',
  },
  profiles: {
    title: 'Profiles',
    sub: 'config/profiles.json — read on every agent spawn, no restart needed',
  },
  budget: {
    title: 'Budget',
    sub: 'config/budget.json — hot-read, applies immediately; upgrades never overwrite (only --force)',
  },
  machines: {
    title: 'Machines',
    sub: 'config/machines.json — fs.watch hot-reload; clients auto-launched over SSH at startup',
  },
  templates: {
    title: 'Thread templates',
    sub: 'config/thread-templates.json — read fresh on every thread launch',
  },
  mcp: {
    title: 'MCP servers',
    sub: 'config/mcp-config.json — full / core / tui variants picked per runtime mode',
  },
  notifications: {
    title: 'Notifications',
    sub: '.env notification flags + system notice routing (fans out per platform)',
  },
  hooks: {
    title: 'Hooks',
    sub: 'three layers: in-agent · thread lifecycle · session — .mjs read fresh per invocation',
  },
  advanced: {
    title: 'Advanced',
    sub: 'feature flags — written to .env, restart to apply',
  },
};

export function sectionMeta(key: SettingsSectionKey): SettingsSectionMeta {
  return SETTINGS_SECTION_META[key];
}
