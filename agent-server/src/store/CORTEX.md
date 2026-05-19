Please update me when files in this folder change

Persistence layer (L1) — 15 store modules: 11 data repos + outbound-queue WAL + json-repository base class + in-memory-repository test implementation + atomic-write tool. All write operations are serialized via AsyncMutex.
task-repo.ts responsibilities are limited to I/O + lock + git sync, does not carry any domain mutation forwarding (mutations have been migrated to domain/tasks/mutator.ts).

| filename | role | function |
|---|---|---|
| `json-repository.ts` | base | Generic JSON file CRUD |
| `in-memory-repository.ts` | base | In-memory implementation for testing |
| `atomic-write.ts` | utility | Atomic write |
| `outbound-queue.ts` | persistence | WAL-based outbound message queue, prevents message loss on restart. Provides durablePost/durableUpdate helper functions |
| `thread-repo.ts` | persistence | Thread state persistence |
| `session-repo.ts` | persistence | Session persistence |
| `conversation-ledger-repo.ts` | persistence | Conversation ledger persistence |
| `session-registry-repo.ts` | persistence | Session registry persistence |
| `execution-repo.ts` | persistence | Execution registry persistence |
| `channel-repo.ts` | persistence | Project → Slack channel mapping |
| `project-dir-repo.ts` | persistence | Project → external code directory mapping |
| `schedule-repo.ts` | persistence | Scheduled task list persistence — ScheduleTask includes target (fresh/channel/session/thread) + fallback (fresh/skip/wait), migrate auto-backfills target=fresh for old records |
| `cost-repo.ts` | persistence | Cost record persistence |
| `profile-repo.ts` | persistence | Agent profile persistence |
| `task-repo.ts` | persistence | load/refresh/flush + read-only queries + runExclusive/commitAndPush. Pure I/O + mutex + git, no domain mutation forwarding |
