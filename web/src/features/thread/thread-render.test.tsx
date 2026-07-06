import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { ThreadChildNode, ThreadDetail } from '@cortex-agent/ui-contract';
import { ThreadStepList } from './ThreadStepList';
import { NestedThreadsPanel } from './NestedThreadsPanel';
import { ThreadArtifactsPanel } from './ThreadArtifactsPanel';

// Render-level checks for the F2 surface (11b/2b). vitest runs in node; react-dom/server renders
// the REAL components against a synthesized ThreadDetail — the browser E2E is environmentally
// blocked (headless Chrome's persistent SSE defeats --dump-dom here), so these assert the rendered
// markup of the actual components; the interactive state decisions are covered by nested-threads.test.ts.

function child(id: string, depth: number, children: ThreadChildNode[] = [], over: Partial<ThreadChildNode> = {}): ThreadChildNode {
  return {
    id, templateName: over.templateName ?? 'coder-review', status: over.status ?? 'running',
    activeAgent: over.activeAgent ?? null, costUsd: over.costUsd ?? 0.5, depth,
    createdAt: '2026-07-06T00:00:00Z', taskId: null, children, truncated: over.truncated ?? false,
  };
}

// c1(d0) → g1(d1) → gg1(d2) → ggg1(d3) → gggg1(d4, truncated)
const deepTree: ThreadChildNode[] = [
  child('thr_c1', 0, [
    child('thr_g1', 1, [
      child('thr_gg1', 2, [
        child('thr_ggg1', 3, [child('thr_gggg1', 4, [], { truncated: true })]),
      ]),
    ]),
  ]),
  child('thr_c2', 0, [], { status: 'completed' }),
];

const detail: ThreadDetail = {
  id: 'thr_root', templateName: 'coder-review', currentStep: { index: 1, name: 'implement' },
  status: 'running', projectId: 'cortex-self', createdAt: '2026-07-06T00:00:00Z',
  updatedAt: '2026-07-06T00:00:00Z', totalSteps: 2, artifactPath: '/a/artifact.md', endedAt: null,
  error: null, abortReason: null, activeAgent: 'slot1', activeStage: 'implement', totalCostUsd: 2.64,
  steps: [
    { stepIndex: 0, agentSlotId: 'slot0', stage: 'plan', status: 'completed', executionId: 'e0', sessionId: null, sessionName: null, costUsd: 0.51, numTurns: 12, durationS: 207, startedAt: null, endedAt: '2026-07-06T00:00:00Z', outputSummary: 'plan complete' },
    { stepIndex: 1, agentSlotId: 'slot1', stage: 'implement', status: 'running', executionId: null, sessionId: null, sessionName: null, costUsd: null, numTurns: null, durationS: null, startedAt: null, endedAt: null, outputSummary: null },
  ],
  agentFlow: { slotId: 'slot1', profile: 'coder', status: 'running', stage: 'implement', sessionId: null, sessionName: null, lastOutput: 'wiring the outline flatten' },
  dispatches: [], children: deepTree,
  artifacts: { artifactPath: '/home/x/artifact.md', workspacePath: '/home/x/ws', taskId: '0f25', taskProject: 'cortex-self' },
};

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

describe('ThreadArtifactsPanel (11b right rail — persistent refs)', () => {
  it('renders artifact/workspace/task refs + live badge + the Stage-6 deferral note', () => {
    const html = render(<ThreadArtifactsPanel artifacts={detail.artifacts} live />);
    expect(html).toContain('data-thread-artifacts="true"');
    expect(html).toContain('/home/x/artifact.md');
    expect(html).toContain('cortex-self/0f25');
    expect(html).toContain('live');
    expect(html).toMatch(/Stage 6/);
  });
  it('shows an empty state when the thread has no artifact', () => {
    const html = render(<ThreadArtifactsPanel artifacts={{ artifactPath: null, workspacePath: null, taskId: null, taskProject: null }} live={false} />);
    expect(html).toContain('No artifact');
    expect(html).not.toContain('>live<');
  });
});

describe('ThreadStepList (11b left pipeline — reused F1 primitive)', () => {
  it('renders the active step expanded + the completed step collapsed', () => {
    const html = render(<ThreadStepList detail={detail} />);
    expect(html).toContain('data-active-step="true"');
    expect(html).toContain('wiring the outline flatten'); // active agent flow lastOutput
    expect(html).toContain('data-step-index="0"');
  });
  it('renders the renderSubthreads slot instead of the default flat list when provided', () => {
    const html = render(
      <ThreadStepList detail={detail} renderSubthreads={() => <div data-slot="nested" />} />,
    );
    expect(html).toContain('data-slot="nested"');
  });
});

describe('NestedThreadsPanel (2b nested threads)', () => {
  it('renders the inline (Tree) subthread rows with drill affordances + the Tree/Outline toggle', () => {
    const html = render(<NestedThreadsPanel nodes={deepTree} focusId="thr_root" trail={[]} />);
    expect(html).toContain('data-nested-panel="true"');
    expect(html).toContain('data-nested-thread-id="thr_c1"');
    expect(html).toContain('data-drill-thread-id="thr_c1"'); // has children → drillable
    expect(html).toContain('>Tree</button>');
    expect(html).toContain('>Outline</button>');
  });
  it('marks a node at/over the max level (or truncated) as "max"', () => {
    // an already-deep (truncated) node rendered at top level
    const html = render(<NestedThreadsPanel nodes={[child('thr_x', 3, [], { truncated: true })]} focusId="thr_root" trail={[]} />);
    expect(html).toContain('max');
  });
  it('shows an empty state when there are no subthreads', () => {
    const html = render(<NestedThreadsPanel nodes={[]} focusId="thr_root" trail={[]} />);
    expect(html).toContain('No subthreads');
  });
});
