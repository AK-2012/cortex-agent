// input:  config, agent-adapter, profile-manager, agent-types
// output: runAgent / runAgentOnce / runWithAdapter + fallback chain + bridge helper re-exports
// pos:    domain/agents — sole agent execution path [S11]

import { getAdapter } from '../../agent-adapter/index.js';
import type { AgentAdapter, AgentSpawnConfig, Backend } from '../../agent-adapter/index.js';
import { resolveProfileConfig } from './profile-manager.js';
import type { ResolvedProfileConfig } from './profile-manager.js';
import type { AgentHandle, AgentResult } from '@core/types/agent-types.js';
import { recordCost } from '../costs/cost-tracker.js';
import { configureEnvForMode, isRetryableResult, isRetryableError } from './config.js';
import { isModeRateLimited, isThrottled } from '../costs/rate-limit-throttle.js';
import { GATEWAY_URL } from '../costs/gateway-manager.js';
import { createLogger } from '@core/log.js';
import { loadCortexRules } from '../memory/rules-loader.js';

const log = createLogger('facade');

// --- Types ---

export interface AgentConfig {
  model: string;
  backend: string;
  mode: string | null;
  extraEnv?: Record<string, string>;
  extraOption?: Record<string, string>;
  /** DR-0012: Claude adapter mode (print/tui). Only meaningful for backend='claude'. */
  claudeBackend?: 'print' | 'tui';
}

export interface RunAgentOptions {
  profileName?: string | null;
  sessionId?: string | null;
  sessionKey?: string | null;
  channel?: string;
  files?: unknown[];
  callbackSource?: string | null;
  scheduleTaskId?: string | null;
  isUserInitiated?: boolean;
  project?: string;
  trigger?: string;
  /** Cortex execution context surfaced to the MCP server child as CORTEX_THREAD_ID/PROFILE/PROJECT/SESSION_NAME env vars.
   *  Read by the cortex_context / cortex_schedule_* MCP tools so LLMs can self-discover their thread and target schedules
   *  at the current thread / session without guessing IDs. */
  threadId?: string | null;
  sessionName?: string | null;
  /** Cortex execution record id, surfaced as CORTEX_EXECUTION_ID to subprocess env. */
  executionId?: string | null;
  /** When true, load only core MCP server (remote_* tools). Used by template thread sessions.
   *  Default (undefined/false) loads full MCP config with cortex-ext tools. */
  useCoreMcp?: boolean;
  onProgress?: ((progress: any) => void) | null;
  onAssistantMessage?: ((msg: string) => void) | null;
  onToolUse?: ((name: string, input: any) => void) | null;
  onFallback?: (current: AgentConfig, next: AgentConfig, result: AgentResult | null, error?: Error) => Promise<void>;
  [key: string]: any;
}

// --- Adapter execution ---

function buildSpawnConfig(
  options: RunAgentOptions,
  config: AgentConfig,
  anthropicBaseUrl: string | undefined,
): AgentSpawnConfig {
  // Pack the Cortex execution context only if at least one field is set, so adapters can
  // skip writing CORTEX_* env vars / route-context fields when there's nothing to report.
  const ctx = {
    threadId: options.threadId ?? null,
    profile: options.profileName ?? null,
    project: options.project ?? null,
    sessionName: options.sessionName ?? null,
    executionId: options.executionId ?? null,
    useCoreMcp: options.useCoreMcp ?? undefined,
  };
  const hasContext = !!(ctx.threadId || ctx.profile || ctx.project || ctx.sessionName || ctx.executionId || ctx.useCoreMcp);

  // Load global rules (no paths frontmatter) and inject as appendSystemPrompt.
  // Scoped rules (with paths) are handled by the Read/Grep PostToolUse hook.
  const rules = loadCortexRules();
  const appendSystemPrompt = rules.global.length > 0
    ? rules.global.map(r => r.body).join('\n\n---\n\n')
    : undefined;

  return {
    sessionId: options.sessionId ?? null,
    sessionKey: options.sessionKey || options.channel || 'default',
    resume: !!options.sessionId,
    model: config.model,
    systemPrompt: typeof options.systemPrompt === 'string' ? options.systemPrompt : undefined,
    outputStyle: typeof options.outputStyle === 'string' ? options.outputStyle : undefined,
    pluginDirs: Array.isArray(options.pluginDirs) ? options.pluginDirs : undefined,
    env: config.extraEnv && Object.keys(config.extraEnv).length > 0 ? config.extraEnv : undefined,
    extraOption: config.extraOption && Object.keys(config.extraOption).length > 0 ? config.extraOption : undefined,
    claudeBackend: config.claudeBackend,
    channel: options.channel,
    claudeAgent: options.claudeAgent ?? undefined,
    callbackSource: options.callbackSource ?? undefined,
    scheduleTaskId: options.scheduleTaskId ?? undefined,
    isUserInitiated: !!options.isUserInitiated,
    rawTools: typeof options.tools === 'string' ? options.tools : undefined,
    anthropicBaseUrl,
    // PI-specific routing: provider name (= profile mode) + gateway base URL. PI adapter writes
    // a multi-provider models.json (writeProvidersConfig) so every PI provider lands on the
    // gateway. Claude / codex adapters ignore these fields.
    piProvider: config.backend === 'pi' && config.mode ? config.mode : undefined,
    piGatewayBaseUrl: config.backend === 'pi' ? GATEWAY_URL : undefined,
    cortexContext: hasContext ? ctx : undefined,
    appendSystemPrompt,
  };
}

