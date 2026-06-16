# MCP — Model Context Protocol


Cortex 内置三个 MCP（Model Context Protocol）服务器，赋予智能体访问远程机器、Cortex 自身的调度和费用系统以及 Slack 的能力。本文档解释每个服务器提供什么、如何配置以及如何添加第三方 MCP 服务器。

## 什么是 MCP

MCP 是一个开放协议，允许 LLM 应用通过标准化的 JSON-RPC 接口（基于 stdio 或 HTTP）向智能体暴露工具。Cortex 使用 MCP 在智能体进程（无法直接访问 agent-server 内部）和服务器能力之间架起桥梁。MCP 支持因后端而异——功能矩阵参见 [backends.md](./backends.md)。

Claude Code 从 JSON 文件读取 MCP 服务器配置，并将每个服务器作为子进程生成。智能体可以像内置工具（Bash、Read、Edit 等）一样调用 MCP 工具，工具名称以 `mcp__<server-name>__` 为前缀。

## 为什么 Cortex 内置自己的 MCP 服务器

Cortex 的 agent-server 维护智能体进程无法直接访问的状态：到远程机器的 WebSocket 连接、调度数据库、费用记录、Slack API 客户端和执行注册表。MCP 服务器充当受控桥梁——智能体调用 MCP 工具，MCP 服务器与 agent-server 内部通信（通过 HTTP 到本地 webhook 服务器端口 3001，或通过读取共享文件），结果流回智能体。

## 内置 MCP 服务器

### cortex-core

暴露与远程机器交互的工具。这是线程/模板会话加载的唯一服务器——线程智能体获得远程机器访问权限，但不获得平台特定、费用或调度工具。

| 工具 | 参数 | 描述 |
|---|---|---|
| `remote_bash` | `device`、`command`、`timeout?`、`description?`、`run_in_background?` | 通过 cortex-client 在远程设备上执行 shell 命令 |
| `remote_read` | `device`、`file_path`、`offset?`、`limit?` | 从远程设备读取文件（支持图像和 PDF） |
| `remote_write` | `device`、`file_path`、`content` | 向远程设备写入文件内容 |
| `remote_edit` | `device`、`file_path`、`old_string`、`new_string`、`replace_all?` | 通过字符串替换编辑远程设备上的文件 |
| `remote_glob` | `device`、`pattern`、`path?` | 在远程设备上查找匹配 glob 模式的文件 |
| `remote_grep` | `device`、`pattern`、`path?`、`glob?`、`type?`、`output_mode?`、`-A?`、`-B?`、`-C?`、`-i?`、`-n?`、`head_limit?`、`offset?`、`multiline?` | 使用 ripgrep 在远程设备上搜索文件内容 |
| `thread_abort` | `kind`、`diagnosis` | 升级你自己的线程（too-big / mis-scoped / blocked-external，终态 `aborted`） |
| `thread_split` | `subtasks` | 把你自己的任务分解为子任务（keep-parent 汇合），子任务走正常派发队列 |
| `thread_wait` | `on_tasks?`、`on_threads?` | 挂起你自己的线程直到被等待的子项完成；与 `cortex-task spawn` 配合使用 |
| `task_status` | `task_id`、`project?` | 读取任务的生命周期状态（status、是否可执行、claimed_by、blocked_by、依赖、parent） |
| `task_result` | `task_id`、`project?` | 读取任务的结果（done/blocked、done_when、完成备注、阻塞原因） |
| `task_list` | `project?`、`status?`、`parent?`、`limit?` | 列出任务（可按 status 或 parent 过滤） |
| `current_time` | `timezone?` | 获取当前日期时间；可选 IANA 时区（默认服务器本地）。返回 Unix 时间戳、UTC ISO 字符串及带偏移的本地时间 |

服务器实现在 `agent-server/src/domain/mcp/core-server.ts`。工具实现在 `agent-server/src/domain/mcp/tools/`。

### cortex-ext

暴露 Cortex 管理工具：调度、费用查询和上下文解析。此服务器仅由直接/用户发起的会话加载——线程智能体不获得这些工具。

| 工具 | 参数 | 描述 |
|---|---|---|
| `cortex_schedule_add` | `type`、`message`、`interval?`、`time?`、`dayOfWeek?`、`delay?`、`target?`、`fallback?`、`profile?`、`preCheck?`、`channel?` | 创建调度任务（interval、daily、weekly 或 once） |
| `cortex_schedule_list` | `limit?` | 列出所有调度任务及其状态 |
| `cortex_schedule_get` | `id` | 通过 8 字符十六进制 ID 查找调度任务 |
| `cortex_schedule_remove` | `id` | 删除调度任务（幂等） |
| `cortex_schedule_pause` | `id` | 暂停周期性调度任务 |
| `cortex_schedule_resume` | `id` | 恢复暂停的调度任务 |
| `cost_query` | _(无)_ | 查询当前费用：今天/月支出、预算限制、剩余预算、API/plan 分摊、来源细分、令牌使用量 |
| `query_executions` | `execution_id?`、`task_id?`、`status?`、`project?`、`limit?` | 查询执行记录——按状态、项目过滤，或按 ID 查找 |
| `cortex_context` | _(无)_ | 返回当前执行上下文：channel、sessionId、sessionName、threadId、profile、project、backend |

