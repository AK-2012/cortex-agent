Please update me when files in this folder change

PlatformAdapter's concrete platform implementations. Each adapter is a thin bridge, unified to the PlatformAdapter interface.

**Multi-platform conduit prefixing**: Slack/Feishu/TUI can run simultaneously behind `CompositeAdapter`. Each adapter exposes conduits in a canonical prefixed form (`slack:`, `feishu:`, `tui-`) at its boundary and strips the prefix before calling its SDK / reading-writing its bare-id registry. Routing uses `ownsConduit(conduit)`. See `composite-adapter.ts`.

| filename | role | function |
|---|---|---|
| `index.ts` | factory | Select & compose adapters by CORTEX_PLATFORM (comma list, e.g. `slack,feishu`) / CORTEX_TUI — `createPrimaryAdaptersFromEnv` (N primaries) + `createAdapterFromEnv` (0→throw, 1→bare, ≥2→composite). `createPrimaryAdapterFromEnv` kept as back-compat shim |
| `slack.ts` | adapter | Slack Bolt + WebClient implementation (updateMessage has built-in per-message ≥1.1s throttle to prevent chat.update 429; `openOutputStream` + project conduit methods; `slack:`-prefixes conduits at the boundary) |
| `slack-output-stream.ts` | output stream | SlackOutputStream — coalescing OutputStream for Slack: content coalescing, mutable tail, table/HR split heuristics, retry backoff, pendingEdits-based `updateMessage` |
| `project-conduits.ts` | store | Platform-agnostic file-backed project→conduit mapping (JsonRepository; filePath defaults to STORE_DIR/channel-registry.json, Feishu passes feishu-channel-registry.json) |
| `slack-project-conduits.ts` | store | Backward-compat alias: re-exports `ProjectConduitsStore` as `SlackProjectConduitsStore` |
| `feishu.ts` | adapter | Feishu SDK + WSClient implementation (project-report routes via ProjectConduitsStore; inbound files parsed from content JSON; downloadFile uses messageResource.get; form values typed via name suffix; `feishu:`-prefixes conduits at the boundary) |
| `feishu-output-stream.ts` | output stream | FeishuOutputStream — coalesces streamed text into one growing card via card patch (im.v1.message.patch); openMutable is a real region (tool-call traces render); overflow chunks thread under the first message (reply_in_thread, Slack-style) |
| `tui/` | subdirectory | TUI gateway adapter — PlatformAdapter v2 backed by localhost WebSocket (M1: handshake, session binding, inbound dispatch, outbound translation, keepalive, M4 protocol) |
| `composite-adapter.ts` | adapter | CompositeAdapter wrapping N sub-adapters (Slack/Feishu/TUI) behind one PlatformAdapter surface; routes outbound by `ownsConduit` prefix; system-notice fans out to real primaries, project-report fans out by binding; FanOutOutputStream; extractTuiAdapter |
