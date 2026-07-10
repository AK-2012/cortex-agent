import { describe, expect, it } from 'vitest';
import type { TaskInfo } from '@cortex-agent/ui-contract';
import { buildTaskModalVm } from './task-modal-vm';

function task(partial: Partial<TaskInfo>): TaskInfo {
  return {
    id: 'T-100',
    text: 'a task',
    project: 'proj',
    status: 'open',
    priority: 'medium',
    actionable: false,
    claimedBy: null,
    blockedBy: null,
    dependsOn: [],
    plan: null,
    template: 'experiment-pipeline',
    why: null,
    doneWhen: null,
    ...partial,
  };
}

describe('buildTaskModalVm — status pill (prototype L2574-2579)', () => {
  it('done → green ✓ done', () => {
    const vm = buildTaskModalVm(task({ status: 'done' }), []);
    expect(vm.pill).toEqual({ bg: '#E9F4EE', fg: '#23854F', text: '✓ done' });
  });

  it('blocked (blockedBy set) → red blocked, outranks claimed', () => {
    const vm = buildTaskModalVm(task({ blockedBy: 'T-1', claimedBy: 'thr_x' }), []);
    expect(vm.pill).toEqual({ bg: '#FBEDEB', fg: '#C03D33', text: 'blocked' });
  });

  it('claimed → blue in-progress with the claimer id', () => {
    const vm = buildTaskModalVm(task({ claimedBy: 'thr_8f2c' }), []);
    expect(vm.pill).toEqual({ bg: '#EEF0FA', fg: '#4655D4', text: '● in-progress · thr_8f2c' });
  });

  it('actionable → blue actionable', () => {
    const vm = buildTaskModalVm(task({ actionable: true }), []);
    expect(vm.pill).toEqual({ bg: '#EEF0FA', fg: '#4655D4', text: 'actionable' });
  });

  it('open, not actionable, not claimed → gray waiting on deps', () => {
    const vm = buildTaskModalVm(task({}), []);
    expect(vm.pill).toEqual({ bg: '#F1F2F5', fg: '#8A93A2', text: 'waiting on deps' });
  });
});

describe('buildTaskModalVm — priority color (prototype L2606)', () => {
  it('high → red', () => {
    expect(buildTaskModalVm(task({ priority: 'high' }), []).priColor).toBe('#C03D33');
  });
  it('medium → amber', () => {
    expect(buildTaskModalVm(task({ priority: 'medium' }), []).priColor).toBe('#C99A2E');
  });
  it('low → gray', () => {
    expect(buildTaskModalVm(task({ priority: 'low' }), []).priColor).toBe('#B6BDC9');
  });
});

describe('buildTaskModalVm — fields (prototype L2605-2611)', () => {
  it('emits exactly priority/status/template/gpu/claimed-by in order', () => {
    const vm = buildTaskModalVm(task({ claimedBy: 'thr_8f2c', template: 'coder-review' }), []);
    expect(vm.fields.map((f) => f.k)).toEqual([
      'priority',
      'status',
      'template',
      'gpu',
      'claimed-by',
    ]);
  });

  it('priority value red only when high', () => {
    expect(buildTaskModalVm(task({ priority: 'high' }), [])._fieldsByKey.priority.vColor).toBe(
      '#C03D33',
    );
    expect(buildTaskModalVm(task({ priority: 'low' }), [])._fieldsByKey.priority.vColor).toBe(
      '#191C22',
    );
  });

  it('gpu is a "—" data-gap in muted color', () => {
    const gpu = buildTaskModalVm(task({}), [])._fieldsByKey.gpu;
    expect(gpu.v).toBe('—');
    expect(gpu.vColor).toBe('#B6BDC9');
  });

  it('claimed-by is "—" muted when unclaimed, blue id when claimed', () => {
    expect(buildTaskModalVm(task({}), [])._fieldsByKey['claimed-by']).toMatchObject({
      v: '—',
      vColor: '#B6BDC9',
    });
    expect(
      buildTaskModalVm(task({ claimedBy: 'thr_8f2c' }), [])._fieldsByKey['claimed-by'],
    ).toMatchObject({ v: 'thr_8f2c', vColor: '#4655D4' });
  });

  it('status field reflects the derived status word', () => {
    expect(buildTaskModalVm(task({ status: 'done' }), [])._fieldsByKey.status.v).toBe('done');
    expect(buildTaskModalVm(task({ blockedBy: 'T-1' }), [])._fieldsByKey.status.v).toBe('blocked');
    expect(buildTaskModalVm(task({ claimedBy: 'x' }), [])._fieldsByKey.status.v).toBe('in-progress');
    expect(buildTaskModalVm(task({ actionable: true }), [])._fieldsByKey.status.v).toBe(
      'actionable',
    );
    expect(buildTaskModalVm(task({}), [])._fieldsByKey.status.v).toBe('waiting');
  });
});

