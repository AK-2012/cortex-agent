# features/approvals/ — approval center overlay (7a)

Stage-R3. The **approval center** overlay — a centered 1120×700 modal
reproduced **1:1** from `design/ref/prototype.dc.html` L1317-1405 (+ shared backdrop L1292), diffed vs
`design/proto-shots/03-approval-center.png` (and the deny-armed footer vs `20-approval-deny-armed.png`,
which is the *inline card* deny state — the overlay's own deny-armed follows the source `apd.armed`
branch: feedback input + Cancel + Confirm reject). Wired to the **real** `approvals.*` ui-service scope
(paired backend scope): `approvals.list` for the queue, `approvals.approve` / `approvals.reject`
for a decision that flips the target entry's Status line in `~/.cortex/context/PENDING_APPROVALS.md`
(the mutate never runs the underlying operation) → the list re-invalidates for a live refresh.

| path | role |
|---|---|
| `approval-center-vm.ts` | **Pure** VM (TDD): `statusPill(status)` (amber/green/red), `pendingLabel(n)` (singular/plural), `toListCard` / `toDetail` (real ApprovalInfo → the prototype slots, missing fields → `—`/omit, `hasCommand` gate), `defaultSelectedId`. Framework-free. |
| `approval-center-vm.test.ts` | vitest unit tests (TDD — written first, watched red, 17 tests). |
| `ApprovalCenterModal.tsx` | The **1:1 overlay**. `ApprovalCenterView` (exported, pure presentational — backdrop + panel + header + PENDING·N list + detail + footer; render-tested) and the `ApprovalCenterModal` container that binds `approvals.list({status:'pending'})`, selection + armed/feedback state, `approvals.approve`/`approvals.reject` mutations (invalidate + toast), and Escape-close. `data-approval-center` / `data-approval-id` / `data-approval-feedback` / `data-action="arm\|cancel\|approve\|reject"` for E2E. |
| `approval-center-render.test.tsx` | `react-dom/server` structural checks of `ApprovalCenterView` (header/path/PENDING·N/grid/COMMAND/footer/armed/empty — 9 tests). |
| `ApprovalsProvider.tsx` | Global mount + `useApprovals()` context (`open()`/`close()`). One modal instance; the left-rail banner + inline chat approval card open it. Mounted in `shell/AppShell` (mirrors the ⌘K palette / exec-log-drawer mounts). |

## Triggers

- `features/workbench/LeftRail` — the "N approval pending" banner now uses the real
  `approvals.list({status:'pending'})` count and calls `useApprovals().open()` (was GAP-1, hidden).
- `features/workbench/ApprovalCard` — the inline chat approval card is a click-through trigger into
  the overlay (its own Approve/Deny stay non-mutating; the real decision surface is the overlay).

## Data gaps (real ApprovalInfo vs the prototype mock) — flagged, never fabricated

The real `ApprovalInfo` (parsed from PENDING_APPROVALS.md) only has
`{id,title,operation,reason,impact,command,status,queuedAt,decidedAt,feedback}`. The prototype's mock
carries extras with **no backing field** → rendered structurally as omitted/`—`, never invented:

- **tag / origin** (left card meta) — no safety-class / origin field → omitted.
- **from / task / ttl** (detail meta row) — no thread / task / Slack-TTL field → omitted; `queued`
  shows the `queuedAt` date (date-only; no clock in the markdown).
- **ESTIMATE cost table** — the prototype's `$12.40 / daily budget / over remaining` table has NO
  real data → the mono block renders the real **COMMAND** (`Command/Action` bullet) instead; when
  `command` is null the block is omitted. **No cost number is ever fabricated** (task red-line).
- **Why-approval note** — no rationale field → the amber note is omitted (a rejected entry's captured
  `feedback` is echoed in a small red note instead, when present).
- **statusPill** — `● pending` / `✓ approved` / `✕ rejected` / `failed` from real `status` (the
  prototype's `· thread paused` suffix has no backing field → dropped).

## Notes

- **No approvals bus event** — the mutate only flips markdown; there is no EventBus publish, so live
  refresh is **invalidate-after-mutate** (not a subscription). By design, not a gap.
- **Overlay chrome** follows the `features/tasks/TaskModal` precedent (plain backdrop + fixed panel +
  Escape `useEffect`), the established convention for the prototype-1:1 modals, not Radix Dialog.
- Backend: the paired approvals scope (`approvals.list` + `approvals.approve/reject`,
  PENDING_APPROVALS.md parser/writer). Web is the new surface over that already-landed scope.
