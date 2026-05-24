// input:  nothing (leaf type-only module)
// output: AgentAdapter / AgentSpawnConfig / AgentProcess / Backend
// pos:    Core contract types of the Agent adapter abstraction layer
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { Capability } from './capabilities.js';
import type { NormalizedEvent } from './normalize/event-types.js';
import type { NormalizedHookSpec } from './normalize/hooks.js';
import type { AgentResult } from '@core/types/agent-types.js';

export type Backend = 'claude' | 'codex' | 'pi';

export interface UserMessage {
  text: string;
  attachments?: { mimeType: string; path: string }[];
}

/**
 * Generic MCP server configuration covering both stdio (command/args/env) and HTTP (url) shapes.
 * @see DR-0008 §3.6 (MCP abstraction) and agent-server/mcp-config.json (existing Claude MCP config).
 */
export interface McpServerConfig {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface AgentSpawnConfig {
  sessionId: string | null;
  /** Used to deduplicate sessions within a channel — multiple thread agents share a channel but need separate sessions. */
  sessionKey: string;
  resume: boolean;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  /** Canonical tool names (see normalize/tool-names.ts). Adapter translates to backend-native at spawn time. */
  tools?: string[];
  pluginDirs?: string[];
  model?: string;
  env?: Record<string, string>;
  extraOption?: Record<string, string>;
  mcpServers?: McpServerConfig[];
  hooks?: NormalizedHookSpec[];
  outputStyle?: string;
  cwd?: string;

  // --- Claude-specific passthroughs (task f7cf); other backends ignore these ---
  /** DR-0008 Phase 3 cleanup target. Channel identifier; Claude uses for session-pool key fallback, Codex for route key. */
  channel?: string;
  /** DR-0008 Phase 3 cleanup target. Claude `--agent` CLI flag. */
  claudeAgent?: string;
  /** DR-0008 Phase 3 cleanup target. MCP env + log context; both Claude and Codex read it. */
  callbackSource?: string;
  /** DR-0008 Phase 3 cleanup target. Forwarded to MCP env + Claude log context. */
  scheduleTaskId?: string;
  /** DR-0008 Phase 3 cleanup target. */
  isUserInitiated?: boolean;
  /** DR-0008 Phase 3 cleanup target. Raw Claude-native comma-separated tool names; bypasses canonical→native translation. */
  rawTools?: string;
  /** DR-0008 Phase 3 cleanup target. Per-request ANTHROPIC_BASE_URL override (gateway-routed mode URL). */
  anthropicBaseUrl?: string;

  // --- PI-specific passthroughs; other backends ignore these ---
  /** PI provider name (e.g. "anthropic", "deepseek", "openai-codex"). Sourced from the active
   *  cortex profile's `mode` field. PI adapter passes it to the subprocess as `--provider <name>`. */
  piProvider?: string;
  /** Base URL of the cortex local gateway (e.g. "http://127.0.0.1:9880"). PI adapter writes a
   *  multi-provider models.json overriding every discovered provider's baseUrl to land on this
   *  gateway, so PI traffic is monitored / cost-tracked rather than going direct to upstreams. */
  piGatewayBaseUrl?: string;

  /** DR-0012: Claude adapter mode. 'print' (default, -p stream-json) or 'tui' (interactive tmux + jsonl tail).
   *  Ignored for non-claude backends. Sourced from the active profile's claudeBackend field. */
  claudeBackend?: 'print' | 'tui';

  /** Cortex execution context surfaced to the MCP server child as CORTEX_THREAD_ID/PROFILE/PROJECT/SESSION_NAME env vars
   *  (and into Codex route-context.json). Read by mcp tools/context.ts and tools/schedule.ts so LLMs running inside
   *  the agent can self-discover their thread / profile / project / session-name without guessing. */
  cortexContext?: {
    threadId?: string | null;
    profile?: string | null;
    project?: string | null;
    sessionName?: string | null;
    /** Cortex execution record id, surfaced as CORTEX_EXECUTION_ID to subprocess env. */
    executionId?: string | null;
    /** When true, load only core MCP server (remote_* tools). Used by template thread sessions. */
    useCoreMcp?: boolean;
  };
}

export interface AgentProcess {
  sessionKey: string;
  /** May be null at spawn time; adapter fills in asynchronously when the backend assigns a session id. */
  sessionId: string | null;
  /** Run one turn. Resolves with the AgentResult for that turn (carries rateLimited / planFilePath / askUserQuestions / cost accounting the outer fallback depends on). Events for the same turn are also emitted via the `events` iterable. */
  send(message: UserMessage): Promise<AgentResult>;
  /** Async iterable of normalized events. Iterator returns done after close(). */
  events: AsyncIterable<NormalizedEvent>;
  close(): Promise<void>;
  kill(): boolean;
}

export interface AgentAdapter {
  readonly backend: Backend;
  readonly capabilities: Set<Capability>;
  /** Start or resume a session. */
  spawn(config: AgentSpawnConfig): AgentProcess;
  /** Graceful close. */
  close(sessionKey: string): Promise<void>;
  /** Forced kill. */
  kill(sessionKey: string): boolean;
  /** List currently open session keys. */
  listSessions(): string[];
}
