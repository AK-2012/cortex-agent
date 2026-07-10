# Plan — Session origin classification + full thread transcript recording

> **Status: implemented (2026-07-09).** Part A (origin field end-to-end) + Part B (thread
> transcript buffer→flush) landed. Verified: session-registry (24), query-sessions (9),
> thread-transcript (4), thread-runner (18), thread-rate-limit-resume (6) unit tests pass;
> agent-server + ui-contract + web typecheck clean; depcruise clean; web suite 503 pass.
> Full agent-server `npm test` could not complete in this session (machine load avg 60+ on the
> shared lab box → every forked file hit the 15s cap, incl. files untouched by this change);
> no new failures were introduced (touched-module tests all green run together). Live-streaming
> of in-progress thread sessions into the UI remains a follow-up (v1 persists the transcript,
> visible on reload / at step end).



## Problem

Two coupled defects in the Web UI left rail (`LeftRail.tsx`):

1. **Sessions are not classified by origin.** The left rail queries `sessions.list({})`
   with no filter, so it mixes (a) direct user conversations, (b) thread-agent sessions,
   and (c) schedule-triggered sessions. The only origin marker in the data model is
   `Session.kind: 'local' | 'scheduled'` — direct chats and thread sessions are BOTH
   `kind:'local'` and indistinguishable except by the `label` naming convention
   (`[threadId:agentSlotId]`). Requirement: the left rail must show **only direct user
   conversations**.

2. **Thread steps record no transcript.** `agent-runner.ts` (direct path) appends every
   user/assistant/tool event to `conversation-history/<sessionId>.jsonl` via the callbacks
   passed to `runConversation` (lines 137/172/182). The thread runner (`domain/threads/runner.ts`)
   has its own step callbacks (`setupStepCallbacks`) that stream to the OutputStream but
   **never call `conversationHistory.append*`**. So a thread session's `sessions.transcript`
   is empty and cannot be displayed in the UI. Requirement: thread sessions must have a
   full transcript (assistant text + tool calls) recorded.

## Design overview

- **Part A** adds a first-class `origin: 'direct' | 'thread' | 'scheduled'` field to the
  session record, set at every registration site, exposed through the tRPC DTO with an
  optional server-side filter, and consumed by the left rail (`origin:'direct'`).
- **Part B** wires the thread runner to record each step's transcript into
  `conversation-history`, keyed by the step's final `result.sessionId`, using a
  **buffer-during-step / flush-at-step-end** mechanism (the fresh-slot sessionId is only
  known after the agent runs).

`kind` is **retained** (resumable logic, scheduled detection, `sessionMeta` UI all depend
on it). `origin` is the new, orthogonal, more-granular dimension. Both are set at
registration; `kind = origin === 'scheduled' ? 'scheduled' : 'local'`.

---

## Part A — session `origin` field

### A1. Data model (`store/session-registry-repo.ts`)
- Add `origin: 'direct' | 'thread' | 'scheduled'` to the `Session` interface (currently L23–35).
- Persist it in `registerSession`'s mutate block (currently L152–163).
- **Migration** for existing `session-registry.json` records lacking `origin`: derive lazily
  in the read/migration path —
  - `kind === 'scheduled'` → `'scheduled'`
  - else `label` matches `/^\[[^\]]+:[^\]]+\]$/` (thread label) → `'thread'`
  - else → `'direct'`
  Fold this into the existing legacy-migration code (the same place that reconstructs
  `projectId` from `channel-registry.json`, L55–104) so it runs once and rewrites the file.
- Optional filter helper: `listByOrigin(origin, projectId?)` OR just filter inside the
  query handler (see A4). Prefer filtering in the handler to keep the repo lean.

### A2. Registration plumbing
Add `origin` to the shared opts types and thread it through:
- `session-lifecycle.ts`: `SessionRegistryWriter.registerSession` opts, `RegisterNamedSessionOpts`,
  and the `registerNamedSession` body (default `origin: opts.origin ?? 'direct'`).
