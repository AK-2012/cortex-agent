Please update me when files in this folder change

Domain layer (L3) directory — established according to the six-layer structure of plan/agent-server-decouple.md §2.
Currently only has threads/ subdirectory; subsequent S8-S11 will gradually add agents / sessions / tasks / executions, etc.

| subdirectory | status | function |
|---|---|---|
| `threads/` | [S7] DONE | Thread lifecycle, prompt building, config loading, artifact I/O |
| `agents/` | [S11] DONE | Agent execution facade (config.ts + facade.ts) + bridge export, replaces claude-bridge/codex-bridge shim |
| `tasks/` | [S2] DONE | Task system: parser (read path, core in core/task-parser.ts), mutator (write path, 17 mutations), dispatcher, archiver, recommendation |
| `executions/` | [S14] DONE | Execution registry re-export layer (registry.ts) — wraps ExecutionRepo terminal transitions with lock-release side effect |
| `scheduling/` | [S9] DONE | Scheduled task scheduling: job-registry + 4 job runners (scheduled-task / task-dispatch / memory-index-regen / task-archive) + jobs/target-dispatch.ts (4-way decision tree) |
