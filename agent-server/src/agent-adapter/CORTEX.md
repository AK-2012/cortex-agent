Please update me when files in this folder change

Agent abstraction layer: decouples Cortex core from the three backend CLIs: Claude Code / Codex / PI.
Unified NormalizedEvent event schema and AgentAdapter contract.

| filename | role | function |
|---|---|---|
| `index.ts` | entry | getAdapter(backend) dispatch + centralized symbol export |
| `types.ts` | contract | AgentAdapter/AgentProcess/SpawnConfig types |
| `capabilities.ts` | capabilities | Capability enum + per-backend capability set |
| `normalize/event-types.ts` | event types | NormalizedEvent discriminated union |
| `normalize/event-stream.ts` | queue | createEventStream single-producer FIFO |
| `normalize/tool-names.ts` | tool name table | canonical ↔ backend-native bidirectional mapping |
| `normalize/hooks.ts` | hook contract | NormalizedHookSpec + trigger types |
| `claude/adapter.ts` | adapter | ClaudeAdapter + session pool + runClaude |
| `claude/defaults.ts` | constants | timeout/MCP/tools/hooks constants |
| `claude/hooks-builder.ts` | builder | buildHooksSettings generates hook configuration |
| `claude/tool-summarizers.ts` | summarizer | summarizeToolInput tool input rendering |
| `claude/spawn-args.ts` | args | buildSpawnArgs constructs CLI args |
| `claude/event-parser.ts` | parser | stream-json event parsing + plan tracking |
| `claude/tmux-control.ts` | utility | tmux CLI wrapper (DR-0012 Phase 1, TUI mode foundation) |
| `claude/jsonl-tail.ts` | utility | session jsonl file tail + NormalizedEvent translation (DR-0012 Phase 1) |
| `claude/cost-from-usage.ts` | pricing | reverse-derive USD cost from message.usage tokens (DR-0012 Phase 1) |
| `claude/adapter-tui.ts` | adapter | ClaudeTuiSession — interactive Claude under tmux + jsonl tail (DR-0012 Phase 2) |
| `codex/adapter.ts` | adapter | CodexAdapter + RouteRuntime pool |
| `codex/event-parser.ts` | parser | codexEventToNormalized translation |
| `pi/agent-dir.ts` | config | PI agent directory constants (data/pi/models.json + logs/sessions-pi/) + models.json auto-write |
| `pi/adapter.ts` | adapter | PIAdapter + PISession + switch_session |
| `pi/event-parser.ts` | parser | piRpcLineToNormalized translation |
| `pi/framing.ts` | framing | LF-only NDJSON encoding and splitter |
| `pi/spawn-args.ts` | args | buildSpawnArgs constructs pi CLI args |
| `pi/mcp-bridge.ts` | extension | Bridge PI to Cortex MCP server |
| `pi/hook-bridge.ts` | extension | Bridge PI tool events to hooks/*.mjs |
| `pi/tool-shims.ts` | extension | ask/exit_plan/todo pseudo tool registration |
| `pi/pi-ext-types.ts` | types | Minimal TS type stub for PI SDK |
