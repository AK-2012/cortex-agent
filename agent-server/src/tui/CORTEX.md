Please update me when files in this folder change

M5 Ink TUI client — chat+dashboard terminal client speaking M4 protocol. Zero imports from domain/, orchestration/, store/, agent-adapter/.

| File | Role | Function |
|---|---|---|
| `index.tsx` | entry | Argv parse → connect → render `<App>`. Handles --resume/--project/--port. Sends handshake.hello on connect. Interactive session picker for --resume. |
| `App.tsx` | layout | Top-level layout with Header + Transcript + SidePanel + InputBox + StatusLine + modals. Wires hooks, frame dispatch routing (transcript/dashboard/notifications). |
| `ws-client.ts` | ws class | Typed WS client wrapping M4 protocol. Exponential backoff: 250/500/1k/2k/4k/8k/30s cap. Retry sends resume. |
| `components/Header.tsx` | header bar | ProjectId + sessionName + connected indicator + queued count + notification count + cost summary. |
| `components/Transcript.tsx` | transcript | Scrollable message list anchored to bottom. Scroll-up freezes auto-scroll. Render scroll hint when scrolled up. |
| `components/MessageRow.tsx` | message row | Renders text + RichBlock[] + stream segments + queued indicator. |
| `components/InputBox.tsx` | input | Multi-line input via ink-text-input `UncontrolledTextInput`. Submit on Enter, cancel on Esc. |
| `components/ConfirmModal.tsx` | confirm modal | Destructive action confirmation — y/Enter confirm, n/Esc cancel. Optional `reasonInput` renders TextInput with `onConfirm(reason)`. |
| `components/StatusLine.tsx` | status bar | Connection state / queued count / error / reconnect / notification count. Key hints: Ctrl+D Dashboard, Ctrl+N Notifications, Ctrl+P Projects. |
| `components/SidePanel.tsx` | side panel | Ctrl+D toggle host. Right-side box containing Dashboard. Does not block input focus when shown. |
| `components/Dashboard.tsx` | dashboard | Tab-cycled panel: Threads/Tasks/Schedules/Executions/Cost. Tab key cycles, per-tab query/subscribe lifecycle. |
| `components/DashboardThreadsTab.tsx` | threads tab | Thread list with status icon, template name, step progress. |
| `components/DashboardTasksTab.tsx` | tasks tab | Task list with status/priority/text/claimed. Disabled mutation buttons (Phase 3). |
| `components/DashboardSchedulesTab.tsx` | schedules tab | Schedule list with type/nextRun/paused. Disabled mutation buttons (Phase 3). |
| `components/DashboardExecutionsTab.tsx` | executions tab | Execution list with status/type/machine/duration/cost. Disabled mutation buttons (Phase 3). |
| `components/DashboardCostTab.tsx` | cost tab | Cost summary: total/monthly/daily by model, budget remaining. |
| `components/Notifications.tsx` | notifications | Corner badge (`🔔 N`) + Enter-to-open modal listing active notifications. ↑/↓ navigate, Enter detail, Esc close. |
| `components/ProjectSwitcher.tsx` | project switcher | Ctrl+P modal: list projects via ui.query 'projects.list', select to send session.switch. |
| `components/SessionPicker.tsx` | session picker | --resume mode: list resumable sessions, ↑/↓/Enter to select. |
| `hooks/useWsClient.ts` | ws hook | React wrapper around WsClient — connection lifecycle + frame stream. Sends handshake.hello on mount. |
| `hooks/useTranscript.ts` | data hook | Map<messageId, RenderedMessage> for O(1) chat.update. Parallel id[] for insertion order. 30ms batch coalescing for stream.text. |
| `hooks/useKeybindings.ts` | key handler | Global key handler via `useInput`. Ctrl+C (dual exits), Ctrl+L clear, ↑/↓/PgUp/PgDn scroll. Ctrl+D side panel, Ctrl+N notifications, Ctrl+P projects. |
| `hooks/useNotifications.ts` | notif hook | Map<id, NotificationEntry> ring buffer cap 50. Pure helpers `_addNotification`/`_markRead`/`_clearNotifications`. Exposes unreadCount. |
| `hooks/useDashboardData.ts` | dashboard hook | Per-tab state: ui.query on focus, subscribe to events, re-render on ui.event. Pure helpers: `_handleQueryResult`/`_handleEvent`/`_createPendingQuery`/`_clearPendingQuery`. |
| `hooks/useMutate.ts` | mutate hook | Async action hook for ui.mutate request/response — sends mutate frames, matches results by crypto.randomUUID() id, 10s timeout, cleanup on unmount. Returns `{mutate, handleFrame}`. |
| `render/markdown.ts` | md parser | Minimal inline markdown: `**bold**`, `*italic*`, `` `code` ``, `[text](url)`. |
| `render/rich-blocks.tsx` | block renderer | RichBlock[] discriminated union → `<Box>`/`<Text>` elements. Actions → placeholder 'Phase 2'. |
