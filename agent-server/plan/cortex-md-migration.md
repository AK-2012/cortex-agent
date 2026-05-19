# CLAUDE.md → CORTEX.md Full Migration Plan

## Objective

CLAUDE.md is completely retired, and CORTEX.md takes over all related functions. The mechanism, loading logic, and injection semantics correspond one-to-one with the current CLAUDE.md, just renamed + changing "rely on Claude Code to auto-load local CLAUDE.md" to "Cortex uses its own hook to load local CORTEX.md".

File name set: `['CORTEX.md', 'CORTEX.local.md']`, with global fallback at `~/.cortex/CORTEX.md`.

## Scope

- agent-server side: scanner, injector, MCP tool helper, remote tool registration point, hook configuration, new local hook.
- client side: scanner, Read/Write/Edit response fields.
- Tests: rename + add new cases.
- Physical files: git mv all 35 CLAUDE.md in the repo and 20 CLAUDE.md in `~/.cortex`.
- Documentation/SKILL.md/system prompt: uniformly replace the string "CLAUDE.md" with "CORTEX.md".
- Global comment marker `>>> If I am updated, make sure to update my header comment and the parent folder's CORTEX.md <<<` changed to `... CORTEX.md <<<`.
- `~/.cortex/CLAUDE.md` (actually Cortex's system prompt) entirely migrated to `~/.cortex/CORTEX.md`.

Do not touch Claude Code harness's own configuration — whether it reads CLAUDE.md or not is irrelevant to Cortex, but Cortex no longer depends on this behavior.

## Phase 1: Remote Path (Minimum Viable)

What is being changed is the literals and file names of the existing CLAUDE.md remote linkage.

### 1.1 Client-Side Scanner

`client/src/claude-md-scanner.ts` → `client/src/cortex-md-scanner.ts`

```ts
const CORTEX_MD_NAMES = ['CORTEX.md', 'CORTEX.local.md'];
const HOME_FALLBACK   = path.join(os.homedir(), '.cortex', 'CORTEX.md');
export interface CortexMDEntry { path: string; content: string; mtimeMs: number; }
export function scanCortexMDChain(targetFilePath: string): CortexMDEntry[] { ... }
```

Logic is exactly the same as the current `scanClaudeMDChain`: from `dirname(target)` climbing up to fs root, picking up the above two file names at each level, finally appending the home fallback; the 200 KB / 20 level limit remains unchanged.

### 1.2 Client-Side Response

`client/src/client.ts`:
- Import changed to `scanCortexMDChain` / `CortexMDEntry`.
- `safeScanClaudeMDs` → `safeScanCortexMDs`.
- Return field `claudeMDs` → `cortexMDs`; `handleRead/handleWrite/handleEdit` all changed.
- `FileMutationResult.claudeMDs` field renamed to `cortexMDs`.

### 1.3 Server-Side Scanner (Isolated component, not in use, but kept for symmetry)

`agent-server/src/domain/memory/claude-md-scanner.ts` → `cortex-md-scanner.ts`, content same as 1.1. For reuse by local hooks (see Phase 2).

### 1.4 Server-Side Injector

`agent-server/src/domain/memory/claude-md-injector.ts` → `cortex-md-injector.ts`:
- class `ClaudeMDInjector` → `CortexMDInjector`.
- `DEFAULT_CACHE_DIR` changed to `path.join(WORKSPACE_DIR, 'mcp-cortexmd-cache')`.
- Injection text changed to
  `Auto-loaded CORTEX.md from {device}:{path} (ancestor of accessed path on remote device). These instructions apply to files under this directory on that device.`
- The rest (per-session disk-backed cache, `device:path → mtimeMs` dedup, `markOnlyPaths` dedup suppression) remains unchanged.

### 1.5 Server-Side MCP Helper

`agent-server/src/domain/mcp/tools/claude-md.ts` → `cortex-md.ts`:
- `claudeMDContentBlocks` → `cortexMDContentBlocks`.
- Type `ClaudeMDEntry` → `CortexMDEntry`, re-export.

### 1.6 Server-Side Remote Tool Wiring

`agent-server/src/domain/mcp/tools/task-ops.ts`:
- Import path and names changed according to 1.5.
- `result.claudeMDs` → `result.cortexMDs` (three places: remote_read / remote_write / remote_edit).
- `claudeMDContentBlocks(...)` → `cortexMDContentBlocks(...)`.

### 1.7 Cache Directory Migration

The old `<workspace>/mcp-claudemd-cache` can be blindly deleted once at startup (one-time cleanup) to prevent incorrect old mtime caches from preventing new CORTEX.md from being injected. Or simply leave it alone and let it expire naturally via TTL (7 days). Prefer the latter, zero risk.

### 1.8 Client-Side Release

The client is `cortex-client` as a separate npm package (running on remote machines). After changes, it needs to be repackaged and redeployed on my-pc / lab / lab-ksu. Use the `cortex-system:client-manage` skill for this step.

## Phase 2: Local Path (New Hook)

The agent-server process runs on lab2. Local Read/Write/Edit/Glob/Grep are harness built-in tools, not going through MCP. They rely on hook injection. Two complementary hooks:

- **SessionStart + UserPromptSubmit** (Claude Code) / **before_agent_start** (PI): cwd entry preload, so the agent sees CORTEX.md on the first prompt.
- **PostToolUse**: subsequently, when accessing files in other directories, inject along the file path ancestor chain.

Template follows the stdout JSON style of `hooks/rules-loader.mjs`, with a single script compatible with three invocation entry points.

### 2.1 New Hook Script

`agent-server/src/hooks/cortex-md-injector.mjs`, single script with two trigger modes:

- **PostToolUse** (matcher `Read`): takes scan starting point from `tool_input.file_path` / `tool_input.path`.
- **SessionStart** (matcher `startup|resume|clear|compact`): takes scan starting point from `payload.cwd`, one-time preload at session start.

Implementation notes:

- Scan logic is implemented inline in the script, isomorphic with `agent-server/src/domain/memory/cortex-md-scanner.ts`; does not reference TS build artifacts to keep hook startup fast (same approach as rules-loader.mjs).
- per-session disk-backed dedup: cache directory `~/.cortex/tmp/cortexmd-cache/<sessionId>.json`, key `path → mtimeMs`.
- Same semantics as the remote path's `markOnlyPaths`: if this tool operation is on a CORTEX.md itself, only update the cache, do not inject.
- Unified output format:
  ```json
  { "hookSpecificOutput": { "hookEventName": "<event>", "additionalContext": "<system-reminder>...</system-reminder>" } }
  ```
- Total length protection: `additionalContext` has a 10,000 character limit (as per Claude Code documentation). When each file can be up to 200 KB, multiple files can easily overflow. The script accumulates in leaf→root order, stops when exceeding 9,500 characters, and appends `[truncated, N more files at root]` annotation.
- Keep the `matched` field for the PI hook-bridge to concatenate into systemPrompt during `before_agent_start` (rules-loader.mjs already does this).

### 2.2 Register Hook

`agent-server/src/agent-adapter/claude/hooks-builder.ts`:

`POST_TOOL_USE_HOOKS` add:
```ts
{ matcher: 'Read', hooks: [nodeHook('cortex-md-injector.mjs')] },
```

Add new exports:
```ts
export const SESSION_START_HOOKS = [
  { matcher: 'startup|resume|clear|compact', hooks: [nodeHook('cortex-md-injector.mjs')] },
];
export const USER_PROMPT_SUBMIT_HOOKS = [
  { hooks: [nodeHook('cortex-md-injector.mjs')] },
];
```

`buildHooksSettings()` return value adds `SessionStart: SESSION_START_HOOKS`, `UserPromptSubmit: USER_PROMPT_SUBMIT_HOOKS`.

Does not affect existing `memory-ref-tracker.mjs` / `rules-loader.mjs` / `session-activity-tracker.mjs` / `sensitive-file-edit.mjs`; each manages its own concerns.

### 2.3 Session Start Preload (Feasibility Confirmed)

Claude Code's own loading of CLAUDE.md reads the one in cwd at session start, so the first user prompt arrives with context; a pure PostToolUse hook would only trigger on the first tool call, resulting in a worse experience. It has been confirmed that the harness supports SessionStart and UserPromptSubmit. The implementation plan:

**Claude Code (add two sections in hooks-builder.ts):**

```ts
SessionStart: [
  { matcher: 'startup|resume|clear|compact', hooks: [nodeHook('cortex-md-injector.mjs')] },
],
UserPromptSubmit: [
  { hooks: [nodeHook('cortex-md-injector.mjs')] },  // empty matcher = always
],
```

`cortex-md-injector.mjs` branches based on stdin's `hook_event_name`:
- `SessionStart`: uses `payload.cwd` as scan starting point; on first start, injects the entire cwd CORTEX.md chain at once. Does not resend when matcher=`compact` (already in cache, naturally hits dedup).
- `PostToolUse` (Read): uses file_path / path from tool_input, following the current Phase 2.1 logic.

Output uniformly uses `{ hookSpecificOutput: { hookEventName: <event>, additionalContext: '<system-reminder>...</system-reminder>' } }`. Note that Claude Code has a 10,000 character limit for `additionalContext` — with each file having a 200 KB limit, overflow is possible. Add a total length truncation guard in the script; when too long, keep the first few entries in leaf→root order + annotation of truncated.

**PI (add a section in hook-bridge.ts):**

PI's `ExtensionAPI` does not have SessionStart; the equivalent is `before_agent_start`, which fires before each agent run, payload `{ prompt, systemPrompt }`, and the handler can mutate `event.systemPrompt`. The change:

```ts
pi.on('before_agent_start', (event, ctx) => {
  const payload = {
    hook_event_name: 'UserPromptSubmit',  // reuse the same script
    session_id: getSessionId(ctx),
    cwd: ctx.cwd,
    prompt: event.prompt,
  };
  const result = runHookScript(path.join(HOOKS_DIR, 'cortex-md-injector.mjs'), payload);
  const ctxText = result?.hookSpecificOutput?.additionalContext;
  if (ctxText) {
    event.systemPrompt = (event.systemPrompt ?? '') + '\n\n' + ctxText;
  }
});
```

PI does not distinguish between startup vs continued; it fires every round; the dedup cache keeps repeated scan costs manageable.

**Codex (no extension hook system):**

`agent-adapter/codex/adapter.ts` runs the Codex CLI as a jsonrpc child process, without an equivalent `on(event, handler)` bridge. Local CORTEX.md injection can only go through the path of "concatenating content into systemPrompt at startup". Specifically, change the codex spawn-args or system prompt assembly location (can be deferred for short term; Codex is only used for specific tasks in Cortex, and the common scenarios of remote path + unchanged cwd are already covered; listed as a follow-up task).

### 2.4 Documentation

Update header comments in `agent-adapter/claude/hooks-builder.ts` and `agent-adapter/pi/hook-bridge.ts`; `hooks/CORTEX.md` (originally hooks/CLAUDE.md) documents the new hook's trigger conditions and dedup behavior.

## Phase 3: Physical File Migration

### 3.1 Cortex repo

```
find /home/fangxin/Cortex -name CLAUDE.md -not -path '*/node_modules/*' -not -path '*/.git/*'
```

35 files, all `git mv CLAUDE.md CORTEX.md`. Including:
- repo root, agent-server, client root-level CLAUDE.md
- `agent-server/src/**/CLAUDE.md` index files for each directory
- `agent-server/tests/CLAUDE.md`
- `agent-server/defaults/CLAUDE.md`
- CLAUDE.md in all plugin / skill directories

`.gitignore` changes `CLAUDE.local.md` → `CORTEX.local.md`.

### 3.2 User context

```
find /home/fangxin/.cortex -name CLAUDE.md
```

20 files, same `git mv`. Includes `~/.cortex/CLAUDE.md` (system prompt main file) + project roots + `experiments/` subdirectory indexes, etc.

### 3.3 Documentation and prompt content

In each file that is mv'd, the string "CLAUDE.md" is uniformly replaced with "CORTEX.md" (self-references, links, directory index descriptions). Batch sed, but need to review whether there are references to "Claude Code's CLAUDE.md" as an external concept — currently it appears there are none; they are all Cortex's own index files.

All "CLAUDE.md" in `agent-server/defaults/prompts/systemPrompts/{direct,worker,coder}.md`, `defaults/plugins/**/SKILL.md`, `defaults/rules/*.md` changed to "CORTEX.md". Key SKILL.md:
- `cortex-coder/skills/code-standards/SKILL.md` (11 places)
- `cortex-common/skills/compound/SKILL.md` (9 places)
- `cortex-system/skills/{feedback,evolve,refresh-skills,reorient,project-init,gravity,deep-retrospective}/SKILL.md` (30+ total)

## Phase 4: Code Comment Marker

The `>>> If I am updated, make sure to update my header comment and the parent folder's CORTEX.md <<<` marker appears in the header of almost all TS files (grep shows 100+ files, 1 each). Bulk sed replace with `... CORTEX.md <<<`.

```bash
grep -rl '所属文件夹 CLAUDE.md' agent-server/src agent-server/tests client/src \
  | xargs sed -i 's|所属文件夹 CLAUDE.md|所属文件夹 CORTEX.md|g'
```

## Phase 4.5: PI hook-bridge Connects to before_agent_start

`agent-server/src/agent-adapter/pi/hook-bridge.ts` add in the default exported `hookBridge(pi)`:

```ts
pi.on('before_agent_start', (event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
  const sessionId = getSessionId(ctx);
  const payload: ClaudeHookPayload = {
    hook_event_name: 'UserPromptSubmit' as any,  // Reuse the same script logic
    session_id: sessionId,
    tool_name: '',
    tool_input: {},
    tool_use_id: '',
    cwd: ctx.cwd,
  };
  try {
    const result = runHookScript(path.join(HOOKS_DIR, 'cortex-md-injector.mjs'), payload);
    const ctxText = (result as any)?.hookSpecificOutput?.additionalContext;
    if (ctxText && typeof ctxText === 'string') {
      event.systemPrompt = (event.systemPrompt ?? '') + '\n\n' + ctxText;
    }
  } catch (e) {
    log.error('cortex-md-injector (before_agent_start) error:', e);
  }
});
```

In the `ClaudeHookPayload` interface, the `hook_event_name` field needs to be extended to `'PreToolUse' | 'PostToolUse' | 'SessionStart' | 'UserPromptSubmit'`, aligning the types.

In `pi-ext-types.ts`, `ExtensionAPI` has already declared `before_agent_start` as a first-class event (line 90); no need to expand literal types.

Codex adapter is not handled in this phase; listed as a follow-up: at startup, concatenate the result of `scanCortexMDChain(cwd)` to the end of systemPrompt in `codex/spawn-args.ts` or the system prompt assembly location.

## Phase 5: Tests

### 5.1 Rename

- `agent-server/tests/claude-md-scanner.test.ts` → `cortex-md-scanner.test.ts`
- `agent-server/tests/claude-md-injector.test.ts` → `cortex-md-injector.test.ts`

The literals `CLAUDE.md` / `CLAUDE.local.md` / `~/.claude/CLAUDE.md` in test bodies are all changed to the CORTEX equivalent versions, assertion messages are renamed accordingly.

### 5.2 New Tests

Add unit tests for the new local hook `agent-server/tests/cortex-md-injector-hook.test.ts`, covering three entry points:

- **PostToolUse**: stdin `{ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path } }`, assert stdout JSON contains `additionalContext`.
- **SessionStart**: stdin `{ hook_event_name: 'SessionStart', source: 'startup', cwd }`, assert scan starts from cwd.
- **UserPromptSubmit**: stdin `{ hook_event_name: 'UserPromptSubmit', cwd, prompt }`, assert behavior same as SessionStart.
- **Dedup**: second input with same mtime and same sessionId no longer injects; re-injects after mtime changes.
- **Truncation**: construct a chain exceeding 10,000 characters, verify script truncates and appends `[truncated]` annotation, does not exceed limit.
- **markOnly**: tool reading CORTEX.md itself only updates cache, does not output `additionalContext`.

PI path: add a case in `agent-server/tests/agent-adapter-pi-hook-bridge.test.ts` where `before_agent_start` triggers cortex-md-injector and mutates `event.systemPrompt`.

### 5.3 End-to-End

Run `npm test` to confirm no residual `CLAUDE.md` literals leak into assertions.

## Phase 6: Deployment and Switchover

1. Complete Phases 1–5 on the feature branch.
2. Before restarting agent-server, complete the `~/.cortex/` file migration on lab2 (including `~/.cortex/CLAUDE.md` → `CORTEX.md`), so the new code can read it directly after startup.
3. Repackage cortex-client, deploy to my-pc / lab / lab-ksu. During this period, the RPC schema is forward/backward compatible (extra `claudeMDs` fields will be ignored, missing `cortexMDs` fields are treated as empty arrays). You can upgrade server first then client, or vice versa; during this period, functionality degrades to "remote CORTEX.md not injected", but will not crash.
4. Restart app.js.
5. Smoke test: `/orient`, `!thread main`, remote `remote_read` a file whose cwd contains CORTEX.md, confirm the injection block appears and only appears once.
6. Drop a decision record in `context/decisions/`: CLAUDE.md retired, CORTEX.md took over, migration date, corresponding commit.

## Compatibility and Risks

`cortex-client` is an npm package; remote machines may not be able to upgrade immediately. For this purpose, the RPC layer compatibility strategy:
- Server side: when `result.cortexMDs` is missing, treat as empty array, do not inject.
- Old client versions still return `claudeMDs`, server side ignores them — the impact is that during the period before remote machines are upgraded, there is no CORTEX.md injection; this is expected degradation, not a bug.
- No longer do dual-write (returning both claudeMDs and cortexMDs) to avoid confusion.

During the physical file git mv, running threads that reference old CLAUDE.md paths may fail. It is recommended to perform the migration during a low-activity window and record a maintenance window in `STATUS.md`.

`~/.cortex/CLAUDE.md` is Cortex's root system prompt. During migration, if agent-server is still running and has active sessions, those sessions have already loaded the old prompt into memory and are unaffected; new sessions read from `CORTEX.md`.

Do not create `CLAUDE.md` symlinks for compatibility — the user explicitly said "CLAUDE.md will not be retained"; a clean cut is cleaner.

## Implementation Order (Recommended)

1. Write new `cortex-md-scanner.ts` / `cortex-md-injector.ts` / `cortex-md.ts`, keep old files untouched, run tests to confirm new code works independently.
2. Switch `task-ops.ts` to new modules; client side switches synchronously. This step also completes the server↔client field name switch, requiring client self-connection verification locally.
3. Add local hook script `cortex-md-injector.mjs`, register PostToolUse + SessionStart + UserPromptSubmit in hooks-builder.ts.
4. Connect PI hook-bridge to `before_agent_start`.
5. One-time big change: delete old files, batch sed markers, batch git mv physical files, batch sed "CLAUDE.md" references in documentation.
6. Run full test suite, fix remaining assertions.
7. Deploy cortex-client to my-pc / lab / lab-ksu, restart agent-server.
8. Follow-up: add CORTEX.md loading to Codex adapter's systemPrompt assembly path.

Make one commit per phase for easy rollback.

## Hook Event Compatibility Matrix (Reference)

| Entry Point | Claude Code | PI | Codex |
| --- | --- | --- | --- |
| Session Start | `SessionStart` (matchers: startup/resume/clear/compact) | `before_agent_start` (no matcher, fires every round, relies on dedup) | No hook, need to concatenate systemPrompt in spawn-args |
| Every Prompt | `UserPromptSubmit` | `before_agent_start` same as above | None |
| Before Tool Call | `PreToolUse` | `tool_call` | No hook bridge |
| After Tool Call | `PostToolUse` | `tool_result` | No hook bridge |
| Session End | `SessionEnd` | `session_shutdown` | None |
| `additionalContext` Limit | 10,000 characters | systemPrompt directly concatenated (no explicit limit, but constrained by context window) | systemPrompt directly concatenated |
