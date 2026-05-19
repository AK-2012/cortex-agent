# Plan: npm-install-based runtime refactor

> Status: **CODE REFACTOR DONE** (Steps 0-8). Step 9 (live rollout) deferred to
> user-triggered execution — see `plan/install-rollout.md`.
> Owner: Cortex
> Created: 2026-05-11; last updated 2026-05-12

## Completed commits

| Step | Commit | Summary |
|---|---|---|
| 0 | (in plan/install-smoke-baseline.md) | Baseline: `npm pack && install -g .tgz` exposes B0-1..B0-5 |
| 1 | `cb87552d` | `INSTALL_ROOT` split; PACKAGE_ROOT 3-up → 2-up; deprecated aliases retained |
| 2 | `b310f573` | PI/Codex adapters: `.ts` → `dist/.js`; drop tsx loader from MCP spawn |
| 3 | `41d48c68` | `cortex init` recursively seeds `prompts/`, `rules/`, `plugins/`, `context/decisions/`; skill-scanner + claude defaults → DATA_DIR |
| 4 | `e7b9241b` | All `cwd: PACKAGE_ROOT` spawn sites → `cwd: DATA_DIR` (scheduler/gateway/codex) |
| 5 | `1780be7d` | Remove `CORTEX_DEV=1` src-watch + auto-rebuild; daemon now dist-only |
| 6 | `b3a57a4c` | Drop dev scripts (`dev`, `start`, `daemon`, `client`, `bootstrap`, `task`) + `bin/task` + `scripts/dev.mjs` |
| 7 | `19c3025b` | `postinstall` hook touches `.restart`; new `cortex restart` CLI subcommand |
| 8 | (verified, no commit) | Real install smoke: MCP servers boot, CLI bins work, no `.ts` source leaked into install |
| 9 | (manual) | Live rollout — see `plan/install-rollout.md` |



## 目标 (Goal)

让 `npm install -g cortex-agent-server-X.Y.Z.tgz` 产出一个**完全自洽**的安装：
- 不再依赖源码仓库布局（`PACKAGE_ROOT/.../src/*.ts` 之类的路径全部消除）
- 升级流程：`npm run build && npm pack && npm install -g ./tgz`，daemon 重启后跑新代码
- 同时**移除 dev 模式**（`CORTEX_DEV=1` 下的 src 监听 + 自动 `tsc` 重建路径）

## Scope

In scope: `agent-server/`（包含 cli/daemon/adapters/skills/scheduler/gateway）
Out of scope: `client/`（`cortex-client` 已干净，无相关问题）；功能行为不变。

## 当前问题清单（grep 实证）

`PACKAGE_ROOT` / `SERVER_ROOT` / `REPO_ROOT` 共 42 处引用，分布在 13 个文件。三类问题：

**A. 运行时引用 `.ts` 源码** —— `package.json#files=["dist/","defaults/"]` 不带 `src/`，install 后立刻 ENOENT：
- `src/agent-adapter/pi/adapter.ts:32-36` → `agent-server/src/agent-adapter/pi/{mcp-bridge,tool-shims,hook-bridge}.ts`
- `src/agent-adapter/pi/mcp-bridge.ts:20-21` → `../../domain/mcp/{core-server,server}.ts`
- `src/agent-adapter/codex/adapter.ts:161-162` → `agent-server/src/domain/mcp/{core-server,server}.ts`

**B. 引用仓库布局的 dotdirs** —— install 后这些目录不在 `node_modules/cortex-agent-server/` 下：
- `domain/memory/skill-scanner.ts:14,16` → `PACKAGE_ROOT/.claude/skills`, `.codex/skills/.system`
- `agent-adapter/claude/defaults.ts:20` → `PACKAGE_ROOT/.claude/settings.json`

**C. `cwd: PACKAGE_ROOT` 给子进程** —— install 后 cwd 是 `node_modules/`，不符合预期：
- `domain/scheduling/scheduler.ts:501`（cortex-run 子进程）
- `domain/costs/gateway-manager.ts:135`（aistatus 子进程）
- `agent-adapter/codex/adapter.ts:261,545,794`（codex app-server）

