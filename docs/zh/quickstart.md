# 快速入门


从零开始，大约十分钟内让 Cortex 智能体在 Slack 中回复你，其中大部分时间是在等待 `npm` 安装和填写 Slack 应用创建页面。

`cortex init` 几乎完成所有工作。你不需要手动编辑任何配置文件。本指南只是告诉你每个提示的预期内容。

## 前置条件

- Node.js ≥ 20（Cortex 本身要求 20+；捆绑的编程智能体后端推荐 22）。
- 一个可以创建应用的 Slack 工作区。（也支持飞书/Lark——参见 [slack-setup.md](./slack-setup.md) 了解等效流程。）
- 大约 2 GB 的空闲磁盘空间用于后端、插件和日志。

你**不需要**预先安装 `claude`（Claude Code）或 `pi`（pi-coding-agent）。不需要预先安装 `git`。不需要预先创建任何目录或 env 文件。`cortex init` 会为你安装所有这些。

## 第一步 — 安装 Cortex

```bash
npm install -g @cortex-agent/server
```

这会在你的 PATH 中放置三个可执行文件：`cortex`、`cortex-task`、`cortex-run`。

## 第二步 — 运行设置向导

```bash
cortex init
```

向导会遍历以下提示。默认值都是合理的；按回车接受即可。

1. **选择哪些后端？** — Claude Code（推荐用于 Anthropic 订阅）和/或 PI（用于其他订阅）。你可以两者都选。Cortex 会通过 `npm install -g` 安装你选择的后端。
2. **选择哪个交互平台？** — `Slack`（推荐）或 `Skip`。选择 Slack 会触发下一步。
3. **Slack 令牌。** Cortex 首先打印完整的 **Slack 应用清单**，并询问你是否要复制到剪贴板。将其粘贴到 Slack 的"Create New App → From a manifest"流程中，然后回来按顺序粘贴它要求的三个令牌：`SLACK_SIGNING_SECRET`、`SLACK_APP_TOKEN`（`xapp-…`）、`SLACK_BOT_TOKEN`（`xoxb-…`）。`CORTEX_ADMIN_CHANNEL` 是可选的——留空，Cortex 会在你第一次给机器人发私信时自动检测。Slack 端的完整分步说明见 [slack-setup.md](./slack-setup.md)。
4. **机器名称。** 默认为你的主机名。
5. **GPU 检测。** Cortex 运行 `nvidia-smi` 并打印数量。无需输入。
6. **aistatus 令牌使用报告？** 可选的，选择是否在 [aistatus.cc](https://aistatus.cc) 的公共排行榜上分享匿名令牌计数。如果选择是，你需要提供姓名、组织和邮箱（邮箱仅用于身份识别，不会显示）。
7. **将 Cortex 注册为系统服务？** macOS 会获得一个 `launchd` plist；Linux 会获得一个 `systemd --user` 单元（无需 sudo）；Windows 不支持，需要手动启动。
8. **自动检测 Claude Code / PI 用于网关和配置？** 如果你已在其他 shell 中运行了 `claude login` 和/或 `pi login`，回答是。Cortex 会扫描你的 `~/.claude/.credentials.json` 和 `~/.pi/agent/` 来发现端点，并让你选择哪个发现的（mode, model）对成为 `plan` 配置（由执行智能体使用——planner、doc-writer、coder 等），哪个成为 `execute` 配置（由审查智能体使用）。你也可以稍后通过 `cortex setup-gateway` 运行此步骤。

向导完成后你会看到：

```
Cortex initialized at /Users/you/.cortex. Run `cortex start` to launch.
```

## `cortex init` 创建了什么

所有内容都位于 `CORTEX_HOME`（默认 `~/.cortex/`）下：

```
~/.cortex/
├── .git/                       # 自动 git 初始化，所有状态均已提交
├── CORTEX.md                   # 根智能体上下文（从默认值初始化）
├── config/
│   ├── .env                    # 平台令牌 + CORTEX_MACHINE
│   ├── budget.json             # 每日/每月预算限制
│   ├── machines.json           # 本机能力（gpuCount、路径）
│   ├── mcp-config.json         # 主 MCP 服务器入口
│   ├── mcp-config-core.json    # 受限上下文的子集
│   ├── mcp-config-tui.json     # TUI 模式的子集
│   ├── profiles.json           # 命名的（后端、模型）配置
│   ├── session-hooks.json      # 会话级钩子管道
│   └── thread-templates.json   # 多智能体线程定义
├── data/
│   ├── mode.json               # 当前模式 + 活跃配置
│   └── schedules.json          # 初始化的周期性任务
├── context/                    # 项目日志存放在这里
│   ├── CORTEX.md、projects/、decisions/、scans/、ideas/、retrospectives/、user/
├── plugins/                    # 8 个角色限定技能插件（默认值的完整副本）
├── prompts/                    # 指令、系统提示、模板
├── rules/                      # 智能体自动加载的规则文件
├── hooks/                      # 钩子脚本（.mjs）
├── .claude/                    # Claude Code 钩子 + 设置
└── logs/                       # 守护进程 + LLM 日志
```

正常使用时你**不应该**手动编辑任何这些文件。`cortex init --force` 会重新生成自动生成的文件（`mcp-config*.json`、`machines.json`、`mode.json`），同时保留你的 `.env`、配置和内容文件。

`~/.aistatus/` 单独存放：

```
~/.aistatus/
├── gateway.yaml                # 网关路由配置（自动生成）
└── config.yaml                 # aistatus 上传器设置（你的姓名/组织/邮箱）
```

## 第三步 — 启动服务器

```bash
cortex start          # 前台运行，Ctrl-C 停止
# 或
cortex daemon         # 受监督运行，崩溃重启 + 热重载
```

如果你在第二步选择了注册系统服务，守护进程已经在运行，你可以跳过此步骤。通过以下命令检查：

```bash
cortex config         # 打印解析后的路径 + 初始化状态
```

## 第四步 — 发送你的第一条消息

打开 Slack，找到你刚安装的 Cortex 机器人，给它发私信：

```
hello
```

第一条私信是 Cortex 用来在你留空 `CORTEX_ADMIN_CHANNEL` 时自动检测管理频道的。你应该在几秒钟内收到回复。

尝试一个真正的提示：

```
list my projects
```

或者启动一个线程：

```
!thread direct help me sketch a research plan for X
```

## 接下来读什么

- 创建 Slack 应用时出了问题，或者你想在运行 `cortex init` 之前先完成——阅读 [slack-setup.md](./slack-setup.md)。
- 你想了解 Cortex 识别的每个配置文件和环境变量，或覆盖某个自动生成的路径——阅读 [configuration.md](./configuration.md)。
- 你想了解每个 CLI 子命令和标志——阅读 [cli-reference.md](./cli-reference.md)。
- 你想切换后端或添加其他提供商——阅读 [backends.md](./backends.md)。