describe('buildTaskModalVm — dependencies join (real, from tasks.list only)', () => {
  it('upstream from dependsOn, resolving name + dot + label; " · done" when the dep is done', () => {
    const t = task({ id: 'T-044', dependsOn: ['T-041'] });
    const all = [t, task({ id: 'T-041', text: 'DR sweep', status: 'done' })];
    const vm = buildTaskModalVm(t, all);
    expect(vm.deps).toHaveLength(1);
    expect(vm.deps[0]).toMatchObject({
      id: 'T-041',
      name: 'DR sweep',
      label: 'upstream · done',
      dotColor: '#23854F',
      idColor: '#4655D4',
      bg: '#FBFBFC',
      border: '#EFF1F5',
    });
  });

  it('non-done upstream dot is blue and label is plain "upstream"', () => {
    const t = task({ id: 'T-044', dependsOn: ['T-041'] });
    const all = [t, task({ id: 'T-041', text: 'DR sweep', status: 'open', actionable: true })];
    const vm = buildTaskModalVm(t, all);
    expect(vm.deps[0]).toMatchObject({ label: 'upstream', dotColor: '#4655D4' });
  });

  it('blocked upstream dot is red', () => {
    const t = task({ id: 'T-044', dependsOn: ['T-041'] });
    const all = [t, task({ id: 'T-041', blockedBy: 'T-9' })];
    expect(buildTaskModalVm(t, all).deps[0].dotColor).toBe('#C03D33');
  });

  it('downstream from reverse scan of the list', () => {
    const t = task({ id: 'T-041' });
    const all = [t, task({ id: 'T-044', text: 'analyze sweep', dependsOn: ['T-041'] })];
    const vm = buildTaskModalVm(t, all);
    expect(vm.deps).toHaveLength(1);
    expect(vm.deps[0]).toMatchObject({ id: 'T-044', name: 'analyze sweep', label: 'downstream' });
  });

  it('unresolved upstream id → gray dot, "—" name, kept visible', () => {
    const t = task({ id: 'T-044', dependsOn: ['T-999'] });
    const vm = buildTaskModalVm(t, [t]);
    expect(vm.deps[0]).toMatchObject({ id: 'T-999', name: '—', dotColor: '#B6BDC9' });
  });

  it('no deps → empty array', () => {
    expect(buildTaskModalVm(task({}), []).deps).toEqual([]);
  });
});

describe('buildTaskModalVm — action flags (prototype L2599, L2613-2616)', () => {
  it('canUnblock iff blockedBy present', () => {
    expect(buildTaskModalVm(task({ blockedBy: 'T-1' }), []).canUnblock).toBe(true);
    expect(buildTaskModalVm(task({}), []).canUnblock).toBe(false);
  });

  it('completable iff not done and not blocked', () => {
    expect(buildTaskModalVm(task({}), []).completable).toBe(true);
    expect(buildTaskModalVm(task({ status: 'done' }), []).completable).toBe(false);
    expect(buildTaskModalVm(task({ blockedBy: 'T-1' }), []).completable).toBe(false);
  });

  it('complete button bg + label track completable/done', () => {
    const open = buildTaskModalVm(task({}), []);
    expect(open.completeBg).toBe('#4655D4');
    expect(open.completeLabel).toBe('Complete');
    const done = buildTaskModalVm(task({ status: 'done' }), []);
    expect(done.completeBg).toBe('#B6BDC9');
    expect(done.completeLabel).toBe('Completed');
  });
});
