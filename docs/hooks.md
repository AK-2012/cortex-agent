# Hooks

Cortex has three independent hook subsystems that fire at different boundaries:
agent-level hooks inside the coding-agent process (PreToolUse, PostToolUse,
SessionStart, PermissionRequest), server-side thread lifecycle hooks (onStart,
onTransition, onEnd), and session-level hooks (onNew, onMessageEnd). This
document explains each one, how they are configured, and how to write your own.
For where hooks sit in the overall system, see [architecture.md](./architecture.md).

## Architecture overview

```
┌─────────────────────────────────────────────────┐
│  Agent Process (Claude Code / PI)               │
│  ┌───────────────────────────────────────────┐  │
│  │  Hook scripts (.mjs) fired by the agent   │  │
│  │  CLI via --settings or --extension        │  │
│  │  PreToolUse / PostToolUse / SessionStart  │  │
│  └───────────┬───────────────────────────────┘  │
│              │ HTTP webhook (port 3001)          │
└──────────────┼──────────────────────────────────┘
               │
┌──────────────┼──────────────────────────────────┐
│  Agent-Server Process                           │
│  ┌───────────┴───────────────────────────────┐  │
│  │  hook-bridge.ts — translates hook events  │  │
│  │  to Slack interactions (AskUserQuestion,  │  │
│  │  ExitPlanMode)                            │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │  hook-runner.ts — thread lifecycle hooks  │  │
│  │  (onStart / onTransition / onEnd)         │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │  session-hooks.ts — session-level hooks   │  │
│  │  (onNew / onMessageEnd)                   │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## Agent-level hooks (Claude Code)

These hooks run inside the Claude Code CLI process. Cortex generates the hook
configuration dynamically in `agent-adapter/claude/hooks-builder.ts` and
injects it via the `--settings` CLI flag at spawn time. The hook scripts live
in `~/.cortex/hooks/`.

### PreToolUse hooks

Fired before a tool executes. These hooks can block the tool (returning
`permissionDecision: 'deny'`) or allow it to proceed with modified input.

| Hook script | Matcher | Purpose |
|---|---|---|
| `sensitive-file-edit.mjs` | `Edit\|Write` | Bypasses Claude's built-in `.claude/` path protection by performing the file operation directly, then returning deny with a success message |
| `tasks-yaml-guard.mjs` | `Edit\|Write` | Checks TASKS.yaml project lock before allowing edits — if the current process doesn't hold the lock, the edit is denied |
| `ask-user-question-hook.mjs` | `AskUserQuestion` | Forwards user questions to Slack via HTTP POST to the hook-bridge, blocks until user answers |
| `exit-plan-mode-hook.mjs` | `ExitPlanMode` | Forwards plans to Slack for approval via HTTP POST to the hook-bridge, blocks until user approves or rejects |

The last two hooks (`AskUserQuestion` and `ExitPlanMode`) are only registered
when the agent's tool list includes those tools. Thread agents that don't have
them skip those hooks.

### PostToolUse hooks

Fired after a tool completes. These cannot block — they are used for
side effects like logging, context injection, and access tracking.

| Hook script | Matcher | Purpose |
|---|---|---|
| `memory-ref-tracker.mjs` | `Read\|Grep` | Tracks which memory files (experiments, knowledge, patterns) were accessed, writing to `_meta/access-log.jsonl` |
| `rules-loader.mjs` | `Read\|Grep` | Injects scoped rules from `rules/*.md` into the agent's context when relevant files are read |
| `session-activity-tracker.mjs` | `Read\|Edit\|Write\|Skill` | Logs session activity (file reads, edits, writes, skill invocations) to `logs/session-activity/<session_id>.jsonl` |
| `cortex-md-injector.mjs` | `Read` | Injects the CORTEX.md ancestor chain into context when the agent reads a file under a CORTEX.md-managed directory |

### SessionStart hooks

Fired on session startup, resume, clear, and compact events. Currently a
single hook:

| Hook script | Matcher | Purpose |
|---|---|---|
| `cortex-md-injector.mjs` | `startup\|resume\|clear\|compact` | Injects CORTEX.md context at session start |

### PermissionRequest hooks

A single static hook that auto-bypasses permission prompts for Edit and Write
operations. This is safe because the PreToolUse hooks (`sensitive-file-edit.mjs`
and `tasks-yaml-guard.mjs`) handle the actual access control.

### How the configuration is built

In `hooks-builder.ts`, `buildHooksSettings()` takes the agent's tool list and
returns a settings object injected as `--settings '{"hooks":{...}}'`:

```typescript
// Equivalent structure injected at spawn time:
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write", "hooks": [
          { "type": "command", "command": "node ~/.cortex/hooks/sensitive-file-edit.mjs", "timeout": 10 },
          { "type": "command", "command": "node ~/.cortex/hooks/tasks-yaml-guard.mjs", "timeout": 10 }
      ]},
      { "matcher": "AskUserQuestion", "hooks": [...] },   // only if tool is available
      { "matcher": "ExitPlanMode", "hooks": [...] }       // only if tool is available
    ],
    "PostToolUse": [
      { "matcher": "Read|Grep", "hooks": [
          { "type": "command", "command": "node ~/.cortex/hooks/memory-ref-tracker.mjs" },
          { "type": "command", "command": "node ~/.cortex/hooks/rules-loader.mjs" }
      ]},
      { "matcher": "Read|Edit|Write|Skill", "hooks": [
          { "type": "command", "command": "node ~/.cortex/hooks/session-activity-tracker.mjs" }
      ]},
      { "matcher": "Read", "hooks": [
          { "type": "command", "command": "node ~/.cortex/hooks/cortex-md-injector.mjs" }
      ]}
    ],
    "PermissionRequest": [
      { "matcher": "Edit|Write", "hooks": [
          { "type": "command", "command": "printf '{\"hookSpecificOutput\":{\"hookEventName\":\"PermissionRequest\",\"decision\":{\"behavior\":\"allow\"}}}'", "timeout": 5 }
      ]}
    ],
    "SessionStart": [
      { "matcher": "startup|resume|clear|compact", "hooks": [
          { "type": "command", "command": "node ~/.cortex/hooks/cortex-md-injector.mjs" }
      ]}
    ]
  }
}
```

## PI backend hooks

The PI (terminal) coding agent doesn't use Claude Code's `--settings` hooks
syntax. Instead, Cortex uses an extension API bridge
(`agent-adapter/pi/hook-bridge.ts`) that registers event handlers on PI's
`ExtensionAPI`:

- `before_agent_start` → runs `cortex-md-injector.mjs` with a `SessionStart`
  event payload
- `tool_call` → runs `sensitive-file-edit.mjs` for `edit`/`write` tools
- `tool_result` → runs `memory-ref-tracker.mjs` (for Reads), `rules-loader.mjs`
  (for Reads), `cortex-md-injector.mjs` (for Reads), and
  `session-activity-tracker.mjs` (for Read/Edit/Write/Skill)

The PI bridge normalizes tool names (PI's lowercase names to Claude's
PascalCase) and field names (PI's `path` to Claude's `file_path`) so the same
hook scripts work across both backends.

## The hook-bridge: translating tool events to Slack

A distinct piece of infrastructure called the hook-bridge
(`agent-server/src/orchestration/routing/hook-bridge.ts`) handles the
translation between blocking Claude Code hooks and Slack interactions. This is
not a hook in the Claude Code sense — it's the server-side machinery that
makes AskUserQuestion and ExitPlanMode work.

The hook-bridge:
- Receives HTTP POST requests from hook scripts on `POST /hook/ask-user-question`
  and `POST /hook/exit-plan-mode`
- Registers a pending Promise with a 30-minute TTL
- Publishes `ask-user.requested` or `plan.submitted` events on the event bus
- The hook-bridge subscribers (`hook-bridge-subscribers.ts`) post interactive
  Slack messages in response to these events
- When the Slack interaction resolves (user clicks a button or submits a
  modal), the interaction handler resolves the pending Promise
- The HTTP response flows back to the hook script, which outputs the result
  to stdout, which Claude Code reads as the PreToolUse result

## Thread lifecycle hooks (server-side)

Thread lifecycle hooks fire at three points during a multi-agent thread
execution. They are configured in `thread-templates.json` under the `hooks`
key of each template.

### Hook phases

| Phase | When | Use cases |
|---|---|---|
| `onStart` | Before the first agent step | Pre-flight checks, workspace setup, initial context injection |
| `onTransition` | After evaluating transitions, between agent steps | Validation between pipeline stages, conditional routing |
| `onEnd` | After the thread's main loop completes | Post-task cleanup, status updates, notification, artifact collection |

### Configuration

Hooks are configured in `thread-templates.json`:

```json
{
  "name": "example",
  "hooks": {
    "onEnd": {
      "command": "node ~/.cortex/hooks/task-status-check.mjs",
      "args": ["scheduler-main"],
      "timeout": 10000
    }
  }
}
```

- `command` — full shell invocation, including interpreter (e.g., `node
  ~/.cortex/hooks/my-hook.mjs`)
- `args` — positional arguments passed as `$1`, `$2`, etc.
- `timeout` — milliseconds, defaults to 30000

### Hook execution

`hook-runner.ts` handles execution:

1. `buildHookContext()` constructs a `HookContext` object with full thread
   state: `threadId`, `templateName`, `phase`, `currentStepIndex`, `steps`,
   `activeAgent`, `previousAgent`, `artifactContent`, `userMessage`,
   `totalCostUsd`.
2. `executeHook()` spawns the command as `sh -c '<command> "$@"' hook <args>`,
   sends the context as JSON on stdin.
3. The hook script writes a `HookResult` JSON to stdout:

   ```json
   {
     "insertAgent": true,
     "profile": "__active__",
     "prompt": "Review the thread output and suggest next steps."
   }
   ```

   Or, to send the prompt to an existing agent in the thread (instead of
   creating a new one):

   ```json
   {
     "targetAgent": "reviewer",
     "prompt": "The planner finished. Here is additional context..."
   }
   ```

4. If `insertAgent: true` or `targetAgent` is set with a `prompt`,
   `runHookAgent()` spawns a new agent turn. For `insertAgent`, a temporary
   agent is created. For `targetAgent`, the prompt is sent to the named
   agent's persistent session.

### Task dispatch extra hooks

When a task is dispatched, the dispatch system injects an `extraHooks.onEnd`
hook on top of whatever the template already configures:

```typescript
extraHooks: {
  onEnd: {
    command: 'node hooks/task-status-check.mjs',
    args: [selectedTask.project, selectedTask.id],
    timeout: 10000,
  },
}
```

This ensures task status is updated after the thread completes, regardless of
outcome.

## Session-level hooks

Session hooks fire at the channel/session boundary rather than the thread
boundary. They are configured in `~/.cortex/config/session-hooks.json`.

### Configuration

```json
{
  "onNew": {
    "command": "node hooks/new-session-hook.mjs",
    "args": [],
    "timeout": 60000
  }
}
```

Two hook points are defined in the type system (`SessionHooksFile`);

- `onNew` — fires when `!new` or the "New" status button closes a session.
  Used for pre-close memory flush (checking for uncommitted changes, reminding
  about pending work).
- `onMessageEnd` — fires after each assistant message turn completes. Currently
  not automatically configured but supported by the pipeline.

### onNew flow

1. `fireAndForgetPreCloseHook()` captures the current `sessionId` before the
   session is destroyed.
2. The hook script receives context JSON on stdin: `channel`, `sessionId`,
   `sessionName`, `executionId`, `profile`, `trigger`.
3. The hook script's stdout, if non-empty, is injected as a fresh agent turn
   targeting the still-alive session — allowing the agent to act on findings
   (e.g., commit uncommitted work) before the session closes.

### onMessageEnd flow

1. Called from the agent lifecycle handler (`lifecycle.ts`) after the
   assistant turn completes.
2. The hook output extends the same VirtualMessage (Slack thread) as the
   just-completed turn, so hook output appears inline rather than as a
   separate top-level message.
3. Like onNew, non-empty stdout is injected as a follow-up agent turn.

## The _meta/access-log.jsonl system

The `memory-ref-tracker.mjs` PostToolUse hook implements automatic reference
tracking for the atomized memory system (DR-0007, see
[memory.md](./memory.md) for the full memory architecture). It records every Read and
Grep access to experiment, knowledge, and pattern files.

Each access produces one JSONL record:
```json
{"file": "EXP-001.md", "tool": "Read", "ts": "2026-05-19T10:30:00.000Z"}
```

The log file lives at `<project>/_meta/access-log.jsonl` and is auto-committed
to git after each write. The memory index regeneration command
(`memory-index-regen`) reads this log to compute access counts (`refs`) and
last-access timestamps (`last-ref`), which feed into the index sorting and
hot/cold classification.

## Writing a custom hook

You can write custom hook scripts for any hook phase that supports them. Hook
scripts are Node.js `.mjs` files that receive context on stdin and write
results to stdout.

### Minimal PreToolUse hook example

A hook that warns when the agent tries to edit a specific file:

```javascript
#!/usr/bin/env node
// ~/.cortex/hooks/warn-sensitive-file.mjs
import { readFileSync } from 'fs';

// Read tool input from stdin
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString());

if (input.tool_name === 'Edit' || input.tool_name === 'Write') {
  const path = input.tool_input?.file_path || '';
  if (path.includes('.env') || path.includes('credentials')) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Refusing to edit sensitive file: ${path}`
      }
    }));
    process.exit(0);
  }
}

// Allow by default
console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow'
  }
}));
```

### Registering a custom Claude Code hook

Add the hook to the dynamic configuration by modifying
`hooks-builder.ts` in the agent-server source:

```typescript
// In buildPreToolUseHooks or POST_TOOL_USE_HOOKS:
{ matcher: 'Edit|Write', hooks: [
  nodeHook('sensitive-file-edit.mjs', 10),
  nodeHook('tasks-yaml-guard.mjs', 10),
  nodeHook('warn-sensitive-file.mjs', 5),  // your custom hook
]},
```

For a lighter touch, you can also add hooks through `settings.json` if you
are running Claude Code directly (outside the Cortex spawn path), but this is
not the recommended approach for Cortex-managed agents.

### Thread lifecycle hook example

A hook that posts a summary to Slack when a thread ends:

```javascript
#!/usr/bin/env node
// Collect stdin
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const ctx = JSON.parse(Buffer.concat(chunks).toString());

// ctx has: threadId, templateName, phase, steps, activeAgent, artifactContent, ...

// Return a result — optionally inject a follow-up agent turn
console.log(JSON.stringify({
  insertAgent: false
  // Or: insertAgent: true, prompt: "Summarize the thread output."
}));
```

Configure it in `thread-templates.json`:

```json
{
  "hooks": {
    "onEnd": {
      "command": "node ~/.cortex/hooks/my-summary-hook.mjs",
      "timeout": 15000
    }
  }
}
```

## Debugging hooks

Hook execution logs appear in the agent-server daemon logs
(`~/.cortex/logs/daemon.log`). Hook scripts that write to stderr will have
their output captured and logged. Common issues:

- **Hook script not found** — check the path in the command. All paths should
  be absolute or relative to `DATA_DIR` (typically `~/.cortex/`).
- **JSON parse error** — the hook's stdout wasn't valid JSON. Check that
  `console.log` is writing valid JSON and nothing else is writing to stdout.
- **Timeout** — the hook took longer than configured. Increase the `timeout`
  value. Default is 30 seconds for thread hooks, 60 seconds for session hooks.
- **Permission denied** — ensure the `.mjs` file is executable and has the
  correct Node.js shebang.
