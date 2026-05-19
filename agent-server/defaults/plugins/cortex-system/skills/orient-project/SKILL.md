---
name: orient-project
description: "Use when about to execute a specific project task and need a narrow, task-scoped orientation for project-specific execution prep, blocker/approval/resource checks, or when the task is clear but still need minimum project context before acting. Do not use for global prioritization, cross-project ranking, or deciding what to work on next — use /orient for that."
allowed-tools:
  - Read
  - Grep
  - Glob
argument-hint: "[project-name] [optional task summary]"
---

# Orient Project

You are doing a **task-scoped project orientation**.

Your job is to gather only the minimum context needed to execute one concrete task safely and correctly. This skill exists to prepare a worker for execution, not to perform portfolio-level planning.

## Workflow

### 1. Lock scope to the current task
Extract or infer:
- target project
- concrete task text
- project-specific knowledges
- any explicit constraints already provided

If the project is unclear, resolve that first. Do not broaden the scan until the project is known.

### 2. Read only task-relevant project context
Read the minimum set needed for execution:
1. `context/projects/<project>/STATUS.md`
2. `context/projects/<project>/TASKS.md` — focus on the matching task and nearby related items
3. `context/projects/<project>/mission.md` or `roadmap.md` only if needed to understand why the task matters
4. `context/projects/<project>/ISSUES.md` only if the task appears blocked by workflow friction or tooling confusion
5. `context/projects/<project>/CORTEX.md` only if needed to find project-specific knowledge index

Do not scan unrelated projects.
Do not do cross-project comparisons.
Do not perform broad task ranking.

### 3. Check execution blockers
Before work starts, verify only the blockers that matter for this task:
- `approval-needed` / `approved` state
- `blocked-by` tags and whether they are still unresolved
- resource constraints mentioned in the task or project docs
- if the task is GPU-bound, note that GPU availability must be checked before launch
- if the task depends on an external machine or external artifact, call that out explicitly

If a blocker prevents execution, stop at the briefing and report the blocker clearly.

### 4. Produce a short task-ready briefing
Use this exact structure:

## Task-Ready Briefing
- **Project:** <project>
- **Task:** <task text>
- **Current state:** <1-2 lines from STATUS.md relevant to this task>
- **Relevant constraints:** <approval / blocker / resource constraints, or "none found">
- **Key context:** <only the facts needed to execute>
- **Ready to execute:** yes | no
- **If not ready:** <single-sentence blocker summary>

Keep it short. Prefer omission over extra context.

## Behavior guidance
- Bias toward the smallest sufficient read set.
- If the task is already self-contained, the briefing can be very short.
- Do not invent extra checks just because they exist in `/orient`.
- Do not turn execution prep into strategy work.
- If the task is clearly executable, finish the briefing and move on to implementation.
- **Key point: this skill is just the preparation phase. After outputting the briefing you must continue to execute the task itself.** The briefing is not the final output — the real work begins after the briefing. Do not stop after outputting the briefing.

## Example

**Input:** Start work on a flywheel task to fix a broken data export script.

**Output:**

## Task-Ready Briefing
- **Project:** flywheel
- **Task:** Fix the broken data export script
- **Current state:** Export pipeline exists; recent STATUS notes schema drift in the downstream consumer.
- **Relevant constraints:** none found
- **Key context:** Matching TASKS entry says done when exported rows validate against the current schema; ISSUES not needed.
- **Ready to execute:** yes
- **If not ready:** n/a
