// Static content that is NOT part of the real S4 chat data path (task aba0). The transcript body
// (divider / user / tool-calls / assistant) is now driven by the real `sessions.transcript` query +
// live `session.message` stream (see transcript-vm.ts / MessageStream.tsx). What remains here:
//   • the tool-call label helper + type (shared by ToolCallsRow)
//   • the composer slash-command menu (18-slash-menu) — visual only; there is no backend that
//     executes slash commands, so it stays a local affordance (verbatim EN copy from the prototype)
//   • a representative Approval card (Stage-5 GAP-B: no approvals tRPC scope yet) + default profile
//     label — flagged, unchanged from 89e7; kept to preserve the 00-workbench composition.

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

/** "N tool call(s)" (prototype mkTools text, L1913). */
export function toolCallsLabel(n: number): string {
  return n + (n > 1 ? ' tool calls' : ' tool call');
}

/** Default chat profile label (prototype chatProfile default, L1636). Profile has no tRPC scope. */
export const DEFAULT_CHAT_PROFILE = 'research';

/** slash-menu commands (prototype cmds L2115–2121; EN copy verbatim). The composer slash menu
 *  (18-slash-menu) is visual only — there is no backend op to execute a slash command. */
export const SLASH_COMMANDS = [
  { cmd: '/dispatch', desc: 'Dispatch a task to a remote machine' },
  { cmd: '/diff', desc: 'Show pending repo changes at the commit gate' },
  { cmd: '/devices', desc: 'gpu-01 · lab-4090 · mac-m3' },
  { cmd: '/pause', desc: 'Pause the current thread' },
  { cmd: '/status', desc: 'Session status summary' },
];

// Representative approval card content (prototype approvalVM APR-0007, L1785–1791). Stage-5 GAP-B:
// no approvals tRPC scope → representative content with inert buttons; flagged, unchanged from 89e7.
export const REPRESENTATIVE_APPROVAL: ApprovalContent = {
  id: 'APR-0007',
  tagText: 'Approval required',
  title: 'Over-budget dispatch — 8×A100 ablation sweep',
  desc: 'Estimated $12.40 vs $10.00 daily budget · requested by thr_8f2c',
};
