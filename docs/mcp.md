# MCP — Model Context Protocol

Cortex ships three bundled MCP (Model Context Protocol) servers that give the
agent access to remote machines, Cortex's own scheduling and cost systems, and
Slack. This document explains what each server provides, how they are
configured, and how to add third-party MCP servers.

## What MCP is

MCP is an open protocol that lets LLM applications expose tools to agents
through a standardized JSON-RPC interface over stdio or HTTP. Cortex uses MCP
to bridge between the agent process (which has no direct access to
agent-server internals) and the server's capabilities. MCP support varies by
backend — see the feature matrix in [backends.md](./backends.md).

Claude Code reads MCP server configurations from a JSON file and spawns each
server as a child process. The agent can then call MCP tools just like
built-in tools (Bash, Read, Edit, etc.), with the tool names prefixed by
`mcp__<server-name>__`.

## Why Cortex ships its own MCP servers

Cortex's agent-server maintains state that the agent process cannot access
directly: WebSocket connections to remote machines, the schedule database,
cost records, the Slack API client, and execution registry. MCP servers serve
as a controlled bridge — the agent calls an MCP tool, the MCP server talks to
agent-server internals (via HTTP to the local webhook server on port 3001, or
by reading shared files), and the result flows back to the agent.

## The three bundled MCP servers

### cortex-core

Exposes tools for interacting with remote machines. This is the only server
loaded by thread/template sessions — thread agents get remote machine access
but not Slack, cost, or schedule tools.

| Tool | Parameters | Description |
|---|---|---|
| `remote_bash` | `device`, `command`, `timeout?`, `description?`, `run_in_background?` | Execute a shell command on a remote device via cortex-client |
| `remote_read` | `device`, `file_path`, `offset?`, `limit?` | Read a file from a remote device (supports images and PDFs) |
| `remote_write` | `device`, `file_path`, `content` | Write content to a file on a remote device |
| `remote_edit` | `device`, `file_path`, `old_string`, `new_string`, `replace_all?` | Edit a file on a remote device by string replacement |
| `remote_glob` | `device`, `pattern`, `path?` | Find files matching a glob pattern on a remote device |
| `remote_grep` | `device`, `pattern`, `path?`, `glob?`, `type?`, `output_mode?`, `-A?`, `-B?`, `-C?`, `-i?`, `-n?`, `head_limit?`, `offset?`, `multiline?` | Search file contents on a remote device using ripgrep |
| `current_time` | `timezone?` | Get the current date/time; optional IANA timezone (defaults to server local). Returns Unix epoch, UTC ISO, and localized wall-clock with offset |

The server implementation is at
`agent-server/src/domain/mcp/core-server.ts`. Tools are implemented in
`agent-server/src/domain/mcp/tools/task-ops.ts`.

### cortex-ext

Exposes Cortex management tools: scheduling, cost queries, execution tracking,
Slack file upload, and context resolution. This server is only loaded by
direct/user-initiated sessions — thread agents do not get these tools.

| Tool | Parameters | Description |
|---|---|---|
| `cortex_schedule_add` | `type`, `message`, `interval?`, `time?`, `dayOfWeek?`, `delay?`, `target?`, `fallback?`, `profile?`, `preCheck?`, `channel?` | Create a scheduled task (interval, daily, weekly, or once) |
| `cortex_schedule_list` | `limit?` | List all scheduled tasks with their status |
| `cortex_schedule_get` | `id` | Look up a scheduled task by its 8-char hex ID |
| `cortex_schedule_remove` | `id` | Delete a scheduled task (idempotent) |
| `cortex_schedule_pause` | `id` | Pause a recurring scheduled task |
| `cortex_schedule_resume` | `id` | Resume a paused scheduled task |
| `cost_query` | _(none)_ | Query current cost: today/month spending, budget limits, remaining budget, API/plan split, source breakdown, token usage |
| `query_executions` | `execution_id?`, `task_id?`, `status?`, `project?`, `limit?` | Query execution records — filter by status, project, or look up by ID |
| `cortex_context` | _(none)_ | Return the current execution context: channel, sessionId, sessionName, threadId, profile, project, backend |
| `slack_send_file` | `file_path`, `file_name?`, `title?`, `comment?` | Upload a local file to Slack |

