# web/ — @cortex-agent/web

Cortex Web UI: Vite + React 18 + TypeScript SPA (DR-0018 Stage-1 task 4). Renders the
three-pane workbench shell; talks to agent-server over tRPC (HTTP/SSE) via `@trpc/client`
+ TanStack Query. Design tokens (DR-0018 §5) live in `tailwind.config.ts` — no screen
hard-codes hex.

## Layout

| path | role |
|---|---|
| `tailwind.config.ts` | **All** design tokens: §5 state palette / status-pill bg/fg pairs / surfaces / 8px grid / radius / shadow, **plus the prototype 1:1 base (DR-0018 §8.6 RA, task 6d21)** — `fontFamily.sans`/`mono` match the prototype exactly, the audited `proto.*` color scale (ink/line/accent/amber tints), and the 16 `cx*` animation utilities. No screen hard-codes hex |
| `index.html` | SPA entry; `#root` + `/src/main.tsx`; loads **IBM Plex Mono** (Google Fonts, wght 400;500;600) matching the prototype helmet |
| `src/index.css` | Tailwind directives + the prototype `<style>` base **verbatim** (§8.6 RA): html/body reset (base `#E9E7E2` + exact system-sans stack), `input{}` reset, `.sess-row` hover, and the 16 raw `@keyframes cx*` (literal names — inline `animation:cx…` in prototype-1:1 markup depends on them) |
| `vite.config.ts` | React plugin; `@` → `src` alias; dev proxy `/trpc` → `127.0.0.1:3004`. Proxy injects `x-cortex-token` (from `CORTEX_CLIENT_TOKEN`) so the token-gated ui-http-server is reachable in dev without the browser holding the secret (SSE cannot set headers) |
| `postcss.config.js` | tailwindcss + autoprefixer |
| `index.html` | SPA entry; `#root` + `/src/main.tsx` |
| `src/main.tsx` | React root; wraps `Providers` + `RouterProvider` |
| `src/providers.tsx` | `QueryClientProvider` + tRPC `TRPCProvider` + `design/TooltipProvider` |
| `src/lib/trpc.ts` | `@trpc/tanstack-react-query` context + vanilla client. `splitLink`: query/mutate → `httpBatchLink`, subscription → `httpSubscriptionLink` (SSE). Typed directly against the real `AppRouter` (task 3) — the old `AnyTRPCRouter` fallback seam was removed (a deferred conditional type does not auto-tighten and degraded every procedure to `any`) |
| `src/router.tsx` | `createBrowserRouter`: `AppShell` layout; `/workbench` → `WorkbenchPage` (design 3a, task 5b0f), `/tasks` → `TasksPage` (task 5), `/kit` → `KitPage` (design demo, task e794), other routes still `EmptyPane` |
| `src/design/` | Design-system core primitives (DR-0018 §5 Stage 2, tasks e794/2add) — token-driven StatusPill/MonoText/ID/Card/SectionHeader/Button/Tabs/Tooltip/EmptyState/DegradedState (10c status language). See its CORTEX.md |
| `src/shell/` | `AppShell` (**Stage-R RB pass-through**, task f528 — renders `<Outlet/>` + the global ⌘K `CommandPalette`; the old token-summary nav `LeftRail` was removed — `/workbench` owns its own frame + rail) · `EmptyPane` (wraps `design/EmptyState`) |
| `src/features/workbench/` | **Stage-R RB app-shell frame + Left Rail 1:1** (task f528) — `WorkbenchPage` = 240/fluid/400 three-pane flex frame; real `LeftRail` (prototype L42–100, real projects/sessions/cost); `CenterChat`/`RightPanel` STUB slots (siblings B/C). See its CORTEX.md |
| `src/features/tasks/` | Tasks tab vertical slice (design 4a, task 5) — see its CORTEX.md. `TasksPanel` = reusable data-driven body (also used by the workbench Tasks tab); `Pills.tsx` delegates to `design/StatusPill` |
| `src/features/command-palette/` | ⌘K command palette (design 6c, task 051b) on `cmdk` — searches real sessions/threads/tasks over tRPC + section-nav commands, keyboard-reachable. See its CORTEX.md |
| `src/features/thread/` | Thread detail 11b **center-column view rebuilt 1:1 from the prototype** (Stage-R2 task 4450) — `/threads/:id` = real LeftRail frame + header/meta/PIPELINE/THREAD-ARTIFACT over `threads.get` (B1); nested 2b drill-down; pure `thread-detail-vm`. Superseded the Stage-3 token-summary detail. See its CORTEX.md |
| `src/features/execution/` | Execution detail 8b (task 2198) — `executions.get` rail + live `executions.log` stream + Stop (`executions.cancel`), route `/executions/:executionId`. See its CORTEX.md |
| `src/features/kit/` | `/kit` design-system demo surface (tasks e794/2add) — every primitive in every variant/state + degraded-4 (10c) via `DegradedDemos.tsx` + empty-state next-action panels (10d), pure presentational |
| `src/features/base-demo/` | `/base` prototype 1:1 base specimen (§8.6 RA, task 6d21) — type specimens (sans + IBM Plex Mono), the audited `proto.*` palette swatches, and the 16 `cx*` animations live; pure presentational, for visual diff vs the prototype |

## Notes

- Depends on `@cortex-agent/ui-contract` (`workspace:*`) for the `AppRouter` type + zod schemas — type-only, no backend runtime coupling.
- **Tasks tab live** (Stage-1 task 5): `/tasks` renders real `tasks.list` grouped by lifecycle·priority and live-updates via the tRPC subscription. Verified end-to-end against a running ui-http-server (real render + live update on a real Complete mutation).
- **Workbench live** (Stage-2 task 5b0f): `/workbench` renders real `sessions.list` (left) + `threads.list` / `tasks.list` (right tabs) with an Active/History filter and live subscriptions; center chat is a placeholder (no transcript scope yet — Stage 4), Machines is a placeholder (Stage 7).
- Dev boots without agent-server (proxy engages only on `/trpc` request). Live data needs the port-3004 ui-http-server (task 3) and `CORTEX_CLIENT_TOKEN` set in the dev shell (proxy injects it).
- `build` = `tsc --noEmit && vite build`; `typecheck` = `tsc --noEmit`; `test` = `vitest run` (`group-tasks` grouping + `design/tone` status→tone mapping pure-logic unit tests).
- Tailwind pinned to v3.4 (config-file token contract; v4 moves tokens to CSS `@theme`).
- Tabs/Tooltip use `@radix-ui/react-tabs` / `@radix-ui/react-tooltip` (approved primitive layer, DR-0018 §1); token-only styling.
- **⌘K command palette live** (Stage-2 task 051b): `features/command-palette/` on `cmdk` (`^1.1.1`),
  mounted globally in `AppShell`. Searches real `sessions.list`/`threads.list`/`tasks.list` over
  tRPC + section-nav command items; navigates via React Router. Verified against a live
  ui-http-server (real task + thread matches rendered by search; ⌘K open, keyboard nav/Enter/Esc,
  navigation all driven headless-Chrome, zero console errors). File search deferred to Stage 6 (no
  fs-read tRPC scope yet).
