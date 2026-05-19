// input:  ClaudeSpawnOptions + channel/session env
// output: buildSpawnArgs + buildClaudeEnv pure functions
// pos:    Construct Claude CLI argv and process environment variables
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { DEFAULT_TOOLS, MCP_CONFIG, CORE_MCP_CONFIG, TUI_MCP_CONFIG, TUI_TOOLS } from './defaults.js';
import { buildHooksSettings } from './hooks-builder.js';

/**
 * Adapter mode selector. `print` (default) uses `-p` + stream-json; `tui` uses interactive TUI
 * under tmux with jsonl tail (DR-0012). Both modes share the rest of the CLI surface.
 */
export type ClaudeSpawnMode = 'print' | 'tui';

export interface ClaudeSpawnOptions {
  tools: string | null;
  systemPrompt?: string | null;
  appendSystemPrompt?: string | null;
  model?: string | null;
  claudeAgent?: string | null;
  pluginDirs?: string[] | null;
  outputStyle?: string | null;
  needsResume: boolean;
  sessionId: string;
  /** Override MCP config path. Thread sessions pass CORE_MCP_CONFIG (remote_* only). */
  mcpConfigPath?: string;
  /** Extra CLI options from profile (e.g. {"--thinking": "xhigh"}). */
  extraOption?: Record<string, string> | null;
  /** DR-0012: select adapter mode. Default 'print' preserves -p stream-json behavior. */
  mode?: ClaudeSpawnMode;
}

export function buildSpawnArgs(options: ClaudeSpawnOptions): string[] {
  const mode: ClaudeSpawnMode = options.mode ?? 'print';
  // Per-mode defaults: TUI mode loads the TUI MCP set + tool whitelist that excludes
  // AskUserQuestion / EnterPlanMode / ExitPlanMode (replaced by cortex-tui-bridge MCP tools).
  const mcpConfigDefault = mode === 'tui' ? TUI_MCP_CONFIG : MCP_CONFIG;
  const toolsDefault = mode === 'tui' ? TUI_TOOLS : DEFAULT_TOOLS;
  const mcpConfig = options.mcpConfigPath || mcpConfigDefault;

  const args: string[] = [];

  if (mode === 'print') {
    // Stream-json over stdio for -p mode (current behavior — preserved exactly for regression)
    args.push(
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
    );
  }
  // Both modes: permission bypass + MCP + tools
  args.push(
    '--dangerously-skip-permissions', '--permission-mode', 'bypassPermissions',
    '--mcp-config', mcpConfig,
    '--tools', options.tools || toolsDefault,
  );
  if (options.systemPrompt) args.push('--system-prompt', options.systemPrompt);
  if (options.appendSystemPrompt) args.push('--append-system-prompt', options.appendSystemPrompt);
  if (options.model) args.push('--model', options.model);
  if (options.claudeAgent) args.push('--agent', options.claudeAgent);
  if (options.pluginDirs) {
    for (const dir of options.pluginDirs) args.push('--plugin-dir', dir);
  }
  if (options.extraOption) {
    for (const [k, v] of Object.entries(options.extraOption)) args.push(k, v);
  }
  const settings: Record<string, any> = { hooks: buildHooksSettings(options.tools) };
  if (options.outputStyle) settings.outputStyle = options.outputStyle;
  args.push('--settings', JSON.stringify(settings));
  if (options.needsResume) args.push('--resume', options.sessionId);
  else args.push('--session-id', options.sessionId);
  return args;
}

/** Cortex agent execution context — surfaces as CORTEX_* env vars so MCP tools
 *  (cortex_context, cortex_schedule_*) can self-discover the current thread/profile/etc.
 *  Optional fields are omitted from env when undefined, so child processes see no key
 *  rather than an empty string. */
export interface CortexAgentContext {
  threadId?: string | null;
  profile?: string | null;
  project?: string | null;
  sessionName?: string | null;
  /** Cortex execution record id, surfaced as CORTEX_EXECUTION_ID to subprocess env. */
  executionId?: string | null;
  /** When true, load only core MCP server (remote_* tools). */
  useCoreMcp?: boolean;
}

export function buildClaudeEnv(
  channel: string,
  sessionId: string,
  callbackSource?: string | null,
  scheduleTaskId?: string | null,
  anthropicBaseUrl?: string,
  extraEnv?: Record<string, string>,
  context?: CortexAgentContext,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDECODE;
  for (const key of Object.keys(env)) {
    if (key.startsWith('CLAUDE_CODE')) delete env[key];
  }
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  env.SLACK_CHANNEL = channel;
  env.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
  env.CORTEX_SESSION_ID = sessionId;
  if (callbackSource) env.CORTEX_CALLBACK_SOURCE = callbackSource;
  if (scheduleTaskId) env.CORTEX_SCHEDULE_TASK_ID = scheduleTaskId;
  if (anthropicBaseUrl) env.ANTHROPIC_BASE_URL = anthropicBaseUrl;
  delete env.CORTEX_THREAD_ID;
  delete env.CORTEX_PROFILE;
  delete env.CORTEX_PROJECT;
  delete env.CORTEX_SESSION_NAME;
  if (context?.threadId) env.CORTEX_THREAD_ID = context.threadId;
  if (context?.profile) env.CORTEX_PROFILE = context.profile;
  if (context?.project) env.CORTEX_PROJECT = context.project;
  if (context?.sessionName) env.CORTEX_SESSION_NAME = context.sessionName;
  if (context?.executionId) env.CORTEX_EXECUTION_ID = context.executionId;
  if (extraEnv) {
    for (const [k, v] of Object.entries(extraEnv)) env[k] = v;
  }
  return env;
}
