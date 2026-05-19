---
paths:
  - "context/projects/*/STATUS.md"
---

# STATUS.md Convention

Snapshot of the project's current state. **Overwrite mode** — only keep the latest state, do not accumulate history.

## Hard Constraints

- **Length limit: 120 lines**. Must trim if exceeded.
- **Update mode: Overwrite**. Update after each related operation. Do not append historical records.
- **Check line count before each write**: >=80 lines warning, >=120 lines forced trimming.

## Required Sections (in order)

```markdown
# <project> Status

Updated: YYYY-MM-DD

## Current Phase
<One paragraph, stating the current stage and core focus>

## Recent Progress
<One paragraph or 3-5 bullet points, only changes within this phase>

## Unresolved Issues
<Bullet list, open issues / blockers / pending decisions; write "none" if none>

## Next Steps
<Clear next action. Points to task-id in TASKS.yaml or a specific plan file>
```

## Prohibited Content

- Historical records of completed items → belongs in `tasks-archive.md`
- Experiment data/conclusions → belongs in `experiments/EXP-NNN.md`
- Settled knowledge/methodology → belongs in `knowledge/K-NNN.md`
- Design decision trade-offs → belongs in `decisions/DR-NNNN.md`
- Superseded old phase descriptions → delete directly (old phase outputs should have been settled into EXP/K/PAT)

## Overflow Handling

If exceeding 120 lines before writing:
1. Move entries from "Recent Progress" that span across current phase out (→ EXP/K or delete directly)
2. Delete "Completed Items" paragraph (if any)
3. Still exceeded → delete the entire old phase paragraph, keep only a one-line index pointing to the archive
