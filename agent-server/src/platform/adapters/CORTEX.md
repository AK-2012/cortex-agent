Please update me when files in this folder change

PlatformAdapter's concrete platform implementations. Each adapter is a thin bridge, unified to the PlatformAdapter interface.

| filename | role | function |
|---|---|---|
| `index.ts` | factory | Select adapter by CORTEX_PLATFORM |
| `slack.ts` | adapter | Slack Bolt + WebClient implementation (updateMessage has built-in per-message ≥1.1s throttle to prevent chat.update 429; gains `openOutputStream` + project conduit methods in S1) |
| `slack-output-stream.ts` | output stream | SlackOutputStream — coalescing OutputStream for Slack: content coalescing, mutable tail, table/HR split heuristics, retry backoff, pendingEdits-based `updateMessage` |
| `slack-project-conduits.ts` | store | File-backed project→conduit mapping (JsonRepository + STORE_DIR/channel-registry.json) |
| `feishu.ts` | adapter | Feishu SDK + WSClient implementation (gains `openOutputStream` + project conduit methods in S1) |
| `feishu-output-stream.ts` | output stream | FeishuOutputStream — no messageEdit/coalescing; each emitText posts separately; openMutable is a no-op |
| `tui/` | subdirectory | TUI gateway adapter — PlatformAdapter v2 backed by localhost WebSocket (M1: handshake, session binding, inbound dispatch, outbound translation, keepalive, M4 protocol) |
| `composite-adapter.ts` | adapter | CompositeAdapter wrapping primary + TUI gateway behind one PlatformAdapter v2 surface; FanOutOutputStream for project-report fan-out; extractTuiAdapter |
