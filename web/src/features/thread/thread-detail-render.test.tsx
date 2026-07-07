import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreadPipeline } from './ThreadPipeline';
import { ThreadArtifactPanel } from './ThreadArtifactPanel';
import type { DetailArtifact, ThreadDetailVm } from './thread-detail-vm';

// react-dom/server render checks for the 11b presentational surface (design §6.3 F2). vitest runs in
// node; browser E2E is environment-blocked (persistent SSE defeats headless-Chrome — see
// features/thread/CORTEX.md), so these assert the real components' markup. Data fetching + cancel/
// drill navigation live in ThreadDetailRoute/View (verified against a real ui-http-server, not here).

const runningVm: ThreadDetailVm = {
  name: 'plan-exec-review',
  tid: 'thr_8f2c',
  pill: { bg: '#EEF0FA', fg: '#4655D4', text: 'Running' },
  crumbs: [{ id: null, name: 'quad-nav-sim2real', accent: false }],
  template: 'plan-exec-review',
  started: '07:12',
  elapsed: '42:18',
  cost: 'Σ $2.52',
  task: 'T-041',
  depthDots: [true, true, false, false, false].map((filled) => ({ filled })),
  depthText: '2/5',
  live: true,
  steps: [
    { kind: 'done', title: '1 · Plan', note: 'plan.md', meta: '3m · $0.04', hasConnector: false, subs: [], subCount: 0 },
    {
      kind: 'running',
      title: '3 · Review',
      note: '',
      meta: '04:12',
      hasConnector: true,
      agent: {
        profile: 'reviewer',
        execInfo: 'exec_31b0 · local',
        lastOutput: 'Now checking the headline claim.',
        streaming: true,
        live: true,
      },
      subCount: 2,
      subs: [
        { id: 'thr_b7f3', name: 'verify-metrics', level: 'L2', pill: { bg: '#EEF0FA', fg: '#4655D4', text: 'Running' }, hasLine: true, line: 'analyst', isMax: false },
        { id: 'thr_cc', name: 'check-claims', level: 'L2', pill: { bg: '#E9F4EE', fg: '#23854F', text: 'Done' }, hasLine: false, line: '', isMax: false },
      ],
    },
    { kind: 'pending', title: '4 · Commit', note: 'safety class: repo write', meta: 'gated', hasConnector: true, subs: [], subCount: 0 },
  ],
  artifact: {} as DetailArtifact,
};

describe('ThreadPipeline', () => {
  const html = renderToStaticMarkup(<ThreadPipeline vm={runningVm} onOpenSub={() => {}} />);
  it('renders the PIPELINE header + hint', () => {
    expect(html).toContain('PIPELINE');
    expect(html).toContain('auto-follows active step');
  });
  it('renders each step title and the collapsed metas', () => {
    expect(html).toContain('1 · Plan');
    expect(html).toContain('3 · Review');
    expect(html).toContain('4 · Commit');
    expect(html).toContain('gated');
  });
  it('expands the running step into the agent flow + sub-thread cards', () => {
    expect(html).toContain('agent: reviewer');
    expect(html).toContain('exec_31b0 · local');
    expect(html).toContain('Now checking the headline claim.');
    expect(html).toContain('SUB-THREADS · 2');
    expect(html).toContain('verify-metrics');
    expect(html).toContain('check-claims');
    expect(html).toContain('open ›');
  });
});

describe('ThreadArtifactPanel', () => {
  const artifact: DetailArtifact = {
    path: 'experiments/EXP-023.md',
    live: true,
    updated: '2m ago',
    taskId: 'T-041',
    taskProject: 'quad-nav-sim2real',
    workspacePath: '/ws/thr_8f2c',
    writtenBy: [
      { label: '1 Plan · done', active: false },
      { label: '3 Review · editing', active: true },
    ],
    contentGap: true,
  };
  const html = renderToStaticMarkup(<ThreadArtifactPanel artifact={artifact} onOpen={() => {}} />);
  it('renders the header refs + live badge + Open', () => {
    expect(html).toContain('THREAD ARTIFACT');
    expect(html).toContain('experiments/EXP-023.md');
    expect(html).toContain('live');
    expect(html).toContain('Open ↗');
    expect(html).toContain('2m ago');
  });
  it('renders REFERENCES from real refs and the Stage-6 content-gap note', () => {
    expect(html).toContain('REFERENCES');
    expect(html).toContain('/ws/thr_8f2c');
    expect(html).toContain('quad-nav-sim2real');
    expect(html).toContain('Memory viewer');
  });
  it('renders WRITTEN BY chips from steps', () => {
    expect(html).toContain('WRITTEN BY');
    expect(html).toContain('1 Plan · done');
    expect(html).toContain('3 Review · editing');
  });
});
