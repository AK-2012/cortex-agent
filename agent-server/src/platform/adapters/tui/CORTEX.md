Please update me when files in this folder change

TUI adapter — M1 gateway: PlatformAdapter v2 backed by localhost WebSocket.
Bridges WS connections (M4 protocol) to the PlatformAdapter interface.

| filename | role | function |
|---|---|---|
| `index.ts` | barrel | Re-export TuiGatewayAdapter, TuiConnection, helpers |
| `tui-gateway.ts` | adapter | TuiGatewayAdapter — PlatformAdapter impl + TuiAdapterControls (setBus/setUiService), WS server, handshake, inbound dispatch, outbound translation, keepalive |
| `tui-connection.ts` | connection | Per-WS connection — conduitId, activeSessionId, activeProjectId, send/close |
| `tui-conduit-state.ts` | store | In-memory Map<conduitId, TuiConduitState> with helpers |
| `tui-output-stream.ts` | output stream | TuiOutputStream — no coalescing, emits stream.* WS frames |
| `tui-transcript.ts` | transcript | Transcript replay assembly from conversation-ledger |
| `tui-notifications.ts` | notifications | Project-report / system-notice fan-out routing |
