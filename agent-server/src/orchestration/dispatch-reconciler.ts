// input:  executionRegistry, pendingTaskTracker
// output: startDispatchReconciler() — background interval for stale dispatch cleanup
// pos:    orch/ — extracted from entry/app.ts setInterval (S13 composition-root extraction)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as executionRegistry from '@domain/executions/registry.js';
import * as pendingTaskTracker from '@domain/tasks/pending-tracker.js';

const RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
const DISPATCH_STALE_AGE_MS = 3 * 60 * 60 * 1000;

export function startDispatchReconciler(): void {
  setInterval(() => {
    executionRegistry.reconcileStaleDispatches({
      isTaskPending: (taskId) => pendingTaskTracker.getTask(taskId) !== null,
      maxAgeMs: DISPATCH_STALE_AGE_MS,
    });
  }, RECONCILE_INTERVAL_MS);
}
