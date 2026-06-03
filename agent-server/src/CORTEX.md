Please update me when files in this folder change

agent-server's TypeScript ESM runtime source, organized by six-layer structure (S12, plan/agent-server-decouple.md §2).

| Layer | Directory | Function |
|---|---|---|
| L0 | `core/` | Zero dependency: types, path constants, async-mutex, json-repository, atomic-write, CLI utilities |
| L1 | `store/` | Persistence: 11 JsonRepository implementations |
| L2 | `events/` | Event bus: EventBus + daily rolling jsonl + debug replay CLI |
| L3 | `domain/` | Domain services: agents/sessions/tasks/executions/costs/scheduling/system/memory/monitor/remote/mcp/threads |
| L4 | `orchestration/` | Orchestration layer: orchestrator/agent-runner/thread-executor/busy-tracker + routing/ + interactions/ |
| L5 | `entry/` | Entry points: app.ts / daemon.ts / startup-helpers / startup-notify |

### L0: core/
`async-mutex.ts` `atomic-write.ts` `json-repository.ts` `paths.ts` `version.ts` `cli-utils.ts` `utils.ts` `status-format.ts` `running-executions.ts` `task-parser.ts` `types/agent-types.ts` `types/thread-types.ts`

### L1: store/
`in-memory-repository.ts` + 11 repos: `thread-repo` `session-repo` `conversation-ledger-repo` `session-registry-repo` `execution-repo` `project-dir-repo` `schedule-repo` `cost-repo` `profile-repo` `task-repo` + `outbound-queue` (WAL)
Project→conduit mapping (formerly `channel-repo.ts`) has moved into `platform/adapters/slack-project-conduits.ts` — owned by the Slack adapter, since project-report rendering is adapter-specific.

### L2: events/
`event-bus.ts` `event-types.ts` `event-logger.ts` `event-replay.ts` `index.ts`

### L3: domain/
| Subdirectory | Files |
|---|---|
| `agents/` | `config.ts` `facade.ts` `profile-manager.ts` `index.ts` |
| `sessions/` | `session.ts` `session-registry.ts` `session-backup.ts` `session-hooks.ts` (unified onNew/onMessageEnd hook pipeline — spawn + OutputStream display + optional agent injection) |
| `tasks/` | `parser.ts` `lint.ts` `archiver.ts` `dispatcher.ts` `dispatch-utils.ts` `pending-tracker.ts` `store.ts` `recommendation/` `system/` |
| `executions/` | `registry.ts` |
| `costs/` | `cost-tracker.ts` `gateway-manager.ts` `rate-limit-parser.ts` `rate-limit-throttle.ts` `codex-usage-monitor.ts` `codex-event-format.ts` |
| `scheduling/` | `scheduler.ts` `runner.ts` `job-registry.ts` `schedule-command.ts` `schedule-cli.ts` `jobs/` (includes `target-dispatch.ts` 4-way fresh/channel/session/thread decision) |
| `memory/` | `index-regen.ts` `consolidate.ts` `watcher.ts` `skill-scanner.ts` `claude-md-scanner.ts` `claude-md-injector.ts` |
| `monitor/` | `gpu-monitor.ts` `disk-monitor.ts` |
| `remote/` | `client-manager.ts` `client-bootstrap.ts` `client-hot-reload.ts` `cortex-client.ts` |
| `system/` | `update-state.ts` (DR-0013 update-state I/O) |
| `threads/` | `index.ts` `utils.ts` `artifact-io.ts` `template-loader.ts` `prompt-builder.ts` `state-machine.ts` `runner.ts` `hook-runner.ts` `auto-thread.ts` `template-resolver.ts` |
| `mcp/` | `server.ts` + `tools/slack.ts` `cost.ts` `executions.ts` `task-ops.ts` `context.ts` `schedule.ts` (16 tools total) |

### L4: orchestration/
| Path | Function |
|---|---|
| `running-executions.ts` | Unified live-execution registry, keyed by executionId (byKey/byThreadId/byChannel) + agent.* event publishing |
| `conduit-queue.ts` | Per-conduit serial Promise queue |
| `superseded-edits.ts` | Message edit supersede marker |
| `busy-tracker.ts` | activeLlmCount + IPC busy/idle (S13: subscriber-as-source-of-truth) |
| `orchestrator.ts` | Two-branch decision tree (thread-match / default) |
| `agent-runner.ts` | runAgent + lifecycle wrapper |
| `thread-executor.ts` | Thread routing wrapper |
| `lifecycle.ts` | Agent success/failure/recovery/retry |
| `dispatch-reconciler.ts` | stale dispatch cleanup timer (S13: extracted from app.ts) |
| `routing/message-router.ts` | Slack message entry thin layer |
| `routing/webhook.ts` | GitHub/task-op/hook webhook |
| `routing/hook-bridge.ts` | PreToolUse hook ↔ EventBus bridge |
| `routing/hook-bridge-subscribers.ts` | ask-user.requested / plan.submitted subscribers (S13: extracted from app.ts) |
| `routing/edit-handler.ts` | Slack message edit orchestration |
| `routing/file-handler.ts` | Slack file download and classification |
| `routing/commands/` | 14 !command handlers |
| `interactions/` | ask-user-question / plan-handler / plan-approvals / interaction-handlers |
| `status-helpers.ts` | execution / status-message / streaming-VM helpers (pure subset has been sunk to `core/status-format.ts`) |

### L5: entry/
`app.ts` (composition root, S13: <200 lines) `daemon.ts` `startup-helpers.ts` `startup-notify.ts`

### Other static directories
| Directory | Contents |
|---|---|
| `agent-adapter/` | Claude/Codex/PI three-backend abstraction layer (unchanged) |
| `platform/` | Platform abstraction layer Slack/Feishu (unchanged) + `tool-trace.ts` (UI helper for OutputStream tool traces) |
| `tui/` | Ink TUI client (M5) — chat-only terminal client speaking M4 protocol (ws-client, hooks, components, render utilities) |
| `hooks/` | Thread lifecycle hook scripts (unchanged) |
