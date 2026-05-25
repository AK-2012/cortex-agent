// input:  agent-server/session-hooks.json (lazy-read), spawn() subprocess, OutputStream
// output: runSessionHook() unified pipeline + fireAndForgetPreCloseHook (onNew) + onMessageEnd helpers
// pos:    session-level hook subsystem — config loading, subprocess spawn, unified Slack-display pipeline
//         (parallel to thread-hook system, scoped to channel/session rather than thread)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import * as path from 'path';
import { DATA_DIR, CONFIG_DIR } from '@core/paths.js';
import { createLogger } from '@core/log.js';
import { Icons } from '../../core/icons.js';
import type { PlatformAdapter, OutputStream } from '@platform/index.js';
import { runAgent, resolveBackendForChannel } from '@domain/agents/index.js';
import { getSessionAsync } from '@domain/sessions/session.js';
import { sessionStore } from '@store/session-registry-repo.js';
import { conversationLedger } from '@store/conversation-ledger-repo.js';

const log = createLogger('session-hook');

const CONFIG_FILE = path.join(CONFIG_DIR, 'session-hooks.json');
const DEFAULT_TIMEOUT_MS = 60_000;

// ── Config types ──────────────────────────────────────────────────────────────

export interface SessionHookConfig {
  command: string;
  args?: string[];
  timeout?: number;
}

export interface SessionHooksFile {
  onNew?: SessionHookConfig;
  onMessageEnd?: SessionHookConfig;
}

type HookName = 'onNew' | 'onMessageEnd';

function loadConfigFile(): SessionHooksFile | null {
  let raw: string;
  try {
    raw = readFileSync(CONFIG_FILE, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as SessionHooksFile;
  } catch (e: any) {
    log.warn(`Failed to parse ${CONFIG_FILE}: ${e?.message || e}`);
    return null;
  }
}

function loadHookConfig(name: HookName): SessionHookConfig | null {
  const parsed = loadConfigFile();
  if (!parsed) return null;
  const cfg = parsed[name];
  if (!cfg || typeof cfg.command !== 'string' || cfg.command.trim() === '') return null;
  return cfg;
}

export function isOnNewHookConfigured(): boolean {
  return loadHookConfig('onNew') !== null;
}

export function isOnMessageEndHookConfigured(): boolean {
  return loadHookConfig('onMessageEnd') !== null;
}

// ── Subprocess runner (shared) ────────────────────────────────────────────────

interface SpawnOptions {
  cfg: SessionHookConfig;
  stdinPayload: string;
  env: NodeJS.ProcessEnv;
  label: string;
}

interface SpawnResult {
  stdout: string;     // trimmed
  stderr: string;     // truncated to last 2000 chars
  error?: string;     // set on non-zero exit / timeout / spawn error
}

function spawnHookProcess({ cfg, stdinPayload, env, label }: SpawnOptions): Promise<SpawnResult> {
  const timeout = cfg.timeout ?? DEFAULT_TIMEOUT_MS;
  const args = cfg.args ?? [];

  return new Promise<SpawnResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const proc = spawn('sh', ['-c', `${cfg.command} "$@"`, 'hook', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: DATA_DIR,
      timeout,
      env,
    });

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const finish = (result: SpawnResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    proc.on('error', (err) => {
      log.error(`spawn error (${label}): ${err.message}`);
      finish({ stdout: '', stderr: stderr.slice(-2000), error: err.message });
    });

    proc.on('close', (code, signal) => {
      const trimmed = stdout.trim();
      const tail = stderr.slice(-2000);
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        log.error(`timed out after ${timeout}ms (${label})`);
        finish({ stdout: '', stderr: tail, error: `timed out after ${timeout}ms` });
        return;
      }
      if (code !== 0) {
        const msg = `exited with code ${code}`;
        log.error(`${msg} (${label})${stderr ? ': ' + stderr.trim() : ''}`);
        finish({ stdout: '', stderr: tail, error: msg });
        return;
      }
      if (stderr) log.warn(`stderr (${label}): ${stderr.trim()}`);
      finish({ stdout: trimmed, stderr: tail });
    });

    try {
      proc.stdin.write(stdinPayload);
      proc.stdin.end();
    } catch (e: any) {
      log.warn(`stdin write failed (${label}): ${e?.message || e}`);
    }
  });
}

