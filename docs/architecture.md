# Cortex Architecture

Cortex is an autonomous research agent system for robotics and AI/ML. It runs as a server-client architecture: the **agent-server** orchestrates work — task dispatch, thread execution, scheduling, Slack integration, and MCP tools — while remote **agent clients** connect via WebSocket to execute commands on remote machines. For deeper dives into these subsystems, see [threads.md](./threads.md), [tasks.md](./tasks.md), and [memory.md](./memory.md).

## Two Packages

Cortex consists of two npm packages plus a set of plugins:

| Package | Path | Purpose |
|---------|------|---------|
| `@cortex-agent/server` | `agent-server/` | Main server: Slack bot, LLM orchestration, scheduling, task system, MCP tools. Provides three CLI binaries: `cortex`, `cortex-task`, `cortex-run`. |
| `@cortex-agent/client` | `client/` | Lightweight remote agent daemon. Connects via WebSocket, executes shell/file commands locally, supports `cortex-run` for long-running task execution. |
| Plugins | `plugins/cortex-*` | 8 role-scoped plugin bundles containing skills. Not npm packages — loaded as directories at runtime. |

## Agent-Server Architecture: Six Layers

The agent-server code at `agent-server/src/` is organized into six strict layers (L0 through L5). Each layer may only import from lower-numbered layers. This constraint is **enforced at test time** by `agent-server/.dependency-cruiser.cjs` — the `depcruise` rule runs as part of `npm test` and fails the build on any violation.

```
L0  core/          → (no dependencies)
L1  store/         → core
L2  events/        → core
L3  domain/        → core, store, events
L4  orchestration/ → core, store, events, domain
L5  entry/         → everything (composition root)
```

Two additional directories sit outside the layer hierarchy because they are imported across multiple layers:

- **`agent-adapter/`** — the three-LLM-backend abstraction (Claude Code, Codex, PI)
- **`platform/`** — the messaging platform abstraction (Slack)

### Layer 0: `core/` — Zero-Dependency Foundation

The foundation layer. Contains only pure TypeScript with no runtime dependencies on other layers.

| File | Purpose |
|------|---------|
| `paths.ts` | Canonical path constants: `INSTALL_ROOT`, `DATA_DIR` (`~/.cortex/`), `CONFIG_DIR`, `STORE_DIR`, `CONTEXT_DIR`, `PROJECTS_DIR`, `WORKSPACE_DIR`, `PLUGINS_DIR`, `PROMPTS_DIR`, `HOOKS_DIR`, `LOGS_DIR` |
| `utils.ts` | Re-exports path constants plus utility functions: `chunkText`, `formatDurationCompact`, `todayISO`, `listProjectDirs`, `readableTimestamp` |
| `async-mutex.ts` | `AsyncMutex` class — promise-based mutex for serializing async disk writes. Used throughout the store layer to prevent concurrent file corruption |
| `log.ts` | `createLogger(tag)` — console + daily-rolling file sink with 14-day retention |
| `cli-utils.ts` | `formatHelp`, `formatError`, `readStdinSync`, `cliError` — shared CLI formatting |
| `status-format.ts` | Pure formatting: `computeElapsed`, `formatMetricsSuffix`, `buildSessionTag`, `buildUserProcessingMessage` |
| `task-parser.ts` | Task interface definition, YAML parsing/serialization with kebab↔snake_case key mapping, `scanAllTasks`, `scanAvailableTasks`, `filterTasks`, `getTaskStats` |
| `running-executions.ts` | `RunningExecutions` singleton with three-index registry (byKey, byThreadId, byExecutionId). Publishes `agent.*` lifecycle events to the EventBus |
| `types/agent-types.ts` | `AgentResult`, `AgentHandle`, `AgentProgress`, `AskUserQuestionInfo` |
| `types/thread-types.ts` | Full thread type family: `ThreadRecord`, `AgentDefinition`, `ThreadTemplate`, `TransitionRule`, `HookConfig`, `RunThreadOptions`, `AgentStep`, and more |
| `config-generator.ts` | Config file initialization for new installs |
| `gateway-generator.ts` | API gateway YAML generation |
| `profile-generator.ts` | Profile JSON generation |

### Layer 1: `store/` — Persistence

All write operations are serialized through `AsyncMutex` to prevent corruption from concurrent writes. The layer uses two repository patterns:

