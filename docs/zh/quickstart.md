# 快速入门

从零开始，大约 15 分钟内让 Cortex 智能体在 Slack 中回复你，其中大部分时间是在等待 `npm` 安装和填写 Slack 应用创建页面。

`cortex init` 几乎完成所有工作。你不需要手动编辑任何配置文件。本指南告诉你每个提示的预期内容，并精确指示在 Slack 界面中的操作位置。

## 前置条件

- **Node.js ≥ 20**（Cortex 本身要求 20+；捆绑的编程智能体后端推荐 22）。
- **一个 Slack 工作区**，你可以在其中创建应用。（也支持飞书/Lark——参见 [slack-setup.md](./slack-setup.md) 了解等效流程。）
- **大约 2 GB 空闲磁盘空间**，用于后端、插件和日志。

你**不需要**预先安装 `claude`（Claude Code）或 `pi`（pi-coding-agent）。不需要预先安装 `git`。不需要预先创建任何目录或 env 文件。`cortex init` 会为你安装所有这些。

### 检查 Node.js 版本

打开终端，运行：

```bash
node --version
```

你应该看到类似 `v22.14.0` 的输出。如果版本低于 20，或看到 `command not found: node`，请使用以下方法安装或升级 Node.js。

![在终端中检查 Node.js 版本](./images/node-version-check.png)

### 安装 Node.js

**macOS（Homebrew）：**

```bash
brew install node@22
```

**Linux（nvm，推荐）：**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# 重启终端，然后：
nvm install 22
nvm use 22
```

**Linux（apt，Ubuntu/Debian 24.04+）：**

```bash
sudo apt update && sudo apt install nodejs npm
```

**Windows：**

从 [nodejs.org](https://nodejs.org/) 下载 LTS 安装包（选择 "LTS" 版本，22.x 或更高）。运行 `.msi` 安装程序并按提示操作。安装完成后重启终端。

验证安装：

```bash
node --version   # 应输出 v22.x.y 或 v20.x.y
npm --version    # 应输出 10.x.y 或更高
```

## 第一步 — 安装 Cortex

```bash
npm install -g @cortex-agent/server
```

这会在你的 PATH 中放置三个命令：`cortex`、`cortex-task`、`cortex-run`。

如果 `npm install -g` 因权限错误而失败（Linux 上常见），请加 `sudo`，或更好的做法是配置 npm 使用用户本地前缀：

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g @cortex-agent/server
```

## 第二步 — 运行设置向导

```bash
cortex init
```

向导会遍历以下提示。默认值都是合理的；按回车接受即可。以下是每个提示的作用及如何回答。

### 2.1 选择后端

```
? 你想使用哪些编程智能体后端？
❯ ◯ Claude Code（推荐用于 Anthropic 订阅）
  ◯ PI（用于其他订阅）
```

- **Claude Code** — 如果你有 Anthropic 订阅（Claude Pro、Max 或 API），推荐使用。Cortex 会自动安装。
- **PI** — 如果你通过 PI 订阅其他 LLM 提供商，选此项。

你可以两者都选。Cortex 会在下一步对你选择的每个后端运行 `npm install -g`。

### 2.2 选择交互平台

```
? 选择哪个交互平台？
❯ ● Slack（推荐）
  ○ Skip（稍后配置）
```

选择 **Slack**。这将触发下面的令牌收集步骤。如果选择 Skip，稍后可通过 `cortex init --force` 或编辑 `$CORTEX_HOME/config/.env` 来配置平台。

### 2.3 Slack 应用设置（在浏览器中逐步操作）

Cortex 首先打印完整的 **Slack 应用清单**，并询问是否要复制到剪贴板。回答 **Yes** — 清单 JSON 现在已复制到剪贴板。

现在切换到浏览器。以下是精确的操作位置和点击内容。

#### a) 打开 Slack API 应用页面

