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
