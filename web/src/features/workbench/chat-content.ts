// Representative chat-transcript content for the workbench center chat (prototype.dc.html
// L131–357, morning-session default). DATA GAP (transcript — Stage 4): there is no tRPC scope for
// session messages / assistant stream / tool-call trace, so the transcript body is reproduced
// STRUCTURALLY with the prototype's exact morning-session content, rendered verbatim as static
// content. Values copied 1:1 from the prototype's `<script data-dc-script>` (baseMsgs L2055–2072,
// mkTools L1911–1918, approvalVM APR-0007 L1785–1800). The only LIVE data on this surface is the
// inline thread card (threads.get) — see thread-card-proto.ts.

export interface ResultChip {
  text: string;
  bg: string;
  color: string;
}

export interface ToolCall {
  label: string;
  kind: string;
  input: string;
}

export interface ApprovalContent {
  id: string;
  tagText: string;
  title: string;
  desc: string;
}

/** mm:ss zero-padded clock (prototype fmtClock, L1731). */
export function fmtClock(totalSeconds: number): string {
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  const pad = (n: number): string => (n < 10 ? '0' + n : '' + n);
  return pad(mm) + ':' + pad(ss);
}

/** $x.xx (prototype money, L1736). */
export function moneyLabel(v: number): string {
  return '$' + v.toFixed(2);
}

/** "N tool call(s)" (prototype mkTools text, L1913). */
export function toolCallsLabel(n: number): string {
  return n + (n > 1 ? ' tool calls' : ' tool call');
}

export const MORNING = {
  // header (sessTitle('morning') L1864 · chatProfile L1636)
  title: 'morning review',
  profile: 'research',
  // run defaults (state L1625–1627)
  runBaseSeconds: 42 * 60 + 13,
  turns: 12,
  sessionCost: 0.31,
  // stream (baseMsgs L2055–2072)
  divider: 'TODAY 07:42',
  userMessage: 'How did the domain-randomization sweep go overnight?',
  toolCalls: [
    { label: 'read domain-rand-sweep.md', kind: 'read', input: 'experiments/domain-rand-sweep.md' },
    { label: 'threads.status', kind: 'mcp', input: 'threads.status()' },
    { label: 'read eval-logs/', kind: 'read', input: 'eval-logs/**/summary.json' },
    { label: 'recompute table', kind: 'bash', input: 'python tools/recompute_success.py --all-seeds' },
  ] as ToolCall[],
  assistant1:
    'Overnight sweep finished — 7 of 8 seeds converged, proxy success 82% (+9 pts vs baseline). Seed 6 diverged from an unstable reward term.',
  assistant1Chips: [
    { text: 'success 82% ↑9', bg: '#E9F4EE', color: '#23854F' },
    { text: 'seeds 7/8', bg: '#F1F2F5', color: '#5B6472' },
  ] as ResultChip[],
  assistant2:
    'The review step spawned a verify-metrics sub-thread to re-derive the success table:',
  // approval (approvalVM APR-0007, L1785–1791) — representative; Stage-5 gap (no approvals scope)
  approval: {
    id: 'APR-0007',
    tagText: 'Approval required',
    title: 'Over-budget dispatch — 8×A100 ablation sweep',
    desc: 'Estimated $12.40 vs $10.00 daily budget · requested by thr_8f2c',
  } as ApprovalContent,
};

/** slash-menu commands (prototype cmds L2115–2121; EN copy verbatim). Composer send is inert
 *  (Stage-4 gap) — the slash menu is visual only. */
export const SLASH_COMMANDS = [
  { cmd: '/dispatch', desc: 'Dispatch a task to a remote machine' },
  { cmd: '/diff', desc: 'Show pending repo changes at the commit gate' },
  { cmd: '/devices', desc: 'gpu-01 · lab-4090 · mac-m3' },
  { cmd: '/pause', desc: 'Pause the current thread' },
  { cmd: '/status', desc: 'Session status summary' },
];