- **Pattern A (JsonRepository delegation)**: Simple CRUD wrappers around `JsonRepository<T>`. Used for schedule-repo, session-repo, channel-repo, session-registry-repo, cost-repo. All writes go through `atomicWrite()` (write to `.tmp.<pid>.<ts>` then `fs.rename`).
- **Pattern B (in-memory Map + fire-and-forget persist)**: Synchronous in-memory `Map` for reads, with async persist chain for writes. Used for execution-repo and thread-repo where read latency matters and stale-on-crash is acceptable.

| File | Purpose |
|------|---------|
| `json-repository.ts` | Generic `JsonRepository<T>` base class: `read()`, `write()`, `mutate(fn)`, `flush()`. Lazy orphan `.tmp.*` sweep on first I/O. Corrupt-JSON backup mechanism |
| `in-memory-repository.ts` | `InMemoryRepository<T>` — test double with identical interface, no disk I/O |
| `atomic-write.ts` | `atomicWrite(filePath, data)` — write to `.tmp.<pid>.<ts>` then `fs.rename` |
| `outbound-queue.ts` | WAL-based durable outbound message queue. 30-min TTL, 200-entry compaction, 5-second drain loop. Coalesces consecutive updates to the same message |
| `thread-repo.ts` | `ThreadRepo` — in-memory `Map<string, ThreadRecord>` + async persist. Queries: `findByChannel`, `findActive`, `findByPlatformThread`. Startup recovery: `markRunningAsFailedOnStartup`. Cleanup: 7-day old threads (24h for auto-records) |
| `session-repo.ts` | `SessionRepo` — `Record<string, string>` mapping `backend:channel → sessionId` |
| `conversation-ledger-repo.ts` | Per-channel turn tracking: `initConversation`, `beginTurn`, `addResponseTs`, `completeTurn`, `rollbackTo` |
| `session-registry-repo.ts` | `cortex-XXXX` short name registry. `generateSessionName`, `registerSession`, `lookupSession` |
| `execution-repo.ts` | Pattern B repository. Full CRUD: `startLocalExecution`, `registerDispatchExecution`, `completeExecution`, `failExecution`. Async stale detection via `reconcileStaleDispatches` |
| `channel-repo.ts` | `projectName → channelId` mapping |
| `project-dir-repo.ts` | `projectName → machineName → dirPath` with reverse channel lookup |
| `schedule-repo.ts` | Schedule persistence. `ScheduleTask` interface, `ScheduleTarget` union type |
| `cost-repo.ts` | Costs in JSONL (append-only), budget in JSON. 90-day pruning at startup |
| `profile-repo.ts` | Hybrid sync/async reader. `startProfileWatcher()` for hot-reload |
| `task-repo.ts` | Reads TASKS.yaml files. Pure I/O + mutex + git sync (`commitAndPush`). Mutations live in `domain/tasks/mutator.ts` |

### Layer 2: `events/` — Event Bus

A synchronous, type-safe event bus with JSONL logging.

| File | Purpose |
|------|---------|
| `event-types.ts` | 22 user event types + 2 meta events in a `CortexEvent` discriminated union. Categories: message/interaction, agent lifecycle, thread lifecycle, task, system |
| `event-bus.ts` | `EventBus` class — `subscribe(type, handler)` / `publish(event)`. Synchronous fan-out. Async handlers fire-and-forget. Re-entrant guard for `event-bus.handler-failed`. Close hooks for SIGTERM drain |
| `event-logger.ts` | Subscribes to `'*'`, ring buffer of 1024 entries, 100ms flush interval, daily rolling JSONL, 14-day retention. Gated by `CORTEX_EVENT_LOG=off` |
| `event-replay.ts` | Debug CLI: `node events/event-replay.ts --date YYYY-MM-DD [--type xxx]` |

**Event categories:**

- **Message/interaction**: `message.received`, `message.edited`, `plan.submitted`, `plan.approved`, `ask-user.requested`, `ask-user.answered`
- **Agent lifecycle**: `agent.started`, `agent.completed`, `agent.failed`, `agent.superseded`
- **Thread lifecycle**: `thread.created`, `thread.step.started`, `thread.step.finished`, `thread.transitioned`, `thread.completed`, `thread.failed`
- **Task**: `task.claimed`, `task.completed`, `task.dispatched`
- **System**: `llm.active-count-delta`, `scheduler.tick`, `rate-limit.breach`

### Layer 3: `domain/` — Business Logic

The thickest layer. Contains 14 subdirectories, each encapsulating a domain concern.

