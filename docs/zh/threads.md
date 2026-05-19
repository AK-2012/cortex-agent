# Cortex 线程系统


线程系统是 Cortex 的多智能体编排引擎。线程是一个聚焦的智能体接力——每个智能体拥有自己的系统提示、工具和插件——在它们之间传递共享的产物文件以完成复杂的多步骤研究工作。

## 心智模型

线程就像接力赛。每个智能体（跑者）拿起接力棒（`artifact.md` 文件），完成自己的工作，并根据转换规则将接力棒交给下一个智能体。产物文件是共享内存——智能体将发现写入其中，后续智能体读取之前的输出。

线程由 `~/.cortex/config/thread-templates.json` 中的**模板**定义。线程通常由任务调度系统启动——任务如何触发线程执行参见 [tasks.md](./tasks.md)。模板指定：哪些智能体参与、以什么顺序、按什么转换逻辑、以及在步骤之间触发什么生命周期钩子。

## 配置文件

线程系统通过 `~/.cortex/config/thread-templates.json` 配置（从 `$CORTEX_HOME/config/thread-templates.json` 读取）。此文件有两个顶级部分：

```json
{
  "agents": { ... },      // 独立的智能体定义
  "templates": { ... }    // 多智能体管道模板
}
```

配置支持**热重载**：对 `thread-templates.json` 或 `prompts/` 目录中任何提示文件的更改通过 `fs.watch`（300ms 去抖）检测，并在不重启服务器的情况下重新加载。重载时向管理 Slack 频道发送通知。

### 智能体定义

`agents` 映射中的每个智能体都是一个独立的实体，有自己的身份、工具和提示：

```json
{
  "agents": {
    "planner": {
      "description": "规划研究方法",
      "profile": "claude-sonnet",
      "persistSession": false,
      "directive": "你是一个研究规划器。将问题分解为可测试的假设。",
      "promptTemplate": "file:planner-prompt.md",
      "pluginDirs": ["plugins/cortex-common", "plugins/cortex-surveyor"],
      "tools": "Agent,AskUserQuestion,Bash,Read,Grep,Glob,Write,Edit,WebSearch,WebFetch,Skill"
    }
  }
}
```

**智能体定义字段：**

| 字段 | 类型 | 描述 |
|-------|------|-------------|
| `name` | string | 智能体 ID（agents 映射中的键） |
| `profile` | string | `profiles.json` 中的配置名称，或使用当前运行时配置的 `"__active__"` |
| `persistSession` | boolean | `true`：在迭代间重用相同的 LLM 会话（保留对话上下文）。`false`：每个步骤使用新会话 |
| `directive` | string? | 智能体角色/身份，添加到提示之前。支持 `file:filename.md` 引用 |
| `systemPrompt` | string? | 完整系统提示覆盖。支持 `file:` 引用 |
| `promptTemplate` | string? | 带 `{{input}}`、`{{artifactPath}}`、`{{previousOutput}}`、`{{modifiedFiles}}`、`{{modifiedFilesWithDiff}}`、`{{currentDateTime}}` 变量的模板。支持 `file:` 引用 |
| `claudeAgent` | string? | Claude Code 智能体名称（`--agent` 标志，从 `.claude/agents/` 加载） |
| `outputStyle` | string? | Claude Code 输出风格 |
| `tools` | string? | 逗号分隔的工具列表（覆盖默认值） |
| `pluginDirs` | string[]? | 要加载的插件目录（`--plugin-dir` 标志） |

### 多阶段智能体

智能体可以通过 `stages` 字段声明多个**阶段**。当存在阶段时，`promptTemplate` 被忽略——引擎根据转换目标为每个步骤选择适当的阶段提示。

```json
{
  "coder": {
    "profile": "claude-sonnet",
    "persistSession": true,
    "pluginDirs": ["plugins/cortex-coder"],
    "stages": {
      "implement": {
        "promptTemplate": "你正在实施计划。将代码写入 {{artifactPath}}。",
        "description": "编写实现"
      },
      "review": {
        "promptTemplate": "你正在审查 {{artifactPath}} 中的代码。检查正确性。",
        "continuesSession": true,
        "description": "审查实现"
      }
    },
    "entryStage": "implement"
  }
}
```

当阶段上设置了 `continuesSession: true`，且智能体有一个正在恢复的持久会话时，引擎只发送阶段特定的增量提示——跳过指令、协议引言和自动的 `previousOutput` 注入。

