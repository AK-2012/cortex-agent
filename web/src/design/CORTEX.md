# design/ — token-driven core primitives (DR-0018 §5, Stage 2)

The design-system primitive library. Every functional screen composes from these
instead of hard-coding styles. **All** colors/spacing/radius/shadow/fonts come from
`web/tailwind.config.ts` tokens — no primitive contains a hex literal.

| path | role |
|---|---|
| `tone.ts` | Pure `statusTone(status) → Tone` mapping the contract status vocabularies (thread `running/waiting/completed/failed/cancelled/aborted`, task `open/done`, execution `…/stale`) onto the 5 pill tones. `TONES` canonical list. Unknown → `cancelled`. |
| `tone.test.ts` | vitest unit test for `statusTone` (TDD — written first). |
| `StatusPill.tsx` | `StatusPill` — pill from a `tone` or a `status` (auto-mapped via `statusTone`). `pill-<tone>-{bg,fg}` tokens. |
| `MonoText.tsx` | `MonoText` — IBM Plex Mono (`font-mono`) data text; `muted` variant. |
| `ID.tsx` | `ID` — identifier in mono; `copyable` → click-to-copy with transient ✓. |
| `Card.tsx` | `Card` (+ `CardHeader`, `CardBody`) — white surface, token border/radius/shadow; `padded`. |
| `SectionHeader.tsx` | `SectionHeader` — title + optional mono count + right-aligned actions + description. |
| `Button.tsx` | `Button` — variants `primary/secondary/ghost/danger` × sizes `sm/md`; token colors, focus ring, disabled. |
| `Tabs.tsx` | `Tabs` (data-driven) + parts `TabsRoot/TabsList/Tab/TabPanel` — token-styled Radix Tabs. |
| `Tooltip.tsx` | `Tooltip` + `TooltipProvider` (mount once in `providers.tsx`) — token-styled Radix Tooltip. |
| `EmptyState.tsx` | `EmptyState` — centered card, muted title/description, optional icon/action (design 10d). |
| `index.ts` | Barrel — public exports for all primitives + `Tone`/`statusTone`/`TONES`. |

## Notes

- Demo surface: `web/src/features/kit/KitPage.tsx` → route `/kit` renders every primitive in
  every variant/state (pure presentational, no agent-server needed).
- Tabs/Tooltip wrap `@radix-ui/react-tabs` / `@radix-ui/react-tooltip` (approved primitive layer,
  DR-0018 §1) for keyboard/a11y/positioning; styling is token-only.
- `features/tasks/Pills.tsx` and `shell/EmptyPane` now delegate to `StatusPill` / `EmptyState`
  — one source of truth, appearance preserved.
