# Cortex Self-Research Status

Updated: 2026-05-26

## 当前 phase

**Phase 4 实质完成**（roadmap 三个里程碑通过）。Phase 5（知识体系）无明确触发条件，EXP-029 评估为话题错配。当前活跃工作集中在两条工程线：(1) `plan/groovy-strolling-fox.md` OutputStream refactor S2–S4；(2) DR-0008 PI adapter Phase 2 实施。

## 最近推进

- **CORTEX.md 迁移 Stage 1**（2026-05-06）：代码模块重命名完成（task ccbd, commit 99b7885c）——claude-md-scanner/injector/MCP helper/task-ops + client 字段全部改为 cortex-md-* 命名。
- **CORTEX.md 迁移 Phase 2a**（2026-05-06）：`cortex-md-injector.mjs` 本地 hook 脚本实现完成（task adfd, commit dd9c4b88）——单脚本三入口，内联扫描，per-session dedup 缓存，markOnlyPaths，9500 截断保护。
- **CORTEX.md 迁移 Phase 2b**（2026-05-06）：hooks-builder.ts 注册 cortex-md-injector 到三个触发点（task 5c85, commit 23ff5836）——POST_TOOL_USE/SESSION_START/USER_PROMPT_SUBMIT。21/21 测试通过。
- **CORTEX.md 迁移 Phase 2c/4.5**（2026-05-06）：PI hook-bridge before_agent_start 接入 cortex-md-injector（task 0241, commit 05627c88）——CORTEX.md 注入到 PI agent systemPrompt。
- **CORTEX.md 迁移 Stage 3-4**（2026-05-06）：物理文件迁移 + 内容替换（task 379f, commit 9c848ebb）——35 repo + 20 ~/.cortex CLAUDE.md → CORTEX.md; .gitignore 更新; 所有 CORTEX.md self-ref + 3 system prompts + 16 SKILL.md + 3 rules + 227 TS comment markers 批量 sed; defaults/plugins/prompts/rules 加入 git 追踪。
- **DR-0011 Phase 1 完成**（2026-05-06）：Client 端全部实现：`cortex-run-watcher.ts`（task 5a04）+ `cortex-run-launch.ts`（task b75a, commit 31e92af4）launch handler、flush、orphan 检测、ack。63 测试全绿。
- **DR-0011 Phase 2 完成**（2026-05-06）：Server 端 task-callback handler（task 32b0, commit 39c39d55）——ws-server 注册入站 handler，completeTask/blockTask 幂等处理。
- **DR-0008 Phase 2 全部完成**（2026-05-07）：PIAdapter skeleton（6a07）+ hook bridge（d3ae）+ MCP bridge（5754）+ event-parser（a7f9）+ tool-shim（5b5c）+ before_agent_start CORTEX.md 注入（0241）+ direct-pi agent e2e（1022）全部落地。PI 全链路（spawn → tool use → hook → MCP → clean exit）可用。
- **DR-0012 Claude TUI mode 5/5 phases 实施完成**（2026-05-15）：commits `06013232` (Phase 1: tmux-control + jsonl-tail + cost-from-usage) → `82c748e8` (Phase 2: adapter-tui + spawn-args mode=tui) → `c3db4e47` (Phase 3: cortex-tui-bridge MCP set — plan_enter/exit + ask_user) → `17fbb5d5` (Phase 4: profile claudeBackend field + ClaudeAdapter routing + onEvent streaming + resume recovery)。128 unit tests，0 regressions。Opt-in via `claudeBackend: 'tui'` on profile；默认 `'print'`。Smoke: `node agent-server/scripts/smoke-tui-mode.mjs`. Soak validation pending.
- **Provider-aware rate limiting 全链路完成**（2026-04-28）：rate-limit-throttle 简化为纯状态追踪 + mode tracking（commits dd1c2804/d61cd84f/8b644e65 等 7 commit）；facade pre-flight skip、scheduled-task / dispatch 入口 pre-check、one-time migration 全部就位；912 测试全绿。
- **agent-server-decouple S1–S13 全部完成**：S12 物理迁移（5768）→ S13 composition root + BusyTracker IPC canonicalization（6e4b）通过 stage-gate `b3688af2`。store/domain 切割完成，依赖循环消除。
- **ProjectStore 单元测试完成**（2026-05-22, task d7a9, commit `452848b6`）：`resolveFromMessage` 重构为等价于旧 `detectProject` 的语义（`[project:xxx]` 标签优先、大小写不敏感最长子串匹配、general fallback）；新增 15 个测试覆盖标签匹配、子串匹配、falsy 消息、空目录、歧义子串和 fs.watch 缓存失效。27/27 测试通过。
- **Session store API 扩展 + 重命名**（2026-05-22, task a14b）：新增 `getById`、`listByProject`、`listResumable`、`markUsed`、`pruneStale` 5 个 API 方法；内建 name→sessionId 索引使 `lookupSession` O(1)；`sessionRegistryRepo` 重命名为 `sessionStore`（保留 alias）；`pruneStale` 含 executionRepo/threadStore 引用检查和 backup 清理。15/15 测试通过，tsc --noEmit 零错误（commits `70384c2d` + `986889eb`）。
- **Session-store 单元测试 gap 覆盖**（2026-05-22, task c2f8）：补充 4 个 gap 测试至 `tests/store/session-store.test.ts`——fixture migration + 二次读幂等、registerSession projectId 缺省/persistence、GC eligibility 检查 executionRepo/threadStore 引用保护。19/19 store 测试通过（commit `5f1a57e6`）。
- **M3: MockAdapter/VirtualMessage/outbound-queue/DurableHooks 适配 Destination 模型**（2026-05-22, task 0c54）：DurableHooks.beforePost 签名 channel→Destination；VirtualMessage 构造参数 channel→destination，移除 _makeDestination()；outbound-queue WAL 存 Destination；durablePost/MessageSender 签名更新；MockAdapter 及全部测试适配。85/85 测试通过（commit `3cd5fac9`）。解锁 task c619（interactive-reply 站点重写）和 4faa（system-notice 站点重写）。
- **M4: ThreadRecord projectId 一等字段 + Destination 注入 + threadStore findByProject**（2026-05-22, task ae7b）：ThreadRecord 新增 `projectId: string`（从 `metadata.project` 提升）；`ThreadMetadata.project` 移除；threadStore 新增 `findByProject()`；所有 thread 创建路径（createThread/createDefaultThread/createAutoThreadRecord）支持 `projectId`；thread runner/hook-runner 改用 `thread.projectId`；`RunThreadOptions.destination` 改为必填并移除 initThreadContext 的 fallback 推断；agent-runner/thread-executor/task-dispatch/scheduled-task 全部显式传入 Destination。1402/1413 测试通过（11 个 pre-existing ENOENT/timeout 失败无关）。commits 待定。
- **DR-0013 app.ts wiring 完成**（2026-05-24, task 630b, commit `0c598fb2`）：`createSlackUpdatePrompt` 在 `bindToAdapter` 前预注册三按钮 actionId；`setTimeout(60s)` + `setInterval(24h)` 调用 `checkServerUpdate` 加入 startup IIFE。agent-server/CORTEX.md 索引 + docs EN/zh-CN 同时更新。typecheck src/ 零错误，1536 测试全绿。
- **M4: Drop postEphemeral from PlatformAdapter**（2026-05-25, task 12fa, commit `c92d5c53`）：移除 PlatformAdapter.postEphemeral 签名、PlatformCapabilities.ephemeral 字段、Slack/Feishu/Mock 三端实现；interaction-handlers.ts 中的 callsite 改为 postMessage；全部测试通过。
- **M1: TUI Gateway Adapter 实现完成**（2026-05-26, task 1447, commits `127642d2` / `8ebe6e9c` / `0f6950f2` / `13768a5b`）：`TuiGatewayAdapter`（PlatformAdapter v2 + TuiAdapterControls）绑定 127.0.0.1:CORTEX_TUI_PORT（默认 3003），说话 M4 WS 协议（`protocol.ts`）。含 handshake（5s timeout, version check, resume/fresh session）、inbound dispatch（msg.user→MessageContext, action.click→ActionContext, modal.submit→ModalSubmitContext, ping→pong）、outbound translation（chat.post/update/delete, interactive.post, modal.open, chat.markQueued, notification path-offer）、EADDRINUSE soft-fail、90s keepalive。辅助模块：`tui-conduit-state.ts`（per-conduit in-memory Map）、`tui-connection.ts`（per-WS wrapper send/close）、`tui-output-stream.ts`（stream.* frame emitter）、`tui-transcript.ts`（transcript replay assembly）、`tui-notifications.ts`（project-report / system-notice fan-out）。`channel-queue.ts` → `conduit-queue.ts` 重命名。`session-repo.ts` 新增 `registerConduitProvider` hook。22 个 TUI 测试通过，tsc --noEmit 零新错误。
- **M6: CLI integration & packaging 完成**（2026-05-26, task ddc6, commit `5ebf944c`）：`createAdapterFromEnv` 4-branch 重写（composite vs bare vs primary-only + TUI auto-enable）；`cortex tui` 子命令（parseTuiArgs/tuiPortListening/cmdTui/getTuiHelp）；app.ts EventBus + UI service 注入（extractTuiAdapter setBus/setUiService，try/catch 守护 M3 not-landed）；`tsconfig.build.json` 添加 `src/**/*.tsx`。10 个 TUI CLI 测试通过，tsc --noEmit src/ 零错误。
- **Issue 5.3 verified: setUiService catch logs at warn+**（2026-05-26, task 1604, EXP-067）：`app.ts:216` catch 使用 `log.warn()`，满足 warn+ 标准。try/catch 守护的是 M3 动态 import（import `@domain/ui/index.js`），非 `setUiService` 自身——setUiService 是简单 setter 注入，M3 未落盘时不会抛。无需 follow-up。
- **EXP-067: TUI Phase 1 七场景 smoke 测试完成**（2026-05-26, task 760b, commit `5ebf944c`）：在真 daemon + 真 WS 协议上执行了七个被章程要求（gate 640e Director Iterate items 1-7+9）的 smoke 场景，记录到 `context/projects/cortex-self/experiments/EXP-067.md`（`project: cortex-self`, `tags: [tui, phase-gate, smoke]`, `links: [task-640e]`）。结果：4 PASS (S1 TUI-only, S3 并发, S4 项目切换, S5 daemon 重连), 1 BLOCKED (S2 Slack-coexist: 无 .env), 1 PASS (S6 EADDRINUSE), 1 DEFERRED (S7 AskUserQuestion: 需 fixture)。126 单元测试 0 fail。修复 build 配置 bug（`tsconfig.build.json` 缺 `jsx` flag）。三个 follow-up 任务创建（299e, 5f51, f79c）。
- **M3: Cortex UI Service facade 实现完成**（2026-05-26, task 5a62, commit `46ee715c`）：transport-agnostic facade（query/mutate/subscribe）创建于 `agent-server/src/domain/ui-service/`。7 query scopes + 10 mutate ops + event-bus subscribe。Task lock acquire/release 围绕 task mutates。59 测试全绿。`executionRegistry` 新增 `getAll()` 导出。实现前 M3 dynamic-import try/catch guard 替换为直接同步 import。

## 未解决问题

- **3 个 infra 任务等待用户审批**：a91c / f8e3 / 9500（per OVERVIEW.md 2026-03-28 评估）。
- **TUI Phase 1 Gate (task 640e) iterate 完成**：EXP-067 记录了七场景 + EADDRINUSE 的执行结果（4 PASS, 1 BLOCKED, 1 PASS, 1 DEFERRED）。`tsconfig.build.json` 补了缺的 `jsx` flag。126 TUI 单元测试 0 fail。待 gate reviewer 重新评估后决定是否关闭 gate。

## 下一步

- TUI Phase 1 gate (640e) 重新评估：EXP-067 已就绪，待 gate reviewer 判断是否满足 done-when。三个 follow-up (299e/5f51/f79c) 跟踪 blocked/deferred 场景。如果 gate 关闭：
  - 授权 Phase 2 (M3 UI Service + dashboard) 任务创建
  - 关闭 gate task (640e)
- Phase 5 触发条件待 `/scan` 或 `/evolve` 给出新候选；不主动开新方向。
- `c2ab`（重写 cortex-run CLI → sendCommand）和 `ec32`（测试重命名）就绪可做。
- `7629`（DR-0011 清理）和 `5737`（部署 + smoke）待上游完成后接力。