### 文件引用

接受 `file:filename.md` 语法的字段从 `prompts/<subdir>/filename.md` 加载内容：

| 字段 | 子目录 |
|-------|-------------|
| `directive` | `prompts/directives/` |
| `promptTemplate` | `prompts/promptTemplates/` |
| `systemPrompt` | `prompts/systemPrompts/` |

模板系统支持基于 YAML frontmatter 的格式，包括 `extends:`（继承）、`@fill(name)`/`@endfill` 命名块、`@block(name)`/`@endblock` 模板块、`${var}`/`${var:-default}` 变量插值和 `@if(var)`/`@endif` 条件。

## 模板

模板将智能体组合为多步骤管道：

```json
{
  "templates": {
    "coder-review": {
      "description": "实现一个功能然后审查它",
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

**模板字段：**

| 字段 | 类型 | 描述 |
|-------|------|-------------|
| `name` | string | 模板 ID（用于 `!thread <name>` 和任务调度） |
| `agents` | TemplateAgentRef[] | 有序的参与智能体列表 |
| `transitions` | TransitionRule[] | 控制何时从一个智能体移动到下一个的规则 |
| `entryAgent` | string | 第一个运行的智能体 |
| `entryStage` | string? | 第一步进入哪个阶段（默认为智能体的 `entryStage`） |
| `maxTotalSteps` | number | 智能体步骤总数的硬限制 |
| `maxTotalCostUsd` | number? | USD 费用限制 |
| `hooks` | ThreadHooks? | 生命周期钩子（onStart、onTransition、onEnd） |

### 模板中的智能体引用

模板按名称（字符串）或按模板覆盖（对象）引用智能体：

```json
// 简单引用 — 使用定义的智能体
"agents": ["planner", "reviewer"]

