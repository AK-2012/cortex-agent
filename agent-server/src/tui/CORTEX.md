Please update me when files in this folder change

M5 Ink TUI client — chat-only terminal client speaking M4 protocol. Zero imports from domain/, orchestration/, store/, agent-adapter/.

| File | Role | Function |
|---|---|---|
| `index.tsx` | entry | Argv parse → connect → render `<App>`. Handles --resume/--project/--port. Sends handshake.hello on connect. |
| `App.tsx` | layout | Top-level `<Box>` layout with Header + Transcript + InputBox + StatusLine. Wires hooks and frame dispatch. |
| `ws-client.ts` | ws class | Typed WS client wrapping M4 protocol. Exponential backoff: 250/500/1k/2k/4k/8k/30s cap. Retry sends resume. |
| `components/Header.tsx` | header bar | ProjectId + sessionName + connected indicator + queued count. |
| `components/Transcript.tsx` | transcript | Scrollable message list anchored to bottom. Scroll-up freezes auto-scroll. Render scroll hint when scrolled up. |
| `components/MessageRow.tsx` | message row | Renders text + RichBlock[] + stream segments + queued indicator. |
| `components/InputBox.tsx` | input | Multi-line input via ink-text-input `UncontrolledTextInput`. Submit on Enter, cancel on Esc. |
| `components/StatusLine.tsx` | status bar | Connection state / queued count / error / reconnect / notification count. Phase 2 stub hints. |
| `hooks/useWsClient.ts` | ws hook | React wrapper around WsClient — connection lifecycle + frame stream. Sends handshake.hello on mount. |
| `hooks/useTranscript.ts` | data hook | Map<messageId, RenderedMessage> for O(1) chat.update. Parallel id[] for insertion order. 30ms batch coalescing for stream.text. |
| `hooks/useKeybindings.ts` | key handler | Global key handler via `useInput`. Dual Ctrl+C within 1s exits; Ctrl+L clears; ↑/↓/PgUp/PgDn scroll. |
| `render/markdown.ts` | md parser | Minimal inline markdown: `**bold**`, `*italic*`, `` `code` ``, `[text](url)`. |
| `render/rich-blocks.tsx` | block renderer | RichBlock[] discriminated union → `<Box>`/`<Text>` elements. Actions → placeholder 'Phase 2'. |
