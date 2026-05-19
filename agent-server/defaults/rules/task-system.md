---
paths:
  - "context/projects/*/TASKS.yaml"
---

# Task System — Executing Agent Guide

You are reading a TASKS.yaml file. This is a structured task queue, and you have been dispatched to execute specific tasks within it.

## TASKS.yaml Format

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
    gpu: <machine-name>          # optional: target machine for GPU tasks
    blocked-by: "Blocking reason"
```

## Status Update

Use the single CLI `cortex-task` to update task status, **do not manually edit TASKS.yaml**:

```bash
# Claim task
cortex-task claim --project <project> --task-id <id>
# Complete task
cortex-task complete --project <project> --task-id <id> --note "Completion note"
# Mark blocked
cortex-task block --project <project> --task-id <id> --reason "Blocking reason"
# Unblock
cortex-task unblock --project <project> --task-id <id>
# Query
cortex-task query --project <project> --status actionable --json
```

Run `cortex-task --help` for the full list of commands and parameters.

## Partial Completion

Never set status to done + "(partial)". If work is only partially completed:
- Keep status: open and update the description to reflect remaining work
- Or split into completed subtask + new open task

status: done is a terminal state — the task selector treats it as completed and never revisits it.