前往 **[https://api.slack.com/apps](https://api.slack.com/apps)**。

![Slack API 应用页面](./images/slack-api-apps.png)

#### b) 从清单创建新应用

点击绿色的 **Create New App** 按钮，然后点击 **From a manifest**。

![Create New App → From a manifest](./images/slack-create-from-manifest.png)

#### c) 选择工作区并粘贴清单

1. 从右上角的下拉菜单中选择你的 Slack 工作区。
2. 将清单 JSON 粘贴到文本区域（Ctrl+V / Cmd+V）。清单已由 `cortex init` 复制到剪贴板，直接粘贴即可。
3. 点击 **Next**。
4. 查看摘要后点击 **Create**。

![粘贴清单并选择工作区](./images/slack-paste-manifest.png)

#### d) 复制 Signing Secret

创建完成后，Slack 会将你带到应用的 **Basic Information** 页面。在 **App Credentials** 下方，找到 **Signing Secret**。点击 **Show** 并复制。

回到终端，将其粘贴为 `SLACK_SIGNING_SECRET`。

![复制 Signing Secret](./images/slack-signing-secret.png)

#### e) 生成 App-Level Token（xapp-…）

在同一 **Basic Information** 页面向下滚动到 **App-Level Tokens** 部分。点击 **Generate Token and Scopes**。

- Token Name：`cortex-socket`
- Add Scope：`connections:write`
- 点击 **Generate**

复制出现的令牌（以 `xapp-` 开头）。注意：令牌只显示一次，请立即复制。

回到终端，将其粘贴为 `SLACK_APP_TOKEN`。

![生成 App-Level Token](./images/slack-app-token.png)

#### f) 安装到工作区并复制 Bot Token（xoxb-…）

在左侧边栏中点击 **OAuth & Permissions**。滚动到 **OAuth Tokens** 部分，点击 **Install to Workspace**。在授权页面上点击 **Allow**。

安装完成后，页面顶部会显示 **Bot User OAuth Token**（以 `xoxb-` 开头）。复制它。

回到终端，将其粘贴为 `SLACK_BOT_TOKEN`。

![OAuth & Permissions → Install to Workspace](./images/slack-oauth-install.png)

![复制 Bot User OAuth Token](./images/slack-bot-token.png)

#### g) 启用 Messages Tab

在左侧边栏中点击 **App Home**。向下滚动到 **Show Tabs** 部分：

- 勾选 **Messages Tab**（使其出现在机器人的 App Home 中）。
- 勾选 **Allow users to send Slash commands and messages from the
  messages tab**（以便你可以给机器人发私信）。

如果不勾选此项，你可以在频道中 `@cortex` 机器人，但无法给它发私信。

![在 App Home 中启用 Messages Tab](./images/slack-messages-tab.png)

#### h) 管理频道（可选）

Cortex 会询问 `CORTEX_ADMIN_CHANNEL`。你可以**留空** — Cortex 会在你第一次给它发私信时自动检测管理频道。

如果你想显式指定（例如管理通知应发送到共享频道），从 Slack 获取频道 ID：右键点击频道名称 → View channel details → 在对话框底部复制 Channel ID。

### 2.4 机器名称

默认为你的主机名。除非你想要自定义标签，否则直接按回车。

### 2.5 GPU 检测

Cortex 运行 `nvidia-smi` 并打印数量。无需输入。如果没有 NVIDIA GPU，它会打印 0 — 对于大多数使用场景完全没问题。

### 2.6 aistatus 令牌使用报告？

可选的，选择是否在 [aistatus.cc](https://aistatus.cc) 的公共排行榜上分享匿名令牌计数。如果选择是，需提供姓名、组织和邮箱（邮箱仅用于身份识别，不会显示）。

### 2.7 注册为系统服务？

- **macOS** — 在 `~/Library/LaunchAgents/com.cortex.daemon.plist` 创建 `launchd` plist。守护进程在登录时自动启动。
- **Linux** — 创建 `systemd --user` 单元（无需 `sudo`）。守护进程在登录时自动启动。
- **Windows** — 不支持。需手动运行 `cortex start`。

### 2.8 自动检测后端用于网关/配置？

如果你已在其他终端中运行了 `claude login` 和/或 `pi login`，回答 **Yes**。Cortex 会扫描你的 `~/.claude/.credentials.json` 和 `~/.pi/agent/` 来发现端点，并让你选择哪个发现的（mode, model）对成为 `plan` 配置（由执行智能体使用——planner、doc-writer、coder 等），哪个成为 `execute` 配置（由审查智能体使用）。

你也可以稍后通过 `cortex setup-gateway` 运行此步骤。

---

向导完成后你会看到：

```
Cortex initialized at /home/you/.cortex. Run `cortex start` to launch.
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

如果你在第二步 2.7 中选择了注册系统服务，守护进程已在运行，可以跳过此步骤。通过以下命令检查：

```bash
cortex config         # 打印解析后的路径 + 初始化状态
```

你应该看到确认守护进程正在运行的输出，包括 Slack 连接状态和活跃的配置。

![cortex config 输出](./images/cortex-config.png)

## 第四步 — 发送你的第一条消息

现在进入有趣的部分。打开 Slack，找到你刚安装的 Cortex 机器人，发起私信（DM）。

### 4.1 打个招呼

给机器人发私信：

```
hello
```

第一条私信是 Cortex 用来在你留空 `CORTEX_ADMIN_CHANNEL` 时自动检测管理频道的。你应该在几秒钟内收到回复。

![第一条私信：hello](./images/slack-first-dm.png)

### 4.2 创建你的第一个项目

给 Cortex 一个使命。Cortex 会创建项目、设置目录结构并回复确认：

```
创建一个叫"天气看板"的项目，我想做一个显示我所在城市天气的简单网页看板
```

Cortex 会回复它创建的项目结构、分解的初始任务，并询问是否要开始执行。

![通过私信创建项目](./images/slack-create-project.png)

### 4.3 在已有项目中创建任务

有了项目后，可以直接从 Slack 添加任务：

```
在天气看板项目中添加一个任务：用 Chart.js 做一个5天天气预报的图表
```

Cortex 会将任务添加到项目的 `TASKS.yaml` 中，分配 hex ID、设置优先级和依赖关系，并回复确认。

![通过私信创建任务](./images/slack-create-task.png)

### 4.4 查看项目状态

```
天气看板项目进展如何
```

Cortex 会读取项目的 `STATUS.md`、`TASKS.yaml` 和最近的实验记录，然后给你一个当前状况的摘要。

一旦项目任务队列中有任务，Cortex 会自动挑选并派发优先级最高且就绪的任务——你不需要告诉它"开始执行"。只需持续添加任务，Cortex 会自主推进。

## 接下来读什么

- 创建 Slack 应用时出了问题，或想在运行 `cortex init` 之前先完成设置 — 阅读 [slack-setup.md](./slack-setup.md)。
- 想了解 Cortex 识别的每个配置文件和环境变量，或覆盖某个自动生成的路径 — 阅读 [configuration.md](./configuration.md)。
- 想了解每个 CLI 子命令和标志 — 阅读 [cli-reference.md](./cli-reference.md)。
- 想切换后端或添加其他提供商 — 阅读 [backends.md](./backends.md)。
- 想了解多智能体线程管道的工作原理 — 阅读 [threads.md](./threads.md)。
- 想将远程机器连接到 Cortex — 阅读 [cross-machine.md](./cross-machine.md)。
- 想了解项目日志结构（实验、知识、模式）— 阅读 [memory.md](./memory.md)。
