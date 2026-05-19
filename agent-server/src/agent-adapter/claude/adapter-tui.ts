// input:  Session config (channel, sessionId, cwd, prompts/tools/model) + TUI deps (TmuxControl, tailFactory)
// output: ClaudeTuiSession — interactive Claude under tmux with jsonl tail; implements turn lifecycle
// pos:    DR-0012 Phase 2 — parallel adapter to claude/adapter.ts; selects via spawn-args mode='tui'
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { EventEmitter } from 'node:events';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '@core/log.js';
import { TmuxControl } from './tmux-control.js';
import { JsonlTail, JsonlEventNormalizer } from './jsonl-tail.js';
import {
  CancelledError,
  TUI_TMUX_NAME_PREFIX,
  TUI_JSONL_BASE,
  IDLE_SESSION_TIMEOUT,
  MAX_TIMEOUT,
  TURN_IDLE_TIMEOUT,
} from './defaults.js';
import { buildSpawnArgs, buildClaudeEnv, type CortexAgentContext } from './spawn-args.js';
import { buildPrompt, mergeSubstantialOutput } from './event-parser.js';
import type { NormalizedEvent } from '../normalize/event-types.js';
import { usageToCost } from './cost-from-usage.js';

const log = createLogger('claude-tui');

// =====================================================================================
//  Types
// =====================================================================================

/** Subset of JsonlTail surface the session depends on — lets tests inject a mock. */
export interface JsonlTailLike extends EventEmitter {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly path?: string;
}

export interface TuiSessionDeps {
  tmux: TmuxControl;
  /** Factory creating a tail for the given jsonl path. Defaults to real JsonlTail in production. */
  tailFactory: (jsonlPath: string) => JsonlTailLike;
  /** Max wait for jsonl file to appear after spawning. Tests pass 0 (skip wait). Default 5000ms. */
  waitForJsonlMs?: number;
}

export interface ClaudeTuiSessionConfig {
  channel: string;
  sessionId: string;
  /** Pool key used to deduplicate sessions per channel/thread (DR-0008). */
  sessionKey: string;
  /** Working directory of the claude process — must match the cwd used in past sessions for --resume.
   *  Determines jsonl path via Claude's `~/.claude/projects/<dash-encoded-cwd>/<sessionId>.jsonl` convention. */
  cwd: string;
  /** True iff the session is being resumed (`--resume`) rather than freshly created (`--session-id`). */
  needsResume: boolean;
  // -- CLI passthroughs (subset of ClaudeSpawnOptions, all optional) --
  tools?: string | null;
  systemPrompt?: string | null;
  appendSystemPrompt?: string | null;
  model?: string | null;
  claudeAgent?: string | null;
  pluginDirs?: string[] | null;
  outputStyle?: string | null;
  extraOption?: Record<string, string> | null;
  mcpConfigPath?: string;
  // -- runtime context surfaced to MCP servers via env --
  callbackSource?: string | null;
  scheduleTaskId?: string | null;
  anthropicBaseUrl?: string;
  extraEnv?: Record<string, string>;
  context?: CortexAgentContext;
  // -- deps --
  deps: TuiSessionDeps;
}

export interface TuiAgentResult {
  sessionId: string;
  total_cost_usd: number | null;
  num_turns: number | null;
  rateLimited: boolean;
  rateLimitMessage: string | null;
  planFilePath: string | null;
  enteredPlanMode: boolean;
  exitedPlanMode: boolean;
  askUserQuestions: Array<{ toolUseId: string; questions: any[] }>;
  finalOutput: string | null;
}

export interface SendMessageOptions {
  onProgress?: ((progress: { num_turns: number; total_cost_usd: number | null; duration_ms: number | null }) => void) | null;
  onAssistantMessage?: ((text: string) => void) | null;
  onToolUse?: ((name: string, input: any) => void) | null;
  /** Streaming callback: fires for EVERY NormalizedEvent including turn_complete. Used by adapter-level
   *  wrappers (ClaudeAdapter.spawn) to plumb events into the per-turn event stream. */
  onEvent?: ((event: NormalizedEvent) => void) | null;
  files?: any[];
}

