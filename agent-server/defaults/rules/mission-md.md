---
paths:
  - "context/projects/*/mission.md"
---

# mission.md Convention

The project's "constitution": defines goals and success conditions. It is the basis for Cortex's autonomous work decisions.

## Hard Constraints

- **Stable file**: Can only be modified after user confirmation. Cortex must not rewrite or expand scope on its own.
- **Modification trigger condition**: User explicitly directs reorient / pivot / scope change. Do not touch in any other case.
- **Length suggestion**: 50-100 lines. Too long means content that belongs in roadmap/STATUS has been mixed in.

## Required Sections

```markdown
# <project> Mission

## Goal
<1-3 paragraphs. What problem this project solves, what deliverables it produces. Include deadline-type information (if applicable)>

## Success Conditions
<Verifiable criteria. Bullet list. Each must be objectively determinable>
- [ ] <Condition 1>
- [ ] <Condition 2>

## Scope Boundaries
<Clearly state what is and is not done. Prevent scope creep>
- Includes: ...
- Does not include: ...

## Resource Constraints (optional)
<Budget, deadline, personnel, compute resources, etc. hard constraints>
```

## Prohibited Content

- Current progress/phase → belongs in `STATUS.md`
- Roadmap and milestones → belongs in `roadmap.md`
- Task list → belongs in `TASKS.yaml`
- Experiment data → belongs in `experiments/`

## Modification Process

For major reorient-type changes: first use the `reorient` skill to jointly update STATUS / roadmap / project CORTEX.md to avoid context inconsistency.
