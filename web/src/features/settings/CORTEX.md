# features/settings/ — Settings modal 12a–g (Stage-R2+)

The **Settings modal** overlay, rebuilt **1:1** from `design/ref/prototype.dc.html` L721–1088 (script
L2379–2797) and diffed vs `design/proto-shots/14-settings.png` (plan §8.5 settings row). A 1080×680
centered Radix-Dialog card: 48px header + **210px left nav (9 panels)** + `#F7F8FA` content area.
Wired to the **real** `config.get` query (redacted `~/.cortex/config` snapshot) for every panel; the
**Budget** panel drives a real `config.set` write. Consumes the config contract shipped by task 0837.

| path | role |
|---|---|
| `settings-nav.ts` | **Pure** (TDD): the 9 nav entries (label/file/key, prototype order) + `SETTINGS_SECTION_META` (title/sub, verbatim EN copy L2394–2404). |
| `settings-nav.test.ts` | vitest — nav order, labels/file tags, section meta. |
| `platform-env.ts` | **Pure** (TDD): redacted `.env` helpers — `indexEnv`/`envRow` (present→mask `••••••••`, absent→`—`, **never cleartext**), `envKeysWithPrefix`/`hasAnyKey`, and the prototype key groups (SLACK/FEISHU/API/DAEMON, notify + advanced flags). |
| `platform-env.test.ts` | vitest — index, row masking (no cleartext), prefix filter, presence. |
| `budget-vm.ts` | **Pure** (TDD, governs the ONLY write): `DAILY_CHIPS`/`WARN_CHIPS`, `isDailyChipActive`, `buildBudgetValue` (preserves monthly_usd; returns null when it cannot satisfy the backend zod contract — never fabricates a monthly), `formatBudgetUsd`, `budgetBarPct`. |
| `budget-vm.test.ts` | vitest — chip active, value-builder (incl. null/non-positive monthly → null), formatting, bar pct. |
| `settings-ui.tsx` | Shared 1:1 chrome: `SCard`/`SCardHeader`/`MonoKV`/`Toggle`/`RadioDot`. Raw inline styles/px/hex per §8.3. |
| `SettingsPanels.tsx` | The 8 presentational panels (Platform/Profiles/Machines/Templates/MCP/Notifications/Hooks/Advanced) — prototype-exact structure with real snapshot data + honest placeholders. |
| `settings-render.test.tsx` | vitest `react-dom/server` render checks for the 8 panels (real data + placeholders, no cleartext leak). |
| `BudgetPanel.tsx` | Budget panel 12c — **live write**: DAILY chip → `config.set(budget)` mutation → invalidate `config.get` (change→read-back). WARN AT + over-budget policy inert (no budget.json field). today/month from `cost.summary`; daily/monthly denominators from budget.json. |
| `SettingsModal.tsx` | Radix Dialog shell (backdrop scrim + `cxmodal` anim + focus-trap/Esc) + header + 210px nav + content; binds `config.get` + `cost.summary`, switches the 9 panels client-side. |
| `SettingsRoute.tsx` | Route `/settings` = `<WorkbenchPage/>` behind + `<SettingsModal open onClose→/workbench/>` (prototype `modal:'settings'` over a dimmed workbench). LeftRail Settings + ⌘K Settings both already navigate here. |

## Real data vs honest placeholders (no fabricated numbers)

- **REAL**: Platform env keys (grouped, present✓/masked/absent—); Profiles defaultProfile + rows
  (name/model/backend/mode); **Budget** daily/monthly (budget.json) + today/month (cost.summary) +
  **live config.set write**; Machines name/cortexPath/gpuCount/ssh-presence/os; Templates real
  basenames (templates/agents/shells); MCP real server names; Notifications/Advanced toggles reflect
  real env presence; Hooks real filenames.
- **SECURITY**: `.env` values are never rendered (only the fixed mask + present flag); machine `ssh`
  is a presence flag, not the raw user@host — enforced by the config.get contract and never bypassed.
- **Inert / structural placeholder** (backend-uncovered, flagged): Reconnect, Restart-daemon/envDirty
  (no env write → banner omitted, no fabricated pending count), TUI + notify + advanced toggles (no
  env write), default-profile picker, WARN AT + over-budget radio (no budget.json field), Add machine,
  Logs/Retry, runtime CLIENT/STATUS/heartbeat, Open-editor, MCP variant + tool chips, per-template
  chips/hooks, per-hook matcher/phase. Client-lifecycle / Connectivity / thread-lifecycle cards are
  static architecture notes.

## Notes

- **No backend change** — existing ui-service contract only (`config.get`, `config.set`,
  `cost.summary`). Web-only.
- The Profiles + Notifications panels carry a few literal-Chinese notes that are hardcoded in the
  prototype source (not language-toggled); reproduced verbatim for 1:1 fidelity (§8.3). All other
  copy is the prototype's EN.
- Verified: `pnpm -w build` (non-desktop) + web `tsc --noEmit` EXIT=0; web `vitest` 238/238. Live
  (isolated `CORTEX_HOME`): real config.get render across all 9 panels + Budget config.set write
  reflected on read-back. Side-by-side vs `14-settings.png` → `design/build-shots/09e3-settings-compare.png`.