| Subdirectory | Purpose |
|-------------|---------|
| `agents/` | Agent execution facade. `runAgent()` delegates to the backend adapter. Profile resolution, backend detection |
| `sessions/` | Session lifecycle. Hook pipeline (onNew, onMessageEnd) with VirtualMessage display and optional agent injection |
| `tasks/` | Full task system: YAML parsing, dispatch, archiving, pending tracking, lock management, CLI (`cortex-task`), verification |
| `executions/` | Thin re-export over `store/execution-repo.ts` with lock-release side effect: every terminal transition auto-releases task locks |
| `costs/` | Cost tracking, gateway management, rate limiting with per-provider awareness |
| `scheduling/` | Scheduled task engine. `Scheduler` class with hot-reload via `fs.watch`, pre-check gate, before-run guard. 4 job runners: `scheduled-task`, `task-dispatch`, `memory-index-regen`, `task-archive` |
| `memory/` | Memory/index management. `memory-index-regen.ts` rebuilds index.md from YAML frontmatter. File watcher for context changes. CORTEX.md scanning and injection |
| `monitor/` | GPU and disk resource monitoring |
| `remote/` | Remote device management via WebSocket. SSH-based client deployment, hot-reload via npm update |
| `threads/` | Full thread system: state machine, runner, template loading, prompt building, hook execution, artifact I/O, auto-thread logic |
| `mcp/` | MCP server implementation. 16 Cortex MCP tools across 8 tool modules (see [mcp.md](./mcp.md)) |

### Layer 4: `orchestration/` — Message Routing and Execution

Connects platform messages to domain logic. The hook-bridge (part of this
layer) is detailed in [hooks.md](./hooks.md).

| File | Purpose |
|------|---------|
| `channel-queue.ts` | Per-channel serial Promise queue. Ensures only one agent runs per channel at a time |
| `orchestrator.ts` | Two-branch decision tree: if `!thread` command → `ThreadExecutor`, else → `AgentRunner` (default single-agent path) |
| `agent-runner.ts` | Default-agent execution path. Creates a `default` thread pre-execution, runs it, manages streaming and interactive callbacks |
| `thread-executor.ts` | Thread routing: handles `!thread start`, `!thread add`, thread continuation, user message buffering during running steps |
| `busy-tracker.ts` | Tracks active LLM count, sends IPC `busy`/`idle` to parent daemon process |
| `lifecycle.ts` | Agent success/error handling, edit retry, AskUserQuestion resume, turn tracking |
| `superseded-edits.ts` | Message edit supersede markers |
| `dispatch-reconciler.ts` | Background timer for stale dispatch cleanup |
| `routing/message-router.ts` | Slack message entry point. Parses `!thread` commands, normalizes skill commands, delegates to orchestrator |
| `routing/commands/` | 14 `!command` handlers: `cancel`, `channel`, `cost`, `device`, `dispatch`, `mode`, `nvtop`, `orient`, `schedule`, `sendfile`, `session`, `status`, `tail`, `task`, `thread` |
| `routing/hook-bridge.ts` | PreToolUse hook → EventBus bridge. Publishes `plan.submitted` and `ask-user.requested` |
| `routing/hook-bridge-subscribers.ts` | Subscribers that create Slack modals for questions and send plans to Slack |
| `interactions/` | AskUserQuestion modal flow, plan approval state machine, button/modal action routing |

### Layer 5: `entry/` — Composition Root

| File | Purpose |
|------|---------|
| `app.ts` | **Composition root**. Wires EventBus → logger → hook-bridge → runningExecutions → adapters → commands → interactions → scheduler → remote clients → webhook → memory watcher. Handles SIGTERM graceful shutdown |
| `daemon.ts` | Process supervisor. Forks `app.js`, watches `src/*.ts` for auto-rebuild (when `CORTEX_REPO` is set), watches `.restart` trigger file, crash recovery with exponential backoff (1s→30s max) |
| `cli.ts` | `cortex` CLI entry point. Dispatches to: `init`, `start`, `daemon`, `restart`, `task`, `config`, `setup-gateway` |
| `init.ts` | Interactive first-time initialization |
| `startup-helpers.ts` | Cleanup logs, ensure MCP config |
| `startup-notify.ts` | Send startup DM to admin channel |

## LLM Backend Adapter

The `agent-adapter/` directory abstracts three LLM backends behind a unified interface:

| Backend | Adapter | Notes |
|---------|---------|-------|
| Claude Code | `claude/adapter.ts` | Session pool, `stream-json` mode, TUI mode (tmux + JSONL tail). Spawn-args builder, event parser |
| Codex | `codex/adapter.ts` | RouteRuntime pool, event parser |
| PI | `pi/adapter.ts` | PISession, MCP bridge, hook bridge, tool shims |

