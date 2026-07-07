// input:  UiServiceDeps + { id, feedback? }
// output: applyApprovalDecision (pure md flip) + approve/reject handlers
// pos:    mutate handlers for 'approvals.approve' / 'approvals.reject'. These ONLY flip the
//         target entry's Status line in <CORTEX_HOME>/context/PENDING_APPROVALS.md — they do NOT
//         execute the underlying operation (that is the agent/research-loop's job).

import * as fs from 'node:fs';
import { atomicWriteSync } from '@core/atomic-write.js';
import type {
  UiServiceDeps,
  Result,
  ApprovalInfo,
  ApprovalMutateReturn,
  ApprovalsApproveArgs,
  ApprovalsRejectArgs,
} from '../types.js';
import { parseApprovals, headingId } from '../query/approvals.js';

function notFound(id: string): Error {
  return Object.assign(new Error(`Approval not found: ${id}`), { code: 'not-found' });
}

/**
 * Flip a single approval's Status line to `approved`/`rejected` (with `now` timestamp and,
 * for reject, an optional parenthetical feedback). Idempotent: if the target entry already has
 * the requested status, the markdown is returned unchanged. Throws `not-found` for an unknown id.
 * Only the matched entry's `- **Status**:` line is rewritten — every other line is byte-preserved.
 */
export function applyApprovalDecision(
  md: string,
  id: string,
  decision: 'approved' | 'rejected',
  now: string,
  feedback?: string,
): { md: string; entry: ApprovalInfo } {
  const entries = parseApprovals(md);
  const target = entries.find((e) => e.id === id);
  if (!target) throw notFound(id);

  // Idempotent no-op when already in the requested state.
  if (target.status === decision) {
    return { md, entry: target };
  }

  const statusValue =
    decision === 'approved'
      ? `approved ${now}`
      : `rejected ${now}${feedback ? ` (${feedback})` : ''}`;

  // Walk lines; within the matched entry's heading→(next heading) span, rewrite its Status bullet.
  const lines = md.split('\n');
  let inTarget = false;
  let done = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      inTarget = !done && headingId(lines[i]) === id;
      continue;
    }
    if (inTarget && !done && /^-\s+\*\*Status\*\*:/.test(lines[i])) {
      lines[i] = `- **Status**: ${statusValue}`;
      done = true;
    }
  }

  const nextMd = lines.join('\n');
  const entry = parseApprovals(nextMd).find((e) => e.id === id)!;
  return { md: nextMd, entry };
}

function now(): string {
  return new Date().toISOString().slice(0, 10);
}

async function decide(
  deps: UiServiceDeps,
  id: string,
  decision: 'approved' | 'rejected',
  feedback?: string,
): Promise<Result<ApprovalMutateReturn>> {
  try {
    const md = fs.readFileSync(deps.approvalsPath, 'utf8');
    const { md: nextMd, entry } = applyApprovalDecision(md, id, decision, now(), feedback);
    if (nextMd !== md) atomicWriteSync(deps.approvalsPath, nextMd);
    return { ok: true, data: { id: entry.id, status: entry.status } };
  } catch (err: any) {
    const code = typeof err?.code === 'string' && err.code === 'not-found' ? 'not-found' : 'internal';
    return { ok: false, code, message: err?.message || String(err) };
  }
}

export async function handleApproveApproval(
  deps: UiServiceDeps,
  args: ApprovalsApproveArgs,
): Promise<Result<ApprovalMutateReturn>> {
  return decide(deps, args.id, 'approved');
}

export async function handleRejectApproval(
  deps: UiServiceDeps,
  args: ApprovalsRejectArgs,
): Promise<Result<ApprovalMutateReturn>> {
  return decide(deps, args.id, 'rejected', args.feedback);
}
