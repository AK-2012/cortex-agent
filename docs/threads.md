# Cortex Thread System

The thread system is Cortex's multi-agent orchestration engine. A thread is a relay of focused agents — each with its own system prompt, tools, and plugins — passing a shared artifact file between them to accomplish complex, multi-step research work.

## Mental Model

A thread is like a relay race. Each agent (runner) picks up the baton (the `artifact.md` file), does its work, and hands off to the next agent based on transition rules. The artifact file is the shared memory — agents write their findings to it, and subsequent agents read what came before.

Threads are defined by **templates** in `~/.cortex/config/thread-templates.json`. Threads are often launched by the task dispatch system — see [tasks.md](./tasks.md) for how tasks trigger thread execution. A template specifies: which agents participate, in what order, with what transition logic, and what lifecycle hooks fire between steps.

## Configuration File

The thread system is configured via `~/.cortex/config/thread-templates.json` (read from `$CORTEX_HOME/config/thread-templates.json`). This file has two top-level sections:

```json
{
  "agents": { ... },      // Independent agent definitions
  "templates": { ... }    // Multi-agent pipeline templates
}
```

Configuration supports **hot-reload**: changes to `thread-templates.json` or any prompt files in the `prompts/` directory are detected via `fs.watch` (300ms debounce) and reloaded without restarting the server. A notification is sent to the admin Slack channel on reload.

### Agent Definitions

Each agent in the `agents` map is an independent entity with its own identity, tools, and prompt:

```json
{
  "agents": {
    "planner": {
      "description": "Plans the research approach",
      "profile": "claude-sonnet",
      "persistSession": false,
      "directive": "You are a research planner. Break down problems into testable hypotheses.",
      "promptTemplate": "file:planner-prompt.md",
      "pluginDirs": ["plugins/cortex-common", "plugins/cortex-surveyor"],
      "tools": "Agent,AskUserQuestion,Bash,Read,Grep,Glob,Write,Edit,WebSearch,WebFetch,Skill"
    }
  }
}
```

**Agent definition fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Agent ID (key in the agents map) |
| `profile` | string | Profile name from `profiles.json`, or `"__active__"` to use the current runtime profile |
| `persistSession` | boolean | `true`: reuse the same LLM session across iterations (preserves conversation context). `false`: fresh session each step |
| `directive` | string? | Agent role/identity, prepended to the prompt. Supports `file:filename.md` references |
| `systemPrompt` | string? | Full system prompt override. Supports `file:` references |
| `promptTemplate` | string? | Template with `{{input}}`, `{{artifactPath}}`, `{{previousOutput}}`, `{{modifiedFiles}}`, `{{modifiedFilesWithDiff}}`, `{{currentDateTime}}` variables. Supports `file:` references |
| `claudeAgent` | string? | Claude Code agent name (`--agent` flag, loads from `.claude/agents/`) |
| `outputStyle` | string? | Claude Code output style |
| `tools` | string? | Comma-separated tool list (overrides defaults) |
| `pluginDirs` | string[]? | Plugin directories to load (`--plugin-dir` flags) |

### Multi-Stage Agents

An agent can declare multiple **stages** via the `stages` field. When stages are present, `promptTemplate` is ignored — the engine selects the appropriate stage's prompt for each step based on the transition target.

```json
{
  "coder": {
    "profile": "claude-sonnet",
    "persistSession": true,
    "pluginDirs": ["plugins/cortex-coder"],
    "stages": {
      "implement": {
        "promptTemplate": "You are implementing the plan. Write code to {{artifactPath}}.",
        "description": "Write the implementation"
      },
      "review": {
        "promptTemplate": "You are reviewing the code in {{artifactPath}}. Check for correctness.",
        "continuesSession": true,
        "description": "Review the implementation"
      }
    },
    "entryStage": "implement"
  }
}
```

When `continuesSession: true` is set on a stage, and the agent has a persistent session that is being resumed, the engine sends only the stage-specific incremental prompt — skipping the directive, protocol preamble, and automatic `previousOutput` injection.

### File References

Fields that accept `file:filename.md` syntax load their content from `prompts/<subdir>/filename.md`:

| Field | Subdirectory |
|-------|-------------|
| `directive` | `prompts/directives/` |
| `promptTemplate` | `prompts/promptTemplates/` |
| `systemPrompt` | `prompts/systemPrompts/` |

