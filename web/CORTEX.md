# web/ — @cortex-agent/web

Cortex Web UI: Vite + React 18 + TypeScript SPA (DR-0018 Stage-1 task 4). Renders the
three-pane workbench shell; talks to agent-server over tRPC (HTTP/SSE) via `@trpc/client`
+ TanStack Query. Design tokens (DR-0018 §5) live in `tailwind.config.ts` — no screen
hard-codes hex.

## Layout

| path | role |
|---|---|
| `tailwind.config.ts` | **All** §5 design tokens: state palette, status-pill bg/fg pairs, surfaces, fonts (system sans + IBM Plex Mono), 8px grid, radius, shadow |
| `vite.config.ts` | React plugin; `@` → `src` alias; dev proxy `/trpc` → `127.0.0.1:3004` (agent-server ui-http-server, task 3) |
| `postcss.config.js` | tailwindcss + autoprefixer |
| `index.html` | SPA entry; `#root` + `/src/main.tsx` |
| `src/main.tsx` | React root; wraps `Providers` + `RouterProvider` |
| `src/providers.tsx` | `QueryClientProvider` + tRPC `TRPCProvider` |
| `src/lib/trpc.ts` | `@trpc/tanstack-react-query` context + vanilla client (`/trpc`, relative URL). Forward-compat seam: falls back to `AnyTRPCRouter` until `AppRouter` is real (task 3) |
| `src/router.tsx` | `createBrowserRouter`: `AppShell` layout + empty routes (workbench/tasks/threads/overview/settings) |
| `src/shell/` | `AppShell` (three-pane) · `LeftRail` (nav) · `RightPanel` · `EmptyPane` placeholder |
| `src/index.css` | Tailwind directives + base (canvas bg, system font) |

## Notes

- Depends on `@cortex-agent/ui-contract` (`workspace:*`) for the `AppRouter` type + zod schemas — type-only, no backend runtime coupling.
- **Scaffold only** (Stage-1 task 4): no real queries/mutations yet — that is task 5 (Tasks tab vertical slice). The tRPC + Query plumbing is wired and ready.
- Dev boots without agent-server (proxy engages only on `/trpc` request). Live data needs the port-3004 ui-http-server (task 3).
- `build` = `tsc --noEmit && vite build`; `typecheck` = `tsc --noEmit`; `test` = placeholder `exit 0` (component tests are Stage-2 primitives work).
- Tailwind pinned to v3.4 (config-file token contract; v4 moves tokens to CSS `@theme`).
