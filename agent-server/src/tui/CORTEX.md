Please update me when files in this folder change

M5 Ink TUI client — chat+dashboard terminal client speaking M4 protocol. Zero imports from domain/, orchestration/, store/, agent-adapter/.

| File | Role | Function |
|---|---|---|
| `index.tsx` | entry | Argv parse → connect → render `<App>`. Handles --resume/--project/--port. Sends handshake.hello on connect. Interactive session picker for --resume. |
| `App.tsx` | layout | Top-level layout with Header + Transcript + SidePanel + InputBox + StatusLine + modals. Wires hooks, frame routing. Computes `focusZone` (modal/dashboard/input) for keyboard arbitration; `awaitingResponse` blocks send until an agent response frame arrives (then clears queuedCount). |
| `logic.ts` | pure logic | Testable helpers: `computeFocusZone`, `isAgentResponseFrame`, `collectStreamText`, `computeVisibleWindow`. Imported by App/Transcript/MessageRow. |
| `ws-client.ts` | ws class | Typed WS client wrapping M4 protocol. Exponential backoff: 250/500/1k/2k/4k/8k/30s cap. Retry sends resume. Settles to 'disconnected' on backoff-cap so the UI shows the retry hint. |
| `components/Header.tsx` | header bar | ProjectId + sessionName + connected indicator + queued count + notification count + cost summary. |
| `components/Transcript.tsx` | transcript | Bottom-anchored viewport (height from `useStdout().rows`) via `computeVisibleWindow`. Auto-sticks to bottom on new messages unless the user scrolled up (`userScrolledUpRef`). "↑ N more above" hint. |
| `components/MessageRow.tsx` | message row | Renders text + RichBlock[] + streamed text (joined via `collectStreamText`, single flowing `<Text>`) + queued indicator. |
| `components/InputBox.tsx` | input | Controlled ink-text-input `TextInput`. Always typeable; `awaitingResponse` blocks Enter-send while preserving text; `focus` prop set false when dashboard/modal owns the keyboard. |
| `components/AskUserModal.tsx` | modal | Renders modal.open frames: section/select/multi_select/text_input per M4 spec. ↑/↓ navigate, number keys select, Space toggles multi, Enter confirms. Builds modal.submit values and sends via sendFrame. Displays modal.ack errors inline. |
| `components/PlanFeedbackModal.tsx` | modal | Plan-approval modal variant: plan text (scrollable section) + 3 numbered radio options (Approve/Feedback/Cancel) with hot-keys 1/2/3. Feedback sub-mode for text input. Arrow navigation, Enter/close. App.tsx dispatches when callbackId starts with 'plan'. |
| `components/ConfirmModal.tsx` | confirm modal | Destructive action confirmation — y/Enter confirm, n/Esc cancel. Optional `reasonInput` renders TextInput with `onConfirm(reason)`. |
| `components/StatusLine.tsx` | status bar | Connection state / queued count / error / reconnect / notification count. Key hints: Ctrl+D Dashboard, Ctrl+N Notifications, Ctrl+P Projects. |
| `components/SidePanel.tsx` | side panel | Ctrl+D toggle host. Right-side box containing Dashboard. Passes `active` (focusZone==='dashboard') so the dashboard owns the keyboard while shown. |
| `components/Dashboard.tsx` | dashboard | Tab-cycled panel: Threads/Tasks/Schedules/Executions/Cost. Tab key cycles (gated on `active`), per-tab query/subscribe lifecycle. `active` threaded to each tab's `useInput`. |
| `components/DashboardThreadsTab.tsx` | threads tab | Thread list with status icon, template name, step progress. ↑/↓ focus, [c] cancel → ConfirmModal → threads.cancel mutate. Inline "(already finished)" feedback on already-terminal error (5s auto-clear). |
| `components/DashboardTasksTab.tsx` | tasks tab | Task list with status/priority/text/claimed. ↑/↓ focus, [c] claim, [u] unclaim, [d] done (ConfirmModal), [b] block (ConfirmModal+reason), [B] unblock → ui.mutate tasks.*. 5s auto-clear error state. |
| `components/DashboardSchedulesTab.tsx` | schedules tab | Schedule list with type/nextRun/paused. ↑/↓ focus, [p] pause, [r] resume, [x] remove (ConfirmModal) → ui.mutate schedules.*. |
| `components/DashboardExecutionsTab.tsx` | executions tab | Execution list with status/type/machine/duration/cost. ↑/↓ focus, [c] cancel (ConfirmModal) → ui.mutate executions.cancel. 5s auto-clear 'not found' feedback. |
| `components/DashboardCostTab.tsx` | cost tab | Cost summary: total/monthly/daily by model, budget remaining. |
| `components/Notifications.tsx` | notifications | Corner badge (`🔔 N`) + Enter-to-open modal listing active notifications. ↑/↓ navigate, Enter detail, Esc close. |
| `components/ProjectSwitcher.tsx` | project switcher | Ctrl+P modal: list projects via ui.query 'projects.list', select to send session.switch. |
| `components/SessionPicker.tsx` | session picker | --resume mode: list resumable sessions, ↑/↓/Enter to select. |
| `hooks/useWsClient.ts` | ws hook | React wrapper around WsClient — connection lifecycle + frame stream. Sends handshake.hello on mount. |
| `hooks/useTranscript.ts` | data hook | Map<messageId, RenderedMessage> for O(1) chat.update. Parallel id[] for insertion order. 30ms batch coalescing for stream.text. Orphan stream frames on an empty transcript create a synthetic `stream:<id>` message so replies aren't dropped. |
| `hooks/useKeybindings.ts` | key handler | Global key handler via `useInput`. Ctrl+C (dual exits), Ctrl+L clear, ↑/↓/PgUp/PgDn scroll, R reconnect. Ctrl+D/N/P toggles. 3rd arg `opts`: `allowScroll` (gates scroll/clear when another zone owns nav), `allowReconnect`. |
| `hooks/useNotifications.ts` | notif hook | Map<id, NotificationEntry> ring buffer cap 50. Pure helpers `_addNotification`/`_markRead`/`_clearNotifications`. Exposes unreadCount. |
| `hooks/useDashboardData.ts` | dashboard hook | Per-tab state: ui.query on focus, subscribe to events, re-render on ui.event. Pure helpers: `_handleQueryResult`/`_handleEvent`/`_createPendingQuery`/`_clearPendingQuery`. |
| `hooks/useMutate.ts` | mutate hook | Async action hook for ui.mutate request/response — sends mutate frames, matches results by crypto.randomUUID() id, 10s timeout, cleanup on unmount. Returns `{mutate, handleFrame}`. |
| `render/markdown.ts` | md parser | Minimal inline markdown: `**bold**`, `*italic*`, `` `code` ``, `[text](url)`. |
| `render/rich-blocks.tsx` | block renderer | RichBlock[] discriminated union → `<Box>`/`<Text>` elements. Actions → placeholder 'Phase 2'. |