The server implementation is at `agent-server/src/domain/mcp/server.ts`.
Individual tools are in `agent-server/src/domain/mcp/tools/`:
`slack.js`, `cost.js`, `executions.js`, `context.js`, `schedule.js`.

### cortex-tui-bridge

Only loaded in TUI (terminal UI) mode. Replaces Claude Code's native
`EnterPlanMode`, `ExitPlanMode`, and `AskUserQuestion` tools with MCP
equivalents that route through Slack instead of the terminal.

| Tool | Description |
|---|---|
| `cortex_plan_enter` | Emits a reminder that the agent is in plan mode |
| `cortex_plan_exit` | Reads the plan file, sends to Slack for human approval, blocks until resolved |
| `cortex_ask_user` | Asks 1–4 questions via Slack modal, blocks until answered |

The server implementation is at `agent-server/src/domain/mcp/tui-server.ts`.
Tools are in `agent-server/src/domain/mcp/tools/tui-plan.js` and `tui-ask.js`.

## MCP configuration files

Cortex auto-generates three MCP config files at startup (via
`agent-server/src/core/config-generator.ts` and the `ensureMcpConfig()` call
in `agent-server/src/entry/startup-helpers.ts`):

| File | Loaded by | Servers |
|---|---|---|
| `~/.cortex/config/mcp-config.json` | Direct/user-initiated sessions | cortex-core + cortex-ext |
| `~/.cortex/config/mcp-config-core.json` | Thread/template sessions | cortex-core only |
| `~/.cortex/config/mcp-config-tui.json` | TUI mode sessions | cortex-tui-bridge only |

Each file follows Claude Code's standard MCP config format:

```json
{
  "mcpServers": {
    "cortex-core": {
      "command": "node",
      "args": ["/path/to/core-server.js"],
      "cwd": "/path/to/cwd"
    },
    "cortex-ext": {
      "command": "node",
      "args": ["/path/to/server.js"],
      "cwd": "/path/to/cwd"
    }
  }
}
```

The config files are regenerated on every agent-server startup. Manual edits
to them will be overwritten. To customize MCP configuration, modify the
generator in `core/config-generator.ts` or the profile/budget/schedule settings
that the tools read.

### How the right config gets selected

In `agent-adapter/claude/spawn-args.ts`, the MCP config path is selected based
on session context:

- **TUI mode**: loads `mcp-config-tui.json`
- **Print mode, user-initiated sessions**: loads `mcp-config.json`
- **Thread/template sessions**: loads `mcp-config-core.json`

The thread session override happens in the Claude adapter
(`adapter.ts`), which checks `session.cortexContext.useCoreMcp`. This field is
set by the thread executor to ensure thread agents only get remote machine
tools, not Slack, cost, or scheduling tools.

## How MCP tools communicate with agent-server

MCP servers run as separate child processes. They cannot directly access
agent-server in-process state (WebSocket connections, the schedule repo, the
execution registry). Instead, they communicate through two paths:

1. **HTTP loopback** — remote machine tools (`remote_bash`, `remote_read`,
   etc.) send HTTP POST to `http://127.0.0.1:3001/webhook/remote-command`.
   The webhook handler in `agent-server/src/orchestration/routing/webhook.ts`
   forwards the request to `client-manager.sendCommand()`, which sends it over
   WebSocket to the remote device.

2. **Shared file access** — schedule, cost, and execution tools read and write
   the shared data files in `~/.cortex/data/` (schedules.json, costs.jsonl,
   executions.json) directly, using the same repository layer as the main
   server process.

## Adding a third-party MCP server

To add a third-party MCP server (e.g., a database connector, a web search
tool, or a custom research tool), add it to `~/.cortex/config/mcp-config.json`
(and `mcp-config-core.json` if thread agents should also have it):

