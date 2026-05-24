Please update me when files in this folder change

Server auto-update domain layer (DR-0013). Platform-agnostic interfaces and data types for
the auto-update subsystem. Platform-specific implementations (Slack, Feishu, TUI) live in
orchestration/interactions/.

| filename | role | function |
|---|---|---|
| `update-prompt.ts` | interface | UpdateChoice type + UpdatePrompt interface with ask(spec) method |