export function runWithAdapter(
  adapter: AgentAdapter,
  message: string,
  options: RunAgentOptions,
  config: AgentConfig,
  anthropicBaseUrl: string | undefined,
): AgentHandle {
  const spawnConfig = buildSpawnConfig(options, config, anthropicBaseUrl);
  const proc = adapter.spawn(spawnConfig);

  const attachments = (options.files || []).map((f: any) => ({
    mimeType: f.mimetype ?? f.mimeType,
    path: f.localPath ?? f.path,
  }));
  const turnPromise = proc.send({ text: message, attachments });

  // Drive legacy callbacks from the normalized event stream
  const eventLoop = (async (): Promise<void> => {
    try {
      for await (const event of proc.events) {
        switch (event.type) {
          case 'assistant_text':
            options.onAssistantMessage?.(event.text);
            break;
          case 'tool_use':
            options.onToolUse?.(event.name, event.input);
            break;
          case 'turn_progress':
            options.onProgress?.({
              num_turns: event.numTurns,
              total_cost_usd: null,
              duration_ms: null,
            });
            break;
          case 'turn_complete':
            options.onProgress?.({
              num_turns: event.numTurns,
              total_cost_usd: event.totalCostUsd,
              duration_ms: null,
            });
            return;
          case 'cost_record':
            // All three backends emit cost_record via their event parser/adapter.
            // This is the single recording point for all LLM costs.
            recordCost({
              project: options.project || 'general',
              trigger: options.trigger || 'unknown',
              cost_usd: event.cost_usd,
              backend: adapter.backend,
              mode: config.mode || 'api',
              source: 'estimate',
              input_tokens: event.tokens_in,
              output_tokens: event.tokens_out,
              provider: event.provider || undefined,
              model: event.model || undefined,
            }).catch(err => log.warn('recordCost failed:', (err as Error)?.message ?? err));
            break;
          case 'plan_written':
            options.onPlanWritten?.({ path: event.path, content: event.content, toolUseId: event.toolUseId });
            break;
          case 'ask_user_question':
            options.onAskUserQuestion?.({ toolUseId: event.toolUseId, questions: event.questions });
            break;
          default:
            break;
        }
      }
    } catch (e: any) {
      log.warn('runWithAdapter event loop error:', e?.message ?? e);
    }
  })();

  const promise: Promise<AgentResult> = (async () => {
    try {
      const [result] = await Promise.all([turnPromise, eventLoop]);
      return result;
    } catch (err) {
      await eventLoop.catch(() => {});
      throw err;
    } finally {
      await proc.close().catch(() => {});
    }
  })();

  return {
    promise,
    kill: (): boolean => proc.kill(),
    get sessionId(): string | null { return proc.sessionId; },
    agentProcess: proc,
  };
}

export function runAgentOnce(message: string, options: RunAgentOptions, config: AgentConfig): AgentHandle {
  const effectiveMode = config.mode || 'api';
  const metadata: Record<string, string> = {};
  if (options.project) metadata.project = options.project;
  if (options.trigger) metadata.trigger = options.trigger;
  const anthropicBaseUrl = configureEnvForMode(
    effectiveMode,
    Object.keys(metadata).length > 0 ? metadata : undefined,
  );
  const adapter = getAdapter(config.backend as Backend);
  return runWithAdapter(adapter, message, options, config, anthropicBaseUrl);
}