// ── Unified hook pipeline ─────────────────────────────────────────────────────

/** Per-hook context fed to the subprocess (via stdin JSON) and the formatters. */
export interface SessionHookContext {
  channel: string;
  sessionId: string;
  sessionName: string;
  executionId?: string | null;
  profile?: string | null;
}

/** Caller-supplied formatters — keep wording per-hook so existing UX text doesn't change.
 *  All formatters return short single-line strings; runSessionHook appends them via OutputStream,
 *  so they share the same Slack thread/group as surrounding agent output. */
export interface SessionHookFormat {
  /** Status line shown immediately when the hook starts. */
  statusLine: () => string;
  /** Preview line shown when the hook produced non-empty stdout. */
  previewLine: (output: string) => string;
  /** Error line shown when spawn failed / non-zero exit / timeout. */
  errorLine: (err: string) => string;
  /** Optional line when stdout was empty after a successful run. Return null to stay silent. */
  emptyLine?: () => string | null;
}

/** When set, the hook stdout is injected as a fresh agent turn against `targetSessionId`.
 *  All assistant output is appended into the same OutputStream so it visually
 *  continues the hook's status/preview lines. */
export interface SessionHookInject {
  targetSessionId: string;
  profileName: string | null;
  /** Forwarded to runAgent as `trigger`, useful for telemetry / cost grouping. */
  trigger?: string;
}

export interface SessionHookSpec {
  name: HookName;
  ctx: SessionHookContext;
  format: SessionHookFormat;
  inject?: SessionHookInject | null;
}

function buildHookEnv(name: HookName, ctx: SessionHookContext): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CORTEX_HOOK_CHANNEL: ctx.channel,
    CORTEX_HOOK_SESSION_ID: ctx.sessionId,
    CORTEX_HOOK_SESSION_NAME: ctx.sessionName,
    CORTEX_HOOK_TRIGGER: name === 'onNew' ? 'new' : 'messageEnd',
  };
  if (ctx.executionId) env.CORTEX_HOOK_EXECUTION_ID = ctx.executionId;
  return env;
}

function buildHookStdin(name: HookName, ctx: SessionHookContext): string {
  return JSON.stringify({
    channel: ctx.channel,
    sessionId: ctx.sessionId,
    sessionName: ctx.sessionName,
    executionId: ctx.executionId ?? null,
    profile: ctx.profile ?? null,
    trigger: name === 'onNew' ? 'new' : 'messageEnd',
    timestampIso: new Date().toISOString(),
  });
}

/** Unified pipeline: post status line → spawn subprocess → post preview/error line →
 *  optionally inject stdout as a fresh agent turn. Every Slack write goes through
 *  `stream` so hook output and the follow-up agent turn share one continuous thread.
 *
 *  Caller controls the `stream`:
 *    - onMessageEnd: pass the assistant turn's stream so hook lines extend the same
 *      reply chain (no top-level leak).
 *    - onNew: pass a fresh stream anchored at the last assistant message's thread parent
 *      (resolved via resolveSessionThreadTs). */
export async function runSessionHook(
  spec: SessionHookSpec,
  stream: OutputStream,
): Promise<void> {
  const cfg = loadHookConfig(spec.name);
  if (!cfg) return;

  const label = (cfg.args && cfg.args.length) ? `${cfg.command} ${cfg.args.join(' ')}` : cfg.command;

  stream.emitText(spec.format.statusLine());

  const result = await spawnHookProcess({
    cfg,
    stdinPayload: buildHookStdin(spec.name, spec.ctx),
    env: buildHookEnv(spec.name, spec.ctx),
    label,
  });

  if (result.error) {
    stream.emitText(spec.format.errorLine(result.error));
    await stream.flush().catch((e: any) => log.warn(`stream.flush after error failed (${label}): ${e?.message || e}`));
    return;
  }

  if (!result.stdout) {
    const empty = spec.format.emptyLine?.();
    if (empty) stream.emitText(empty);
    await stream.flush().catch((e: any) => log.warn(`stream.flush on empty failed (${label}): ${e?.message || e}`));
    return;
  }

  stream.emitText(spec.format.previewLine(result.stdout));

  if (!spec.inject) {
    await stream.flush().catch((e: any) => log.warn(`stream.flush no-inject failed (${label}): ${e?.message || e}`));
    return;
  }

  try {
    const handle = runAgent(result.stdout, {
      channel: spec.ctx.channel,
      sessionId: spec.inject.targetSessionId,
      sessionKey: spec.ctx.channel,
      isUserInitiated: false,
      profileName: spec.inject.profileName,
      trigger: spec.inject.trigger ?? `hook:${spec.name}`,
      onAssistantMessage: (text: string) => stream.emitText(text),
    });
    await handle.promise;
  } catch (err: any) {
    const msg = err?.message || String(err);
    log.error(`hook ${spec.name} injected agent failed: ${msg}`);
    stream.emitText(`${Icons.warning} ${spec.name} hook follow-up failed: ${msg}`);
  } finally {
    await stream.flush().catch((e: any) => log.warn(`stream.flush after inject failed (${label}): ${e?.message || e}`));
  }
}

