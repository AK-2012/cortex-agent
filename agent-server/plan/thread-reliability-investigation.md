# Thread Reliability Investigation (server restart kills running threads)

Date: 2026-06-08
Trigger: session running B0–B5 coder-review threads; restarts/deploys mid-session interrupted
threads, left half-finished uncommitted work, and skipped the reviewer stage (two type errors leaked).

## TL;DR root cause (corrected after deeper trace — see CORRECTION below)

Threads run **in-process** inside the app.ts child. The daemon defers restart/rebuild while
app.ts reports `busy` (`childBusy`). Three of the four thread launch paths bracket the *whole*
`runThread` with `trackPendingTask(±1)` so they hold `busy` for the entire pipeline:
Slack `!thread` (`thread-executor.ts:64-72`), scheduled-task (`scheduled-task.ts:80-83`), and
task-dispatch (`task-dispatch.ts:73-75`). **The MCP `thread_start` webhook fire-and-forget path
(`webhook.ts:201`) brackets nothing** — so a background MCP-started thread is invisible to the
busy gate. When the *orchestrating* session goes idle, a deferred rebuild/restart fires, SIGTERMs
app.ts (whose handler does not drain in-flight threads, `app.ts:201-216`), and the background
thread dies. On next startup `markRunningAsFailedOnStartup()` stamps it
`failed / "Interrupted by server restart"`. No file rollback exists, so the coder's edits (written
directly to the working tree) survive uncommitted and unreviewed.

> **CORRECTION (vs first pass):** the first pass blamed a "per-LLM-call gate → inter-step gap".
> That is inaccurate: the bracketed paths hold busy across step gaps fine. The real defect is the
> webhook path having **no bracket at all** — every B0–B5 thread was started via `thread_start`,
> so all of them ran fully unprotected. B0 only survived because no deploy landed during its run.

## Evidence (file:line)

1. **In-process thread loop, no durable resume.**
   `src/domain/threads/runner.ts:455-528` — `runThread()` is a plain `while(true)` async loop in
   app.ts memory. On any throw it calls `failThread` (`:502-507`); there is no checkpoint/resume.

2. **Restart-defer gate is per-LLM-call, not per-thread.**
   `src/orchestration/busy-tracker.ts:17-22` — busy IPC on `count 0→1`, idle IPC on `count 1→0`.
   Each thread *step* is one LLM call, so the count returns to 0 between steps.

3. **Deferred restart/rebuild fires on the inter-step idle.**
   `src/entry/daemon.ts:141-163` — the `idle` IPC handler sets `childBusy=false` and, if a
   `pendingRestart`/`pendingRebuild` was deferred during the previous step, fires it immediately.
   `daemon.ts:227-258` (`restart`) and `daemon.ts:383-391` (`runRebuildPipeline`) both defer while
   busy but resume on the next idle — which lands in the gap between thread steps.

4. **SIGTERM handler does not drain in-flight threads.**
   `src/entry/app.ts:201-216` — flushes stores then `process.exit(0)`. It calls `closeAllSessions()`
   (kills the agent subprocess) but never waits for `runThread()` to finish.

5. **Startup stamps the interrupted record.**
   `src/entry/app.ts:289` → `src/store/thread-repo.ts:146-165` — running/waiting → `failed`,
   `error = "Interrupted by server restart"`, the exact string B2 showed.

6. **No atomicity / no rollback.** `grep -E 'git stash|checkout|reset|rollback|revert'` over
   `src/domain/threads/` → no matches. The coder edits the **real working tree** (cwd = repo, tracked
   only via session mutation JSONL, `artifact-io.ts:107`); `workspacePath` is just the artifact dir
   (`artifact-io.ts:189-195`), not a code sandbox. So interrupted edits remain uncommitted in the tree.

7. **MCP tools vanish because the MCP server's lifecycle is coupled to app.ts.**
   `src/domain/mcp/core-server.ts:46-49` — `thread_*` live in a per-session **stdio** MCP server
   spawned as a child of the pooled `claude` process. `thread-ops.ts:13-24` — every tool call HTTP-
   proxies to the daemon webhook `http://127.0.0.1:3001/webhook/thread-op`, hosted *inside app.ts*.
   When app.ts restarts: (a) `closeAllSessions()` kills the pooled claude + its stdio MCP child, and
   (b) the webhook port goes down. The resumed session comes back with a degraded/missing MCP
   connection → "No such tool available", worsening across successive restarts.

8. **`thread_result.finalOutput` is null by design.**
   `src/orchestration/routing/webhook.ts:221` — `finalOutput = last step.output`, and
   `runner.ts:348-359` records `output: result?.finalOutput || null`. Coder/reviewer agents write to
   **artifact.md**, not stdout, so the returned text is empty → finalOutput null, summary "(无输出)".
   Real product is only in artifact.md (`readArtifact`).

