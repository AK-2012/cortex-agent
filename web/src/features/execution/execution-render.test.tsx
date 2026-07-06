import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExecutionDetailInfo } from '@cortex-agent/ui-contract';
import { ExecutionDetailRail } from './ExecutionDetailRail';
import { LogStreamView } from './LogStreamView';
import { EMPTY_LOG, type LogState } from './log-buffer';

// react-dom/server render checks for the F3 (8b) presentational surface. vitest runs in node;
// browser E2E is environment-blocked (persistent SSE defeats headless-Chrome --dump-dom — see
// features/thread/CORTEX.md), so these assert the real components' markup. Data-fetching + the
// live-log hook live in ExecutionDetailPage (verified against a real ui-http-server, not here).

function detail(over: Partial<ExecutionDetailInfo> = {}): ExecutionDetailInfo {
  return {
    id: 'exec_abc',
    type: 'dispatch',
    kind: 'cortex-run',
    status: 'running',
    projectId: 'cortex-self',
    sessionId: null,
    threadId: 'thr_x',
    runtime: { startedAt: '2026-07-06T00:00:00Z', updatedAt: '2026-07-06T00:01:00Z', endedAt: null },
    dispatch: {
      taskId: '2198', machine: 'lab2', pid: '4242', tmuxName: 'run-2198',
      sessionName: 'sess', scheduleTaskId: null, runName: 'my-run',
    },
    metrics: { costUsd: 1.5, numTurns: 12, durationS: 83 },
    gpu: null,
    text: { label: 'my-run', finalOutput: null, error: null },
    ...over,
  };
}

const noop = () => {};

describe('ExecutionDetailRail (8b right rail)', () => {
  it('renders lifecycle / watchdog / GPU (—) / cost fields', () => {
    const html = renderToStaticMarkup(
      <ExecutionDetailRail detail={detail()} onStop={noop} stopping={false} />,
    );
    expect(html).toContain('data-execution-rail="exec_abc"');
    expect(html).toContain('Lifecycle');
    expect(html).toContain('Watchdog');
    expect(html).toContain('4242'); // pid
    expect(html).toContain('my-run'); // runName
    expect(html).toContain('GPU');
    expect(html).toContain('—'); // gpu unknown
    expect(html).toContain('$1.50'); // cost
    expect(html).toContain('1m 23s'); // duration
  });

  it('renders the real GPU (index + memory) when captured (task 032e/7578)', () => {
    const html = renderToStaticMarkup(
      <ExecutionDetailRail
        detail={detail({ gpu: { indices: [1], memoryMb: 49140 } })}
        onStop={noop}
        stopping={false}
      />,
    );
    expect(html).toContain('GPU 1 · 49140 MB'); // real per-execution GPU, no longer the "—" placeholder
  });

  it('enables Stop when running', () => {
    const html = renderToStaticMarkup(
      <ExecutionDetailRail detail={detail({ status: 'running' })} onStop={noop} stopping={false} />,
    );
    expect(html).toMatch(/data-action="stop">Stop</);
    expect(html).not.toMatch(/disabled=""[^>]*data-action="stop"/);
  });

  it('disables Stop when terminal', () => {
    const html = renderToStaticMarkup(
      <ExecutionDetailRail detail={detail({ status: 'completed' })} onStop={noop} stopping={false} />,
    );
    expect(html).toMatch(/disabled=""[^>]*data-action="stop"/);
  });

  it('renders Extend cap as a disabled affordance (no backend op yet)', () => {
    const html = renderToStaticMarkup(
      <ExecutionDetailRail detail={detail()} onStop={noop} stopping={false} />,
    );
    expect(html).toContain('Extend cap');
    expect(html).toMatch(/disabled=""[^>]*data-action="extend-cap"/);
  });
});

describe('LogStreamView (8b live log)', () => {
  it('shows an empty state when no live log is available (not a cortex-run)', () => {
    const html = renderToStaticMarkup(
      <LogStreamView state={EMPTY_LOG} enabled={false} running={false} />,
    );
    expect(html).toContain('No live log');
  });

  it('renders accumulated log lines', () => {
    const state: LogState = { lines: ['line one', 'line two'], dropped: 0, lastSeq: 2 };
    const html = renderToStaticMarkup(<LogStreamView state={state} enabled running />);
    expect(html).toContain('data-log-stream="true"');
    expect(html).toContain('line one');
    expect(html).toContain('line two');
  });

  it('renders a dropped marker when lines were dropped', () => {
    const state: LogState = { lines: ['x'], dropped: 3, lastSeq: 5 };
    const html = renderToStaticMarkup(<LogStreamView state={state} enabled running />);
    expect(html).toContain('3');
    expect(html).toMatch(/dropped/);
  });

  it('shows a waiting placeholder while running with no output yet', () => {
    const html = renderToStaticMarkup(<LogStreamView state={EMPTY_LOG} enabled running />);
    expect(html).toContain('waiting for output');
  });
});
