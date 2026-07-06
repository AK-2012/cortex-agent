import { describe, it, expect } from 'vitest';
import type { SessionInfo, ThreadInfo, TaskInfo } from '@cortex-agent/ui-contract';
import { buildPaletteItems, NAV_COMMANDS } from './palette-items';

function task(partial: Partial<TaskInfo> & Pick<TaskInfo, 'id'>): TaskInfo {
  return {
    text: `task ${partial.id}`,
    project: 'proj-a',
    status: 'open',
    priority: 'high',
    actionable: true,
    claimedBy: null,
    blockedBy: null,
    dependsOn: [],
    plan: null,
    template: 'coder-review',
    ...partial,
  };
}

function thread(partial: Partial<ThreadInfo> & Pick<ThreadInfo, 'id'>): ThreadInfo {
  return {
    templateName: 'coder-review',
    currentStep: null,
    status: 'running',
    projectId: 'proj-a',
    createdAt: '2026-07-06T00:00:00Z',
    updatedAt: '2026-07-06T00:00:00Z',
    totalSteps: 3,
    artifactPath: null,
    ...partial,
  };
}

function session(partial: Partial<SessionInfo> & Pick<SessionInfo, 'sessionId'>): SessionInfo {
  return {
    name: `session ${partial.sessionId}`,
    projectId: 'proj-a',
    backend: 'claude',
    kind: 'local',
    createdAt: '2026-07-06T00:00:00Z',
    lastUsedAt: '2026-07-06T00:00:00Z',
    resumable: true,
    label: null,
    ...partial,
  };
}

describe('buildPaletteItems', () => {
  it('returns no items for empty inputs', () => {
    expect(buildPaletteItems({ sessions: [], threads: [], tasks: [] })).toEqual([]);
  });

  it('maps a task to a Tasks item routed to /tasks with focusId', () => {
    const items = buildPaletteItems({
      sessions: [],
      threads: [],
      tasks: [task({ id: '051b', text: 'command palette' })],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      group: 'Tasks',
      route: '/tasks',
      focusId: '051b',
    });
    expect(items[0].label).toContain('command palette');
  });

  it('maps a thread to a Threads item routed to /threads', () => {
    const items = buildPaletteItems({
      sessions: [],
      threads: [thread({ id: 'thr_abc', templateName: 'manager' })],
      tasks: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ group: 'Threads', route: '/threads', focusId: 'thr_abc' });
  });

  it('maps a session to a Sessions item routed to /workbench', () => {
    const items = buildPaletteItems({
      sessions: [session({ sessionId: 'sess_1', name: 'main chat' })],
      threads: [],
      tasks: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ group: 'Sessions', route: '/workbench', focusId: 'sess_1' });
    expect(items[0].label).toContain('main chat');
  });

  it('assigns unique cmdk values per item across groups', () => {
    const items = buildPaletteItems({
      sessions: [session({ sessionId: 'x' })],
      threads: [thread({ id: 'x' })],
      tasks: [task({ id: 'x' })],
    });
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exposes the entity id/project/status as searchable keywords', () => {
    const [item] = buildPaletteItems({
      sessions: [],
      threads: [],
      tasks: [task({ id: '051b', text: 'palette', project: 'cortex-self', status: 'open' })],
    });
    expect(item.keywords).toContain('051b');
    expect(item.keywords).toContain('cortex-self');
    expect(item.keywords).toContain('open');
  });

  it('orders groups Sessions → Threads → Tasks', () => {
    const items = buildPaletteItems({
      sessions: [session({ sessionId: 's' })],
      threads: [thread({ id: 't' })],
      tasks: [task({ id: 'k' })],
    });
    expect(items.map((i) => i.group)).toEqual(['Sessions', 'Threads', 'Tasks']);
  });

  it('preserves input order within a group', () => {
    const items = buildPaletteItems({
      sessions: [],
      threads: [],
      tasks: [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })],
    });
    expect(items.map((i) => i.focusId)).toEqual(['a', 'b', 'c']);
  });
});

describe('NAV_COMMANDS', () => {
  it('covers every app section with a route and label', () => {
    const routes = NAV_COMMANDS.map((c) => c.route);
    expect(routes).toEqual(
      expect.arrayContaining(['/workbench', '/tasks', '/threads', '/overview', '/settings', '/kit']),
    );
    for (const cmd of NAV_COMMANDS) {
      expect(cmd.label.length).toBeGreaterThan(0);
      expect(cmd.id.length).toBeGreaterThan(0);
    }
  });

  it('has unique command ids', () => {
    const ids = NAV_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
