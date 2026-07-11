import { describe, expect, it } from 'vitest';
import type { ApprovalInfo } from '@cortex-agent/ui-contract';
import { buildMobileApprovalsVm } from './mobile-approvals-vm';

function mk(partial: Partial<ApprovalInfo> & { id: string }): ApprovalInfo {
  return {
    id: partial.id,
    title: partial.title ?? 'Untitled',
    operation: partial.operation ?? null,
    reason: partial.reason ?? null,
    impact: partial.impact ?? null,
    command: partial.command ?? null,
    status: partial.status ?? 'pending',
    queuedAt: partial.queuedAt ?? null,
    decidedAt: partial.decidedAt ?? null,
    feedback: partial.feedback ?? null,
    provenance: partial.provenance ?? null,
    taskRef: partial.taskRef ?? null,
  };
}

const NOW = new Date('2026-07-09T12:00:00Z');

describe('buildMobileApprovalsVm', () => {
  it('splits the first pending entry into the expanded card and the rest into queue rows', () => {
    const vm = buildMobileApprovalsVm(
      [
        mk({ id: 'a', title: 'First', operation: 'Skill · behavior change', reason: 'why', impact: 'affects dispatch', queuedAt: '2026-07-09' }),
        mk({ id: 'b', title: 'Second', operation: 'Over-budget', queuedAt: '2026-07-09' }),
        mk({ id: 'c', title: 'Third', operation: 'Delete data', queuedAt: '2026-07-09' }),
      ],
      NOW,
    );
    expect(vm.pendingCount).toBe(3);
    expect(vm.firstCard?.id).toBe('a');
    expect(vm.queueRows.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('maps real fields honestly: operation→tier, impact→judgement, queuedAt→age; no from-thread', () => {
    const vm = buildMobileApprovalsVm(
      [mk({ id: 'a', title: 'T', operation: 'Skill · behavior change', reason: 'r', impact: 'affects dispatch', queuedAt: '2026-07-09' })],
      NOW,
    );
    const c = vm.firstCard!;
    expect(c.tier).toEqual({ text: 'Skill · behavior change', bg: '#F7ECCE', fg: '#8A5B06' });
    expect(c.title).toBe('T');
    expect(c.reason).toBe('r');
    expect(c.judgement).toBe('affects dispatch');
    expect(c.age).toBe('2026-07-09');
    // no fabricated from-thread / rationale field on the VM surface
    expect(Object.keys(c)).not.toContain('fromThread');
  });

  it('omits null-backed slots (no fabrication) — absent operation/impact/queuedAt drop out', () => {
    const vm = buildMobileApprovalsVm([mk({ id: 'a', title: 'T' })], NOW);
    const c = vm.firstCard!;
    expect(c.tier).toBeNull();
    expect(c.reason).toBeNull();
    expect(c.judgement).toBeNull();
    expect(c.age).toBeNull();
  });

  it('firstCard is null when there are no pending entries', () => {
    const vm = buildMobileApprovalsVm(
      [mk({ id: 'x', status: 'approved', decidedAt: '2026-07-08' })],
      NOW,
    );
    expect(vm.pendingCount).toBe(0);
    expect(vm.firstCard).toBeNull();
    expect(vm.queueRows).toEqual([]);
  });

  it('processed rows = resolved within 7 days, ✓ approved / ✕ rejected, newest first', () => {
    const vm = buildMobileApprovalsVm(
      [
        mk({ id: 'p', title: 'Pending one', status: 'pending', queuedAt: '2026-07-09' }),
        mk({ id: 'r1', title: 'Edited CORTEX.md', status: 'approved', decidedAt: '2026-07-08' }),
        mk({ id: 'r2', title: 'Killed daemon mid-run', status: 'rejected', decidedAt: '2026-07-05' }),
        mk({ id: 'old', title: 'Ancient', status: 'approved', decidedAt: '2026-06-01' }),
      ],
      NOW,
    );
    expect(vm.processedRows.map((r) => r.id)).toEqual(['r1', 'r2']); // 'old' outside 7d window
    expect(vm.processedRows[0]).toMatchObject({ approved: true, title: 'Edited CORTEX.md', date: '2026-07-08' });
    expect(vm.processedRows[1]).toMatchObject({ approved: false, title: 'Killed daemon mid-run', date: '2026-07-05' });
  });

  it('excludes resolved entries with no decidedAt from the this-week list', () => {
    const vm = buildMobileApprovalsVm(
      [mk({ id: 'r', title: 'No date', status: 'approved', decidedAt: null })],
      NOW,
    );
    expect(vm.processedRows).toEqual([]);
  });

  it('queue row carries operation tier + queuedAt age, ellipsis-safe title', () => {
    const vm = buildMobileApprovalsVm(
      [
        mk({ id: 'a', title: 'First', status: 'pending' }),
        mk({ id: 'b', title: 'Over-budget dispatch — 8×A100 ablation', operation: 'Over-budget', queuedAt: '2026-07-09' }),
      ],
      NOW,
    );
    const row = vm.queueRows[0];
    expect(row).toMatchObject({
      id: 'b',
      title: 'Over-budget dispatch — 8×A100 ablation',
      age: '2026-07-09',
      tier: { text: 'Over-budget', bg: '#F7ECCE', fg: '#8A5B06' },
    });
  });
});
