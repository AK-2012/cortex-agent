---
name: task
description: "MUST Use when adding, editing, querying, or managing cortex tasks — includes task creation conventions (format, tagging, decomposition rules). MUST use before using cortex-task CLI."
author: Cortex
version: 2.0.0
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
date: 2026-04-25
---

# Task

You are Cortex, managing the TASKS.yaml task system.

## Arguments
$ARGUMENTS

The task system has a single canonical CLI: `cortex-task`
(source: `agent-server/src/task-system/task-cli.ts`). Both read and write
operations live behind subcommands. Run `cortex-task --help` for
the full reference. Use this CLI as the source of truth for task operations
instead of manually editing `TASKS.yaml` when a canonical command exists.

---

## Canonical CLI Usage

## Lock Rules

TASKS.yaml uses a file-level lock mechanism to prevent incorrect dispatch by the dispatcher during editing. Lock records are stored in the `lock:` field at the top level of `TASKS.yaml`.

### Commands requiring a lock

The following mutation commands **must** hold the project lock first, otherwise they will exit with an error:

- `add` — Add a new task
- `edit` — Edit task fields
- `batch-edit` — Batch edit
- `decompose` — Decompose into subtasks
- `assign-ids` — Assign task IDs

Lifecycle commands (claim / complete / block / unblock / pause / resume / approval series / stop, etc.) **do not need** a lock — they are called routinely by the dispatcher and cortex-run on automated paths.

### Lock semantics

| Concept | Description |
|---------|-------------|
| **owner** | Lock holder identifier: prefers `$CORTEX_EXECUTION_ID`, falls back to `manual:<user>:<pid>` |
| **TTL** | Fixed 20 minutes. TTL is a safety net — the onMessageEnd hook reminds the agent to release |
| **force** | Expired locks can be forcefully preempted with `--force`, recording a force warning |
| **release** | `lock-release` only releases when owner matches; `lock-force-release` releases unconditionally |

### Hook interception

**Direct editing of `TASKS.yaml` is prohibited.** The PreToolUse hook intercepts Edit/Write operations on `**/TASKS.yaml`:
- Without lock → rejected with prompt to use `cortex-task` CLI
- With lock → allowed (the lock itself guarantees exclusivity)

### Typical multi-step edit workflow

```bash
# 1. Acquire project lock
cortex-task lock-acquire --project foo --note "splitting EXP-017 task"

# 2. Edit/add tasks
cortex-task edit --project foo --task-id ab12 --done-when "..."
cortex-task add  --project foo --text "..." --why "..." --done-when "..." --plan ... --template ...

# 3. Release lock
cortex-task lock-release --project foo
```

---

### Read (no mutation)

```bash
cortex-task --help
cortex-task list                                  # actionable, sorted by project priority
cortex-task list --all --json                     # all tasks (incl. completed) as JSON
cortex-task stats                                 # supply statistics per project
cortex-task query --project <project> [--status <status>] [--priority <p>] [--text <s>] [--task-id <id>] [--has-deps] [--no-deps] [--json]
cortex-task show --task-id <id> [--json]
cortex-task deps --task-id <id> [--json]
cortex-task lint [--project <p>] [--json]
```

### Write (mutates TASKS.md)

```bash
# State
cortex-task claim --project <p> (--task-id <id> | --task <text>) [--agent <name>]
cortex-task unclaim --project <p> --task-id <id>
cortex-task pause --project <p> --task-id <id>
cortex-task resume --project <p> --task-id <id>
cortex-task complete --project <p> --task-id <id> [--note <text>] [--skip-verify --skip-verify-reason <text>]
cortex-task uncomplete --project <p> --task-id <id>

# Approval
cortex-task request-approval --project <p> --task-id <id>
cortex-task approve --project <p> --task-id <id>
cortex-task clear-approval --project <p> --task-id <id>

# Blocking
cortex-task block --project <p> --task-id <id> --reason <text>
cortex-task unblock --project <p> --task-id <id>


# Mutation
cortex-task add --project <p> --text <t> --why <w> --done-when <c> --plan <path> --template <name> [--priority high|medium|low] [--depends-on <id> [...]]
cortex-task edit --project <p> --task-id <id> [--text <t>] [--why <w>] [--done-when <c>] [--plan <path>] [--priority <p>] \
  [--depends-on <id> [...]] [--add-depends-on <id>] [--remove-depends-on <id>] [--clear-depends-on]
cortex-task batch-edit --project <p> --task-ids <id1,id2,...> [<edit flags>]
cortex-task decompose --project <p> --task-id <id> --subtasks-file <path|->

# Maintenance
cortex-task assign-ids [--project <p>]
cortex-task validate
cortex-task stop --task-id <dispatch-id-or-hash> [--dry-run]
```