// ── onNew (pre-close) entry points ────────────────────────────────────────────

const ONNEW_FORMAT: SessionHookFormat = {
  statusLine: () => `${Icons.hook} Running \`!new\` hook…`,
  previewLine: (out) => {
    const preview = out.length > 80 ? out.slice(0, 80) + '…' : out;
    return `${Icons.hook} ${preview}`;
  },
  errorLine: (err) => `${Icons.warning} \`!new\` hook failed: ${err}`,
  emptyLine: () => `${Icons.hook} hook returned empty output — nothing to inject.`,
};

const ONMESSAGEEND_FORMAT: SessionHookFormat = {
  statusLine: () => `${Icons.hook} Checking for unreleased locks…`,
  previewLine: (out) => {
    const preview = out.length > 80 ? out.slice(0, 80) + '…' : out;
    return `${Icons.hook} ${preview}`;
  },
  errorLine: (err) => `${Icons.warning} Lock check failed: ${err}`,
  // onMessageEnd is silent on empty output — the common case is "nothing to remind".
  emptyLine: () => null,
};

/** Resolve the Slack thread anchor for a fresh onNew vm:
 *    1. Caller-supplied threadAnchorId (e.g. user typed !new in-thread).
 *    2. Last turn's statusMessageTs from the conversation ledger.
 *    3. null → vm starts a top-level message and self-anchors. */
async function resolveOnNewThreadAnchor(channel: string, threadAnchorId?: string | null): Promise<string | null> {
  if (threadAnchorId) return threadAnchorId;
  const conv = await conversationLedger.getConversation(channel);
  if (conv?.turns.length) {
    for (let i = conv.turns.length - 1; i >= 0; i--) {
      const ts = conv.turns[i].statusMessageTs;
      if (ts) return ts;
    }
  }
  return null;
}

/** Resolve the profile name to use when injecting the onNew hook's stdout as a fresh
 *  agent turn. Priority order:
 *    1. session-registry (per-session truth — correct for thread-spawned sessions whose
 *       profile is NOT mirrored into the channel-level conversation-ledger).
 *    2. conversation-ledger (channel-level fallback — correct for user-conversation
 *       sessions where the registry may lack a profileName-bearing record).
 *
 *  The two sources can disagree on a channel that hosts both kinds of session — e.g.
 *  a thread session running profile `deepseek-pro` while the user's main conversation
 *  is on profile `plan`. Reading from the ledger alone causes Cortex to resume the
 *  thread session with the wrong profile, which routes through the wrong gateway mode
 *  and triggers Anthropic's "Invalid signature in thinking block" 400.
 *
 *  Exported (rather than inlined) so the priority logic is unit-testable in isolation
 *  without spinning up the real repo singletons. */
export interface ProfileLookupDeps {
  lookupRegistryProfile: (sessionId: string) => Promise<string | null>;
  lookupLedgerProfile:   (channel: string)   => Promise<string | null>;
}

export async function resolveOnNewProfileName(
  channel: string,
  sessionId: string,
  deps: ProfileLookupDeps,
): Promise<string | null> {
  const fromRegistry = await deps.lookupRegistryProfile(sessionId);
  if (fromRegistry) return fromRegistry;
  return deps.lookupLedgerProfile(channel);
}

/** Default binding of the registry lookup — composes lookupBySessionId + lookupSession.
 *  Extracted so prepareOnNewRun's call site stays one line and tests can swap in fakes. */
async function defaultLookupRegistryProfile(sessionId: string): Promise<string | null> {
  const name = await sessionStore.lookupBySessionId(sessionId);
  if (!name) return null;
  const record = await sessionStore.lookupSession(name);
  return record?.profileName ?? null;
}