The template system supports a YAML-frontmatter-based format with `extends:` (inheritance), `@fill(name)`/`@endfill` named blocks, `@block(name)`/`@endblock` template blocks, `${var}` / `${var:-default}` variable interpolation, and `@if(var)`/`@endif` conditionals.

## Templates

Templates compose agents into multi-step pipelines:

```json
{
  "templates": {
    "coder-review": {
      "description": "Implement a feature then review it",
      "agents": ["planner", "coder", "reviewer"],
      "transitions": [
        {"from": "planner", "to": "coder:implement", "condition": {"type": "always"}},
        {"from": "coder:implement", "to": "coder:review", "condition": {"type": "always"}},
        {"from": "coder:review", "to": "reviewer", "condition": {"type": "always"}}
      ],
      "entryAgent": "planner",
      "maxTotalSteps": 10,
      "maxTotalCostUsd": 5.00,
      "hooks": {
        "onEnd": {
          "command": "node hooks/post-task-hook.mjs",
          "timeout": 30000
        }
      }
    }
  }
}
```

**Template fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Template ID (used in `!thread <name>` and task dispatch) |
| `agents` | TemplateAgentRef[] | Ordered list of participating agents |
| `transitions` | TransitionRule[] | Rules governing when to move from one agent to the next |
| `entryAgent` | string | The first agent to run |
| `entryStage` | string? | Which stage to enter on the first step (defaults to agent's `entryStage`) |
| `maxTotalSteps` | number | Hard limit on total agent steps |
| `maxTotalCostUsd` | number? | Cost limit in USD |
| `hooks` | ThreadHooks? | Lifecycle hooks (onStart, onTransition, onEnd) |

### Agent References in Templates

Templates reference agents either by name (as a string) or with per-template overrides (as an object):

```json
// Simple reference — use agent as defined
"agents": ["planner", "reviewer"]

// With overrides — customize the agent for this template
"agents": [
  {"ref": "planner"},
  {"ref": "coder", "promptTemplate": "file:special-coder-prompt.md", "tools": "Read,Write,Edit"}
]
```

Override fields: `promptTemplate`, `directive`, `systemPrompt`, `persistSession`, `claudeAgent`, `outputStyle`, `tools`, `pluginDirs`.

## Transitions

Transitions determine how the thread moves from one agent to the next. They are evaluated after each agent step completes.

### Transition Endpoint Syntax

Endpoints use the syntax `"agent"` or `"agent:stage"`. A bare agent name matches any stage of that agent. An `agent:stage` endpoint matches only that specific stage.

### Condition Types

| Type | Behavior | Parameters |
|------|----------|------------|
| `always` | Always transition | None |
| `convergence` | Loop until a marker string appears in the artifact output, or until `maxIterations` is reached | `marker` (string to find), `maxIterations` (max loops, default 3) |
| `output_contains` | Transition if the artifact output matches a regex pattern | `pattern` (regex string) |
| `output_not_contains` | Transition if the artifact output does NOT match a regex pattern | `pattern` (regex string) |

### Evaluation Order

Transitions are evaluated in the order they appear in the template. The **first matching rule wins**. If no rule matches, the thread stops (terminal state: `no_matching_transition`).

A rule's `from` endpoint is matched against the last completed step. Only rules whose `from` matches the last step's agent (and optionally stage) are considered.

### Convergence Example

```json
{
  "from": "coder:implement",
  "to": "coder:review",
  "condition": {
    "type": "convergence",
    "marker": "[IMPLEMENTATION COMPLETE]",
    "maxIterations": 5
  }
}
```

This means: after `coder:implement` runs, check if the artifact contains `[IMPLEMENTATION COMPLETE]`. If it does, transition to `coder:review`. If not, loop back to `coder:implement`. If it loops 5 times without the marker, stop with `max_iterations`.

### Template Limits

Two hard limits are checked before evaluating any transitions:

- `maxTotalSteps` — if the thread has reached this many total steps, stop with `max_iterations`
- `maxTotalCostUsd` — if the accumulated cost exceeds this, stop with `cost_limit`

## Thread Lifecycle

### States

A thread moves through these states during its lifetime:

```
running → completed   (all steps finished successfully)
running → failed      (unrecoverable error)
running → cancelled   (user cancelled via !cancel or button)
running → aborted     (agent self-aborted via the thread_abort tool)
running → waiting     (waiting for user input — Phase 6 buffering)
```

Terminal states: `completed`, `failed`, `cancelled`, `aborted`.

### Agent-Initiated Control (abort / split / wait)

Thread control is out-of-band: an agent signals its own thread by calling the `thread_abort`, `thread_split`, or `thread_wait` MCP tools, never by writing markers into the artifact (text mentioning those keywords in the artifact does nothing). The tool writes a structured `metadata.pendingControl` on the agent's own thread; the runner reads it after every step completion, with **higher priority than all transition rules**. `thread_abort({ kind, diagnosis })` immediately terminates the thread with status `aborted` (but `onEnd` hooks still fire); `thread_split({ subtasks })` proposes a decomposition of the owning dispatch task; `thread_wait` suspends until awaited children finish.

### Execution Loop

The main execution loop in `runner.ts` runs as follows:

1. **onStart hook**: Fire before the first step (template hook first, then caller's extraHooks)
2. **Loop**:
   a. Resolve the next step (which agent, which stage)
   b. Build the step config (prompt, session, profile, execution registry entry)
   c. Set up streaming callbacks (assistant message aggregation, tool traces)
   d. Execute the agent (spawn LLM process, await result)
   e. Record step outcome (persist to thread store, register session, finalize execution)
   f. Read metadata.pendingControl (abort / split / wait) written by the control tools
   g. Evaluate transitions (first matching rule wins, or stop)
   h. **onTransition hook**: Fire between steps (if transitioning)
3. **onEnd hook**: Fire after the main loop completes
4. Mark thread as completed (if still running)

## Lifecycle Hooks

Hooks are shell commands executed at specific points in the thread lifecycle. They receive context as JSON on stdin and can return instructions as JSON on stdout. Thread hooks are one of three hook subsystems — see [hooks.md](./hooks.md) for the full hook architecture, including agent-level and session-level hooks.

### Hook Points

| Hook | When it fires | Context |
|------|--------------|---------|
| `onStart` | Before the first agent step | `{ threadId, templateName, phase: "start", steps: [], activeAgent, artifactContent, userMessage, totalCostUsd }` |
| `onTransition` | After each transition, before the next step | Same as above, plus `previousAgent` identifying the agent that just completed |
| `onEnd` | After all steps complete, before the thread is marked done | Same as above, with final artifact content and completed steps |

### Hook Configuration

```json
{
  "onEnd": {
    "command": "node hooks/post-task-hook.mjs",
    "args": ["--project", "flywheel"],
    "timeout": 30000
  }
}
```

- `command` — full shell invocation (interpreter must be included: `node ...`, `bash ...`, etc.)
- `args` — positional arguments passed as `$1`, `$2`, ... via `sh -c 'cmd "$@"'`
- `timeout` — execution timeout in milliseconds (default: 30000)

### Hook Return Values

Hooks return JSON on stdout to control what happens next:

**Insert a temporary agent:**
```json
{
  "insertAgent": true,
  "prompt": "Run post-task cleanup: verify all tests pass",
  "profile": "claude-haiku",
  "directive": "You are a cleanup agent"
}
```
This creates a new temporary agent that runs the given prompt, then the thread continues normally.

**Target an existing agent's session:**
```json
{
  "targetAgent": "reviewer",
  "prompt": "Double-check the results in the artifact against the original requirements"
}
```
This sends the prompt to the `reviewer` agent's persistent session (via stdin if the process is still alive, or `--resume` if dead). `targetAgent` takes priority over `insertAgent`.

### Hook Execution Order

Template hooks fire first, then the caller's `extraHooks` (injected by scheduler/dispatch) at the same phase. Both use identical execution semantics. ExtraHooks are not persisted to the ThreadRecord — they are valid only for the current `runThread()` invocation.

## Workspace and Artifact

Each thread gets an isolated workspace on the filesystem:

```
tmp/threads/thr_a1b2c3d4/
├── artifact.md        # The shared artifact — agents read and write this
└── ...                # Any other files agents create
```

The artifact path is available to all agents via the `{{artifactPath}}` template variable. Agents communicate by reading what previous agents wrote and appending their own findings.

Agents can also read files modified by previous agents:
- `{{previousOutput}}` — the complete output from the last completed step
- `{{modifiedFiles}}` — list of files edited by the previous agent (extracted from session activity logs)
- `{{modifiedFilesWithDiff}}` — file list with per-file diff blocks reconstructed from session activity JSONL

## Thread Commands

### Starting a Thread

```
!thread coder-review Implement user authentication for the API
!thread researcher Survey recent papers on tactile sensing
```

The first word after `!thread` is the template name (or agent name for single-agent execution). The rest is the user message passed to the first agent.

### Adding an Agent

```
!thread add reviewer
!thread add critic Please focus on security implications
```

This dynamically adds an agent to an existing thread. The thread must be completed or waiting (not currently running). If the thread was an auto-record (no filesystem workspace), a workspace is created lazily.

### Other Thread Commands

| Command | Description |
|---------|-------------|
| `!thread list` | List active threads |
| `!thread status [id]` | Show thread status and steps |
| `!thread cancel [id]` | Cancel a running thread |
| `!thread agents` | List available agents |
| `!thread templates` | List available templates |

## Thread Types

Cortex uses three types of thread records internally:

| Type | templateName | Workspace | Used by |
|------|-------------|-----------|---------|
| **Template thread** | Actual template name | Yes | `!thread <template>`, task dispatch |
| **Default thread** | `"default"` | Yes | Single-agent messages (the normal chat path) |
| **Auto thread** | `null` | No (initially) | `!thread add` chaining from single-agent runs |

The distinction matters because the runner treats default threads differently: they run exactly one step (no transitions), use the channel's existing session, and forward streaming output directly to the user.

## Thread Record

Each thread's full state is persisted in `~/.cortex/data/threads.json` as a `ThreadRecord`:

| Field | Description |
|-------|-------------|
| `id` | Thread ID (`thr_<8 hex>`) |
| `status` | Current lifecycle state |
| `channel` | Slack channel ID |
| `templateName` | Template used (null for ad-hoc) |
| `userMessage` | The original user message |
| `workspacePath` / `artifactPath` | File paths for the shared artifact |
| `agents` | Map of agent slots with their state (sessionId, status, persistSession) |
| `activeAgent` / `activeStage` | Which agent and stage runs next |
| `steps[]` | Recorded execution history per step (agent, stage, cost, duration, output) |
| `iterationCounts` | Track convergence loop counts per transition edge |
| `totalCostUsd` | Cumulative cost across all steps |
| `metadata` | Caller-provided context: scheduleTaskId, trigger, project, pendingMessages |
| `abortReason` | Reason if agent self-aborted |

Old threads are cleaned up on startup: threads older than 7 days are removed (24 hours for auto-records without workspaces).

## Prompt Variables

Agent prompts support template variables that are resolved at runtime:

| Variable | Description |
|----------|-------------|
| `{{input}}` | The user message (for the first step) or the previous agent's output |
| `{{artifactPath}}` | Absolute path to `artifact.md` |
| `{{previousOutput}}` | Full output from the last completed step |
| `{{modifiedFiles}}` | Files edited by the previous agent |
| `{{modifiedFilesWithDiff}}` | Files with inline diffs from previous agent |
| `{{currentDateTime}}` | Current date and time in ISO format |

## Plugin Loading

Each agent definition specifies which plugin directories to load via `pluginDirs`. Plugins are resolved relative to `DATA_DIR` (default: `~/.cortex/`). For example, `plugins/cortex-coder` resolves to `~/.cortex/plugins/cortex-coder/`.

The plugin directories are passed to the LLM backend as `--plugin-dir` flags (Claude Code) or `--skill` flags (PI). The backend then scans for `SKILL.md` files and makes them available as invocable skills. See [skills-and-plugins.md](./skills-and-plugins.md) for the full skill and plugin system.

## Thread Cleanup

When a thread completes, fails, or is cancelled:

- The agent handle is removed from `RunningExecutions`
- Thread-specific sessions (keyed by `thr:<threadId>:`) are closed
- The thread store is flushed to disk

On server startup, any threads left in `running` status are marked as `failed` to prevent stale state.
