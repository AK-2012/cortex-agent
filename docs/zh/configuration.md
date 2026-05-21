# 配置


Cortex 在启动时从 `$CORTEX_HOME/config/` 加载所有配置。唯一必需的变量是 `CORTEX_PLATFORM` 和平台凭据（Slack）。其他所有内容都有合理的默认值，大多数用户无需修改。

## 文件层次结构

以下所有路径均相对于 `$CORTEX_HOME`（默认：`~/.cortex/`）。

```
$CORTEX_HOME/
├── .env                          # 平台令牌、功能标志
├── config/
│   ├── .env                      # 同一个文件（符号链接/规范位置）
│   ├── profiles.json             # 命名的智能体配置
│   ├── thread-templates.json     # 智能体定义和编排模板
│   ├── machines.json             # 远程客户端机器注册表
│   ├── budget.json               # 每日/每月预算限制
│   ├── mcp-config.json           # 完整 MCP 服务器配置
│   ├── mcp-config-core.json      # 仅核心 MCP（remote_* 工具）
│   ├── mcp-config-tui.json       # TUI 模式 MCP 配置
│   └── session-hooks.json        # 会话级钩子配置
├── data/
│   ├── mode.json                 # 当前运行时模式和配置
│   ├── schedules.json            # 持久化的调度任务列表
│   ├── executions.json           # 统一执行注册表
│   ├── costs.jsonl               # 90 天滚动费用记录
│   └── sessions.json             # 频道到智能体会话的映射
├── .claude/
│   └── settings.json             # Claude Code 钩子和权限
├── hooks/                        # 钩子脚本（.mjs）
├── plugins/                      # 角色限定技能插件
├── prompts/                      # 系统提示、指令、模板
├── rules/                        # 智能体会话的上下文规则
├── context/                      # Dense Context 知识库
│   └── projects/                 # 研究项目文件
├── logs/                         # 守护进程和 LLM 会话日志
└── tmp/                          # 临时工作区（线程等）
```

## 加载顺序和优先级

1. **内置默认值**（`agent-server/defaults/`）随 npm 包一起发布，为每个配置文件提供回退值。
2. **`$CORTEX_HOME/config/.env`** 在守护进程启动时通过 `dotenv` 加载。这些会覆盖守护进程和所有 fork 子进程的进程环境变量。
3. **`$CORTEX_HOME/config/profiles.json`** 在每次生成智能体时读取，用于解析模型、后端和额外环境变量。
4. **`$CORTEX_HOME/.claude/settings.json`** 由 Claude Code 读取（不是由 Cortex 直接读取），用于配置编程智能体后端的钩子和权限。

`.env` 文件支持标准的 `KEY=VALUE` 语法和 `#` 注释。已在 shell 中设置的环境变量优先于 `.env` 文件（dotenv 默认行为）。

## 环境变量

所有值从 `$CORTEX_HOME/config/.env` 文件加载。只有 `CORTEX_PLATFORM` 和平台凭据是必需的。

### 路径

| 变量 | 默认值 | 用途 |
|---|---|---|
| `CORTEX_HOME` | `~/.cortex/` | 用户数据根目录（配置、上下文、日志、存储） |
| `CORTEX_PROJECTS_DIR` | `<CORTEX_HOME>/context/projects/` | 覆盖项目目录 |
| `CORTEX_REPO` | — | 用于守护进程自动重建/热重载的仓库路径 |

### 启动

| 变量 | 默认值 | 用途 |
|---|---|---|
| `CORTEX_MACHINE` | `os.hostname()` | 启动私信的机器标签 |
| `CORTEX_RESTART_REASON` | — | 重启通知的原因字符串 |
| `CORTEX_CLIENT_PORT` | `3002` | cortex-client 管理器的 WebSocket 端口 |

### 平台（Slack）

| 变量 | 必需 | 用途 |
|---|---|---|
| `CORTEX_PLATFORM` | 是 | `slack`（默认） |
| `SLACK_BOT_TOKEN` | 是 | Slack Bot OAuth 令牌（`xoxb-...`） |
| `SLACK_SIGNING_SECRET` | 是 | Slack 应用签名密钥 |
| `SLACK_APP_TOKEN` | 是 | Socket Mode 的 Slack 应用级令牌（`xapp-...`） |
| `CORTEX_ADMIN_CHANNEL` | 否 | 管理私信频道 ID（运行时自动检测） |

### API

| 变量 | 用途 |
|---|---|
| `ANTHROPIC_API_KEY` | 直接 API 模式的 Anthropic API 密钥 |
| `ANTHROPIC_BASE_URL` | 覆盖 API 基础 URL（由网关代理自动设置） |

