---
name: orient
description: "Use when the user wants a project-wide status briefing, asks what to work on next, or when autonomous scheduling needs a fresh situational assessment"
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - Agent
argument-hint: "[fast | full | project-name] — 'fast' for abbreviated orient, 'full' for comprehensive, or project name to scope"
---

# Orient

You are Cortex, performing a global orientation scan. Your job is to assess the current state of all projects and resources, then deliver a concise briefing with prioritized action recommendations — including specific task recommendations from TASKS.md.

This is your core decision-making ability — even when there's no explicit task, you can determine what should happen next.

## Paused project handling

**Paused projects are completely skipped in orient.** Do not read their STATUS.md, TASKS.md, ISSUES.md, experiments/, knowledge/ or any other files. Do not analyze, do not generate tasks, do not modify anything. Only list them as a single line "[project name] — paused" in the final briefing.

Detection method: Read `context/OVERVIEW.md`, projects whose status column contains "paused" are paused projects.

## Tier selection

Orient has two tiers: **fast** (abbreviated, ~2-3 turns) and **full** (comprehensive, ~5-7 turns).

$ARGUMENTS

- `/orient fast` — run fast orient (skip to "Fast orient" section below)
- `/orient full` — run full orient (use the standard procedure below)
- `/orient <project-name>` — run full orient scoped to that project

---

## Fast orient

When running in fast mode, do only the following:

### Step 0: Commit orphaned work

Run `git status`. If there are uncommitted changes from previous sessions (modified files, untracked artifacts), commit them immediately with a descriptive message. Orphaned work is the most common knowledge-loss pattern. Do not analyze or assess — just commit what's there.

Skip only if `git status` is clean.

### Gather context (minimal)

Read the following in parallel:
1. `git log --oneline -5` — recent activity
2. `git status` (reuse from step 0)
3. `context/projects/*/TASKS.md` — for all active projects. Also read the first ~10 lines of each project's `STATUS.md` to extract current state and priority, and scan `ISSUES.md` if present for unresolved workflow friction.

### Task supply and decomposition

While scanning TASKS.md files, improve task quality:
- **Flag** tasks with >2 steps as decomposition *candidates* — do NOT auto-split. Step/file count is only a hint; apply the /task decomposition self-audit (cut at the thin seam, not the finest grain) before splitting. Many-step tasks that share one abstraction are coupled and should stay whole. When unsure, leave a candidate note rather than fragmenting.
- Remove stale `[blocked-by]` tags where the referenced condition is resolved
- If `ISSUES.md` shows recurring or unresolved workflow friction with no corresponding open task, decompose it into one or more concrete follow-up tasks in the same project's `TASKS.md`

### Mission gap check

For each project with ≤2 unblocked tasks, do a lightweight mission gap check:

1. Read the project's `mission.md` — extract success conditions
2. For each condition, check if there's a corresponding open task in TASKS.md
3. If any condition has no corresponding open task AND is not already satisfied, generate a task:
   ```
   - [ ] <imperative verb phrase> [routing tag]
      Why: Mission gap — no task for <condition>
      Done when: <verifiable condition matching the success criterion>
      Priority: <inferred from context>
   ```
4. Report: "Mission gaps: N conditions checked, M tasks generated" or "Mission gaps: none"

### Select task

Extract unblocked tasks from TASKS.md files. Apply project priority first, then task-level ranking (prevents waste > unblocks > produces knowledge > matches momentum > cost-proportionate). Skip strategic alignment check, repetition penalty scan, and compound opportunity scanning.

**Stale blocker check**: Note any `[blocked-by]` tags older than 7 days. Flag for re-verification.

If the candidate task involves resource consumption, also read the relevant project files to assess budget feasibility.

**Empty-queue fallback**: If no actionable tasks found:
1. Run mission gap analysis for ALL active projects
2. If gaps found → select from generated tasks
3. If no gaps → log "no actionable tasks, no mission gaps" and end session

### Output format (fast)

Report these sections:
- **Uncommitted work**: Git status summary or "clean"
- **Mission gaps**: For projects with ≤2 unblocked tasks
- **Recommended task**: Task text, project, 1-line rationale
- **Task supply updates**: Any generation, decomposition, or re-tagging done

Skip: Cross-session patterns, gravity signals, compound opportunities, risks (covered by full orient).

---

## Full orient

The standard comprehensive orient procedure. Runs when explicitly requested, when auto-detection determines it's needed, or when scoped to a project.

## Scope

