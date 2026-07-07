// Profile-chip dropdown options (prototype.dc.html L109–121 + support.js L1904–1908, task c3ce).
// GAP: no `profiles` tRPC scope exists → the option set is the prototype's verbatim static list
// (matches the prototype, whose picker is also client-only). onPick updates the local chip label.

export interface ProfileOption {
  name: string;
  sub: string;
  active: boolean;
}

const PROFILE_DEFS: readonly { name: string; sub: string }[] = [
  { name: 'research', sub: 'session default' },
  { name: 'plan', sub: 'claude-sonnet-4' },
  { name: 'execute', sub: 'claude-sonnet-4' },
  { name: 'claude-haiku', sub: 'claude-haiku-4' },
];

export const PROFILE_NAMES: readonly string[] = PROFILE_DEFS.map((p) => p.name);

export function buildProfileOptions(active: string): ProfileOption[] {
  return PROFILE_DEFS.map((p) => ({ name: p.name, sub: p.sub, active: p.name === active }));
}