服务器实现在 `agent-server/src/domain/mcp/server.ts`。各个工具在 `agent-server/src/domain/mcp/tools/`。

### cortex-slack

Slack 平台特定的 MCP 服务器。仅当会话源自 Slack 时加载，提供平台特定的文件上传和消息功能。

| 工具 | 参数 | 描述 |
|---|---|---|
| `slack_send_file` | `file_path`、`file_name?`、`title?`、`comment?` | 上传本地文件到 Slack |

服务器实现在 `agent-server/src/domain/mcp/slack-server.ts`。

### cortex-feishu

飞书/Lark 平台特定的 MCP 服务器。仅当会话源自飞书时加载，提供全面的文档和文件操作。

| 工具 | 参数 | 描述 |
|---|---|---|
| `feishu_send_file` | `file_path`、`file_name?`、`title?`、`comment?`、`channel?` | 上传本地文件到飞书 |
| `feishu_create_doc` | `title`、`content?`、`folder_token?` | 创建新的飞书文档 |
| `feishu_read_doc` | `doc_token` | 从飞书文档读取内容 |
| `feishu_update_doc` | `doc_token`、`content` | 更新飞书文档的内容 |
| `feishu_delete_doc` | `doc_token` | 删除飞书文档 |
| `feishu_wiki_create` | `space_id`、`title`、`content?` | 在飞书中创建新的 wiki 页面 |
| `feishu_wiki_read` | `node_token` | 从飞书 wiki 页面读取内容 |
| *(更多 bitable/sheets/drive 工具)* | — | 完整列表参见 `agent-server/src/domain/mcp/feishu/index.ts` |

服务器实现在 `agent-server/src/domain/mcp/feishu-server.ts`。各个工具在 `agent-server/src/domain/mcp/feishu/`。

### cortex-tui-bridge

仅在 TUI（终端 UI）模式下加载。将 Claude Code 原生的 `EnterPlanMode`、`ExitPlanMode` 和 `AskUserQuestion` 工具替换为通过 Slack 而非终端路由的 MCP 等效工具。

| 工具 | 描述 |
|---|---|
| `cortex_plan_enter` | 发出智能体处于计划模式的提醒 |
| `cortex_plan_exit` | 读取计划文件，发送到 Slack 供人类审批，阻塞直到解决 |
| `cortex_ask_user` | 通过 Slack 模态框询问 1-4 个问题，阻塞直到回答 |

服务器实现在 `agent-server/src/domain/mcp/tui-server.ts`。工具在 `agent-server/src/domain/mcp/tools/tui-plan.js` 和 `tui-ask.js`。

## MCP 配置文件

Cortex 在启动时自动生成 MCP 配置文件（通过 `agent-server/src/core/config-generator.ts` 和 `agent-server/src/entry/startup-helpers.ts` 中的 `ensureMcpConfig()` 调用）。平台特定的服务器（cortex-slack、cortex-feishu）根据会话的源平台动态加载。

| 文件 | 加载者 | 服务器 |
|---|---|---|
| `~/.cortex/config/mcp-config.json` | 直接/用户发起的会话 | cortex-core + cortex-ext + 平台特定（cortex-slack 或 cortex-feishu） |
| `~/.cortex/config/mcp-config-core.json` | 线程/模板会话 | 仅 cortex-core |
| `~/.cortex/config/mcp-config-tui.json` | TUI 模式会话 | 仅 cortex-tui-bridge |
| `~/.cortex/config/mcp-config-slack.json` | Slack 特定分层（按需） | cortex-slack |

每个文件遵循 Claude Code 的标准 MCP 配置格式：

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

配置文件在每次 agent-server 启动时重新生成。手动编辑它们将被覆盖。要自定义 MCP 配置，修改 `core/config-generator.ts` 中的生成器或工具读取的 profile/budget/schedule 设置。

### 如何选择正确的配置

在 `agent-adapter/claude/spawn-args.ts` 中，MCP 配置路径根据会话上下文选择：

- **TUI 模式**：加载 `mcp-config-tui.json`（仅 cortex-tui-bridge）
- **Print 模式，用户发起的会话**：加载 `mcp-config.json`（cortex-core + cortex-ext + 平台特定）
- **线程/模板会话**：加载 `mcp-config-core.json`（仅 cortex-core）

平台特定的服务器（cortex-slack、cortex-feishu）在 Claude 和 PI 适配器中根据会话的源平台动态加载。线程会话覆盖通过 `session.cortexContext.useCoreMcp` 实现，确保线程智能体仅获得远程机器工具，不获得平台特定、费用或调度工具。

## MCP 工具如何与 agent-server 通信

MCP 服务器作为独立的子进程运行。它们不能直接访问 agent-server 的进程内状态（WebSocket 连接、调度仓库、执行注册表）。相反，它们通过两条路径通信：