async function defaultLookupLedgerProfile(channel: string): Promise<string | null> {
  const conv = await conversationLedger.getConversation(channel);
  return conv?.profileName ?? null;
}

/** Build the onNew SessionHookSpec + a fresh stream. Returns null when the hook isn't
 *  configured or there's no live session to capture context from. */
async function prepareOnNewRun(
  channel: string,
  adapter: PlatformAdapter,
  threadAnchorId?: string | null,
): Promise<{ spec: SessionHookSpec; stream: OutputStream } | null> {
  if (!isOnNewHookConfigured()) return null;

  const backend = resolveBackendForChannel(channel);
  const sessionId = await getSessionAsync(channel, backend);
  if (!sessionId) {
    log.info('onNew hook skipped: no active session for channel', channel);
    return null;
  }
  const sessionName = (await sessionStore.lookupBySessionId(sessionId)) || sessionId.slice(0, 8);

  // Resolve profile BEFORE handleNewCmd clears the ledger (sync, runs after this fn returns).
  // Registry is the per-session truth; ledger is the channel-level fallback.
  const profileName = await resolveOnNewProfileName(channel, sessionId, {
    lookupRegistryProfile: defaultLookupRegistryProfile,
    lookupLedgerProfile:   defaultLookupLedgerProfile,
  });

  const anchor = await resolveOnNewThreadAnchor(channel, threadAnchorId);
  const stream = adapter.openOutputStream({ type: 'interactive-reply', conduit: channel, sessionId: '' }, { threadId: anchor });

  const spec: SessionHookSpec = {
    name: 'onNew',
    ctx: { channel, sessionId, sessionName, profile: profileName },
    format: ONNEW_FORMAT,
    inject: { targetSessionId: sessionId, profileName, trigger: 'hook:onNew' },
  };

  return { spec, stream };
}

/** Fire-and-forget onNew hook used by the !new command and the "New" status button.
 *  Returns immediately; the hook subprocess and any injected agent turn run async
 *  via the unified pipeline. The session is closed by the caller in parallel —
 *  sessionId is captured up-front so the JSONL still resolves after deletion. */
export async function fireAndForgetPreCloseHook(
  channel: string,
  adapter: PlatformAdapter,
  threadAnchorId?: string | null,
): Promise<void> {
  const prepared = await prepareOnNewRun(channel, adapter, threadAnchorId);
  if (!prepared) return;
  void runSessionHook(prepared.spec, prepared.stream).catch((err) => {
    log.error('onNew hook async completion failed:', err?.message || err);
  });
}

/** Synchronous variant of fireAndForgetPreCloseHook — awaits the hook to completion.
 *  Reserved for cases where the caller wants to block on the !new pipeline (e.g.
 *  test harness, scripted teardown). */
export async function runPreCloseHook(
  channel: string,
  adapter: PlatformAdapter,
  threadAnchorId?: string | null,
): Promise<void> {
  const prepared = await prepareOnNewRun(channel, adapter, threadAnchorId);
  if (!prepared) return;
  await runSessionHook(prepared.spec, prepared.stream);
}

// ── onMessageEnd entry point ─────────────────────────────────────────────────

export interface OnMessageEndArgs {
  channel: string;
  sessionId: string;
  sessionName: string;
  executionId: string;
  profile?: string | null;
  /** OutputStream to extend — pass the assistant turn's stream so the hook lines
   *  thread under the just-finished reply rather than leaking to top-level. */
  stream: OutputStream;
}

/** Run the onMessageEnd hook against the just-finished assistant turn's vm.
 *  No-op when not configured. */
export async function runMessageEndSessionHook(args: OnMessageEndArgs): Promise<void> {
  if (!isOnMessageEndHookConfigured()) return;
  const spec: SessionHookSpec = {
    name: 'onMessageEnd',
    ctx: {
      channel: args.channel,
      sessionId: args.sessionId,
      sessionName: args.sessionName,
      executionId: args.executionId,
      profile: args.profile ?? null,
    },
    format: ONMESSAGEEND_FORMAT,
    inject: {
      targetSessionId: args.sessionId,
      profileName: args.profile ?? null,
      trigger: 'hook:onMessageEnd',
    },
  };
  await runSessionHook(spec, args.stream);
}