If a project argument is provided (e.g. `/orient dex-hand`), scope to that project only:
- Read only `context/projects/<arg>/` files (STATUS.md, ISSUES.md, experiments/index.md, TASKS.md, mission.md, roadmap.md)
- Also read `context/projects/<arg>/decisions/` if the directory exists — project-direction decisions inform task context
- Skip cross-project comparison — focus on within-project task ranking
- Still read git status and recent git log for repo-wide awareness

If no project argument, assess all active projects and recommend the highest-leverage task across all of them.

## Step 0: Commit orphaned work

Before anything else, run `git status`. If there are uncommitted changes from previous sessions (modified files, untracked artifacts), commit them immediately with a descriptive message. Orphaned work is the most common knowledge-loss pattern. Do not analyze or assess — just commit what's there.

Skip this step only if `git status` is clean.

## Step 1: Gather context

Read the following in parallel:

1. **Recent git activity**:
   - `git log --oneline -15`
   - `git status` (reuse from step 0)

2. **Project context**: For each active project in `context/projects/`:
   - STATUS.md — current state, recent changes
   - ISSUES.md — unresolved or recurring workflow friction, documentation/tooling problems
   - experiments/index.md — recent experiments and their conclusions (lightweight index, Read specific EXP-NNN.md for details)
   - TASKS.md — task queue
   - mission.md — objectives and success conditions
   - roadmap.md — milestones and verification conditions
   - `decisions/` — ls only, for awareness of design choices

3. **Global context**:
   - `context/OVERVIEW.md` — global picture
   - `context/decisions/` — system-level design decisions

4. **Machine state** (local):
   - `nvidia-smi` — GPU utilization
   - `tmux ls` — running sessions
   - Check for running training/experiments

5. **Cross-session patterns**: Check for:
   - Sessions without commits
   - Zero-knowledge sessions
   - Uncommitted files
   - Timeouts or cost anomalies
   A pattern requires 3+ occurrences to be reportable.

## Step 2: Task Inventory

Read each active project's TASKS.md and ISSUES.md together to compute task supply stats and friction follow-ups:

```
For each project with TASKS.md:
  - Count: actionable | blocked | in-progress | completed
  - Stale check: any [in-progress] tasks older than 3 days? → flag for cleanup
  - Supply check: actionable tasks < 2? → flag as low supply
  - ISSUES scan: unresolved or recurring friction with no open task? → generate task(s)
```

When scanning `ISSUES.md`, treat repeated or still-open efficiency problems as actionable work rather than passive notes. Convert them into concrete tasks in the same project's `TASKS.md` when the next step is clear enough to execute.

**Task generation from ISSUES.md:**
- Create a task when an issue is recurring, still unresolved, or clearly blocking efficient work
- Make the task concrete and root-cause oriented (fix docs, repair tooling, correct parameters, add validation, clarify workflow)
- Use the issue entry as provenance in the `Why:` field
- If one issue contains multiple independent fixes, decompose into multiple tasks
- If a corresponding open task already exists, do not duplicate it

**If any project has 0 actionable tasks → trigger Mission Gap Analysis (Step 2b)**

### Step 2b: Mission Gap Analysis (empty-queue fallback)

When a project has no actionable tasks or task supply is low:

1. Read the project's `mission.md` — extract success conditions
2. Read the project's `roadmap.md` — extract milestone verification conditions (checklist items)
3. Read the project's `TASKS.md` — get all tasks (including completed)
4. For each success condition / milestone verification condition:
   a. Is there an open task covering it? → skip
   b. Is it already satisfied (completed task or evidence on disk)? → skip
   c. Neither → generate a new task:
      - Task description (verb-first)
      - Why: "Mission condition: <original text>" or "Roadmap milestone: <original text>"
      - Done when: derived from the success/verification condition
      - Priority: inferred from roadmap phase (current phase = high, future = medium/low)
      - `[template: ...]` tag based on the nature of the work
5. Add generated tasks to the project's TASKS.md
6. If no gaps found → record "no gaps, queue exhausted" — this is a valid state

## Step 3: Rank Tasks

Extract all unblocked tasks from TASKS.md files. For each task, assess:

1. **Prevents waste?** Does this task stop resources from being burned on broken configs, invalid setups, or known-bad patterns? Tasks that prevent waste are almost always highest leverage because they protect the denominator of findings/dollar.

2. **Unblocks others?** How many other tasks or experiments depend on this completing? Check for `[blocked-by]` tags that reference this task.

3. **Produces knowledge?** Does the task have a clear hypothesis, falsifiable outcome, or "Done when" that includes a finding or decision? Tasks that produce knowledge directly serve the mission. Tasks that only produce operational output are lower leverage unless they enable knowledge-producing tasks.