### 速率限制（Slack）

| 变量 | 默认值 | 用途 |
|---|---|---|
| `CORTEX_SLACK_RL_GLOBAL_CAPACITY` | `20` | 全局 API 调用令牌桶容量 |
| `CORTEX_SLACK_RL_GLOBAL_REFILL_PER_SEC` | `1` | 全局每秒补充速率 |
| `CORTEX_SLACK_RL_CHANNEL_CAPACITY` | `1` | 每频道令牌桶容量 |
| `CORTEX_SLACK_RL_CHANNEL_REFILL_PER_SEC` | `1` | 每频道每秒补充速率 |

### Webhook

| 变量 | 默认值 | 用途 |
|---|---|---|
| `WEBHOOK_PORT` | `3001` | Webhook HTTP 服务器端口 |
| `WEBHOOK_HOST` | `127.0.0.1` | 远程客户端的回退主机（当 Tailscale/LAN IP 未检测到时） |
| `GITHUB_WEBHOOK_SECRET` | — | GitHub webhook HMAC-SHA256 签名密钥 |

### 数据文件覆盖

| 变量 | 默认值 | 用途 |
|---|---|---|
| `CORTEX_EXECUTIONS_FILE` | `<STORE_DIR>/executions.json` | 执行记录 |
| `CORTEX_COSTS_FILE` | `<STORE_DIR>/costs.jsonl` | 费用追踪 |
| `CORTEX_BUDGET_FILE` | `<CONFIG_DIR>/budget.json` | 预算配置 |

### 功能标志

| 变量 | 默认值 | 用途 |
|---|---|---|
| `DEBUG` | — | 启用调试级日志输出 |
| `CORTEX_EVENT_LOG` | `on` | 设置为 `off` 以禁用事件总线日志 |
| `CORTEX_SHOW_TOOL_CALLS` | — | 在 VirtualMessage 尾部内联渲染工具调用 |
| `CORTEX_INJECT_USER_CONTEXT` | — | 设置为 `1` 以将 `USER.md` 上下文注入线程 |
| `CORTEX_GPU_MONITOR_MOCK` | — | 用于测试的模拟 GPU 数据 JSON（覆盖真实的 nvidia-smi 查询） |

## profiles.json

位于 `$CORTEX_HOME/config/profiles.json`。定义命名智能体配置，控制每个智能体会话使用的后端、模型和额外配置。可用后端对比参见 [backends.md](./backends.md)。

### 模式

```json
{
  "defaultProfile": "plan",
  "profiles": {
    "plan": {
      "model": "claude-sonnet-4-20250514",
      "backend": "claude",
      "mode": "plan",
      "claudeBackend": "print",
      "extraEnv": {},
      "extraOption": {},
      "fallback": []
    },
    "execute": {
      "model": "claude-sonnet-4-20250514",
      "backend": "claude",
      "mode": "execute",
      "claudeBackend": "print",
      "extraEnv": {},
      "extraOption": {}
    }
  }
}
```

### 字段

| 字段 | 类型 | 必需 | 描述 |
|---|---|---|---|
| `defaultProfile` | string | 是 | 未指定配置时使用的默认配置名称 |
| `profiles` | object | 是 | 配置名称到配置项的映射 |
| `profiles.<name>.model` | string | 是 | 模型标识符（如 `claude-sonnet-4-20250514`） |
| `profiles.<name>.backend` | string | 否 | 后端：`claude`、`pi` 或 `codex`（默认：`claude`） |
| `profiles.<name>.mode` | string | 否 | 运行模式标识符（自由格式，如 `plan`、`execute`） |
| `profiles.<name>.extraEnv` | object | 否 | 传递给后端进程的额外环境变量。键必须匹配 `^[A-Z_][A-Z0-9_]*$`。 |
| `profiles.<name>.extraOption` | object | 否 | 传递给后端的额外 CLI 标志。键必须以 `--` 开头。 |
| `profiles.<name>.claudeBackend` | string | 否 | Claude 适配器模式：`print`（默认，使用 `-p` + stream-json）或 `tui`（在 tmux 下交互式 Claude + jsonl tail）。非 claude 后端忽略。 |
| `profiles.<name>.fallback` | array | 否 | 有序的回退配置项列表。如果主后端失败，Cortex 按顺序尝试每个回退项。每个回退项继承主配置中未指定的字段。 |

### 配置解析

在智能体生成时，Cortex 通过以下链解析配置：

