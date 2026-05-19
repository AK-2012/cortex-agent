---
paths:
  - "context/projects/*/ISSUES.md"
---

# ISSUES.md Convention

Records execution friction affecting work efficiency: misleading requirements, confusing documentation, tools that are hard to use, incorrect parameters, process deadlocks, etc. For centralized fixing in subsequent sessions.

## Hard Constraints

- **Length limit: 80 lines**. Exceeding means unresolved issues are accumulating, triggering cleanup.
- **Append mode**: New issues are appended to the end.
- **Resolved entries are deleted directly**: No archiving, no history retained. Delete the corresponding entry from the file immediately after fixing.

## Entry Format

```markdown
- **<One-line title>** (<YYYY-MM-DD>)
  - Problem: <What specific friction/error/confusion point>
  - Context: <Which task/operation/context was encountered in>
  - Investigation: <What was checked, what was tried, root cause guess or confirmation>
```

## Prohibited Content

- Fixed issues (resolved must be deleted, no changelog left behind)
- Experiment failure conclusions → belongs in `experiments/EXP-NNN.md`
- Design decision trade-offs → belongs in `decisions/DR-NNNN.md`
- Project-level blockers → belongs in `STATUS.md` "Unresolved Issues" section (ISSUES.md records process friction, not phase blockers)

## Overflow Handling

If exceeding 80 lines before writing:
1. Check for entries that were silently fixed but not deleted → delete them
2. Merge similar friction into one entry
3. Still exceeded → leave a pointer in STATUS.md "Unresolved Issues" section, clear and restart ISSUES.md entirely
