Please update me when files in this folder change

PlatformAdapter's concrete platform implementations. Each adapter is a thin bridge, unified to the PlatformAdapter interface.

| filename | role | function |
|---|---|---|
| `index.ts` | factory | Select adapter by CORTEX_PLATFORM |
| `slack.ts` | adapter | Slack Bolt + WebClient implementation (updateMessage has built-in per-message ≥1.1s throttle to prevent chat.update 429; gains `openOutputStream` + project conduit methods in S1) |
| `slack-output-stream.ts` | output stream | SlackOutputStream — full VirtualMessage logic port: coalescing, mutable tail, table/HR split heuristics, retry backoff, pendingEdits-based `updateMessage` |
| `slack-project-conduits.ts` | store | File-backed project→conduit mapping (JsonRepository + STORE_DIR/channel-registry.json) |
| `feishu.ts` | adapter | Feishu SDK + WSClient implementation (gains `openOutputStream` + project conduit methods in S1) |
| `feishu-output-stream.ts` | output stream | FeishuOutputStream — no messageEdit/coalescing; each emitText posts separately; openMutable is a no-op |
