import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  parseApprovals,
  handleApprovalsList,
} from '../../../src/domain/ui-service/query/approvals.js';
import { createUiService } from '../../../src/domain/ui-service/ui-service.js';
import { createAppRouter } from '../../../src/domain/ui-service/app-router.js';
import { createCallerFactory } from '../../../src/domain/ui-service/trpc.js';
import type { UiServiceDeps } from '../../../src/domain/ui-service/types.js';

// A representative PENDING_APPROVALS.md with a preamble + 4 entries covering every status,
// a missing-field entry, and a reject with parenthetical feedback.
const SAMPLE = `# Pending Approvals

> This file tracks operations that require user approval before execution.
> Use \`/approval\` to review.

## 2026-03-01 Alpha: promote a rule
- **Operation**: Move K to rules
- **Reason**: it is a validated behavior rule
- **Impact**: adds a rule section
- **Command/Action**: Edit CLAUDE.md
- **Status**: pending

## 2026-03-02 Beta: bump idle timeout
- **Operation**: Increase IDLE_TIMEOUT to 15m
- **Reason**: scans fail on slow WebFetch
- **Impact**: modifies one constant
- **Command/Action**: Edit bridge line 16
- **Status**: approved — executed 2026-03-02 (per user)

## 2026-03-06 Gamma: submit upstream issue
- **Operation**: Submit the bug report
- **Reason**: investigation complete
- **Status**: rejected 2026-03-02 (misdiagnosis, scan actually succeeded)

## 2026-03-11 Delta: failed thing
- **Operation**: do the thing
- **Reason**: because
- **Impact**: some impact
- **Command/Action**: run it
- **Status**: failed
`;

function makeDeps(approvalsPath: string): UiServiceDeps {
  return {
    projectStore: { list: () => [], get: () => undefined, exists: () => false, getDefault: () => ({ id: 'general', name: 'general', kind: 'general' as const, contextDir: '/g' }), createProject: () => ({} as any) },
    sessionStore: { listByProject: async () => [], listByOrigin: async () => [], listResumable: async () => [], getById: async () => null },
    threadStore: { getAll: () => [], get: () => null },
    taskStore: { getAll: () => [], getById: () => null, load: () => {}, refresh: () => {} },
    scheduler: { list: async () => [], get: async () => null, pause: async () => null, resume: async () => null, remove: async () => false, add: async () => ({ id: 'sch_new' } as any) },
    executionRegistry: { getExecution: () => null, getAll: () => [], cancelExecution: () => null },
    executionLogTailer: { startTail: () => {}, stopTail: () => {}, refCount: () => 0 },
    conversationHistory: { getHistory: async () => null },
    sendSessionMessage: () => {},
    approvalsPath,
    runningExecutions: { getAll: () => [] } as any,
    costSummary: async () => ({ today: 0, week: 0, month: 0, total: 0, byMode: {} as any, byProject: {}, byTrigger: {}, bySource: {}, byBackend: {}, tokens: {} as any, entryCount: 0 }),
    bus: { subscribe: () => ({ unsubscribe: () => {} }), publish: () => {} } as any,
    adapter: {} as any,
  };
}

function writeTemp(content: string): string {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cortex-appr-'));
  const p = path.join(dir, 'PENDING_APPROVALS.md');
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

// ── (1) parse: multi-entry, order, headings, statuses ────────────────────────
test('parseApprovals parses every entry with title/queuedAt/status', () => {
  const all = parseApprovals(SAMPLE);
  assert.equal(all.length, 4);

  const [a, b, g, d] = all;
  assert.equal(a.title, 'Alpha: promote a rule');
  assert.equal(a.queuedAt, '2026-03-01');
  assert.equal(a.status, 'pending');
  assert.equal(a.operation, 'Move K to rules');
  assert.equal(a.reason, 'it is a validated behavior rule');
  assert.equal(a.impact, 'adds a rule section');
  assert.equal(a.command, 'Edit CLAUDE.md');

  assert.equal(b.status, 'approved');
  assert.equal(b.decidedAt, '2026-03-02');

  assert.equal(g.status, 'rejected');
  assert.equal(g.decidedAt, '2026-03-02');
  assert.equal(g.feedback, 'misdiagnosis, scan actually succeeded');

  assert.equal(d.status, 'failed');
});

// ── (2) missing fields → null ────────────────────────────────────────────────
test('parseApprovals sets missing bullet fields to null', () => {
  const [, , gamma] = parseApprovals(SAMPLE);
  // Gamma has no Impact / Command-Action bullets.
  assert.equal(gamma.impact, null);
  assert.equal(gamma.command, null);
  assert.equal(gamma.operation, 'Submit the bug report');
});

// ── (3) status filter ────────────────────────────────────────────────────────
test('parseApprovals filters by status', () => {
  const pending = parseApprovals(SAMPLE, 'pending');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].title, 'Alpha: promote a rule');

  const rejected = parseApprovals(SAMPLE, 'rejected');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].status, 'rejected');
});

// ── (4) stable ids ───────────────────────────────────────────────────────────
test('parseApprovals assigns stable, distinct ids', () => {
  const first = parseApprovals(SAMPLE).map((e) => e.id);
  const second = parseApprovals(SAMPLE).map((e) => e.id);
  assert.deepEqual(first, second); // stable across reads
  assert.equal(new Set(first).size, first.length); // distinct
  assert.ok(first.every((id) => /^[0-9a-f]{8}$/.test(id)));
});

// ── (5) missing file → [] ────────────────────────────────────────────────────
test('handleApprovalsList returns [] when the file is missing', async () => {
  const deps = makeDeps(path.join(os.tmpdir(), 'does-not-exist-approvals.md'));
  const list = await handleApprovalsList(deps, {});
  assert.deepEqual(list, []);
});

// ── (6) facade + tRPC wiring ─────────────────────────────────────────────────
test('approvals.list reachable via the ui-service facade', async () => {
  const deps = makeDeps(writeTemp(SAMPLE));
  const ui = createUiService(deps);
  const res = await ui.query('approvals.list', {});
  assert.ok(res.ok);
  assert.equal(res.data.length, 4);

  const filtered = await ui.query('approvals.list', { status: 'approved' });
  assert.ok(filtered.ok);
  assert.equal(filtered.data.length, 1);
  assert.equal(filtered.data[0].status, 'approved');
});

test('approvals.list reachable via the tRPC AppRouter', async () => {
  const deps = makeDeps(writeTemp(SAMPLE));
  const caller = createCallerFactory(createAppRouter(createUiService(deps)))({});
  const list = await caller.approvals.list({});
  assert.equal(list.length, 4);
  const pending = await caller.approvals.list({ status: 'pending' });
  assert.equal(pending.length, 1);
});