1. **HTTP 环回** — 远程机器工具（`remote_bash`、`remote_read` 等）发送 HTTP POST 到 `http://127.0.0.1:3001/webhook/remote-command`。`agent-server/src/orchestration/routing/webhook.ts` 中的 webhook 处理程序将请求转发到 `client-manager.sendCommand()`，后者通过 WebSocket 发送到远程设备。

2. **共享文件访问** — 调度、费用和执行工具直接读取和写入 `~/.cortex/data/` 中的共享数据文件（schedules.json、costs.jsonl、executions.json），使用与主服务器进程相同的仓库层。

## 添加第三方 MCP 服务器

要添加第三方 MCP 服务器（例如数据库连接器、网络搜索工具或自定义研究工具），将其添加到 `~/.cortex/config/mcp-config.json`（如果线程智能体也应该拥有它，还需添加到 `mcp-config-core.json`）：

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

**重要**：配置文件在每次服务器重启时重新生成。要持久化自定义 MCP 服务器条目，你必须修改 `agent-server/src/core/config-generator.ts` 中的生成器（`buildFullConfig()` 和/或 `buildCoreConfig()` 函数），而不是直接编辑 JSON 文件。

类型系统已经通过 `AgentSpawnConfig.mcpServers` 字段（每后端 `McpServerConfig` 数组）支持第三方 MCP 服务器，但截至当前代码库，此字段尚未被适配器消费。所有 MCP 配置仍然通过 `--mcp-config` CLI 标志流动。

## 权限模型

MCP 工具跨越从智能体进程到 agent-server 内部和远程机器的信任边界。Cortex 应用以下控制：

1. **工具可用性** — 智能体的工具列表（按配置和线程模板控制）决定哪些 MCP 工具对智能体可见。线程智能体仅加载 `cortex-core`（无 Slack、无费用、无调度）。

2. **Claude Code 的第三方 MCP 被禁用** — `~/.cortex/.claude/settings.json` 中的设置 `ENABLE_CLAUDEAI_MCP_SERVERS: "false"` 阻止 Claude 从其自身的目录自动发现 MCP 服务器。Cortex 通过自己的配置文件独占管理 MCP 服务器。

3. **绕过权限** — Claude Code 以 `--dangerously-skip-permissions --permission-mode bypassPermissions` 生成，意味着它不会对每个 MCP 工具调用提示。访问控制在 MCP 工具实现级别和通过 PreToolUse 钩子系统进行。

4. **PreToolUse 守卫** — `tasks-yaml-guard.mjs` 钩子拦截对 `TASKS.yaml` 文件的 Edit/Write 操作（包括远程编辑）并检查项目锁。`sensitive-file-edit.mjs` 钩子处理 `.claude/` 路径保护。

5. **网络边界** — 与远程机器通信的 MCP 工具通过 client-manager 的 WebSocket 层。`machines.json` 注册表控制哪些设备是已知的。只有具有活跃 WebSocket 连接的设备才能接收命令。

## 传递给 MCP 服务器的环境变量

MCP 服务器进程接收 agent server 环境变量的一个子集：

| 变量 | 来源 | 使用者 |
|---|---|---|
| `SLACK_CHANNEL` | 生成时的频道参数 | cortex-ext（slack_send_file）、tui-server |
| `SLACK_BOT_TOKEN` | process.env | cortex-ext |
| `CORTEX_SESSION_ID` | 会话上下文 | tui-server、context 工具 |
| `CORTEX_SESSION_NAME` | 会话上下文 | context 工具 |
| `CORTEX_THREAD_ID` | 线程上下文 | context 工具 |
| `CORTEX_PROFILE` | 会话上下文 | context 工具 |
| `CORTEX_PROJECT` | 会话上下文 | context 工具 |
| `CORTEX_EXECUTION_ID` | 执行上下文 | 任务锁钩子 |
| `CORTEX_TUI_MODE` | 在 TUI 模式下设为 `'1'` | tui-server |
| `CORTEX_CALLBACK_SOURCE` | 可选回调元数据 | cortex-ext |
| `CORTEX_SCHEDULE_TASK_ID` | 可选调度任务 ID | cortex-ext |
| `CORTEX_ROUTE_CONTEXT_FILE` | 每回合上下文文件路径 | cortex-ext（Codex 路由） |
| `ANTHROPIC_BASE_URL` | 可选 API 基础 URL 覆盖 | 模型路由 |

## 安全考量

MCP 工具赋予智能体在远程机器上执行 shell 命令、读写文件、上传到 Slack 和修改调度的能力。安全假设如下：

- `cortex-client` WebSocket 端口（3002）不暴露到公网。使用 Tailscale、VPN 或 localhost-only 绑定（网络拓扑选项参见 [cross-machine.md](./cross-machine.md)）。
- Webhook HTTP 端口（3001）仅绑定到 `127.0.0.1`——MCP 服务器通过环回而不是网络与之通信。
- 智能体在与 [safety-and-approvals.md](./safety-and-approvals.md) 中记录的相同影响范围安全边界内运行。MCP 工具不能绕过对高权限操作的 need-approval 门控。