A normalization layer (`normalize/`) converts backend-specific events into a unified `NormalizedEvent` stream. The `capabilities.ts` file declares a `Capability` enum with per-backend capability sets (e.g., `Capability.Plugins` is supported by Claude and PI but not Codex).

## Platform Adapter

The `platform/` directory abstracts Slack behind a `PlatformAdapter` interface:

| Method | Purpose |
|--------|---------|
| `start` / `stop` | Lifecycle |
| `onMessage` / `onMessageEdit` / `onAction` / `onModalSubmit` | Event registration |
| `postMessage` / `updateMessage` / `deleteMessage` | Outbound messaging |
| `postInteractive` | Interactive messages with buttons |
| `openModal` | Modals |
| `uploadFile` / `downloadFile` | File operations |
| `addReaction` | Emoji reactions |
| `getPermalink` / `getAdminChannel` | Utility |

`VirtualMessage` handles message aggregation — merging multiple appends into fewer messages with retry delays to avoid rate limits.

## WebSocket Protocol (Server ↔ Client)

The WebSocket protocol is used for **remote device command execution**, not for Slack/agent communication. The server runs a WebSocket server (default port 3002) via `startClientManager()`. For the full cross-machine story — deployment, network topology, and security — see [cross-machine.md](./cross-machine.md).

### Message Flow

1. **Client connects** → sends `{ type: 'hello', device, platform, capabilities }`
2. **Server validates** → checks for duplicate device name (error code `4002` if duplicate)
3. **Heartbeat** → client sends `{ type: 'heartbeat', device, timestamp }` every 5 seconds. Server marks device offline after 15 seconds of silence (code `4003`)
4. **Command dispatch** → server sends `{ type: 'command', commandId, action, params }`. Client executes and replies with `{ type: 'result', commandId, success, data, error }`

### Command Actions

The client supports these remote actions: `bash` (shell execution with timeout/background), `read` (file read with text/image/PDF support), `write` (file write with CRLF detection), `edit` (text replacement with replace_all), `glob` (file glob with VCS exclusion), `grep` (ripgrep with pagination), `cortex-run.launch`, `cortex-run.cancel`.

### Client Architecture

The client (`client/src/client.ts`) is a lightweight WebSocket daemon that maintains a persistent connection. It supports automatic reconnection with exponential backoff (1s→30s max). The `cortex-run-watcher.ts` implements a client-resident watchdog for long-running tasks with two-layer stall detection (output stall and progress stall) and GPU auto-detection via `nvidia-smi`.

## Event Bus Topology

The EventBus is wired in `app.ts` via a singleton-then-inject pattern. Components are constructed with no dependencies, then wired via `setBus(bus)`:

| Component | Publishes | Subscribes |
|-----------|-----------|------------|
| `runningExecutions` | `agent.started/completed/failed/superseded` | — |
| `eventLogger` | `event-logger.dropped` | `'*'` (all events → JSONL) |
| `planApprovals` | `plan.approved` | `plan.submitted` |
| `busyTracker` | — | `llm.active-count-delta` |
| `interactionHandlers` | `ask-user.answered` | `ask-user.requested` |
| `hookBridge` | `plan.submitted`, `ask-user.requested` | — |

## State Storage

Cortex stores all state on the filesystem under `~/.cortex/`. There is no database — everything is JSON files with atomic writes (`tmp + rename`).

| Path | Purpose |
|------|---------|
| `mode.json` | Current runtime mode and profile |
| `profiles.json` | Named agent profile list |
| `schedules.json` | Persistent scheduled task list |
| `sessions.json` | Channel-to-agent session mapping |
| `executions.json` | Unified execution registry |
| `thread-templates.json` | Agent definitions and orchestration templates |
| `threads.json` | Active and historical thread state |
| `tasks/` | Project task queues (TASKS.yaml per project) |
| `costs.jsonl` | Per-call cost records (90-day rolling) |
| `logs/` | Daemon and LLM logs |

## Naming Conventions

- **Thread IDs**: `thr_<8-hex-chars>` (e.g., `thr_a1b2c3d4`)
- **Execution IDs**: `exec_<kind>_<base36-ts>_<4-rand>` (e.g., `exec_local_1a2b3c_xyzw`)
- **Schedule task IDs**: 8 hex characters (from `randomBytes(4)`)
- **Session names**: `cortex-<6-hex-chars>` (e.g., `cortex-a1b2c3`)
- **Task IDs**: 4 hex characters (e.g., `f7cf`)
- **File format**: All TypeScript uses `.ts` with ESM import style (`import { X } from './foo.js'`)