### Flag semantics (set vs incremental)

`--depends-on` is a **set / replace** flag:
- On `add`: define the initial value.
- On `edit`: replace the entire current list (use `--clear-depends-on` to clear).

For incremental edits (only on `edit` / `batch-edit`):
- Dependencies: `--add-depends-on <id>`, `--remove-depends-on <id>` (each repeatable).

`--depends-on` accepts **both** space-separated and repeatable forms:
```bash
--depends-on a111 a112              # space-separated
--depends-on a111 --depends-on a112 # repeatable
```

### Other notes

- `--dry-run` previews `stop` and `decompose` without mutating.
- `decompose --subtasks-file -` reads JSON from stdin (pipeline-friendly).
- All mutation commands return JSON (`task_id`, `agent`, `claimed_at`, …) on success.
- `stop` accepts either the dispatch ID (`dispatch_xxx`) or the TASKS.yaml hash; project is auto-resolved from `pending-tasks.json`.

---

## Step 1: Read Current State

Common starting points:
- Actionable list: `cortex-task list --json`
- Full list (incl. completed): `cortex-task list --all --project <project> --json`
- Project-scoped filtered query: `cortex-task query --project <project> --json`
- Supply stats: `cortex-task stats --json`
- Single task details: `cortex-task show --task-id <id> --json`
- Dependency view: `cortex-task deps --task-id <id> --json`

Use `--json` when you need structured data for follow-up actions.

---

## Step 2: Determine Action

Parse `$ARGUMENTS` and map the request to the right subcommand.

### Path A — List / Query Tasks

Use `list` / `query` / `show` / `deps` / `lint` / `stats`.

Examples:
- Actionable list: `cortex-task list --json`
- All tasks in one project: `cortex-task list --all --project <project> --json`
- Filter: `cortex-task query --project <project> --status actionable --priority high --json`
- One task: `cortex-task show --task-id <id> --json`
- Dependencies: `cortex-task deps --task-id <id> --json`
- Lint a project: `cortex-task lint --project <project> --json`

### Path B — Mutate Task Lifecycle

Prefer `--task-id` when you have an ID. Use `--task <text>` only as fuzzy fallback (not allowed for `add`).

Examples:
- Claim: `cortex-task claim --project <project> --task-id <id> --agent cortex-<machine>`
- Complete: `cortex-task complete --project <project> --task-id <id> --note "Verified via smoke test"`
- Block: `cortex-task block --project <project> --task-id <id> --reason "waiting for approval"`
- Add: `cortex-task add --project <project> --text "Run ablation" --why "Isolate tactile contribution" --done-when "Results in EXP-017.md" --plan context/projects/<project>/experiments/EXP-017.md --priority high --template <name>`
- Set deps: `cortex-task edit --project <project> --task-id <id> --depends-on a111 a112` (replaces full list)
- Append a dep: `cortex-task edit --project <project> --task-id <id> --add-depends-on a113`
- Append a dep: `cortex-task edit --project <project> --task-id <id> --add-depends-on a114`
- Assign IDs: `cortex-task assign-ids --project <project>`
- Stop preview: `cortex-task stop --task-id <id> --dry-run`

If the user asks to decompose a task, prepare the subtasks JSON file first, then call `decompose`. Subtasks inherit the parent task's `[plan: ...]` tag; each subtask can override via `"plan": "<path>"`.

---

## Step 3: Report Result

Summarize the result briefly and include the canonical CLI response when useful.

If the CLI reports an error, surface it directly instead of inferring a different outcome.

---

## Notes

- Prefer the canonical CLI over manual `TASKS.yaml` edits whenever a matching command exists.
- Show / deps require `--task-id`.
- All write commands except `assign-ids` / `validate` / `stop` require `--project`.
- `assign-ids` is the canonical way to backfill missing task IDs.
- **`add` required**: `--text`, `--why`, `--done-when`, `--plan`, `--template`. Omitting `--text` or `--template` is rejected.
- **Manual Task ID is prohibited**: New tasks must be created via the `add` command; directly editing TASKS.yaml to write IDs is forbidden.

---

## Task Creation Conventions

### TASKS.yaml Format