interface PendingTurn {
  resolve: (value: TuiAgentResult) => void;
  reject: (error: Error) => void;
  enteredPlanMode: boolean;
  exitedPlanMode: boolean;
  planFilePath: string | null;
  askUserQuestions: Array<{ toolUseId: string; questions: any[] }>;
  finalOutput: string | null;
  longestOutput: string | null;
  turnCount: number;
  turnTotalCost: number | null;
  killed: boolean;
  options: SendMessageOptions;
}

// =====================================================================================
//  ClaudeTuiSession
// =====================================================================================

/**
 * TUI-mode Claude session. Each instance owns one tmux session and one jsonl tail. Turns run
 * serially through {@link sendMessage}; cancellation via {@link cancelCurrentTurn} sends Esc + C-u
 * to interrupt the in-flight model response and clear the prompt buffer.
 *
 * @see DR-0012 §3.2 — turn lifecycle: paste → Enter → await turn_complete → resolve.
 */
export class ClaudeTuiSession {
  readonly channel: string;
  readonly sessionId: string;
  readonly sessionKey: string;
  readonly cwd: string;
  readonly tmuxName: string;
  readonly jsonlPath: string;

  private readonly tmux: TmuxControl;
  private readonly tailFactory: (p: string) => JsonlTailLike;
  private readonly waitForJsonlMs: number;
  private readonly config: ClaudeTuiSessionConfig;

  private tail: JsonlTailLike | null = null;
  private normalizer: JsonlEventNormalizer = new JsonlEventNormalizer();
  private alive = false;
  private needsResume: boolean;

  private currentTurn: PendingTurn | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private maxTimer: NodeJS.Timeout | null = null;
  private turnIdleTimer: NodeJS.Timeout | null = null;

  constructor(config: ClaudeTuiSessionConfig) {
    this.config = config;
    this.channel = config.channel;
    this.sessionId = config.sessionId;
    this.sessionKey = config.sessionKey;
    this.cwd = config.cwd;
    this.needsResume = config.needsResume;
    this.tmux = config.deps.tmux;
    this.tailFactory = config.deps.tailFactory;
    this.waitForJsonlMs = config.deps.waitForJsonlMs ?? 5000;

    this.tmuxName = `${TUI_TMUX_NAME_PREFIX}${this.sessionId}`;
    this.jsonlPath = computeJsonlPath(this.cwd, this.sessionId);
  }

  isAlive(): boolean {
    return this.alive && this.tmux.hasSession(this.tmuxName);
  }

  // -----------------------------------------------------------------------------
  //  Lifecycle
  // -----------------------------------------------------------------------------