```json
{
  "mcpServers": {
    "cortex-core": { "command": "node", "args": ["..."], "cwd": "..." },
    "cortex-ext": { "command": "node", "args": ["..."], "cwd": "..." },
    "my-custom-server": {
      "command": "python",
      "args": ["/home/user/my-mcp-server/server.py"],
      "env": { "API_KEY": "${MY_API_KEY}" }
    }
  }
}
```

**Important**: the config files are regenerated on every server restart. To
persist custom MCP server entries, you must modify the generator in
`agent-server/src/core/config-generator.ts` (the `buildFullConfig()` and/or
`buildCoreConfig()` functions) rather than editing the JSON files directly.

The type system already supports third-party MCP servers through the
`AgentSpawnConfig.mcpServers` field (per-backend `McpServerConfig` array), but
this field is not yet consumed by the adapters as of the current codebase. All
MCP configuration still flows through the `--mcp-config` CLI flag.

## Permission model

MCP tools cross the trust boundary from the agent process into agent-server
internals and remote machines. Cortex applies the following controls:

1. **Tool availability** — the agent's tool list (controlled per profile and
   per thread template) determines which MCP tools appear to the agent. Thread
   agents load only `cortex-core` (no Slack, no cost, no scheduling).

2. **Claude Code's third-party MCP is disabled** — the setting
   `ENABLE_CLAUDEAI_MCP_SERVERS: "false"` in `~/.cortex/.claude/settings.json`
   prevents Claude from auto-discovering MCP servers from its own directory.
   Cortex exclusively manages MCP servers through its own config files.

3. **Bypass permissions** — Claude Code is spawned with
   `--dangerously-skip-permissions --permission-mode bypassPermissions`,
   meaning it won't prompt for each MCP tool call. Access control happens at
   the MCP tool implementation level and through the PreToolUse hook system.

4. **PreToolUse guards** — the `tasks-yaml-guard.mjs` hook intercepts
   Edit/Write operations on `TASKS.yaml` files (including remote edits) and
   checks project locks. The `sensitive-file-edit.mjs` hook handles
   `.claude/` path protection.

5. **Network boundary** — MCP tools that talk to remote machines go through
   the client-manager's WebSocket layer. The `machines.json` registry
   controls which devices are known. Only devices with an active WebSocket
   connection can receive commands.

## Environment variables passed to MCP servers

The MCP server processes receive a subset of the agent server's environment:

| Variable | Source | Used by |
|---|---|---|
| `SLACK_CHANNEL` | Channel parameter at spawn time | cortex-ext (slack_send_file), tui-server |
| `SLACK_BOT_TOKEN` | process.env | cortex-ext |
| `CORTEX_SESSION_ID` | Session context | tui-server, context tools |
| `CORTEX_SESSION_NAME` | Session context | context tools |
| `CORTEX_THREAD_ID` | Thread context | context tools |
| `CORTEX_PROFILE` | Session context | context tools |
| `CORTEX_PROJECT` | Session context | context tools |
| `CORTEX_EXECUTION_ID` | Execution context | task lock hooks |
| `CORTEX_TUI_MODE` | Set to `'1'` in TUI mode | tui-server |
| `CORTEX_CALLBACK_SOURCE` | Optional callback metadata | cortex-ext |
| `CORTEX_SCHEDULE_TASK_ID` | Optional schedule task ID | cortex-ext |
| `CORTEX_ROUTE_CONTEXT_FILE` | Per-turn context file path | cortex-ext (Codex routing) |
| `ANTHROPIC_BASE_URL` | Optional API base URL override | Model routing |

## Security considerations

MCP tools give the agent the ability to execute shell commands on remote
machines, read and write files, upload to Slack, and modify schedules. The
security posture assumes:

- The `cortex-client` WebSocket port (3002) is not exposed to the public
  internet. Use Tailscale, a VPN, or localhost-only binding (see
  [cross-machine.md](./cross-machine.md) for network topology options).
- The webhook HTTP port (3001) is bound to `127.0.0.1` only — MCP servers
  talk to it via loopback, not over the network.
- The agent operates within the same blast-radius safety boundaries documented
  in [safety-and-approvals.md](./safety-and-approvals.md). MCP tools cannot
  bypass the need-approval gating for high-privilege operations.
