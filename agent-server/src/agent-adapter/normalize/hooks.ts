// input:  nothing (leaf type-only module)
// output: NormalizedHookSpec + HookTrigger
// pos:    Adapter-neutral hook contract types
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

export type HookTrigger =
  | { phase: 'pre-tool'; toolNames: string[] }
  | { phase: 'post-tool'; toolNames: string[] }
  | { phase: 'permission-request'; toolNames: string[] }
  | { phase: 'session-start' }
  | { phase: 'turn-end' };

export interface NormalizedHookSpec {
  trigger: HookTrigger;
  /** Shell command. Adapter chooses how to invoke it (Claude: settings JSON; PI: in-process extension spawn). */
  command: string;
  timeoutSec?: number;
  /** If the hook needs to block until a webhook callback resolves it. Adapter picks the implementation mechanism. */
  blocking?: { mode: 'webhook'; endpoint: string; ttlMin: number };
}
