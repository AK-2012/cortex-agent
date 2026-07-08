# features/memory/ — memory viewer 7b (center-column view)

The `/memory` route: the project **Memory viewer** as a center-column view inside the workbench frame,
rebuilt 1:1 from `design/ref/prototype.dc.html` L658–719. Reuses the 1:1 `LeftRail` + `RightPanel`; only
the center pane swaps to `MemoryView`, mirroring the prototype's `isMemory` state (rails persist —
proto-shots 11/12 show the right rail). Diffed vs `proto-shots/11-memory-exp.png` (diff ON) +
`12-memory-nodiff.png` (diff OFF).

## Layout

| path | role |
|---|---|
| `MemoryPage.tsx` | Route `/memory`. The 240/fluid/400 flex frame (same as `WorkbenchPage`/`OverviewPage`) assembling `‹LeftRail/› ‹MemoryView/› ‹RightPanel/›`. |
| `MemoryView.tsx` | The center pane 1:1 (prototype L660–718): header (‹ back → `/overview` · projName · Memory · filepath · git-backed) + 200px file tree + right pane (diff-toggle bar + rendered markdown). Binds real `memory.tree` / `memory.file`; local state `selectedPath` + `diffOn`. Exact inline styles/px/hex/font/EN copy. |
| `MarkdownView.tsx` | Presentational Markdown renderer: frontmatter card + prototype-styled headings/paragraphs/lists/GFM tables/code/blockquote (prototype L685–716). |
| `markdown.ts` | **Pure** (TDD): `splitFrontmatter` (YAML `--- … ---` → chip entries + `summary`) · `parseInline` (bold/italic/code/link) · `parseBlocks` (heading/paragraph/list/table/code/blockquote/hr). Dependency-free — no `react-markdown` (public-repo minimalism; exact style control). |
| `markdown.test.ts` | vitest for `markdown.ts` (13 tests, written first). |
| `memory-vm.ts` | **Pure** (TDD): `buildTreeRows` (files selectable + dirs w/ real entryCount) · `pickDefaultPath` · `relTimeAgo` · `diffToggle` (verbatim prototype pill hexes). Reuses `overview-vm.deriveActiveProjectId`. |
| `memory-vm.test.ts` | vitest for `memory-vm.ts` (8 tests). |
| `memory-render.test.tsx` | `react-dom/server` render checks of `MarkdownView` (5 tests). Neutral placeholder fixtures. |

## Real data vs honest placeholders

- **REAL** (via existing tRPC scopes — no backend change here):
  - **File tree** = `memory.tree({projectId})` — the real top-level files (mission/roadmap/STATUS/TASKS,
    selectable → `memory.file`) + memory dirs (experiments/knowledge/patterns/decisions) with their real
    `entryCount`. Active project = `deriveActiveProjectId` (most-recent session's project).
  - **Rendered markdown** = `memory.file({projectId,path})` raw content → frontmatter card + markdown body.
  - **`updated …` label** = real `memory.file.modifiedAt` (relative humanize).
- **HONEST placeholder (mandated — NEVER fabricated numbers)**:
  - **git-diff metadata** — the prototype's task ref, `+42 −7` line counts, and commit hash have **no
    backend scope** → the diff bar shows a single muted `diff metadata unavailable` note (no numbers/hash).
    The **diff toggle renders BOTH visual states 1:1** ("Viewing diff" filled / "Diff hidden" outline);
    with diff ON, since there is no per-line diff data, an honest amber banner replaces the (impossible)
    added/removed line highlights and the body renders the current content.
  - **Dir contents** — `memory.tree` returns dir names + counts only (no entry list) → dirs are
    non-selectable and their nested files are NOT enumerated (no dir-listing scope). Flagged gap.

## Notes

- **No backend change** — consumes only the existing `memory.tree` / `memory.file` (+ `projects.list` /
  `sessions.list` for the active project). Web-only; `/trpc` relative URL unchanged.
- **Do NOT** add a git-diff backend scope. Line +/− data stays an honest placeholder.
- Entry points: Overview "Project memory" card → `/memory`; header ‹back / projName → `/overview`.
