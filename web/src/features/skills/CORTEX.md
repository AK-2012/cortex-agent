Please update me when files in this folder change

# skills/ — Desktop Skills Browser (plan §12 A item 2 / 8a)

Center-pane view that renders real `skills.list` tRPC data — grouped by plugin,
with skill chips and count summary. Mounted at route `/skills` within the workbench
frame (LeftRail + RightPanel persist). No fabricated data.

| filename | role | function |
|---|---|---|
| `SkillsPage.tsx` | page | Route component: LeftRail + SkillsView + RightPanel frame |
| `SkillsView.tsx` | view | Center pane: renders skills.list groups + chip layout + load/error/empty states |
| `CORTEX.md` | index | This index |