## Mapping to observed B0–B5

- **B0 (thr_e32cc024)** completed: no restart landed in its inter-step gaps. Full plan→impl→review→
  `[IMPL-APPROVED]`, self-commit d993dc24.
- **B2 (thr_775ceb36)** `failed` "Interrupted by server restart": deploy deferred during the implement
  step; implement finished (4 edits + 2 new files landed in tree), idle fired, deferred rebuild fired
  → SIGTERM before reviewer. Record shows only plan; files uncommitted, review skipped.
- **B3 (thr_66978128)** built `src/domain/tui-session/` into the real repo, then restart → resumed
  session lost MCP → `thread_status` "No such tool available". Two type errors (createFresh return
  type missing `emitNotFoundError`; deps `kind: string` vs `'local' | 'scheduled'`) leaked because the
  reviewer never ran; tsx (esbuild, no typecheck) couldn't catch them, only `tsc -p tsconfig.build.json`.
- **B4+B5** done by hand: by then `thread_start` itself was gone (MCP fully detached).

## Why the type errors are the real danger

The reviewer stage is the only thread step that runs `build typecheck`. Killing the thread before it
silently downgrades a "reviewed + typechecked" deliverable to "raw codegen", while still leaving the
edits in the tree looking done. tsx tests pass (esbuild strips types), so nothing flags it until a
human runs `tsc`.

## Proposed fixes (ranked by leverage / effort) — NOT yet implemented, needs approval

### F1. Busy bracket on the MCP `thread_start` webhook path — ✅ DONE (2026-06-08)
The other three launch paths already bracket the whole thread; the webhook path didn't. Added
`runThreadDetached()` (`thread-executor.ts`) which wraps the fire-and-forget run with
`trackPendingTask(+1)` (synchronous, before the run dispatches) … `(-1)` in `finally`, so a
background `thread_start` thread now holds the busy gate for its entire pipeline and a deferred
rebuild/restart waits for the thread to finish. `webhook.ts:201` now calls it. Regression test:
`tests/orch/thread-detached.test.ts` (sync +1, balanced -1 on success/reject). tsc + depcruise clean.

Residual (not a regression — shared by all thread paths): a genuinely-hung thread blocks deploys
indefinitely. Optional follow-up: max-defer ceiling + bounded graceful drain (F2).

### F2. Graceful thread drain on SIGTERM
In `app.ts` SIGTERM, await in-flight `runThread` promises (bounded by the daemon's 5s→SIGKILL window,
so cap it / raise the daemon force-kill timeout). Combined with F1 this makes restart wait for a clean
thread boundary instead of severing it.

### F3. Stage-boundary checkpoint commits (better than auto-rollback)
The user's own note: interrupted work was *recoverable* from the tree — that's a feature. Auto-
rollback would destroy recoverable work. Instead, commit at each stage boundary (WIP commit per
agent step) so an interrupted thread leaves a clean, attributable checkpoint that the next session can
inspect/continue, and a completed thread squashes. Optional: run the coder in a `git worktree` to keep
the main tree clean.

### F4. Post-thread typecheck gate (defense in depth for #review-skip)
Regardless of thread outcome, gate commits on `tsc -p tsconfig.build.json` (pre-commit hook or a
dispatch-level CI step). Even a perfectly-running reviewer can miss things; the typechecker shouldn't
depend on the thread surviving.

### F5. Surface artifact in thread_result (fixes #4, trivial)
`webhook.ts:221`: fall back to `artifact` when last `step.output` is empty, and include an artifact
snippet in the completion summary so the product is visible without manually opening artifact.md.

### F6. Granularity escape hatch (fixes #5)
For one-line changes, skip the 3-stage template — use a single-agent `thread_start({ agent: ... })`
or just hand-edit. Already mitigable; document the threshold in the develop/thread skill.

---

## Deep dive: MCP tool disappearance — CORRECTED with log evidence (2026-06-08)

> The hypotheses below (race against `npm install -g` swap; webhook-ordering) were **wrong** — the
> log shows the tools were missing 5–9 min into a *stable* app.ts run, not during a restart window.
> Real root cause, from `~/.cortex/logs/server-20260608.log`:

**Failed in-place rebuilds corrupt `dist/`, and the MCP server is spawned fresh from `dist/`.**

Evidence:
- `07:54:02` build exit=0 → `07:54:13` app restarts with good dist (PID 2431959).
- `07:54:20` a new in-place rebuild (user saved `domain/tui-session/index.ts`) **fails**:
  `TS2741: Property 'emitNotFoundError' is missing … in type 'HandshakeResolution'` (the B3 error).
