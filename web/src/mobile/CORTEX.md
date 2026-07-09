# mobile/ — mobile shell base (web-only, design 5a–5c bottom Tab)

The viewport-driven mobile shell: on a mobile viewport (≤ `MOBILE_MAX_WIDTH`, i18n) the SPA renders
the ported iOS device frame + a bottom 4-Tab nav with the active screen swapped through `<Outlet/>`.
Desktop is unaffected (a separate router; see `RootRouter`). Ported 1:1 from `design/ref/ios-frame.jsx`
(device frame) + `scheme.dc.html` L2995-3000 / L3188-3191 (bottom Tab). Each screen is a **STUB slot**
a later pass replaces behind its own export (RB f528 frame-owner precedent). Raw px/hex/svg by design
(§8.3) — the mobile palette is not in the light `proto.*` token set.

| path | role |
|---|---|
| `IOSDevice.tsx` | Ported iOS 26 device frame (`IOSDevice` + `IOSStatusBar`): 402×874 bezel r48, dynamic island (126×37), status bar (9:41 + signal/wifi/battery glyphs), home indicator (139×5). Verbatim from `design/ref/ios-frame.jsx`. The source's `IOSNavBar`/`IOSKeyboard`/`IOSList` are not ported (screens own their headers). |
| `IOSDevice.test.tsx` | `react-dom/server` render checks (frame/island/home-indicator/time). |
| `mobile-tabs.ts` | **Pure** Tab model: `MOBILE_TABS` (sessions/threads/tasks/machines → `/m/*` + vocab label key), `activeTabId(pathname)`, `tabBadge(id, {activeThreadCount, hasPendingApproval})` (线程 count badge / 会话 amber dot). |
| `mobile-tabs.test.ts` | vitest units for the pure Tab logic (TDD, written first). |
| `mobile-tasks.ts` | **Pure** 5c task logic: `classifyMobileTask` (blocked→in-progress→claimable→waiting-deps precedence), `groupMobileTasks` (open-only buckets), `executableCount`/`allOpenCount` (可执行 = in-progress+claimable / 全部 = all open), `orderedGroups(grouped, segment)`, `MOBILE_GROUP_DOT` (verbatim scheme dot hex). |
| `mobile-tasks.test.ts` | vitest units for the 5c grouping/counts (TDD, written first). |
| `BottomTabBar.tsx` | Presentational bottom Tab bar (props-driven; MobileShell binds real counts). Exact scheme chrome: 4 tabs with SVG icons, active `#191C22`/inactive `#98A1B0`, `#4655D4` active-thread badge, `#C99A2E` amber approval dot, ≥44px touch targets, zh labels from `useVocab`. |
| `BottomTabBar.test.tsx` | `react-dom/server` render checks (labels/active/badge/dot/touch). |
| `MobileShell.tsx` | Frame owner: `IOSDevice` + persistent `BottomTabBar` + scroll `<Outlet/>`. Fetches real `threads.list` (active filter, reuses `features/workbench/scope`) → 线程 badge and `approvals.list` (pending) → 会话 amber dot. |
| `mobile-routes.tsx` | Pure route config `mobileRoutes` (MobileShell layout + the 6 screen slots + index/`*` redirect to `/m/sessions`). Separate from the router instance so it is inspectable without a browser history. |
| `mobile-router.tsx` | The concrete `mobileRouter` (browser/hash by shell mode). |
| `mobile-router.test.ts` | Structural test of `mobileRoutes` (path set, 5 STUB routes navigable, index + catch-all). |
| `screens/` | Screen slots: `MobileTasksScreen` (5c) is a **real** tRPC-bound screen (below); the rest are STUB slots (`StubScreen` shared body): `MobileSessionsScreen` (5a) · `MobileThreadsScreen` (5b) · `MobileMachinesScreen` (机器, 3b 同构) · `MobileApprovalsScreen` (10e) · `MobileOverviewScreen` (10f). Neutral placeholders (守则11), replaced by later passes. |
| `screens/MobileTasksScreen.tsx` | **5c 任务 (real)** — binds `tasks.list` + `useTasksLiveSync` + `tasks.unblock`; owns segment (可执行/全部) + per-card expand + pending state. |
| `screens/MobileTasksView.tsx` | Presentational 5c view (1:1 scheme L3110-3186, raw px/hex/font §8.3): 任务 header + 可执行/全部 segmented + grouped list (进行中/可认领/等依赖/已阻塞, status dots) + claimable-card expand→DONE-WHEN (honest placeholder, no `doneWhen` field) + blocked-card 「解除」 (≥44px). Bottom Tab is shell-owned, not rendered here. |
| `screens/MobileTasksView.test.tsx` | `react-dom/server` render checks (marker/gutter/segments/4 groups/expand placeholder/blocked 解除/deps). |
| `screens/screens.test.tsx` | render checks for the remaining STUB slots (5a/5b/machines/10e/10f). |

## Notes

- **Render switch**: `src/RootRouter.tsx` reads `useIsMobile()` (i18n) and mounts `mobileRouter`
  (mobile) or the unchanged desktop `router`. Two separate configs → the desktop path is
  byte-identical (no regression). `src/main.tsx` renders `<RootRouter/>` inside `<Providers>`
  (so `useIsMobile` resolves).
- **i18n**: labels come from `useVocab()`; on the mobile viewport the vocab is zh (会话/线程/任务/机器).
  Added a `sessions` vocab key. `isMobile` is derived off the same `matchMedia` breakpoint as the
  language (`useIsMobile`), so layout and language never disagree.
- **Live data**: badge/dot use the existing `threads.list` + `approvals.list` contract — no backend
  change. `approvals.list` is a Stage-R3 scope; an older daemon without it yields no dot (honest 0).
- **STUB base**: this task delivers only the frame + tabs + routing; the 5 named screens
  (5a/5b/5c/10e/10f) are slots siblings fill. `机器` is a shell-owned placeholder (scheme draws no
  mobile machines screen).
- **Verified**: web `vitest` green (5 mobile suites, 35 tests) + `pnpm -w typecheck` EXIT=0; live
  headless-Chrome render at 500×1000 (≤767 → mobile) showed the iOS frame + zh 4-Tab + active state
  + live thread badge + home indicator (`design/build-shots/0325-mobile-shell.png`); desktop router
  byte-identical (no regression).
