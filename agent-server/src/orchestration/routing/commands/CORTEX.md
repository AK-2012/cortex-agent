# orch/routing/commands/ — !Command dispatcher

Per-command-family handler files split from `command-handlers.ts` ([S10-B]). Each file is ≤200 LoC and handles one family of `!` Slack commands.

| File | Commands | Dependency |
|------|----------|------------|
| `index.ts` | Aggregator: `registerCommands(deps)` → `dispatchCommand` | All below |
| `orient.ts` | `!orient` | None (placeholder) |
| `thread.ts` | `!thread` | Re-exports from `command-thread-handlers.ts` |
| `schedule.ts` | `!schedule` | Re-exports from `schedule-command.ts` (needs scheduler dep) |
| `cost.ts` | `!cost`, `!budget` | `cost-tracker` |
| `task.ts` | `!tasks` | `task-parser` |
| `mode.ts` | `!mode`, `!backend`, `!model`, `!profile`, `!skills`, `!agent` | `mode-manager`, `profile-manager`, `skill-scanner` |
| `status.ts` | `!status`, `!help` | `status` needs `getExecutionStatusReport` dep |
| `cancel.ts` | `!cancel` | `running-executions`, `channel-queue`; needs `cancelDispatchedTask` dep |
| `nvtop.ts` | `!nvidia-smi`, `!nvtop` | `gpu-monitor`, `dispatch-utils`, `client-manager` |
| `session.ts` | `!new`, `!newq`, `!resume` | `claude-bridge`, `session-registry-repo`, `conversation-ledger`, `domain/sessions/session-hooks` |
| `channel.ts` | `!projects`, `!register`, `!unregister`, `!project-dir` | `channel-repo`, `project-dir-repo` |
| `device.ts` | `!devices`, `!clients` | `client-manager`, `dispatch-utils` |
| `tail.ts` | `!tail` | `fs` (daemon.log tail) |
| `sendfile.ts` | `!sendFile` | `dispatch-utils`, `scp` |

Each handler signature: `(channel: string, adapter: PlatformAdapter, trimmedMessage: string) => Promise<void>`.
Handlers needing injected deps use a `createXxxHandler(deps)` factory in index.ts.
