import type { ExecutionDetailInfo } from '@cortex-agent/ui-contract';

// Pure presentational derivations for the execution detail screen (design 8b, DR-0018 §6.3 F3).
// Framework-free → unit-tested; the components stay declarative.

const DASH = '—';

// Only a running execution can be Stopped (executions.cancel). Terminal states disable the control.
export function isStoppable(status: string): boolean {
  return status === 'running';
}

// A live `execution.log` stream is subscribable only for a cortex-run launch, i.e. when the daemon
// registered a `runName` for the dispatch (B2-C). Otherwise the log location can't be resolved.
export function logStreamEnabled(detail: ExecutionDetailInfo): boolean {
  return detail.dispatch?.runName != null;
}

// gpu is the real per-execution GPU captured via the cortex-run watcher → task-callback chain
// (task 032e/7578): "GPU <indices> · <memoryMb> MB" when known, "—" when the run resolved none.
export function formatGpu(gpu: ExecutionDetailInfo['gpu']): string {
  if (!gpu || gpu.indices.length === 0) return DASH;
  const idx = `GPU ${gpu.indices.join(',')}`;
  return gpu.memoryMb != null ? `${idx} · ${gpu.memoryMb} MB` : idx;
}

export function formatCost(usd: number | null): string {
  return usd == null ? DASH : `$${usd.toFixed(2)}`;
}

export function formatNum(n: number | null): string {
  return n == null ? DASH : String(n);
}

export function formatDuration(s: number | null): string {
  if (s == null) return DASH;
  const total = Math.round(s);
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${total % 60}s`;
  return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
}
