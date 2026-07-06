import { describe, expect, it } from 'vitest';
import { TONES, statusTone, type Tone } from './tone';

// All status vocabularies the ui-service contract can emit
// (agent-server/src/domain/ui-service/types.ts).
const THREAD_STATUSES = ['running', 'waiting', 'completed', 'failed', 'cancelled', 'aborted'];
const TASK_STATUSES = ['open', 'done'];
const EXECUTION_STATUSES = ['running', 'completed', 'failed', 'cancelled', 'stale'];

const ALL = [...THREAD_STATUSES, ...TASK_STATUSES, ...EXECUTION_STATUSES];

describe('statusTone', () => {
  it('maps every contract status to a valid tone', () => {
    for (const status of ALL) {
      expect(TONES).toContain(statusTone(status));
    }
  });

  it('maps synonymous statuses onto the five tones as designed', () => {
    const cases: Record<string, Tone> = {
      running: 'running',
      waiting: 'waiting',
      completed: 'done',
      done: 'done',
      failed: 'failed',
      aborted: 'failed',
      cancelled: 'cancelled',
      stale: 'cancelled',
      open: 'running',
    };
    for (const [status, tone] of Object.entries(cases)) {
      expect(statusTone(status)).toBe(tone);
    }
  });

  it('is case-insensitive', () => {
    expect(statusTone('RUNNING')).toBe('running');
    expect(statusTone('Completed')).toBe('done');
  });

  it('falls back to cancelled for an unknown status', () => {
    expect(statusTone('bogus')).toBe('cancelled');
    expect(statusTone('')).toBe('cancelled');
  });
});
