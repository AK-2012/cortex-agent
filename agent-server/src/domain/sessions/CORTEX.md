Please update me when files in this folder change

Session domain — stateful session lifecycle (CRUD + registry + backup + hooks), not to be confused with the TUI session layer (`tui-session/`).

| filename | role | function |
|---|---|---|
| `session.ts` | persistence | get/set/deleteSessionAsync — re-exports from store/session-repo |
| `session-registry.ts` | persistence | sessionStore re-export + lookupSessionName helper (store/session-registry-repo) |
| `session-backup.ts` | persistence | Claude session JSONL per-turn backup and restore |
| `session-hooks.ts` | lifecycle | Unified onNew/onMessageEnd hook pipeline — spawn + OutputStream display + optional agent injection (onNew pre-close turn runs on an isolated pool key via `onNewInjectSessionKey`, closed after, so `!new` does not resurrect the old session onto the channel slot) |
| `session-lifecycle.ts` | lifecycle | Shared session-lifecycle primitives: registerNamedSession, attachExistingSession, resetChannelSession |
