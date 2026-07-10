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
  - **Line-level `+/−`** = real `memory.file.lineDiff` (`git diff --numstat` working-tree vs HEAD). The diff
    bar shows green `+N` / red `−M`; a clean file legitimately reads `+0 −0`. Pure `formatLineDiff()` maps the
    DTO → chips (or `null` → placeholder). Since `~/.cortex/context` is auto-committed, most files show `0/0` —
    the real, spec-faithful answer, not a placeholder.
- **HONEST placeholder (mandated — NEVER fabricated numbers)**:
  - **line `+/−` when unresolvable** — when `lineDiff` is `null` (project dir not a git work tree / git
    unavailable / binary) the diff bar falls back to a muted `diff metadata unavailable` note and the amber
    banner explains the file is not git-tracked. Never a fabricated `+42 −7`.
  - **task ref + commit hash** — still have **no backend scope** → not shown (not fabricated). The **diff
    toggle renders BOTH visual states 1:1** ("Viewing diff" filled / "Diff hidden" outline); with diff ON the
    amber banner states the real aggregate (`+N / −M lines changed vs HEAD`) and notes per-line highlighting
    is not available (only aggregate counts have a backend); the body renders the current working-tree content.
  - **Dir contents** — `memory.tree` returns dir names + counts only (no entry list) → dirs are
    non-selectable and their nested files are NOT enumerated (no dir-listing scope). Flagged gap.

## Notes

- Consumes `memory.tree` / `memory.file` (+ `projects.list` / `sessions.list` for the active project). The
  `memory.file.lineDiff` git-numstat field is the only backend-side data added for the real `+/−`; `/trpc`
  relative URL unchanged.
- Line `+/−` is now REAL (git numstat). It stays an honest `null`→placeholder when the dir is not a git work
  tree; do NOT fabricate counts. Per-line highlighting, task ref, and commit hash remain out (no backend).
- Entry points: Overview "Project memory" card → `/memory`; header ‹back / projName → `/overview`.
