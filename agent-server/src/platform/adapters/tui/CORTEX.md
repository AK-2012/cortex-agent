Please update me when files in this folder change

TUI adapter — M1 gateway: PlatformAdapter v2 backed by localhost WebSocket.
Bridges WS connections (M4 protocol) to the PlatformAdapter interface.

| filename | role | function |
|---|---|---|
| `index.ts` | barrel | Re-export TuiGatewayAdapter, TuiConnection, helpers |
| `tui-gateway.ts` | adapter | TuiGatewayAdapter — PlatformAdapter impl + TuiAdapterControls (setBus/setUiService/setSessionService/setConduitQueue), WS server, handshake, inbound dispatch, outbound translation, keepalive. Session lifecycle delegated to injected @domain/tui-session service; `lookupConduit()` exposes in-memory state for app.ts's conduit provider. No @store/@orch imports. |
| `tui-connection.ts` | connection | Per-WS connection — conduitId, activeSessionId, activeProjectId, send/close |
| `tui-conduit-state.ts` | store | In-memory Map<conduitId, TuiConduitState> with helpers |
| `tui-output-stream.ts` | output stream | TuiOutputStream — no coalescing, emits stream.* WS frames |
| `tui-transcript.ts` | transcript | Pure synchronous transcript replay formatter (no @store deps) — TranscriptData → TranscriptReplay | null |
| `tui-notifications.ts` | notifications | Project-report / system-notice fan-out routing |
| `ports.ts` | port types | Pure structural boundary types — TranscriptTurn, TranscriptData, ConduitQueuePort (zero layer imports) |
