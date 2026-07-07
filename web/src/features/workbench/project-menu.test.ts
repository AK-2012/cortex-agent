import { describe, it, expect } from 'vitest';
import type { ProjectConduitInfo, ThreadInfo } from '@cortex-agent/ui-contract';
import {
  runningCountByProject,
  buildSwitchList,
  switchRowMeta,
  projMenuSubLabel,
} from './project-menu';

const thread = (projectId: string, status: ThreadInfo['status']): ThreadInfo => ({
  id: 't_' + Math.random().toString(36).slice(2),
  templateName: 'coder-review',
  currentStep: null,
  status,
  projectId,
  createdAt: '2026-07-06T00:00:00Z',
  updatedAt: '2026-07-06T00:00:00Z',
  totalSteps: 1,
  artifactPath: null,
});

const project = (id: string): ProjectConduitInfo => ({
  id,
  kind: 'research',
  contextDir: '/x/' + id,
  hasMission: true,
  conduits: {},
});

describe('runningCountByProject', () => {
  it('counts only running + waiting threads, grouped by projectId', () => {
    const counts = runningCountByProject([
      thread('a', 'running'),
      thread('a', 'waiting'),
      thread('a', 'completed'),
      thread('b', 'running'),
      thread('c', 'failed'),
    ]);
    expect(counts).toEqual({ a: 2, b: 1 });
  });

  it('returns an empty map for no active threads', () => {
    expect(runningCountByProject([thread('a', 'completed')])).toEqual({});
  });
});

describe('switchRowMeta', () => {
  it('shows the running count when > 0, else idle', () => {
    expect(switchRowMeta(2)).toBe('2 running');
    expect(switchRowMeta(1)).toBe('1 running');
    expect(switchRowMeta(0)).toBe('idle');
  });
});

describe('buildSwitchList', () => {
  it('excludes the active project and maps real running counts, order preserved', () => {
    const rows = buildSwitchList(
      [project('flywheel'), project('cortex-self'), project('tactile')],
      'cortex-self',
      { flywheel: 2 },
    );
    expect(rows).toEqual([
      { id: 'flywheel', running: 2, isRunning: true, meta: '2 running' },
      { id: 'tactile', running: 0, isRunning: false, meta: 'idle' },
    ]);
  });

  it('keeps every project when there is no active project', () => {
    const rows = buildSwitchList([project('a'), project('b')], null, {});
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('projMenuSubLabel', () => {
  it('formats plural threads + cost', () => {
    expect(projMenuSubLabel(2, 4.21)).toBe('2 threads running · $4.21 today');
  });

  it('uses singular for one thread', () => {
    expect(projMenuSubLabel(1, 0.3)).toBe('1 thread running · $0.30 today');
  });

  it('omits cost when unknown', () => {
    expect(projMenuSubLabel(0, undefined)).toBe('0 threads running');
  });
});