**D. 根成因** —— `core/paths.ts:17`：
```ts
PACKAGE_ROOT = path.resolve(CORE_DIR, '..', '..', '..')
// 假设布局：Cortex/agent-server/src/core/，3 级向上
```
当前 npm-link symlink 模式下 Node 走 realpath，落回真仓库，巧合可工作。真正 install 后 `CORE_DIR = node_modules/cortex-agent-server/dist/core/`，3 级向上变成 `node_modules/`，全错。

## 设计核心：拆分 PACKAGE_ROOT 语义

把当前一个 `PACKAGE_ROOT` 里揉在一起的三件事拆开：

| 旧概念 | 新概念 | 含义 | 解析方式 |
|---|---|---|---|
| `PACKAGE_ROOT`（=仓库根） | `INSTALL_ROOT` | 已安装包根（`dist/`、`defaults/` 所在） | `resolve(CORE_DIR, '..', '..')` — 2 级向上，从 `dist/core/` 到 install 根 |
| `SERVER_ROOT`（=agent-server/） | 同上，合并掉 | — | 同上 |
| `PACKAGE_ROOT/.claude/...`（=用户可变状态） | `DATA_DIR/...` 或 `INSTALL_ROOT/defaults/...` | 看是用户可写还是不可变 | 已有 |
| `cwd: PACKAGE_ROOT`（=子进程工作目录） | `cwd: DATA_DIR` 或显式传入 | 每个 spawn 站点单独决策 | 显式 |

新 `core/paths.ts` 导出：`INSTALL_ROOT`、`DATA_DIR`、`CONFIG_DIR`、`STORE_DIR`、`CONTEXT_DIR`、`PROJECTS_DIR`、`WORKSPACE_DIR`、`PLUGINS_DIR`、`PROMPTS_DIR`、`HOOKS_DIR`、`LOGS_DIR`、`DEFAULTS_DIR`（新增）。`SERVER_ROOT`/`REPO_ROOT`/`PACKAGE_ROOT` 全删（先 alias 一版本，给迁移期用，最终删）。

## 步骤（每步独立 commit）

### Step 0 — Smoke-test baseline（先量出真问题）
- `npm run build && npm pack`
- `npm install -g --prefix /tmp/ctx-test ./cortex-agent-server-0.1.0.tgz`
- `/tmp/ctx-test/bin/cortex config` 看输出
- `/tmp/ctx-test/bin/cortex daemon` 启动，记录第一个炸的栈
- 产出：`plan/install-smoke-baseline.md`，把"装出来到底缺什么"实证清单写下来（替代 grep 推断）

### Step 1 — `core/paths.ts` 拆分
- 新增 `INSTALL_ROOT` 用 2 级向上算
- 新增 `DEFAULTS_DIR = path.join(INSTALL_ROOT, 'defaults')`
- 保留 `PACKAGE_ROOT`/`SERVER_ROOT`/`REPO_ROOT` 作为 deprecated alias（指向 `INSTALL_ROOT`），方便分步迁移
- `core/utils.ts` re-export 同步更新

### Step 2 — 消除 `.ts` 源码运行时引用（核心改动）

将 PI / Codex adapter 引用的 `.ts` 路径全部改为 `dist/.../*.js`：

| 站点 | 旧 | 新 |
|---|---|---|
| `pi/adapter.ts:32-36` | `INSTALL_ROOT/src/agent-adapter/pi/*.ts` | `INSTALL_ROOT/dist/agent-adapter/pi/*.js` |
| `pi/mcp-bridge.ts:20-21` | `../../domain/mcp/*.ts` | `../../domain/mcp/*.js`（相对 dist 内位置） |
| `codex/adapter.ts:161-162` | `INSTALL_ROOT/src/domain/mcp/*.ts` | `INSTALL_ROOT/dist/domain/mcp/*.js` |

