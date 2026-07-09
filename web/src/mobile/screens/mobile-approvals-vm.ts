import type { ApprovalInfo } from '@cortex-agent/ui-contract';

// Pure view-model for the mobile approval screen (design 10e, scheme.dc.html L3200-3247). Maps the
// REAL `ApprovalInfo` DTO (parsed from PENDING_APPROVALS.md) into the 10e slots — the SAME data +
// tiered labels as desktop 7a (task 851f). The scheme mock carries fields the real markdown does NOT
// have (a safety-class tag / a from-thread / a per-type metric like `$6.40 / 剩余 $1.10` / an
// approval-rule rationale); those are omitted or reuse the closest real field — we NEVER fabricate a
// value (851f precedent). Framework-free so the DTO→value mapping is unit-tested in isolation.

const AMBER_BG = '#F7ECCE';
const AMBER_FG = '#8A5B06';
/** "本周已处理" = resolved within this rolling window (days). */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Cap the processed list so a long history never overflows the 374px content column. */
const MAX_PROCESSED = 6;

export interface TierPill {
  text: string;
  bg: string;
  fg: string;
}

/** First (expanded) pending card — decision happens inline here. */
export interface MobileApprovalFirstCard {
  id: string;
  /** operation → amber tier pill (851f flagged: no safety-class taxonomy field); null when absent. */
  tier: TierPill | null;
  /** queuedAt date; null → omit (851f: date only, no relative clock). */
  age: string | null;
  title: string;
  /** real reason; null → omit. */
  reason: string | null;
  /** real impact shown in the 判定 box (no rationale field — 851f why-note gap); null → omit box. */
  judgement: string | null;
}

/** Collapsed queue row for the remaining pending entries. */
export interface MobileApprovalQueueRow {
  id: string;
  title: string;
  age: string | null;
  tier: TierPill | null;
}

/** A resolved entry in the "本周已处理" list. */
export interface MobileApprovalProcessedRow {
  id: string;
  /** true = approved (✓ green), false = rejected (✕ red). */
  approved: boolean;
  title: string;
  date: string | null;
}

export interface MobileApprovalsVm {
  pendingCount: number;
  firstCard: MobileApprovalFirstCard | null;
  queueRows: MobileApprovalQueueRow[];
  processedRows: MobileApprovalProcessedRow[];
}

function tierOf(operation: string | null): TierPill | null {
  if (!operation || operation.trim() === '') return null;
  return { text: operation, bg: AMBER_BG, fg: AMBER_FG };
}

function withinWeek(decidedAt: string | null, now: Date): boolean {
  if (!decidedAt) return false;
  const t = Date.parse(decidedAt);
  if (Number.isNaN(t)) return false;
  const diff = now.getTime() - t;
  return diff >= 0 && diff <= WEEK_MS;
}

export function buildMobileApprovalsVm(
  entries: ApprovalInfo[],
  now: Date = new Date(),
): MobileApprovalsVm {
  const pending = entries.filter((e) => e.status === 'pending');
  const [first, ...rest] = pending;

  const firstCard: MobileApprovalFirstCard | null = first
    ? {
        id: first.id,
        tier: tierOf(first.operation),
        age: first.queuedAt,
        title: first.title,
        reason: first.reason,
        judgement: first.impact,
      }
    : null;

  const queueRows: MobileApprovalQueueRow[] = rest.map((e) => ({
    id: e.id,
    title: e.title,
    age: e.queuedAt,
    tier: tierOf(e.operation),
  }));

  const processedRows: MobileApprovalProcessedRow[] = entries
    .filter((e) => (e.status === 'approved' || e.status === 'rejected') && withinWeek(e.decidedAt, now))
    .sort((a, b) => Date.parse(b.decidedAt!) - Date.parse(a.decidedAt!))
    .slice(0, MAX_PROCESSED)
    .map((e) => ({ id: e.id, approved: e.status === 'approved', title: e.title, date: e.decidedAt }));

  return { pendingCount: pending.length, firstCard, queueRows, processedRows };
}