```yaml
tasks:
  - id: c8a2
    text: "Task description starting with a verb"
    why: "Why this task needs to be done"
    done-when: "Verifiable completion condition"
    priority: medium        # high | medium | low
    status: open            # open | done
    template: <thread-template-name>
    plan: path/to/design-doc.md
    # Optional fields (defaults apply when omitted)
    depends-on: [a1b2]
    gpu: <machine-name>
    blocked-by: "Blocking reason"
```

### Field Descriptions

#### Lifecycle Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (4-char hex) | Unique task identifier, auto-generated by `add` |
| `text` | string | Task description starting with a verb |
| `why` | string | Why this task needs to be done |
| `done-when` | string | Verifiable completion condition |
| `priority` | enum | high / medium / low |
| `status` | enum | open / done |
| `claimed-by` | string? | Claiming agent name |
| `claimed-at` | string? | Claim date |
| `paused` | bool | Task paused, not participating in dispatch |
| `blocked-by` | string? | External blocking reason |
| `approval-needed` | bool | Requires user confirmation |
| `approved-at` | string? | Approval date |
| `gpu` | string? | GPU machine name |
| `gpu-count` | number | Number of GPUs, default 1 |
| `depends-on` | string[] | List of prerequisite task IDs |
| `plan` | string | Design document path (required) |
| `not-before` | string? | Earliest executable date |
| `completed-at` | string? | Completion date |
| `completed-note` | string? | Completion note |

**Note**: `blocked-by` is for actions outside agent control (user approval, external team, prerequisite task completion). `depends-on` is for machine-resolvable dependencies between tasks; when a prerequisite task is `complete`, all references to that ID across projects are automatically cleared.

#### Template Field (Required)

`template` — Specifies the thread template used for dispatch. **Every task must have this field**, no default value. Run `cortex-task add --help` or `!thread templates` to see the current list of available templates.

### Plan Reference Requirements

**Every task must reference an existing markdown document via `--plan <path>`** as the design/plan source for the task. The `plan` field is written to TASKS.yaml by the `add` command, and can be updated with `edit --plan`.

**Document types that can serve as plan** (choose one):
- Thread artifact — The `## Plan (iteration N)` or `## Materialization Summary` artifact produced by the two-stage review template (e.g., director/plan artifact)
- Project decision — `context/projects/<project>/decisions/DR-NNNN.md`
- Project roadmap / mission — `roadmap.md` / `mission.md` (for mission gap analysis / standing tasks)
- Experiment protocol — `context/projects/<project>/experiments/EXP-NNN.md` (when a task directly corresponds to an experiment)
- System-level decision — `context/decisions/DR-NNNN.md`

**Rules**:
- `--plan` path is **relative to repo root** (e.g., `context/projects/dex-hand/decisions/DR-0012.md`)
- **Tasks without a corresponding plan document must not be created**. If it is just a vague idea, first write a decision / short plan md, then create the task with that as `--plan`.
- Tasks generated by mission gap analysis use `mission.md` or `roadmap.md` as plan; standing tasks use this skill file or the project-level standing-tasks document as plan

**CLI loose constraint vs skill hard requirement**: The CLI `add` does not error when `--plan` is missing, but `task lint` will report a `missing-plan` warning, and **this skill's Task Creation path must provide it**.

### GPU Slot Scheduling

The `gpu` field specifies that a task needs to use GPU on a particular machine. The dispatcher schedules at **per-GPU slot** granularity:

- **Syntax**: `gpu: <machine>` (with `gpu-count` specifying the number of GPUs, default 1)
- The dispatcher detects free GPU slots via `nvidia-smi`, only dispatches when sufficient slots are free
- Automatically sets `CUDA_VISIBLE_DEVICES` during dispatch
- Corresponding GPU slot is released after task completion

### Task Decomposition

#### Iron Rule 1: One-Criterion-One-Task

**Each independently completable/verifiable condition in the Done when must be a separate task.**

Judgment criteria: After condition A is completed, even if condition B has not started, is the result of A already usable? If yes, it must be split.

**Anti-pattern: Checklist-in-Task** — Do not use numbered sub-conditions (1)(2)(3)... to pack multiple independent work items into a single "Done when".

**Exception 1 — Atomic verification**: Multiple sub-conditions are different verification dimensions of the same atomic operation (e.g., "script runs without errors + output file exists + metrics within reasonable range").

**Exception 2 — Article writing**: Long-form writing tasks such as papers are not split by section; execute as a single task to ensure cross-section coherence.

**Example**:

```yaml
# ❌ 3 independent experiments + analysis packed into 1 task
- id: x001
  text: "Run missing baseline experiments"
  done-when: "(1) BC baseline done (2) DG/DANN/CORAL done (3) vision encoder comparison done (4) result analysis done"

# ✅ Split into 3 experiments + 1 analysis task (all referencing the same experiment protocol as plan)
- id: a001
  text: "Run BC baseline experiment"
  plan: context/projects/dex-hand/experiments/EXP-017.md
  done-when: "Training completed, results saved to results/"

- id: a002
  text: "Run domain adaptation baseline"
  plan: context/projects/dex-hand/experiments/EXP-017.md
  done-when: "DG/DANN/CORAL training completed, results saved to results/"

- id: a003
  text: "Run vision encoder comparison experiment"
  plan: context/projects/dex-hand/experiments/EXP-017.md
  done-when: "Comparison experiment completed, results saved to results/"

- id: a004
  text: "Analyze baseline experiment results"
  plan: context/projects/dex-hand/experiments/EXP-017.md
  depends-on: [a001, a002, a003]
  done-when: "Three sets of experiment results compared and analyzed, conclusions recorded in experiments/EXP-NNN.md"
```

#### Iron Rule 2: Explicit Dependency Declaration

If decomposed tasks have execution order requirements, they **must use `depends-on` or `blocked-by` to explicitly declare** them. Do not rely on implicit list order.

```yaml
# ✅ Explicitly orchestrated with depends-on
- id: d001
  text: "Prepare training data"
  plan: context/projects/dex-hand/decisions/DR-0008.md
  done-when: "WebDataset shards generated"

- id: d002
  text: "Train model"
  plan: context/projects/dex-hand/experiments/EXP-018.md
  depends-on: [d001]
  done-when: "Training completed, checkpoint saved"

- id: d003
  text: "Evaluate model"
  plan: context/projects/dex-hand/experiments/EXP-018.md
  depends-on: [d002]
  done-when: "Eval metrics recorded in experiments/EXP-NNN.md"
```

#### Decomposition Trigger Conditions

- Done when contains multiple independently completable conditions (Iron Rule 1, highest priority)
- Decomposed subtasks have sequential dependencies but are not declared (Iron Rule 2)
- Has 2+ independent steps
- Involves 3+ files
- Mixes blocked and unblocked work
- Mixes mechanical work and judgment-based work

### Stage Boundary Constraints

**For projects using the stage-gate mechanism**: Each task creation operation only creates tasks **up to the next gate**; do not pre-create tasks across gates for future stages.

- When creating next-stage tasks, must end with a gate task: `GATE: Stage <N> <stage name>`, whose `--depends-on` references all task IDs in that stage
- Gate tasks form an execution barrier — no tasks for the next stage may be dispatched before passing through the gate for re-evaluation
- Pre-creating tasks across multiple stages **violates this constraint**: future stage tasks should be authorized by the next gate's verdict, not pre-judged by the current creator

**Exceptions**:
- **Iterate branch** patch tasks use the new iter gate as cutoff point (`GATE: Stage <N> (iter <k>) <stage name>`)
- **Mission gap analysis** / **standing tasks** are allowed to create maintenance tasks not belonging to a specific stage (e.g., STATUS.md update, cross-reference verification)
- Projects not using stage-gate are not subject to this constraint

### Mission Gap Analysis (Empty Queue Fallback)

When there are no executable tasks, do not invent work. Execute mission gap analysis:
1. Read the project mission.md success conditions
2. Read the project roadmap.md milestone verification conditions
3. Compare against existing TASKS.md task coverage
4. Auto-generate tasks for uncovered conditions
5. If no gap → nothing to do, record and end

### Task Supply Health

Task supply health indicators:
- Each active project has at least 2 actionable tasks
- Total actionable tasks >= 5
- No more than 50% of tasks are blocked

Auto-generation strategy when supply is low:
1. Mission gap analysis (from mission → task)
2. Roadmap-driven decomposition (split from roadmap milestones)
3. Experiment follow-up (generate follow-up tasks from experiment conclusions)
4. Standing tasks (periodic maintenance tasks)

### Standing Tasks (Recyclable)

The following template tasks can be auto-created when supply is low:

```yaml
- text: "Update STATUS.md for {project}"
  why: "Keep project status current"
  done-when: "STATUS.md reflects actual machine state and latest experiment results"
  priority: low
  plan: context/projects/{project}/mission.md

- text: "Verify cross-references in {project}"
  why: "Prevent documentation drift"
  done-when: "All file references in project files point to existing paths"
  priority: low
  plan: context/projects/{project}/mission.md
```