  private async ensureSpawned(): Promise<void> {
    if (this.alive && this.tmux.hasSession(this.tmuxName)) return;

    const argv = buildSpawnArgs({
      tools: this.config.tools ?? null,
      systemPrompt: this.config.systemPrompt ?? null,
      appendSystemPrompt: this.config.appendSystemPrompt ?? null,
      model: this.config.model ?? null,
      claudeAgent: this.config.claudeAgent ?? null,
      pluginDirs: this.config.pluginDirs ?? null,
      outputStyle: this.config.outputStyle ?? null,
      extraOption: this.config.extraOption ?? null,
      mcpConfigPath: this.config.mcpConfigPath,
      needsResume: this.needsResume,
      sessionId: this.sessionId,
      mode: 'tui',
    });

    const env = buildClaudeEnv(
      this.channel,
      this.sessionId,
      this.config.callbackSource ?? null,
      this.config.scheduleTaskId ?? null,
      this.config.anthropicBaseUrl,
      this.config.extraEnv,
      this.config.context,
    );
    // Mark TUI mode for downstream MCP server self-detection
    env.CORTEX_TUI_MODE = '1';

    // Filter env to string-only entries (tmux -e requires KEY=VAL strings)
    const stringEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'string') stringEnv[k] = v;
    }

    log.info(`Spawning TUI session ${this.tmuxName} (${this.needsResume ? 'resume' : 'new'})`);
    this.tmux.newSession({
      name: this.tmuxName,
      command: ['claude', ...argv],
      cwd: this.cwd,
      env: stringEnv,
    });
    // After the first spawn, any subsequent spawn for this session must use --resume:
    // the Claude jsonl transcript now exists at jsonlPath, and --session-id would conflict.
    // This covers the "tmux died externally between turns" case (DR-0012 §3.6 recovery path).
    this.needsResume = true;

    await this.waitForJsonl();
    // Tear down any pre-existing tail before reassigning. This path is reached during
    // recovery from external tmux death (alive flag was true but hasSession returned false),
    // where the previous tail's poll timer would otherwise keep firing forever and
    // double-emit events into the new turn.
    if (this.tail) {
      try { await this.tail.stop(); } catch { /* best effort */ }
      this.tail = null;
    }
    // Reset the normalizer too — msg.id dedup and per-turn usage are bound to the previous
    // tail's event stream; carrying them forward risks dropping the first re-spawn message
    // (if it happens to reuse an id) or accumulating cost across the spawn boundary.
    this.normalizer = new JsonlEventNormalizer();
    this.tail = this.tailFactory(this.jsonlPath);
    this.tail.on('event', (raw) => this.handleRawEvent(raw));
    await this.tail.start();

    this.alive = true;
    this.resetIdleTimer();
    this.maxTimer = setTimeout(() => {
      log.info(`TUI session ${this.sessionId.substring(0, 8)} hit max timeout, killing`);
      this.kill();
    }, MAX_TIMEOUT);
    // Long-lived timers must not keep the event loop alive (so node:test cleanly exits when
    // tests don't explicitly kill every session). Cleared on close/kill regardless.
    if (typeof this.maxTimer.unref === 'function') this.maxTimer.unref();
  }

  private async waitForJsonl(): Promise<void> {
    if (this.waitForJsonlMs <= 0) return;
    const deadline = Date.now() + this.waitForJsonlMs;
    while (Date.now() < deadline) {
      if (fs.existsSync(this.jsonlPath)) return;
      await new Promise(r => setTimeout(r, 50));
    }
    // Best-effort: jsonl may appear after first user message; do not throw here.
  }

  // -----------------------------------------------------------------------------
  //  Turn execution
  // -----------------------------------------------------------------------------

  async sendMessage(userMessage: string, options: SendMessageOptions): Promise<TuiAgentResult> {
    if (this.currentTurn) {
      throw new Error(`TUI session ${this.tmuxName} already has a turn in flight`);
    }
    await this.ensureSpawned();
    this.resetIdleTimer();

    const prompt = buildPrompt(userMessage, options.files || []);

    const turnPromise = new Promise<TuiAgentResult>((resolve, reject) => {
      this.currentTurn = {
        resolve, reject,
        enteredPlanMode: false,
        exitedPlanMode: false,
        planFilePath: null,
        askUserQuestions: [],
        finalOutput: null,
        longestOutput: null,
        turnCount: 0,
        turnTotalCost: null,
        killed: false,
        options,
      };
    });

    // Paste prompt + Enter
    this.tmux.pasteText(this.tmuxName, prompt);
    this.tmux.sendKeys(this.tmuxName, 'Enter');
    this.startTurnIdleTimer();

    return turnPromise;
  }

  /**
   * Cancel the currently in-flight turn. Sends Escape (interrupts model generation), then C-u
   * (clears any text still in the prompt buffer — Esc alone does NOT clear it; without this step
   * the next sendMessage would concatenate with the stale buffer contents).
   *
   * @see DR-0012 §3.5 — full cancel protocol.
   */
  async cancelCurrentTurn(): Promise<void> {
    const turn = this.currentTurn;
    if (!turn) return;
    turn.killed = true;
    try {
      this.tmux.sendKeys(this.tmuxName, 'Escape');
      await new Promise(r => setTimeout(r, 200));
      this.tmux.sendKeys(this.tmuxName, 'C-u');
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      log.warn(`cancel send-keys failed: ${(e as Error).message}`);
    }
    this.currentTurn = null;
    if (this.turnIdleTimer) { clearTimeout(this.turnIdleTimer); this.turnIdleTimer = null; }
    turn.reject(new CancelledError());
  }

  // -----------------------------------------------------------------------------
  //  Event handling — jsonl tail → normalizer → turn state
  // -----------------------------------------------------------------------------

  private handleRawEvent(raw: any): void {
    this.resetIdleTimer();
    this.bumpTurnIdleTimer();
    const events = this.normalizer.consume(raw);
    for (const ev of events) this.handleNormalizedEvent(ev);
  }

  private handleNormalizedEvent(ev: NormalizedEvent): void {
    const turn = this.currentTurn;
    if (!turn) {
      // Out-of-turn events are dropped (logged for diagnostics).
      log.info(`event outside turn: ${ev.type}`);
      return;
    }
    // Fire onEvent first so adapter-level wrappers see EVERY event, including ones
    // (cost_record, turn_complete, tool_result, ask_user_question, plan_*) that don't
    // have a dedicated per-turn convenience callback.
    if (turn.options.onEvent) {
      try { turn.options.onEvent(ev); } catch (e) { log.warn(`onEvent threw: ${(e as Error).message}`); }
    }
    switch (ev.type) {
      case 'assistant_text': {
        turn.finalOutput = ev.text;
        if (!turn.longestOutput || ev.text.length > turn.longestOutput.length) {
          turn.longestOutput = ev.text;
        }
        try { turn.options.onAssistantMessage?.(ev.text); } catch (e) { log.warn(`onAssistantMessage threw: ${(e as Error).message}`); }
        break;
      }
      case 'tool_use': {
        try { turn.options.onToolUse?.(ev.name, ev.input); } catch (e) { log.warn(`onToolUse threw: ${(e as Error).message}`); }
        break;
      }
      case 'plan_mode_entered': {
        turn.enteredPlanMode = true;
        break;
      }
      case 'plan_written': {
        turn.planFilePath = ev.path;
        break;
      }
      case 'ask_user_question': {
        turn.askUserQuestions.push({ toolUseId: ev.toolUseId, questions: ev.questions });
        break;
      }
      case 'turn_progress': {
        turn.turnCount = ev.numTurns;
        try { turn.options.onProgress?.({ num_turns: ev.numTurns, total_cost_usd: null, duration_ms: null }); } catch (e) { log.warn(`onProgress threw: ${(e as Error).message}`); }
        break;
      }
      case 'cost_record': {
        turn.turnTotalCost = ev.cost_usd;
        break;
      }
      case 'turn_complete': {
        // turn_complete may arrive with cost included; prefer cost_record's value if both present
        if (ev.totalCostUsd != null && turn.turnTotalCost == null) {
          turn.turnTotalCost = ev.totalCostUsd;
        }
        this.completeTurn(turn);
        break;
      }
      case 'tool_result':
      case 'session_started':
      case 'rate_limit':
      case 'error':
        // Not surfaced through AgentResult; could be wired to events stream later.
        break;
    }
  }

  private completeTurn(turn: PendingTurn): void {
    if (this.currentTurn !== turn) return;
    if (this.turnIdleTimer) { clearTimeout(this.turnIdleTimer); this.turnIdleTimer = null; }
    this.currentTurn = null;
    // Note: needsResume is set to true in ensureSpawned() after first spawn — that flag stays
    // true for the rest of this ClaudeTuiSession's lifetime so recovery from tmux death uses
    // --resume rather than --session-id (which would collide with the persisted jsonl).

    const finalOutput = mergeSubstantialOutput(turn.finalOutput, turn.longestOutput);
    const result: TuiAgentResult = {
      sessionId: this.sessionId,
      total_cost_usd: turn.turnTotalCost,
      num_turns: turn.turnCount,
      rateLimited: false,
      rateLimitMessage: null,
      planFilePath: turn.planFilePath,
      enteredPlanMode: turn.enteredPlanMode,
      exitedPlanMode: turn.exitedPlanMode,
      askUserQuestions: turn.askUserQuestions,
      finalOutput,
    };
    turn.resolve(result);
  }

  // -----------------------------------------------------------------------------
  //  Timers
  // -----------------------------------------------------------------------------

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      log.info(`TUI session ${this.sessionId.substring(0, 8)} idle for ${IDLE_SESSION_TIMEOUT}ms, closing`);
      this.close();
    }, IDLE_SESSION_TIMEOUT);
    if (typeof this.idleTimer.unref === 'function') this.idleTimer.unref();
  }

  private startTurnIdleTimer(): void {
    if (this.turnIdleTimer) clearTimeout(this.turnIdleTimer);
    this.turnIdleTimer = setTimeout(() => {
      log.info(`TUI session ${this.sessionId.substring(0, 8)} turn idle for ${TURN_IDLE_TIMEOUT}ms, killing`);
      this.kill();
    }, TURN_IDLE_TIMEOUT);
    if (typeof this.turnIdleTimer.unref === 'function') this.turnIdleTimer.unref();
  }

  private bumpTurnIdleTimer(): void {
    if (!this.turnIdleTimer) return;
    this.startTurnIdleTimer();
  }

  // -----------------------------------------------------------------------------
  //  Shutdown
  // -----------------------------------------------------------------------------

  close(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    if (this.turnIdleTimer) clearTimeout(this.turnIdleTimer);
    this.idleTimer = this.maxTimer = this.turnIdleTimer = null;
    this.alive = false;
    if (this.tail) {
      this.tail.stop().catch(() => { /* best effort */ });
      this.tail = null;
    }
    // graceful: do NOT tmux kill-session — let the user keep observing
    if (this.currentTurn) {
      const t = this.currentTurn;
      this.currentTurn = null;
      t.reject(new CancelledError());
    }
  }

  kill(): boolean {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    if (this.turnIdleTimer) clearTimeout(this.turnIdleTimer);
    this.idleTimer = this.maxTimer = this.turnIdleTimer = null;
    const wasAlive = this.alive;
    this.alive = false;
    if (this.tail) {
      this.tail.stop().catch(() => {});
      this.tail = null;
    }
    try { this.tmux.killSession(this.tmuxName); } catch { /* best effort */ }
    if (this.currentTurn) {
      const t = this.currentTurn;
      this.currentTurn = null;
      t.reject(new CancelledError());
    }
    return wasAlive;
  }
}