// 带覆盖 — 为此模板自定义智能体
"agents": [
  {"ref": "planner"},
  {"ref": "coder", "promptTemplate": "file:special-coder-prompt.md", "tools": "Read,Write,Edit"}
]
```

覆盖字段：`promptTemplate`、`directive`、`systemPrompt`、`persistSession`、`claudeAgent`、`outputStyle`、`tools`、`pluginDirs`。

## 转换

转换决定线程如何从一个智能体移动到下一个。它们在每个智能体步骤完成后进行评估。

### 转换端点语法

端点使用 `"agent"` 或 `"agent:stage"` 语法。裸智能体名称匹配该智能体的任何阶段。`agent:stage` 端点仅匹配该特定阶段。

### 条件类型

| 类型 | 行为 | 参数 |
|------|----------|------------|
| `always` | 总是转换 | 无 |
| `convergence` | 循环直到产物输出中出现标记字符串，或达到 `maxIterations` | `marker`（要查找的字符串），`maxIterations`（最大循环次数，默认 3） |
| `output_contains` | 如果产物输出匹配正则表达式模式则转换 | `pattern`（正则表达式字符串） |
| `output_not_contains` | 如果产物输出不匹配正则表达式模式则转换 | `pattern`（正则表达式字符串） |

### 评估顺序

转换按模板中出现的顺序评估。**第一个匹配的规则胜出**。如果没有规则匹配，线程停止（终止状态：`no_matching_transition`）。

规则的 `from` 端点与最后完成的步骤匹配。只有 `from` 匹配最后步骤的智能体（和可选的阶段）的规则才会被考虑。

### 收敛示例

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

这表示：`coder:implement` 运行后，检查产物是否包含 `[IMPLEMENTATION COMPLETE]`。如果包含，转换到 `coder:review`。如果不包含，循环回 `coder:implement`。如果循环 5 次没有标记，以 `max_iterations` 停止。

### 模板限制

在评估任何转换之前检查两个硬限制：

- `maxTotalSteps` — 如果线程已达到这么多的总步骤数，以 `max_iterations` 停止
- `maxTotalCostUsd` — 如果累计费用超过此值，以 `cost_limit` 停止

## 线程生命周期

### 状态

线程在其生命周期中经历这些状态：

```
running → completed   （所有步骤成功完成）
running → failed      （不可恢复的错误）
running → cancelled   （用户通过 !cancel 或按钮取消）
running → aborted     （智能体通过产物中的 [ABORT] 标记自行中止）
running → waiting     （等待用户输入 — 第 6 阶段缓冲）
```

终止状态：`completed`、`failed`、`cancelled`、`aborted`。

### 智能体发起的中止

线程中的任何智能体都可以通过向产物文件写入 `[ABORT]` 或 `[ABORT: <reason>]` 来中止整个线程。中止标记在每个智能体步骤完成后检查，并且**优先级高于所有转换规则**。检测到时，线程立即终止，状态为 `aborted`，但 `onEnd` 钩子仍然触发。

### 执行循环

`runner.ts` 中的主执行循环运行如下：

1. **onStart 钩子**：在第一步之前触发（先模板钩子，然后是调用者的 extraHooks）
2. **循环**：
   a. 解析下一步（哪个智能体、哪个阶段）
   b. 构建步骤配置（提示、会话、配置、执行注册表条目）
   c. 设置流式回调（助手消息聚合、工具追踪）
   d. 执行智能体（生成 LLM 进程，等待结果）
   e. 记录步骤结果（持久化到线程存储、注册会话、完成执行）
   f. 检查中止标记（产物中的 `[ABORT]`）
   g. 评估转换（第一个匹配的规则胜出，或停止）
   h. **onTransition 钩子**：步骤之间触发（如果正在转换）
3. **onEnd 钩子**：主循环完成后触发
4. 将线程标记为已完成（如果仍在运行）

## 生命周期钩子

钩子是在线程生命周期的特定点执行的 shell 命令。它们通过 stdin 接收 JSON 格式的上下文，并可以通过 stdout 返回 JSON 格式的指令。线程钩子是三个钩子子系统之一——完整的钩子架构（包括智能体级和会话级钩子）参见 [hooks.md](./hooks.md)。

### 钩子点

| 钩子 | 触发时机 | 上下文 |
|------|--------------|---------|
| `onStart` | 第一个智能体步骤之前 | `{ threadId, templateName, phase: "start", steps: [], activeAgent, artifactContent, userMessage, totalCostUsd }` |
| `onTransition` | 每次转换之后，下一个步骤之前 | 同上，加上标识刚完成的智能体的 `previousAgent` |
| `onEnd` | 所有步骤完成后，线程被标记为完成之前 | 同上，包含最终产物内容和已完成的步骤 |

### 钩子配置

```json
{
  "onEnd": {
    "command": "node hooks/post-task-hook.mjs",
    "args": ["--project", "flywheel"],
    "timeout": 30000
  }
}
```

- `command` — 完整的 shell 调用（必须包括解释器：`node ...`、`bash ...` 等）
- `args` — 通过 `sh -c 'cmd "$@"'` 作为 `$1`、`$2`、...传递的位置参数
- `timeout` — 执行超时（毫秒，默认：30000）

### 钩子返回值

钩子通过 stdout 返回 JSON 来控制接下来发生的事情：

**插入临时智能体：**
```json
{
  "insertAgent": true,
  "prompt": "运行任务后清理：验证所有测试通过",
  "profile": "claude-haiku",
  "directive": "你是一个清理智能体"
}
```
这会创建一个新的临时智能体，运行给定的提示，然后线程继续正常进行。

**针对已有智能体的会话：**
```json
{
  "targetAgent": "reviewer",
  "prompt": "根据原始要求再次检查产物中的结果"
}
```
这会将提示发送到 `reviewer` 智能体的持久会话（如果进程仍然存活则通过 stdin，如果已死则通过 `--resume`）。`targetAgent` 优先于 `insertAgent`。

### 钩子执行顺序

模板钩子先触发，然后是调用者的 `extraHooks`（由调度器/分发器注入）在同一阶段。两者使用相同的执行语义。ExtraHooks 不会持久化到 ThreadRecord——它们仅对当前的 `runThread()` 调用有效。

## 工作区和产物

每个线程在文件系统上获得一个隔离的工作区：

```
tmp/threads/thr_a1b2c3d4/
├── artifact.md        # 共享产物——智能体读和写此文件
└── ...                # 智能体创建的任何其他文件
```

产物路径对所有智能体通过 `{{artifactPath}}` 模板变量可用。智能体通过读取之前智能体写入的内容并追加自己的发现来进行通信。

智能体还可以读取之前智能体修改的文件：
- `{{previousOutput}}` — 上一个已完成步骤的完整输出
- `{{modifiedFiles}}` — 上一个智能体编辑的文件列表（从会话活动日志中提取）
- `{{modifiedFilesWithDiff}}` — 文件列表，带有从会话活动 JSONL 重建的每文件 diff 块

## 线程命令

### 启动线程

```
!thread coder-review 为 API 实现用户认证
!thread researcher 调研触觉感知的最新论文
```

`!thread` 后的第一个词是模板名称（或单智能体执行的智能体名称）。其余是传递给第一个智能体的用户消息。

### 添加智能体

```
!thread add reviewer
!thread add critic 请关注安全影响
```

这会向已有线程动态添加一个智能体。线程必须已完成或等待中（不是当前正在运行）。如果线程是 auto-record（没有文件系统工作区），则延迟创建工作区。

### 其他线程命令

| 命令 | 描述 |
|---------|-------------|
| `!thread list` | 列出活跃线程 |
| `!thread status [id]` | 显示线程状态和步骤 |
| `!thread cancel [id]` | 取消运行中的线程 |
| `!thread agents` | 列出可用智能体 |
| `!thread templates` | 列出可用模板 |

## 线程类型

Cortex 内部使用三种类型的线程记录：

| 类型 | templateName | 工作区 | 使用场景 |
|------|-------------|-----------|---------|
| **模板线程** | 实际模板名称 | 是 | `!thread <template>`、任务调度 |
| **默认线程** | `"default"` | 是 | 单智能体消息（正常聊天路径） |
| **自动线程** | `null` | 否（初始） | 从单智能体运行链接的 `!thread add` |

区别很重要，因为运行器对默认线程的处理不同：它们只运行一个步骤（无转换），使用频道的已有会话，并将流式输出直接转发给用户。

## 线程记录

每个线程的完整状态作为 `ThreadRecord` 持久化在 `~/.cortex/data/threads.json` 中：

| 字段 | 描述 |
|-------|-------------|
| `id` | 线程 ID（`thr_<8 位十六进制>`） |
| `status` | 当前生命周期状态 |
| `channel` | Slack 频道 ID |
| `templateName` | 使用的模板（ad-hoc 为 null） |
| `userMessage` | 原始用户消息 |
| `workspacePath` / `artifactPath` | 共享产物的文件路径 |
| `agents` | 智能体槽位映射及其状态（sessionId、status、persistSession） |
| `activeAgent` / `activeStage` | 下一个运行的智能体和阶段 |
| `steps[]` | 每步记录的执行历史（agent、stage、cost、duration、output） |
| `iterationCounts` | 按转换边追踪收敛循环计数 |
| `totalCostUsd` | 所有步骤的累计费用 |
| `metadata` | 调用者提供的上下文：scheduleTaskId、trigger、project、pendingMessages |
| `abortReason` | 智能体自行中止时的原因 |

旧线程在启动时清理：7 天前的线程被移除（无工作区的 auto-records 为 24 小时）。

## 提示变量

智能体提示支持在运行时解析的模板变量：

| 变量 | 描述 |
|----------|-------------|
| `{{input}}` | 用户消息（对于第一步）或前一个智能体的输出 |
| `{{artifactPath}}` | `artifact.md` 的绝对路径 |
| `{{previousOutput}}` | 上一个已完成步骤的完整输出 |
| `{{modifiedFiles}}` | 上一个智能体编辑的文件 |
| `{{modifiedFilesWithDiff}}` | 上一个智能体的文件中带内联 diff |
| `{{currentDateTime}}` | ISO 格式的当前日期和时间 |

## 插件加载

每个智能体定义通过 `pluginDirs` 指定要加载的插件目录。插件相对于 `DATA_DIR`（默认：`~/.cortex/`）解析。例如，`plugins/cortex-coder` 解析为 `~/.cortex/plugins/cortex-coder/`。

插件目录作为 `--plugin-dir` 标志（Claude Code）或 `--skill` 标志（PI）传递给 LLM 后端。后端然后扫描 `SKILL.md` 文件并将其作为可调用技能提供。完整的技能和插件系统参见 [skills-and-plugins.md](./skills-and-plugins.md)。

## 线程清理

当线程完成、失败或被取消时：

- 智能体句柄从 `RunningExecutions` 中移除
- 线程特定会话（按键为 `thr:<threadId>:`）被关闭
- 线程存储刷新到磁盘

在服务器启动时，任何留在 `running` 状态的线程都被标记为 `failed` 以防止陈旧状态。
