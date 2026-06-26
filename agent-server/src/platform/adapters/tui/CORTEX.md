Please update me when files in this folder change

TUI adapter — M1 gateway: PlatformAdapter v2 backed by localhost WebSocket.
Bridges WS connections (M4 protocol) to the PlatformAdapter interface.

| filename | role | function |
|---|---|---|
| `index.ts` | barrel | Re-export TuiGatewayAdapter, TuiConnection, helpers |
| `tui-gateway.ts` | adapter | TuiGatewayAdapter — PlatformAdapter impl + TuiAdapterControls (setBus/setUiService/setSessionService/setConduitQueue), WS server, handshake, inbound dispatch, outbound translation, keepalive. **Lazy session creation**: a no-resume handshake mints NO session (emits no `session.switched`) so merely opening the TUI never creates an empty `cortex-XXXX`; the first `msg.user` calls `_ensureSession` to mint + announce it. Resume handshakes (reconnect carries `resume.sessionId`) still re-attach via the session service. `lookupConduit()` exposes in-memory state for app.ts's conduit provider. No @store/@orch imports. |
| `tui-connection.ts` | connection | Per-WS connection — conduitId, activeSessionId, activeProjectId, send/close |
| `tui-conduit-state.ts` | store | In-memory Map<conduitId, TuiConduitState> with helpers |
| `tui-output-stream.ts` | output stream | TuiOutputStream — no coalescing, emits stream.* WS frames |
| `tui-transcript.ts` | transcript | Pure synchronous transcript replay formatter (no @store deps) — message-based TranscriptData → TranscriptReplay. Renders user (`**You:** …`, which the client strips + grey-highlights), assistant (real text), and tool (dim `· ToolName` context) messages. |
| `tui-notifications.ts` | notifications | Project-report / system-notice fan-out routing |
| `ports.ts` | port types | Pure structural boundary types — TranscriptMessage (role: user/assistant/tool), TranscriptData (message list), ConduitQueuePort (zero layer imports) |
