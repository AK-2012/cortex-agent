// input:  nothing (leaf type-only module)
// output: AgentResult / AgentHandle / AgentProgress types
// pos:    Shared type definitions for agent run results and progress
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

export interface AskUserQuestionInfo {
  toolUseId: string | null;
  questions: string[];
  sessionId: string;
}

export interface AgentResult {
  sessionId: string | null;
  total_cost_usd: number | null;
  num_turns: number | null;
  rateLimited: boolean;
  rateLimitMessage: string | null;
  planFilePath: string | null;
  enteredPlanMode: boolean;
  exitedPlanMode: boolean;
  askUserQuestions?: AskUserQuestionInfo[];
  finalOutput: string | null;
  codexRateLimits?: Record<string, unknown>;
  codexRawLogPath?: string | null;
  /** Number of background tasks (run_in_background) still running when this turn's
   *  result fired. >0 means the CC backend will spontaneously emit a continuation turn
   *  once they finish; orchestration holds the status in a "waiting" state instead of
   *  sealing it as complete. Absent/0 for backends without background-task support. */
  pendingBackgroundTasks?: number;
}

export interface AgentHandle {
  promise: Promise<AgentResult>;
  kill: () => boolean;
  sessionId?: string | null;
  /** Opaque reference to the underlying agent process. Used by PI backend for sendExtensionUiResponse. */
  agentProcess?: unknown;
}

export interface AgentProgress {
  num_turns: number | null;
  total_cost_usd: number | null;
  duration_ms: number | null;
}