export function runAgent(message: string, options: RunAgentOptions = {}): AgentHandle {
  const profileConfig: ResolvedProfileConfig = resolveProfileConfig(options.profileName);
  const configs: AgentConfig[] = [
    { model: profileConfig.model, backend: profileConfig.backend, mode: profileConfig.mode, extraEnv: profileConfig.extraEnv, extraOption: profileConfig.extraOption, claudeBackend: profileConfig.claudeBackend },
    ...(profileConfig.fallback || []),
  ];

  // Single config — no fallback wrapper needed
  if (configs.length <= 1) {
    const effectiveMode = configs[0].mode || 'api';
    if (isModeRateLimited(effectiveMode) && !options.isUserInitiated) {
      return {
        promise: Promise.resolve({
          sessionId: null,
          total_cost_usd: null,
          num_turns: null,
          rateLimited: true,
          rateLimitMessage: `Mode ${effectiveMode} is rate-limited`,
          planFilePath: null,
          enteredPlanMode: false,
          exitedPlanMode: false,
          finalOutput: null,
        }),
        kill: () => false,
        sessionId: null,
      };
    }
    return runAgentOnce(message, options, configs[0]);
  }

  // Multiple configs — wrap with fallback chain
  let currentHandle: AgentHandle | null = null;
  let killed = false;

  const promise: Promise<AgentResult> = (async () => {
    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];
      const isLast = i === configs.length - 1;

      const attemptOptions: RunAgentOptions = i === 0 ? options : { ...options, sessionId: null };

      // Pre-flight: skip modes already known rate-limited without spawning CLI
      const effectiveMode = config.mode || 'api';
      if (isModeRateLimited(effectiveMode) && !options.isUserInitiated) {
        if (isLast) {
          return {
            sessionId: null,
            total_cost_usd: null,
            num_turns: null,
            rateLimited: true,
            rateLimitMessage: `Mode ${effectiveMode} is rate-limited`,
            planFilePath: null,
            enteredPlanMode: false,
            exitedPlanMode: false,
            finalOutput: null,
          };
        }
        log.info(`${config.model}/${effectiveMode} rate-limited, skipping to fallback[${i}]`);
        if (options.onFallback) await options.onFallback(config, configs[i + 1], null);
        continue;
      }

      currentHandle = runAgentOnce(message, attemptOptions, config);

      try {
        const result: AgentResult = await currentHandle.promise;
        if (!isRetryableResult(result) || isLast) {
          return result;
        }
        const modeLabel = config.mode || 'api';
        log.info(`${config.model}/${modeLabel} rate limited, trying fallback[${i}]`);
        if (options.onFallback) {
          await options.onFallback(config, configs[i + 1], result);
        }
      } catch (error) {
        if (killed) throw error;
        if (!isRetryableError(error as Error) || isLast) throw error;
        const modeLabel = config.mode || 'api';
        log.info(`${config.model}/${modeLabel} retryable error, trying fallback[${i}]`);
        if (options.onFallback) {
          await options.onFallback(config, configs[i + 1], null, error as Error);
        }
      }
    }
    throw new Error('All fallback configs exhausted without result');
  })();

  return {
    promise,
    kill(): boolean {
      killed = true;
      return currentHandle?.kill() ?? false;
    },
    get sessionId(): string | null { return currentHandle?.sessionId ?? null; },
    get agentProcess() { return currentHandle?.agentProcess; },
  };
}

/** Returns true when every mode in the profile's fallback chain is currently rate-limited.
 *  Enables job runners to skip claiming/running when all paths are blocked. */
export function allConfigsRateLimited(profileName: string | null): boolean {
  if (!isThrottled()) return false;
  try {
    const config = resolveProfileConfig(profileName);
    const primaryMode = config.mode || 'api';
    const allModes = [primaryMode, ...config.fallback.map(f => f.mode || primaryMode)];
    return allModes.every(m => isModeRateLimited(m));
  } catch {
    return false;
  }
}

// Exposed for tests/run-with-adapter.test.ts; not intended as a public API.
export const _test = {
  runWithAdapter,
  buildSpawnConfig,
};

// --- Bridge helper re-exports (replacing claude-bridge.ts / codex-bridge.ts) ---

export {
  closeSession,
  closeSessionsByPrefix,
  closeAllSessions,
  _test as claudeTest,
} from '../../agent-adapter/claude/adapter.js';
export { shutdownCodex, buildMcpBlock } from '../../agent-adapter/codex/adapter.js';
export { getCurrentPlanFilePath } from '../../agent-adapter/claude/event-parser.js';