- `sessions/session-registry.ts`: pass-through wrapper.

### A3. Set `origin` at every call site (full enumeration)
| site | file:line | origin |
|---|---|---|
| direct inbound (resolveSessionName) | `orchestration/agent-runner.ts:266` | `direct` |
| direct/scheduled fallback (registerOrUpdateSession) | `orchestration/lifecycle.ts:183` | `trigger === 'scheduled' ? 'scheduled' : 'direct'` |
| direct resolvedSessionId | `orchestration/lifecycle.ts:265` | `direct` |
| TUI fresh session | `domain/tui-session/tui-session-service.ts:18` | `direct` |
| thread step (runner) | `domain/threads/runner.ts:416` | `thread` |
| thread step (hook-runner) | `domain/threads/hook-runner.ts:254` | `thread` |
| scheduled / dispatch finalize | `domain/scheduling/jobs/_shared.ts:37` | new `origin` param |

`finalizeThreadSuccess` currently takes `sessionKind: 'scheduled' | 'local'` and is shared by
the **scheduled-task** job and the **task-dispatch** job. Add an explicit `origin` parameter
(do NOT derive from `sessionKind`, because dispatch is `local` but its origin is `thread`):
- scheduled-task job → `origin: 'scheduled'`
- task-dispatch job → `origin: 'thread'`

### A4. tRPC DTO + query
- Add `origin` to `SessionInfo` (`domain/ui-service/types.ts:226–236`) and the
  `@cortex-agent/ui-contract` re-export.
- `handleSessionsList` (`domain/ui-service/query/sessions.ts:37–47`): map `origin` through.
- Add optional `origin?: 'direct'|'thread'|'scheduled'` to `SessionsListParams` /
  `sessionsListInput` (`input-schemas.ts:187`). In `handleSessionsList`, when `origin` is
  provided, filter the resulting list by it (applies in all three branches).
- `resumable` stays `kind !== 'scheduled'` (unchanged).

### A5. Web UI (`web/`)
- `LeftRail.tsx:22`: change `trpc.sessions.list.queryOptions({})` →
  `queryOptions({ origin: 'direct' })`. This is the only functional change needed to satisfy
  "left rail shows only direct conversations".
- `session-groups.ts`: unchanged (`sessionMeta` scheduled marker stays; direct-only list
  just won't hit it). No new grouping required.
- Other consumers of `sessions.list` (CommandPalette, Overview, CenterChat, RightPanel,
  Memory, mobile screens) are left as-is for this change — they don't regress (origin is
  additive; absent filter = all). Note in the PR that thread/scheduled sessions remain
  reachable via the Thread view (`/threads`) and Overview.

---

## Part B — thread transcript recording

### B1. Mechanism: buffer-during-step, flush-at-step-end
The direct path keys history by a sessionId known **before** the run (persistent channel map).
A thread step's sessionId for a fresh slot is only known **after** the agent runs
(`result.sessionId`, used already at `runner.ts:415` to register the session). Therefore:

1. In `setupStepCallbacks` (`runner.ts:235`), allocate a per-step **event buffer**
   `Array<{ role:'assistant'|'tool', text?, toolName?, toolInput? }>`.
   - Wrap `onAssistantMessage`: after emitting to the stream, push `{role:'assistant', text}`.
   - Wrap `onToolUse`: after the existing trace/caller composition, push
     `{role:'tool', toolName:name, toolInput: summarizeToolInputForHistory(input)}`.
   - Return the buffer alongside the callbacks (extend `StepCallbacks` or return via the
     `StepContext`).