- Build script is `tsc -p tsconfig.build.json && tsc-alias … && copy-assets`. `tsconfig.build.json`
  has **no `noEmitOnError`** → default `false` → **tsc emits JS even on type error**, but the `&&`
  short-circuits so **`tsc-alias` never runs**. `tsc-alias` is what rewrites `@store/* @core/*
  @domain/*` path aliases into real relative paths.
- Result: `dist/` now holds freshly-emitted JS with **unresolved path aliases**. The in-memory
  app.ts (PID 2431959) is immune, but `cortex-core` is spawned **fresh from disk** on every session
  resume. At `07:58:56` it spawned `node dist/domain/mcp/core-server.js` → `Cannot find module
  '@store/...'` at startup → Claude Code marks the whole `cortex-core` server failed →
  `No such tool available: mcp__cortex-core__thread_status` (then `thread_start` at `08:03:22`).
- This persists for the rest of the session because Claude Code does not re-handshake a failed MCP
  server; it cleared only when a later clean build restored dist.

### Fix MA — ✅ DONE (2026-06-08): `noEmitOnError: true` in `tsconfig.build.json`
A failed `tsc` now emits **nothing**, leaving the last-good `dist/` intact instead of overwriting
it with alias-broken JS. Any process spawned from disk (cortex-core MCP, CLIs, hooks) keeps working
through a user's in-progress non-compiling edits. This protects more than threads — it's the real
defense for "MCP tools vanished mid-session". The daemon picks up the new tsconfig on the next build
automatically (no daemon restart needed); the abort-on-failure behavior is unchanged, only the dist
corruption is prevented.

Verified:
- Real project `npm run build` → exit 0, emits normally, aliases resolved (`from '../../core/log.js'`).
- Sandbox (`/tmp` throwaway, repo-local tsc): valid code emits; a type error with
  `noEmitOnError:true` → tsc exit 1, output file **preserved as last-good**; same with
  `noEmitOnError:false` → output file **overwritten with the broken emit** (reproduces the bug).
- Bonus repro of the alias mechanism: raw `tsc` alone left `from '@core/utils.js'` (unresolved);
  full build (`tsc && tsc-alias`) produced `from '../../core/log.js'` — confirming a `tsc`-only emit
  (what the `&&` short-circuit leaves on failure) is what breaks `node dist/.../core-server.js`.

Optional stronger form (not done): build to `dist.tmp` and atomically `rename` on full success of
tsc+tsc-alias+copy-assets, so even a mid-write crash can't expose a partial dist.

---

## Side finding: tests polluted the production store — FIXED (2026-06-08)

Running orch tests directly (`npx tsx --test tests/orch/...`) wrote to the real
`~/.cortex/data/threads.json` because those files lacked the `_test-home` isolation guard (0/12 orch
files had it) and direct invocation bypasses run-tests.sh's global `--import`. Audit (via the new
tripwire) found three real writers: `edit-handler.test.ts`, `teardown-execution.test.ts`,
`thread-executor.test.ts`.