1. 如果显式提供了配置名称（通过 `--profile` 或线程模板），使用它。
2. 否则，使用 `profiles.json` 中的 `defaultProfile`。
3. 解析后的配置提供 `model`、`backend`、`mode`、`extraEnv`、`extraOption` 和 `claudeBackend`。
4. 如果后端调用因瞬态错误失败，Cortex 遍历 `fallback` 数组（如果有），按顺序尝试每个条目。

### 验证规则

配置名称必须匹配 `^[a-zA-Z0-9_-]+$`。后端必须是 `claude`、`codex` 或 `pi` 之一。如果指定，`claudeBackend` 必须是 `print` 或 `tui`。未知字段会被静默忽略。

## settings.json

位于 `$CORTEX_HOME/.claude/settings.json`。此文件配置 Claude Code 的钩子和权限系统。Cortex 在 `cortex init` 期间从 `defaults/.claude/settings.json` 初始化它，并且在后续运行中从不覆盖它。

文件遵循 Claude Code 的设置格式，包含 `hooks` 和 `permissions` 部分。钩子系统文档参见 [hooks.md](./hooks.md)。

## defaults/config/ 布局

npm 包中的 `agent-server/defaults/` 目录包含在 init 期间复制到 `$CORTEX_HOME/` 的发布默认值：

| 源 | 目标 | 覆盖行为 |
|---|---|---|
| `defaults/CORTEX.md` | `$CORTEX_HOME/CORTEX.md` | 从不 |
| `defaults/gitignore` | `$CORTEX_HOME/.gitignore` | 从不 |
| `defaults/.claude/settings.json` | `$CORTEX_HOME/.claude/settings.json` | 从不 |
| `defaults/config/budget.json` | `$CORTEX_HOME/config/budget.json` | 仅 `--force` |
| `defaults/config/thread-templates.json` | `$CORTEX_HOME/config/thread-templates.json` | 仅 `--force` |
| `defaults/config/session-hooks.json` | `$CORTEX_HOME/config/session-hooks.json` | 仅 `--force` |
| `defaults/prompts/` | `$CORTEX_HOME/prompts/` | 逐文件：新文件总是添加，已有文件保留除非 `--force` |
| `defaults/plugins/` | `$CORTEX_HOME/plugins/` | 逐文件：新文件总是添加，已有文件保留除非 `--force` |
| `defaults/rules/` | `$CORTEX_HOME/rules/` | 逐文件：新文件总是添加，已有文件保留除非 `--force` |
| `defaults/hooks/` | `$CORTEX_HOME/hooks/` | 逐文件：从不覆盖除非 `--force` |
| `defaults/data/schedules.json` | `$CORTEX_HOME/data/schedules.json` | 从不（除非 `--force`） |
| `defaults/context/` | `$CORTEX_HOME/context/` | 脚手架文件：从不覆盖 |

这种设计意味着 npm 包升级会自动提供新的提示、插件、规则和钩子，而不会覆盖用户的自定义内容。配置文件（`thread-templates.json`、`budget.json` 等）需要 `--force` 才能替换。

## 热重载行为

- **`schedules.json`** — 通过文件监视器监视。更改在几秒钟内生效，无需重启。完整调度系统参见 [scheduling.md](./scheduling.md)。
- **`profiles.json`** — 每次生成智能体时重新读取。更改配置无需重启。
- **`thread-templates.json`** — 每次启动线程时重新读取。
- **`.env`** — 需要守护进程重启才能生效（启动时通过 dotenv 加载一次）。
- **钩子脚本（`hooks/*.mjs`）** — 每次钩子调用时重新读取。
- **插件、提示、规则** — 每次智能体会话生成时重新读取。

## 各文件位置

| 文件 | 用途 | 路径 |
|---|---|---|
| `.env` | 环境变量 | `$CORTEX_HOME/config/.env` |
| `profiles.json` | 智能体配置 | `$CORTEX_HOME/config/profiles.json` |
| `thread-templates.json` | 线程定义 | `$CORTEX_HOME/config/thread-templates.json` |
| `machines.json` | 机器注册表 | `$CORTEX_HOME/config/machines.json` |
| `budget.json` | 预算限制 | `$CORTEX_HOME/config/budget.json` |
| `mcp-config.json` | MCP 服务器配置 | `$CORTEX_HOME/config/mcp-config.json` |
| `settings.json` | Claude 钩子/权限 | `$CORTEX_HOME/.claude/settings.json` |
| `mode.json` | 运行时模式 | `$CORTEX_HOME/data/mode.json` |
| `schedules.json` | 调度任务 | `$CORTEX_HOME/data/schedules.json` |
| `session-hooks.json` | 会话钩子 | `$CORTEX_HOME/config/session-hooks.json` |