PI 的 mcp-bridge / tool-shims / hook-bridge 当前是 `node --import tsx <file>.ts` 启动。改成 `.js` 后变成 `node <file>.js`，需要：
- 确认这三个文件已被 `tsc` 编译进 `dist/`（应是）
- 子进程 spawn 命令去掉 `tsx`，直接 `node`
- 验证模块解析正常（dist 里相对 import 应该工作）

### Step 3 — `.claude` / `.codex` 资产归位

skill-scanner 和 claude/defaults.ts 引用的 `.claude/skills/`、`.codex/skills/.system/`、`.claude/settings.json` —— 这些到底属于谁？

**决策点 ❓**：
- (3a) **跟随包发布**：放 `defaults/.claude/skills/`、`defaults/.codex/skills/.system/`，install 时通过 `cortex init` 拷贝到 `DATA_DIR/.claude/...`，scanner 从 DATA_DIR 读。用户可自定义。
- (3b) **包内只读**：放 `defaults/` 下永远不动，scanner 直接从 `INSTALL_ROOT/defaults/.claude/skills` 读。用户不可加自定义 skill。

推荐 (3a)，与 cortex 现有 "init 拷贝默认资产到 DATA_DIR" 的模式一致。落实：
- 把仓库根的 `.claude/skills/` 和 `.codex/skills/.system/` 移到 `agent-server/defaults/.claude/skills/` 与 `agent-server/defaults/.codex/skills/.system/`（如果还不在）
- `init.ts` 增加这两个目录的复制
- `skill-scanner.ts` 读 `DATA_DIR/.claude/skills` 和 `DATA_DIR/.codex/skills/.system`
- `claude/defaults.ts:20` 改为 `DATA_DIR/.claude/settings.json`（这是用户配置，必然可变）

### Step 4 — `cwd: PACKAGE_ROOT` 逐点 review

每处 `cwd: PACKAGE_ROOT` 单独评估它"为什么需要这个 cwd"：
- `scheduler.ts:501` —— 给 cortex-run 子进程。语义应是"用户项目目录"，已有 PROJECTS_DIR / 任务自带 cwd。改成显式传入或 DATA_DIR fallback。
- `gateway-manager.ts:135` —— aistatus 子进程。aistatus 与仓库无关，cwd 应为 DATA_DIR。
- `codex/adapter.ts:261` —— codex app-server。改 DATA_DIR。
- `codex/adapter.ts:545` —— 如果调用方传 cwd 用调用方，否则 DATA_DIR。
- `codex/adapter.ts:794` —— DATA_DIR。

### Step 5 — Daemon 去 dev 模式

`src/entry/daemon.ts` 删除：
- `DEV_MODE` 常量与所有分支
- `SRC_DIR` / `TSCONFIG_BUILD`
- `runStep` / `runRebuild`
- `setupWatchers` 中 dev 分支
- `restart()` 中 `runRebuild()` 调用
- 头注释与 CORTEX.md 中的 dev 模式描述

简化后 daemon 只做：watch `dist/` + watch `.restart` + watch `.env` → 重启 app.js。crash recovery + busy IPC 不变。

### Step 6 — `package.json` 清理

- 删除 scripts：`dev`、`daemon`（npm 包装不再需要，直接 `cortex daemon`）、`client`、`bootstrap`、`task`（这些 tsx-based 命令都假设有 src/）
- 保留：`build`、`typecheck`、`test`、`prepare`、`test:integration`、`depcruise`
- `start` 保留与否 ❓ —— 当前 `"start": "node --import tsx src/entry/app.ts"`，仅在仓库内 dev 时有意义。建议**删除**（与"去掉 dev 模式"一致）。
- 删除 `bin/task` shell 包装
- `vendor/aistatus-*.tgz` 评估是否还在用（如果只是历史包，挪到 git 历史里）

### Step 7 — 安装后 daemon 重启的处理 ❓

问题：`fs.watch('dist/', { recursive: true })` 在 `npm install -g` 原子替换目录后大概率失效（inode 被删）。两种方案：

