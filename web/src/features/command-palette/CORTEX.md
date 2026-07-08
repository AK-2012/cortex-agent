# features/command-palette/ — ⌘K Command Palette (Stage-R2, design 6c / overlay)

Global command palette on `cmdk`, **rebuilt 1:1 from the prototype** (`prototype.dc.html`
L1295–1315, proto-shot `01-cmdk-palette.png`) — task c967, design §8.6 Stage R2. ⌘K / Ctrl+K
opens the overlay; it searches **real** sessions/threads/tasks over tRPC and navigates via React
Router. Keyboard-reachable end-to-end. Mounted globally in `shell/AppShell`.

| path | role |
|---|---|
| `palette-items.ts` | Pure mappers. `buildCmdkItems({ sessions, threads, tasks }) → CmdkItem[]` maps the three tRPC results into the prototype flat-row model (`glyph` SE/TH/TK · `label` · `sub` · right-aligned `kbd` session/thread/task · `route` · `focusId` · `keywords`). `NAV_COMMAND_ITEMS` = static nav rows (OV Overview / WB Workbench / TK Tasks / TH Threads / ST Settings — prototype OV/ST legs + section jumps). `selectPaletteRows(query, sources, opts)` = the prototype substring filter (`(label+sub+keywords).includes(q)`) with **caps** (empty query → nav + N recent entities/kind; typing → all matches capped) — feeding cmdk every real entity blows up the DOM and stalls the shared batched fetch. |
| `palette-items.test.ts` | vitest unit tests for `buildCmdkItems` / `NAV_COMMAND_ITEMS` / `selectPaletteRows` (TDD — written first, watched fail). |
| `useCommandPalette.ts` | Global ⌘K/Ctrl+K keydown hook (one window listener, cleaned up on unmount) → controlled `{ open, setOpen }`. Unchanged. |
| `CommandPalette.tsx` | The `Command.Dialog` — 1:1 overlay chrome (exact inline styles/px/hex/font/weight from the prototype: search icon, `Jump to session / thread / task / file…` input, `esc` tag, flat rows, footer `↑↓ navigate · ⏎ open · esc dismiss`). `shouldFilter={false}` + controlled input → we own filtering via `selectPaletteRows`. Fetches `sessions/threads/tasks.list` (`enabled` while open, `staleTime`) via `useTRPC`; on select `navigate(route, { state: { focusId } })` + close. Panel/backdrop/row CSS live in `index.css` (`.cmdk-panel`/`.cmdk-backdrop`/`.cmdk-row`) since cmdk's Dialog exposes only classNames. |

## Notes

- **1:1 method (§8.3):** the prototype is authoritative on chrome/anatomy/copy (reproduced verbatim
  with raw values — LeftRail/CenterChat/RightPanel precedent); **real data is the only variable**.
  The prototype's static `i===0` highlight becomes cmdk's `data-[selected]` row (`.cmdk-row` CSS:
  `#F5F6FD` bg / `#4655D4` label). Evidence: `design/build-shots/c967-cmdk-compare.png`.
- **Deferred legs (flagged).** The prototype's **file** (EX), **Approvals** (AP) and **New schedule**
  (SC) rows have no real target yet — no `files.*` fs-read scope (Stage 6, plan §2.1); no approvals /
  schedule overlay (Stage R2+ overlay set). The placeholder copy keeps the verbatim "…/ file…"; those
  results are omitted. done_when only requires sessions/threads/tasks.
- **Row count is capped** (`selectPaletteRows`) + the list is `max-height`+scroll. This is a required
  real-data adaptation: the prototype has ~7 curated rows and no cap; real data has hundreds, and
  rendering them all both breaks the panel height AND (with the workbench's live SSE saturating the
  HTTP/1.1 connection pool) stalls the palette's on-open batched fetch in headless-Chrome. Caps keep
  the DOM small; `staleTime` avoids a duplicate `sessions.list({})` refetch that entangled the batch.
- **Navigation** targets the entity's section route (threads → `/threads/:id`; sessions → `/workbench`;
  tasks → `/tasks`), carrying the entity id in `location.state.focusId` for a future detail surface.
- cmdk (`^1.1.1`) provides ↑/↓/Enter selection + focus trap; the underlying Radix Dialog provides
  Esc/overlay close + focus restore. `Command.Input` autofocuses on open.