2. In `recordStepOutcome` (`runner.ts:370`), on the **normal** path (after the
   rate-limit early-return guard, alongside the existing `registerSession` at L415–425),
   when `result?.sessionId` is set:
   - `conversationHistory.appendUser(result.sessionId, { text: prompt })` — the step prompt
     is this agent's input (one turn per step).
   - Flush the buffer in order: `appendAssistant` / `appendTool` per event.
   - Best-effort `publishSessionMessage(...)` per event for live UI (optional in v1; the
     persisted JSONL is the source of truth on reload).
   - All writes fire-and-forget with the same `.catch` guard as `recordHistory` in
     agent-runner (never let a logging write break the step).

Keying by `result.sessionId` matches the session-registry entry written two lines below, so
`sessions.transcript(sessionId)` resolves the transcript for that thread session.

Multi-step behaviour: `persistSession` slots reuse one sessionId across steps → successive
steps append successive turns to the same JSONL (full multi-turn conversation). Non-persist
slots get one sessionId + one transcript per step (one registry entry each) — consistent
with current registration.

### B2. Shared helper
`summarizeToolInputForHistory` currently lives in `orchestration/agent-runner.ts` (exported).
Threads importing from `orchestration/` risks a dependency-direction smell. **Move** it to a
neutral module — put it beside the recorder in `store/conversation-history-repo.ts` (or a
small `core/` util) and have both agent-runner and the thread runner import it. Update the
agent-runner import.

### B3. Scope / edge cases
- **Rate-limited / aborted / thrown steps**: `recordStepOutcome` returns early on the
  throttled rate-limit path (L389–396); the buffer for that partial step is simply dropped
  (no flush). Acceptable — matches "step not recorded, will re-run".
- **Live streaming into the UI for in-progress thread sessions** is a follow-up: it needs a
  resolved sessionId mid-stream (`handle.sessionId` getter, `facade.ts:276`) which is null
  for the first events of a fresh slot. v1 delivers persisted transcript (visible on reload
  / after the step). Note this explicitly in the completion note.
- **Cost**: transcript appends are O(1) async; negligible.

---

## Verification

Backend:
- Unit (`agent-server/tests/`): migration derives `origin` correctly for the three cases;
  `registerSession` persists `origin`; `handleSessionsList` filters by `origin`.
- Unit (`thread-runner.test.ts`): assert `recordStepOutcome` calls
  `conversationHistory.appendUser/appendAssistant/appendTool` with `result.sessionId` and the
  buffered events in order (inject a fake `conversationHistory`).
- `npm run typecheck` (agent-server) + `vitest run`.

Web:
- `tsc --noEmit && vitest run` in `web/`.
- Manual/e2e: run a real thread (`!thread <agent> <msg>`), then
  `sessions.transcript(stepSessionId)` → prompt + assistant + tool rows present; confirm
  `sessions.list({origin:'direct'})` excludes the thread session and `sessions.list({})`
  still includes it.

End-to-end (`/verify`): drive the left rail against a real ui-http-server and confirm only
direct sessions render; open a thread session's transcript and confirm it is populated.

---

## Rollout / back-compat
- Existing `session-registry.json` records get `origin` via one-time migration on first read.
- Past threads have no historical transcript (never recorded) — only new thread runs get
  transcripts. Acceptable; documented.
- No breaking change to `kind`, `resumable`, or any existing consumer.

## Files touched (summary)
Backend: `store/session-registry-repo.ts`, `domain/sessions/session-lifecycle.ts`,
`domain/sessions/session-registry.ts`, `orchestration/agent-runner.ts`,
`orchestration/lifecycle.ts`, `domain/tui-session/tui-session-service.ts`,
`domain/threads/runner.ts`, `domain/threads/hook-runner.ts`,
`domain/scheduling/jobs/_shared.ts` (+ its two job callers),
`domain/ui-service/types.ts`, `domain/ui-service/query/sessions.ts`,
`domain/ui-service/input-schemas.ts`, `store/conversation-history-repo.ts` (helper move).
Contract: `@cortex-agent/ui-contract` (SessionInfo + input schema).
Web: `web/src/features/workbench/LeftRail.tsx`.
Tests: session-registry migration/filter, thread-runner transcript.
```