4. **Matches momentum?** Is there recent work (last 2-3 sessions) building toward this task? Continuing a thread is cheaper than starting a new one.

5. **Cost-proportionate?** Is the expected cost (time, complexity) proportionate to the expected knowledge output?

**Ranking algorithm:** Score each task by the first criterion it satisfies, in order. Criterion 1 (prevents waste) dominates criterion 2 (unblocks), which dominates criterion 3 (produces knowledge), etc. Within the same criterion, prefer lower cost.

**Strategic alignment:** When recommending, state how the task connects to the project's mission.md or roadmap.md. If it doesn't connect, flag this as potential drift.

**Repetition penalty:** Before finalizing a recommendation, check experiments/index.md recent entries and git log for patterns of the same task being selected repeatedly. If the candidate task (or analyzing the same experiment/artifact) appears 3+ times in recent sessions:
- Flag: "WARNING: This task has been selected N times recently. Check for diminishing returns."
- Check whether new preconditions exist since last selection (e.g., experiment completed, blocker removed, >20% new data)
- If no new preconditions → prefer an alternative task
- If no alternatives → recommend but note the repetition risk

**Decomposition scan:** While scanning tasks, surface decomposition *candidates* — these signals say "run the /task self-audit", NOT "split now":
1. Tasks with >2 steps → candidate (split only if each step survives the others' refactor)
2. Tasks touching >3 files → candidate (3+ files sharing one abstraction are coupled — keep whole)
3. Tasks mixing mechanical and judgment work with a clean handoff → candidate
Cut only at thin seams (low coupling), never on count alone. Report candidates flagged and any splits actually made (with the seam justification).

Do NOT recommend tasks from:
- Tasks with `[blocked-by]` tags with unresolved blockers
- Tasks with `[in-progress]` tags (already being worked on)
- Tasks requiring `[approval-needed]` without `[approved]`

## Step 4: Assess Context

For the recommended task and its project, also evaluate:

- **Gravity signals**: Are there recurring manual fixes or workarounds in recent sessions?
- **Issue pressure**: Does `ISSUES.md` show unresolved friction that is slowing execution, misleading future sessions, or deserves prioritization over the current top task?
- **Uncommitted work**: Does `git status` show meaningful uncommitted changes?
- **Decision debt**: Are there implicit choices being made that should be recorded in `decisions/`?
- **Compound opportunities**: Check for recent experiments with unactioned recommendations relevant to the recommended task.

## Step 5: Deliver Briefing

```
Orient — [date]

[Project Name]
• Status: [one line]
• Recent: [what happened]
• Tasks: [N actionable / N blocked / N in-progress]

[Next Project...]

Task Supply
• Total actionable: N across M projects
• Low supply: [projects with <2 actionable tasks, if any]
• Stale in-progress: [tasks >3 days old, if any]
• Issue-derived tasks: [tasks created from ISSUES.md, or "none"]

Mission Gap Analysis
• [per-project summary: N conditions, M satisfied, K have tasks, J gaps]
• Gaps: [list each gap and generated task, or "none"]

Recommended Next Task
1. [project] — [specific task from TASKS.md] — [why this one]
   Ranking: [which criterion it satisfies]
   Strategic alignment: [connection to mission/roadmap]
2. [backup task if #1 is blocked]

Cross-session Patterns
• [recurring patterns, or "none"]

Gravity Signals
• [recurring manual patterns, or "none"]

Compound Opportunities
• [unactioned recommendations, or "none"]

Scan Intel
• [recent findings, or "no recent scans"]

Task Supply Updates
• [generation, decomposition, re-tagging done]

Risks
• [anything wrong, stalled, or drifting]

Recommended Skill
• [which skill to apply first, or "none — proceed with implementation"]
```

## Skill Selection Guide

- Just finished experiment → `/review`
- Results to interpret → `/diagnose`
- Reviewing plan/design → `/simplify` or `/critique`
- Something went wrong → `/postmortem` or `/diagnose`
- Accumulated findings → `/synthesize`
- Recurring pattern → `/gravity`
- Designing solution → `/solution-design`
- Compliance → `/self-audit` (via `/refresh-skills`)
- End of session → `/compound`

## Guidelines

- Each project gets 2-3 lines max. Skip projects with no changes.
- Action recommendations must be **specific tasks from TASKS.md**, not vague suggestions.
- If task supply is low, explicitly recommend running mission gap analysis or task decomposition.
- If something is broken or urgent, lead with that — don't bury it after routine status.
- When GPUs are idle and there's GPU-bound work in TASKS.md, flag that as the top opportunity.
- Keep the report concise. End with one clear recommended task.
