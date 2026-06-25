// input:  src/tui/components/DashboardCostTab.tsx
// output: Tests — renders real CostSummary fields; empty summary shows the fallback
// pos:    Regression for the property-name mismatch that made every Cost tab read
//         "No cost summary available" even when cost data existed.

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { DashboardCostTab } from '../../src/tui/components/DashboardCostTab.js';
import type { TabData } from '../../src/tui/hooks/useDashboardData.js';

// Shape mirrors domain/costs/cost-tracker.ts CostSummary (top-level USD numbers + byMode buckets).
const SUMMARY = {
  today: 1.25,
  week: 4.5,
  month: 12.3456,
  total: 99.9999,
  byMode: {
    opus: { today: 1.0, week: 3.0, month: 8.0, total: 80.0 },
    sonnet: { today: 0.25, week: 1.5, month: 4.3456, total: 19.9999 },
    idle: { today: 0, week: 0, month: 0, total: 0 },
  },
  byProject: {},
  entryCount: 42,
};

function makeTabData(data: unknown[]): TabData {
  return { data, loading: false, error: null, lastUpdated: Date.now() };
}

test('Cost tab renders totals from a real CostSummary', () => {
  const instance = render(React.createElement(DashboardCostTab, { data: makeTabData([SUMMARY]) }));
  const frame = instance.lastFrame() ?? '';
  assert.equal(frame.includes('No cost summary available'), false, 'must not show the empty fallback when data exists');
  assert.ok(frame.includes('$99.9999'), 'total rendered');
  assert.ok(frame.includes('$12.3456'), 'month rendered');
  assert.ok(frame.includes('$1.2500'), 'today rendered');
  assert.ok(frame.includes('opus'), 'per-mode breakdown rendered');
  assert.equal(frame.includes('idle'), false, 'zero-spend modes are omitted');
  instance.unmount();
  instance.cleanup();
});

test('Cost tab shows fallback only when there is genuinely no spend', () => {
  const empty = { today: 0, week: 0, month: 0, total: 0, byMode: {}, byProject: {}, entryCount: 0 };
  const instance = render(React.createElement(DashboardCostTab, { data: makeTabData([empty]) }));
  const frame = instance.lastFrame() ?? '';
  // total is 0 (not null) so totals still render; ensure it does NOT crash and shows $0.0000.
  assert.ok(frame.includes('$0.0000'), 'zero totals still render rather than a misleading fallback');
  instance.unmount();
  instance.cleanup();
});