- (7a) **post-install 自动触发**：在 `package.json` 加 `postinstall` 脚本：`touch $CORTEX_HOME/data/.restart`（daemon 已 watch 这个）。`.restart` watcher 用的是 STORE_DIR，不在被替换的范围内，应该能稳定触发。
- (7b) **新增 `cortex restart` 命令**：用户安装完手动跑一下。
- (7c) **daemon 守 watcher**：在 watch 出错时尝试重新建立。复杂，先不做。

推荐 (7a) + (7b) 同时上：自动触发 + 手动兜底。

### Step 8 — 真装验证

完整流程跑一遍：
1. `cd agent-server && npm run build && npm pack`
2. `npm install -g --prefix /tmp/ctx-fresh ./cortex-agent-server-0.1.0.tgz`
3. `CORTEX_HOME=/tmp/ctx-home /tmp/ctx-fresh/bin/cortex init`（fresh 初始化）
4. `CORTEX_HOME=/tmp/ctx-home /tmp/ctx-fresh/bin/cortex config` —— 路径全对？
5. `CORTEX_HOME=/tmp/ctx-home /tmp/ctx-fresh/bin/cortex daemon` 启动
6. `curl localhost:300X/health` 或 slack 测试消息一条 —— 端到端通？
7. 模拟一次升级：rebuild + pack + install → daemon 是否检测到并重启？

### Step 9 — Rollout（生产切换）

1. 当前 daemon（PID 2379497）从源码目录起的，先停掉
2. `npm install -g ./cortex-agent-server-0.1.0.tgz` 真正全局装
3. `cortex daemon &`（或 nohup / systemd unit，看现状）
4. Slack 测试一条
5. 删除 `npm link` 残留 symlink
6. 文档更新：
   - `agent-server/CORTEX.md` 去 dev mode 段
   - `agent-server/src/CORTEX.md` 去 dev mode 段
   - 根 `CORTEX.md` 如有提及 dev workflow
   - 新增 `agent-server/INSTALL.md` 或在 CORTEX.md 加"升级流程"小节
7. 更新所有相关项目 STATUS.md

## 未决问题

| # | 问题 | 默认选择 |
|---|---|---|
| Q1 | `.claude/skills` 用户可写？ | 假设是（→ 走 3a） |
| Q2 | PI / Codex adapter 改 `.js` 后还能跑？ | Step 0 smoke 后确认 |
| Q3 | `npm start`（tsx 跑 src）保留吗？ | 删 |
| Q4 | daemon dist-watch 在 install 后能否恢复？ | 走 7a，不依赖 watcher |
| Q5 | `vendor/aistatus-*.tgz` 还在用吗？ | Step 6 时 grep 确认 |

## 风险

- **PI 子进程改 tsx → node 后行为变化**：tsx 在 ESM `.ts` 上做的事不止是类型剥离（还有 `--import` 钩子里的 source-map 等）。改 `.js` 时确认 import 路径都能解析。
- **Hot-restart 路径变了**：原来"改 dist 自动重启"在仓库 dev 时很顺手；改成 install-only 后，每次改代码要走 build→pack→install，节奏慢很多。这是 dev/prod parity 的代价。如果觉得太慢，未来可以加一个仅本机用的 "dev install" 模式（直接 link 到 dist/，不带 src）。
- **状态文件迁移**：`.claude/settings.json`、`skills/` 目录从仓库根挪到 `defaults/` 或 `DATA_DIR`，旧用户的现有数据需要保留路径。如果是新装，无影响；如果你的 `~/.cortex` 已经有数据，需要确认 init 不覆盖。

## 估算工作量

约 3–5 个 session：
- S1: Step 0（baseline）+ Step 1（paths.ts 拆分）
- S2: Step 2（.ts → .js 迁移，最危险）
- S3: Step 3（assets）+ Step 4（daemon 去 dev mode）
- S4: Step 5（package.json）+ Step 6（post-install hook）+ Step 7（smoke 验证）
- S5: Step 8（rollout）+ Step 9（文档）

每步独立可提交，可随时停下。
