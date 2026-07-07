import { describe, it, expect } from 'vitest';
import { buildProfileOptions, PROFILE_NAMES } from './profile-menu';

describe('buildProfileOptions', () => {
  it('returns the verbatim prototype option set with model sub-labels', () => {
    expect(buildProfileOptions('research')).toEqual([
      { name: 'research', sub: 'session default', active: true },
      { name: 'plan', sub: 'claude-sonnet-4', active: false },
      { name: 'execute', sub: 'claude-sonnet-4', active: false },
      { name: 'claude-haiku', sub: 'claude-haiku-4', active: false },
    ]);
  });

  it('marks the active profile only', () => {
    const opts = buildProfileOptions('plan');
    expect(opts.filter((o) => o.active).map((o) => o.name)).toEqual(['plan']);
  });

  it('exposes the ordered profile names', () => {
    expect(PROFILE_NAMES).toEqual(['research', 'plan', 'execute', 'claude-haiku']);
  });
});
