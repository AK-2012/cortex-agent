# Install Smoke Baseline — 2026-05-11

> Step 0 of `npm-install-refactor.md`. 装一次 tgz、跑一遍 daemon，把 install 模式下真出问题的点全部记录下来作为后续 step 的修复 oracle。

## 复现命令

```bash
cd /home/fangxin/Cortex/agent-server
npm run build && npm pack
rm -rf /tmp/ctx-test /tmp/ctx-home
mkdir -p /tmp/ctx-test
npm install --prefix /tmp/ctx-test ./cortex-agent-server-0.1.0.tgz
CORTEX_HOME=/tmp/ctx-home /tmp/ctx-test/node_modules/.bin/cortex init --home /tmp/ctx-home --force
CORTEX_HOME=/tmp/ctx-home /tmp/ctx-test/node_modules/.bin/cortex daemon
```

## 装出来的包结构

```
/tmp/ctx-test/node_modules/cortex-agent-server/
├── dist/        # 504 files
├── defaults/    # CORTEX.md, .claude/, context/, hooks/, plugins/, prompts/, rules/, budget.json,
│                # session-hooks.json, thread-templates.json
└── package.json
```

`files: ["dist/", "defaults/"]` 工作正常。

## 实证问题清单

### B0-1: `PACKAGE_ROOT` 3-up 算错

`cortex config` 输出：
```
PACKAGE_ROOT:  /tmp/ctx-test/node_modules
```

预期：`/tmp/ctx-test/node_modules/cortex-agent-server`

源：`src/core/paths.ts:17` `PACKAGE_ROOT = resolve(CORE_DIR, '..', '..', '..')` —— 3 级向上。
影响：所有从 `core/paths.ts` 导入 `PACKAGE_ROOT`/`SERVER_ROOT` 的代码全错。

### B0-2: `init.ts` 有正确的局部 SERVER_ROOT（佐证修复方向）

`src/entry/init.ts:30` `const SERVER_ROOT = path.resolve(MODULE_DIR, '..', '..');` —— 2 级向上。

证明：装出来的 `/tmp/ctx-home/config/mcp-config.json` 路径正确：
```json
"args": ["/tmp/ctx-test/node_modules/cortex-agent-server/dist/domain/mcp/core-server.js"]
"cwd": "/tmp/ctx-test/node_modules/cortex-agent-server"
```

所以 Step 1 把 `core/paths.ts` 也改成 2-up，即可对齐。

### B0-3: `cortex init` 没拷 prompts/rules/plugins

`copyDefaults` 在 init.ts:1003 只拷了：
- `CORTEX.md`, `.gitignore`, `.claude/settings.json`
- `context/{,projects/,scans/,ideas/,user/}CORTEX.md`
- `budget.json`, `thread-templates.json`, `session-hooks.json`

**没拷**：
- `defaults/prompts/{directives,systemPrompts,promptTemplates}/`
- `defaults/rules/`
- `defaults/plugins/`
- `defaults/context/decisions/DR-0012.md`（context/decisions 整个目录）

直接后果（init 后 daemon 启动日志）：
```
[thread-manager] ERROR Failed to read systemPrompt file ref "file:web.md": ENOENT: ... /tmp/ctx-home/prompts/systemPrompts/web.md
[thread-manager] ERROR Failed to read directive file ref "file:plan-reviewer.md": ENOENT: ... /tmp/ctx-home/prompts/directives/plan-reviewer.md
... (16+ 个 directive / systemPrompt 找不到)
```

但是！daemon 仍然继续启动（`Loaded 16 agents, 7 templates`），只是 thread 执行时会失败。说明这些 prompt 文件是"软依赖"。

这是 init 的 long-standing bug，与 install 模式无关——dev 模式下用户 `~/.cortex/prompts/` 是手动维护的（实测：用户的 directives/ 和 defaults/ 内容已经 diverge）。

**决策点**：是把 `prompts/` 视为"用户可改的种子内容"（init 拷贝→ 用户可改）还是"包内只读"（每次启动从 defaults/ 读）？
- 倾向"种子内容"——因为用户的 directives/ 已经做了实质性修改。
- 落实 = Step 3 把 `prompts/`、`rules/`、`plugins/`、`context/decisions/` 加入 `copyDefaults`。

### B0-4: 没真正触发 PI / Codex 路径（潜伏）

baseline 跑只触发了：cli → init → daemon → app.js → thread-manager 加载 templates → port 占用挂掉（被本机真 daemon 抢了 3002）。

没有触发的（grep 出有问题但 baseline 没踩到）：
- `agent-adapter/pi/adapter.ts:32-36` —— PI mode 启动时才解析这些路径
- `agent-adapter/codex/adapter.ts:161-162` —— Codex mode 才解析
- `domain/memory/skill-scanner.ts:14,16` —— skill scan 触发时（不是启动时）
- `agent-adapter/claude/defaults.ts:20` —— claude mode 启动时

后续 Step 2/3 修完这些后必须额外补 smoke：
- 起 PI mode 跑一条消息
- 起 Codex mode 跑一条消息
- 触发 skill scanner（`/evolve` 之类）

### B0-5: 端口占用导致 app.ts 退出（与 install 无关，是测试环境冲突）

```
[client-manager] ERROR Server error: listen EADDRINUSE: address already in use :::3002
[daemon] INFO app.ts exited with code 1.
```

3002 被本机生产 daemon 占。后续 smoke 要么用 unique port，要么停掉生产 daemon 后再测。

## 不在 baseline 期间出问题的（说明 install 已经能用的部分）

- `cortex init` 主流程能跑
- `cortex config` 能输出（虽然 PACKAGE_ROOT 路径错）
- `cortex daemon` 能 fork app.js
- mcp-config.json 路径生成正确（靠 init.ts 局部 2-up）
- hooks 目录正确部署到 DATA_DIR/hooks/（`deployHooks` 实现 OK）
- machines.json, mode.json, gateway.yaml, profiles.json 生成 OK
- 504 个 dist 文件、defaults/ 完整拷到 install 目录

## 修复优先级（更新 npm-install-refactor.md）

| 优先级 | 问题 | 对应 Step |
|---|---|---|
| P0 | PACKAGE_ROOT 3-up 算错 | Step 1 |
| P0 | PI adapter `.ts` 引用 | Step 2 |
| P0 | Codex adapter `.ts` 引用 | Step 2 |
| P0 | `init` 没拷 prompts/rules/plugins | Step 3（合并） |
| P1 | skill-scanner `.claude/skills` 路径 | Step 3 |
| P1 | `cwd: PACKAGE_ROOT` 子进程 | Step 4 |
| P1 | Daemon dist-watch 在 install 后能否恢复 | Step 7 |
| P2 | claude/defaults.ts `.claude/settings.json` 引用 | Step 3 |

## 下一步

进入 Step 1：`core/paths.ts` 改成 2-up + 引入 `INSTALL_ROOT` 概念 + 保留 alias 兼容期。