// =====================================================================================
//  Jsonl path computation
// =====================================================================================

/**
 * Mirror Claude Code's convention: jsonl session transcript lives at
 *   ~/.claude/projects/<dash-encoded-cwd>/<sessionId>.jsonl
 * where dash-encoded-cwd is the absolute cwd with BOTH `/` AND `.` replaced by `-`
 * (leading slash → leading `-`; dotfiles like `.cortex` → `--cortex`).
 *
 * Empirically verified against `~/.claude/projects/` directory contents on Claude 2.1.141+:
 *   `/home/fangxin/.cortex`     → `-home-fangxin--cortex`
 *   `/home/fangxin/Cortex`      → `-home-fangxin-Cortex`
 *   `/tmp/cortex-spike-tui`     → `-tmp-cortex-spike-tui`
 *
 * The DR-0012 spike ran in `/tmp/cortex-spike-tui` (no dots), so the dot-encoding rule was
 * missed initially — without it, sessions under `~/.cortex/` (the default DATA_DIR) would
 * have JsonlTail watching a non-existent path and timing out on first turn.
 */
export function computeJsonlPath(cwd: string, sessionId: string): string {
  const encoded = cwd.replace(/[/.]/g, '-');
  return path.join(TUI_JSONL_BASE, encoded, `${sessionId}.jsonl`);
}

/**
 * Convenience factory: real JsonlTail wired to the path. Used by production code; tests inject
 * a custom factory instead.
 */
export function defaultTailFactory(jsonlPath: string): JsonlTailLike {
  return new JsonlTail(jsonlPath) as unknown as JsonlTailLike;
}
