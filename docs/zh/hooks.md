# 钩子


Cortex 有三个独立的钩子子系统，在不同的边界触发：编程智能体进程内的智能体级钩子（PreToolUse、PostToolUse、SessionStart、PermissionRequest），服务器端线程生命周期钩子（onStart、onTransition、onEnd），以及会话级钩子（onNew、onMessageEnd）。本文档解释每一个是什么、如何配置以及如何编写自定义钩子。钩子在整体系统中的位置参见 [architecture.md](./architecture.md)。

## 架构概览

```
┌─────────────────────────────────────────────────┐
│  智能体进程（Claude Code / PI）                   │
│  ┌───────────────────────────────────────────┐  │
│  │  钩子脚本（.mjs）由智能体 CLI 通过         │  │
│  │  --settings 或 --extension 触发           │  │
│  │  PreToolUse / PostToolUse / SessionStart  │  │
│  └───────────┬───────────────────────────────┘  │
│              │ HTTP webhook（端口 3001）         │
└──────────────┼──────────────────────────────────┘
               │
┌──────────────┼──────────────────────────────────┐
│  Agent-Server 进程                              │
│  ┌───────────┴───────────────────────────────┐  │
│  │  hook-bridge.ts — 将钩子事件翻译为        │  │
│  │  Slack 交互（AskUserQuestion、            │  │
│  │  ExitPlanMode）                           │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │  hook-runner.ts — 线程生命周期钩子        │  │
│  │  (onStart / onTransition / onEnd)         │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │  session-hooks.ts — 会话级钩子            │  │
│  │  (onNew / onMessageEnd)                   │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## 智能体级钩子（Claude Code）

这些钩子在 Claude Code CLI 进程内运行。Cortex 在 `agent-adapter/claude/hooks-builder.ts` 中动态生成钩子配置，并在生成时通过 `--settings` CLI 标志注入。钩子脚本位于 `~/.cortex/hooks/`。

### PreToolUse 钩子

在工具执行前触发。这些钩子可以阻止工具（返回 `permissionDecision: 'deny'`）或允许其以修改后的输入继续。

| 钩子脚本 | 匹配器 | 用途 |
|---|---|---|
| `sensitive-file-edit.mjs` | `Edit\|Write` | 通过直接执行文件操作然后返回 deny 并带成功消息，绕过 Claude 内置的 `.claude/` 路径保护 |
| `tasks-yaml-guard.mjs` | `Edit\|Write` | 在允许编辑前检查 TASKS.yaml 项目锁——如果当前进程不持有锁，编辑被拒绝 |
| `ask-user-question-hook.mjs` | `AskUserQuestion` | 通过 HTTP POST 将用户问题转发到 hook-bridge 的 Slack，阻塞直到用户回答 |
| `exit-plan-mode-hook.mjs` | `ExitPlanMode` | 通过 HTTP POST 将计划转发到 Slack 以审批，阻塞直到用户批准或拒绝 |

后两个钩子（`AskUserQuestion` 和 `ExitPlanMode`）仅在智能体的工具列表包含这些工具时注册。没有它们的线程智能体跳过这些钩子。

### PostToolUse 钩子

在工具完成后触发。这些不能阻塞——它们用于副作用，如日志记录、上下文注入和访问追踪。

| 钩子脚本 | 匹配器 | 用途 |
|---|---|---|
| `memory-ref-tracker.mjs` | `Read\|Grep` | 追踪访问了哪些内存文件（实验、知识、模式），写入 `_meta/access-log.jsonl` |
| `rules-loader.mjs` | `Read\|Grep` | 当相关文件被读取时，将 `rules/*.md` 中的限定规则注入智能体上下文 |
| `session-activity-tracker.mjs` | `Read\|Edit\|Write\|Skill` | 记录会话活动（文件读取、编辑、写入、技能调用）到 `logs/session-activity/<session_id>.jsonl` |
| `cortex-md-injector.mjs` | `Read` | 当智能体读取 CORTEX.md 管理目录下的文件时，将 CORTEX.md 祖先链注入上下文 |

### SessionStart 钩子

在会话启动、恢复、清除和压缩事件上触发。目前只有一个钩子：

| 钩子脚本 | 匹配器 | 用途 |
|---|---|---|
| `cortex-md-injector.mjs` | `startup\|resume\|clear\|compact` | 在会话开始时注入 CORTEX.md 上下文 |

### PermissionRequest 钩子

一个单一的静态钩子，自动绕过 Edit 和 Write 操作的权限提示。这是安全的，因为 PreToolUse 钩子（`sensitive-file-edit.mjs` 和 `tasks-yaml-guard.mjs`）处理实际的访问控制。

### 配置如何构建

在 `hooks-builder.ts` 中，`buildHooksSettings()` 获取智能体的工具列表并返回一个作为 `--settings '{"hooks":{...}}'` 注入的设置对象：

```typescript
// 生成时注入的等效结构：
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write", "hooks": [
          { "type": "command", "command": "node ~/.cortex/hooks/sensitive-file-edit.mjs", "timeout": 10 },
          { "type": "command", "command": "node ~/.cortex/hooks/tasks-yaml-guard.mjs", "timeout": 10 }
      ]},
      { "matcher": "AskUserQuestion", "hooks": [...] },   // 仅在工具可用时
      { "matcher": "ExitPlanMode", "hooks": [...] }       // 仅在工具可用时
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

## PI 后端钩子

PI（终端）编程智能体不使用 Claude Code 的 `--settings` 钩子语法。相反，Cortex 使用扩展 API 桥接（`agent-adapter/pi/hook-bridge.ts`），在 PI 的 `ExtensionAPI` 上注册事件处理程序：

- `before_agent_start` → 以 `SessionStart` 事件负载运行 `cortex-md-injector.mjs`
- `tool_call` → 对 `edit`/`write` 工具运行 `sensitive-file-edit.mjs`
- `tool_result` → 运行 `memory-ref-tracker.mjs`（用于 Reads）、`rules-loader.mjs`（用于 Reads）、`cortex-md-injector.mjs`（用于 Reads）和 `session-activity-tracker.mjs`（用于 Read/Edit/Write/Skill）

PI 桥接标准化工具名称（PI 的小写名称到 Claude 的 PascalCase）和字段名称（PI 的 `path` 到 Claude 的 `file_path`），以便相同的钩子脚本可以在两个后端上工作。

## hook-bridge：将工具事件翻译到 Slack

一个名为 hook-bridge（`agent-server/src/orchestration/routing/hook-bridge.ts`）的独立基础设施处理阻塞性 Claude Code 钩子和 Slack 交互之间的翻译。这不是 Claude Code 意义上的钩子——它是使 AskUserQuestion 和 ExitPlanMode 工作的服务器端机制。

hook-bridge：
- 从钩子脚本接收 HTTP POST 请求，路径为 `POST /hook/ask-user-question` 和 `POST /hook/exit-plan-mode`
- 注册一个带 30 分钟 TTL 的挂起 Promise
- 在事件总线上发布 `ask-user.requested` 或 `plan.submitted` 事件
- hook-bridge 订阅者（`hook-bridge-subscribers.ts`）响应这些事件发布交互式 Slack 消息
- 当 Slack 交互解析时（用户点击按钮或提交模态框），交互处理程序解析挂起的 Promise
- HTTP 响应流回钩子脚本，钩子脚本将结果输出到 stdout，Claude Code 将其作为 PreToolUse 结果读取

## 线程生命周期钩子（服务器端）

线程生命周期钩子在多智能体线程执行期间的三个点触发。它们在 `thread-templates.json` 中每个模板的 `hooks` 键下配置。

### 钩子阶段

| 阶段 | 何时触发 | 使用场景 |
|---|---|---|
| `onStart` | 第一个智能体步骤之前 | 启动前检查、工作区设置、初始上下文注入 |
| `onTransition` | 评估转换后，智能体步骤之间 | 管道阶段间验证、条件路由 |
| `onEnd` | 线程主循环完成后 | 任务后清理、状态更新、通知、产物收集 |

### 配置

钩子在 `thread-templates.json` 中配置：

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

- `command` — 完整的 shell 调用，包括解释器（如 `node ~/.cortex/hooks/my-hook.mjs`）
- `args` — 作为 `$1`、`$2` 等传递的位置参数
- `timeout` — 毫秒，默认 30000

### 钩子执行

`hook-runner.ts` 处理执行：

1. `buildHookContext()` 构造一个包含完整线程状态的 `HookContext` 对象：`threadId`、`templateName`、`phase`、`currentStepIndex`、`steps`、`activeAgent`、`previousAgent`、`artifactContent`、`userMessage`、`totalCostUsd`。
2. `executeHook()` 以 `sh -c '<command> "$@"' hook <args>` 生成命令，通过 stdin 发送 JSON 格式的上下文。
3. 钩子脚本将 `HookResult` JSON 写入 stdout：

   ```json
   {
     "insertAgent": true,
     "profile": "__active__",
     "prompt": "审查线程输出并建议下一步。"
   }
   ```

   或者，将提示发送到线程中已有的智能体（而不是创建新的）：

   ```json
   {
     "targetAgent": "reviewer",
     "prompt": "规划器已完成。这里是额外的上下文..."
   }
   ```

4. 如果设置了 `insertAgent: true` 或带 `prompt` 的 `targetAgent`，`runHookAgent()` 生成一个新的智能体回合。对于 `insertAgent`，创建一个临时智能体。对于 `targetAgent`，提示被发送到命名智能体的持久会话。

### 任务分发额外钩子

当任务被分发时，分发系统在模板已配置的基础上注入一个 `extraHooks.onEnd` 钩子：

```typescript
extraHooks: {
  onEnd: {
    command: 'node hooks/task-status-check.mjs',
    args: [selectedTask.project, selectedTask.id],
    timeout: 10000,
  },
}
```

这确保无论结果如何，线程完成后任务状态都被更新。

## 会话级钩子

会话钩子在频道/会话边界触发，而非线程边界。它们在 `~/.cortex/config/session-hooks.json` 中配置。

### 配置

```json
{
  "onNew": {
    "command": "node hooks/new-session-hook.mjs",
    "args": [],
    "timeout": 60000
  }
}
```

类型系统（`SessionHooksFile`）中定义了两个钩子点：

- `onNew` — 当 `!new` 或"New"状态按钮关闭会话时触发。用于关闭前的内存刷新（检查未提交的更改、提醒挂起的工作）。
- `onMessageEnd` — 在每次助手消息回合完成后触发。目前未自动配置，但管道支持。

### onNew 流程

1. `fireAndForgetPreCloseHook()` 在会话被销毁前捕获当前 `sessionId`。
2. 钩子脚本通过 stdin 接收上下文 JSON：`channel`、`sessionId`、`sessionName`、`executionId`、`profile`、`trigger`。
3. 钩子脚本的 stdout 如果不为空，则作为针对仍存活的会话的新智能体回合注入——允许智能体在会话关闭前对发现采取行动（如提交未提交的工作）。

### onMessageEnd 流程

1. 在助手回合完成后从智能体生命周期处理程序（`lifecycle.ts`）调用。
2. 钩子输出扩展与刚完成的回合相同的 VirtualMessage（Slack 线程），因此钩子输出以内联方式出现在同一消息线程中，而非作为单独的顶级消息。
3. 与 onNew 一样，非空 stdout 被注入为后续智能体回合。

## _meta/access-log.jsonl 系统

`memory-ref-tracker.mjs` PostToolUse 钩子为原子化内存系统实现自动引用追踪（DR-0007，完整内存架构参见 [memory.md](./memory.md)）。它记录对实验、知识和模式文件的每次 Read 和 Grep 访问。

每次访问产生一行 JSONL 记录：
```json
{"file": "EXP-001.md", "tool": "Read", "ts": "2026-05-19T10:30:00.000Z"}
```

日志文件位于 `<project>/_meta/access-log.jsonl`，并在每次写入后自动提交到 git。内存索引重建命令（`memory-index-regen`）读取此日志以计算访问计数（`refs`）和最后访问时间戳（`last-ref`），这些用于索引排序和热/冷分类。

## 编写自定义钩子

你可以为任何支持钩子的钩子阶段编写自定义钩子脚本。钩子脚本是 Node.js `.mjs` 文件，通过 stdin 接收上下文并将结果写入 stdout。

### 最小 PreToolUse 钩子示例

一个在智能体尝试编辑特定文件时发出警告的钩子：

```javascript
#!/usr/bin/env node
// ~/.cortex/hooks/warn-sensitive-file.mjs
import { readFileSync } from 'fs';

// 从 stdin 读取工具输入
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
        permissionDecisionReason: `拒绝编辑敏感文件：${path}`
      }
    }));
    process.exit(0);
  }
}

// 默认允许
console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow'
  }
}));
```

### 注册自定义 Claude Code 钩子

通过修改 agent-server 源码中的 `hooks-builder.ts` 将钩子添加到动态配置：

```typescript
// 在 buildPreToolUseHooks 或 POST_TOOL_USE_HOOKS 中：
{ matcher: 'Edit|Write', hooks: [
  nodeHook('sensitive-file-edit.mjs', 10),
  nodeHook('tasks-yaml-guard.mjs', 10),
  nodeHook('warn-sensitive-file.mjs', 5),  // 你的自定义钩子
]},
```

更轻量的方式，如果你直接在 Cortex 生成路径外运行 Claude Code，也可以通过 `settings.json` 添加钩子，但这不是 Cortex 管理的智能体的推荐方法。

### 线程生命周期钩子示例

一个在线程结束时向 Slack 发布摘要的钩子：

```javascript
#!/usr/bin/env node
// 收集 stdin
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const ctx = JSON.parse(Buffer.concat(chunks).toString());

// ctx 包含：threadId、templateName、phase、steps、activeAgent、artifactContent、...

// 返回结果——可选地注入后续智能体回合
console.log(JSON.stringify({
  insertAgent: false
  // 或：insertAgent: true, prompt: "总结线程输出。"
}));
```

在 `thread-templates.json` 中配置：

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

## 调试钩子

钩子执行日志出现在 agent-server 守护进程日志中（`~/.cortex/logs/daemon.log`）。写入 stderr 的钩子脚本其输出将被捕获并记录。常见问题：

- **钩子脚本未找到** — 检查命令中的路径。所有路径应为绝对路径或相对于 `DATA_DIR`（通常为 `~/.cortex/`）。
- **JSON 解析错误** — 钩子的 stdout 不是有效的 JSON。检查 `console.log` 是否写入有效 JSON，以及是否有其他内容写入 stdout。
- **超时** — 钩子耗时超过配置的时间。增加 `timeout` 值。线程钩子默认 30 秒，会话钩子默认 60 秒。
- **权限被拒绝** — 确保 `.mjs` 文件可执行并且有正确的 Node.js shebang。