Fix (systemic, can't be forgotten):
- **Tripwire in `core/atomic-write.ts`**: a test process (`NODE_TEST_CONTEXT` set) writing under the
  real `~/.cortex` now throws before writing — silent corruption → loud failure. No-op in
  production. Covers all stores (they all write via `JsonRepository → atomicWrite`). Regression:
  `tests/core/atomic-write-guard.test.ts` (also reproduced the bug first, TDD).
- **`npm run test:file <file>`**: isolated single-file runner (wraps `--import ./tests/_test-home.ts`).
- Added the `_test-home` guard to the three writer tests so direct runs isolate instead of throwing.
- Documented in `tests/CORTEX.md`.
Verified: full suite `npm test` → 0 tripwire fires, 0 failures; tsc + depcruise clean.

### (superseded hypotheses kept for the record)
The webhook-ordering note (M1) is still a real latent bug worth fixing (would surface as
"fetch failed", not "No such tool"), but it was NOT the cause here.

---

## (superseded) Earlier MCP hypothesis

### Architecture
`thread_*` (and `remote_*`, `current_time`) live in **cortex-core**, a *per-session stdio* MCP
server. The claude CLI spawns it from `--mcp-config` (`spawn-args.ts:48-81`) →
`node <INSTALL_ROOT>/dist/domain/mcp/core-server.js` (`config-generator.ts:34`, `paths.ts:19/29`
`INSTALL_ROOT` = the globally-installed package real copy from `npm install -g`). Inside it, every
`thread_*` tool HTTP-proxies to the app.ts webhook `127.0.0.1:3001/webhook/thread-op`
(`thread-ops.ts:13-24`). So the toolset depends on BOTH (a) the stdio server starting cleanly and
(b) the webhook being up.

### Why the tools vanished — two distinct failure modes
Every app.ts restart runs `closeAllSessions()` (`app.ts:202` → `claude/adapter.ts:527`), which
SIGTERM/SIGKILLs every pooled claude process and its stdio MCP children — including the live
orchestrating session. Claude Code resumes it (`--resume`) on the next message with a fresh claude
process that re-spawns cortex-core. The re-spawn can land in a bad window:

- **Mode A — "No such tool available" (what B3 hit).** The deploy pipeline is build → pack →
  `npm install -g <tgz>` (`daemon.ts:410+`). If the resume's cortex-core spawn reads
  `INSTALL_ROOT/dist` during the `npm install -g` file swap (or any transient inconsistency),
  `node core-server.js` throws on startup; Claude Code marks the `cortex-core` server *failed* and
  **drops its entire toolset for that session**. That's why `thread_status` went first and
  `thread_start` followed on the next resume — each resume re-rolled the dice.
- **Mode B — "...error: fetch failed" (distinct).** `startWebhookServer()` runs at `app.ts:361`,
  ~100 lines AFTER `adapter.start()` at `:262`. A resumed session that calls a `thread_*` tool in
  that window reaches a cortex-core that started fine but whose webhook `:3001` isn't listening yet
  → fetch failure (NOT "No such tool"). Pre-existing ordering bug, easy to fix.

F1 (busy gate) reduces restarts during active *thread* work but does NOT protect the *idle
orchestrator* session's MCP re-spawn — that's the session that lost its tools here.

### Proposed MCP fixes (need approval — agent-server behavioral change)
- **M1 (low risk, fully in our control): start the webhook before accepting messages.** Move
  `startWebhookServer()` above `adapter.start()` in `app.ts`. Eliminates Mode B outright.
- **M2 (narrows Mode A): atomic dist publish / boot-gate.** Ensure `INSTALL_ROOT/dist` is swapped
  atomically (install to temp, `rename`), and/or hold session resume until the new app.ts reports
  webhook-ready, so a resuming session never spawns cortex-core against a half-swapped dist.
- **M3 caveat:** the "No such tool" *registration drop* is partly Claude-Code-internal (its MCP
  client marks a failed server's tools absent for the rest of the session and we can't force a
  re-handshake from our side). We can only minimize the chance the server fails to start (M1+M2);
  fully robust recovery would need Claude Code to retry the server, or us to not kill healthy
  sessions on restart at all.

## Deep dive: finalOutput = null — CORRECTED (2026-06-08)

> Earlier claim ("agents write to artifact.md so step.output is null by design") was **wrong**. A
> normally-completing step DOES capture the agent's final assistant text: `runner.ts:354` records
> `output: result?.finalOutput`. Agents do emit assistant messages, so completed steps have output.

Real reason finalOutput came back null on B2/B3: **the thread was interrupted before the running
step was recorded.** Steps are pushed only on completion (`state-machine.ts:268`
`t.steps.push(step)` inside `recordStepResult`). The `coder-review` template is stage-driven —
`coder:plan → coder:implement → coder-reviewer:implReview → …` — each stage a separate step. When a
restart kills the thread mid-stage, that stage's step is never pushed; if it died before the first
stage finalized, `t.steps.length === 0` and `webhook.ts:221` returns `finalOutput: null`
(`t.steps.length ? lastStep.output : null`), with the callback summary falling to `'(无输出)'`
(`thread-callback.ts:23`). The artifact still shows the plan because the agent wrote it mid-turn,
before the step boundary. So null finalOutput is **another face of the interruption bug**, not a
separate design issue — fixing the restart kill (F1 + Fix MA) makes completed threads report the
reviewer's real `[IMPL-APPROVED]` output.

### Residual nicety (optional, not the bug)
For the legitimately-completed case, the last agent sometimes ends on a marker tool-write with no
trailing text → empty finalOutput. Falling back to the artifact (`finalOutput = lastStep.output ||
artifact`) would make the product visible. Low priority vs the two real fixes above.

---

## (superseded) Earlier finalOutput hypothesis

Both surfaces read the **last step's stdout text**, which is empty for artifact-writing agents:
- `webhook.ts:221` — `finalOutput = lastStep.output` (the `artifact` is fetched right above at
  `:220` but not used as a fallback).
- `thread-callback.ts:22-23` — `last = lastStep.output`; `tail = abortReason || error || last ||
  '(无输出)'`.
- Source: `runner.ts:354` records `output: result?.finalOutput || null`. Coder/reviewer agents
  follow the thread protocol and write to **artifact.md**, returning little/no assistant text → the
  step's `output` is null. The real product is only in artifact.md.

### Proposed fix F5 (trivial, low risk)
In the `result` handler and the callback summary, fall back to the artifact when step output is
empty: `finalOutput = lastStep.output || artifact || null`, and have the summary prefer the
artifact tail over `(无输出)`. Makes the product visible from the return value / notification
instead of forcing a manual artifact read.
