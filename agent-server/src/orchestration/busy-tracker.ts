// input:  EventBus, delta: number
// output: busyTracker singleton — activeLlmCount tracking, llm.active-count-delta publish, IPC busy/idle
// pos:    orch/ layer — LLM busy/idle IPC signaling [S6-C]
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { EventBus } from '@events/index.js';

export class BusyTracker {
  private _count = 0;
  private _bus: EventBus | null = null;

  setBus(bus: EventBus): void {
    this._bus = bus;
    // Subscriber-as-source-of-truth: _count is updated by the subscriber itself, so
    // any publisher (including non-tracker bus.publish callers) is correctly counted.
    // Transition detection: 0→1 sends IPC busy, 1→0 sends IPC idle (S13 NTH-A fix).
    bus.subscribe('llm.active-count-delta', (e) => {
      this._count += e.delta;
      if (!process.send) return;
      if (this._count === 1 && e.delta > 0) process.send({ type: 'busy' });
      if (this._count === 0 && e.delta < 0) process.send({ type: 'idle' });
    });
  }

  trackPendingTask(delta: number): void {
    this._bus?.publish({ type: 'llm.active-count-delta', delta });
  }

  /** Exposed for testing: current activeLlmCount value. */
  get count(): number {
    return this._count;
  }
}

export const busyTracker = new BusyTracker();

/** Backward-compat named export: call sites change only the import path, not the call. */
export function trackPendingTask(delta: number): void {
  busyTracker.trackPendingTask(delta);
}
