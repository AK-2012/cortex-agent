# Cortex Self-Research Status

Updated: 2026-05-27

## 当前 phase

**TUI Phase 3 启动**（management UI — 4 个 dashboard tab 的 cancel/pause/resume/remove/claim/complete/block 写操作 + AskUserModal/PlanFeedbackModal/ConfirmModal）。Phase 2 已全部完成并通过 stage-gate（task de19, 2026-05-27），EXP-068 五个 smoke 场景 5 PASS / 0 FAIL，S2 E2E（c39d）+ S3 fan-out（b0e7）+ MTH-1 cost.summary 修复（71fe）三条 carry 全部关闭。研究侧 Phase 4 实质完成，Phase 5 等触发条件。

## 最近推进

- **3919 PlanFeedbackModal 实现完成**（`e0fa5d4e`）：新增 `<PlanFeedbackModal>` 组件 — 计划文本滚动展示 + Approve/Provide Feedback/Cancel 三个编号选项（1/2/3 热键），反馈选择后进入文本输入模式，完整 submit 帧构建。App.tsx 根据 `callbackId.startsWith('plan')` 分发 PlanFeedbackModal 或 AskUserModal。10 TDD 全绿，零新 tsc 错误。TUI 测试总量提升至 100/100。

- **d12f Schedules pause/resume/remove + cb70 Threads cancel 实现完成**（`5e064ab6`）：DashboardSchedulesTab 新增每行 ↑/↓ 导航 + [p] pause / [r] resume / [x] remove（ConfirmModal）+ 内联错误展示（5s 自动清除）；DashboardThreadsTab 新增 [c] cancel（ConfirmModal）+ 已终止状态内联提示。Phase 3 placeholder 已移除。90/90 TUI 全绿，零新 tsc 错误。

- **6e64 useMutate hook 实现完成**（`edb28b34`）：`useMutate({sendFrame, onFrame})` → `{mutate, handleFrame}` — 发 `ui.mutate` 帧 + `crypto.randomUUID()` id，Map 跟踪，匹配 `ui.mutateResult` 根据 id 解析，10s 超时，unmount 清理。4 TDD 全绿，零新 tsc 错误。

- **e278 ConfirmModal 实现完成**（`b0edb3dd`）：`<ConfirmModal title body onConfirm onCancel reasonInput?/>` — y/Enter 确认、n/Esc 取消、可选 reasonInput 显示 TextInput 后 onConfirm(reason)。5 TDD 全绿，零新 tsc 错误。

- **Phase 2 gate iter 2（task de19）已闭合**（2026-05-27）：EXP-068 录入 S2 E2E 实时事件投递（~100-140ms < 1s）+ S3 跨项目通知 fan-out 全链路通过。c39d 修了 mutator.ts/tui-gateway.ts/task-dispatch.ts 三处事件发布 gap；b0e7 修了 tui-notifications/tui-gateway/composite-adapter 三处 server-side + Notifications onSelect client-side。149/149 TUI 测试通过。
- **M5 Phase 2 实施完成**（2026-05-26, task 8a5e, commit `5c95d05a` / `796515f1`）：Ctrl+D side panel (5-tab dashboard)、corner notification badge + modal、Ctrl+P project switcher、interactive `--resume` session picker、header live notification count + cost summary、所有 dashboard tab 走 M3 `ui.query` + `ui.subscribe`。
- **M3 UiService 落地**（2026-05-26, task 5a62, commits `46ee715c` / `df07d253` / `690ada14`）：transport-agnostic facade — 7 query scopes + 10 mutate ops + event-bus subscribe；task-level lock acquire/release 包围 task mutates；61 测试全绿。
- **M6 CLI integration & packaging 完成**（2026-05-26, task ddc6, commit `5ebf944c`）：`createAdapterFromEnv` 4-branch 工厂、`cortex tui` 子命令、app.ts EventBus + UiService 注入。
- **M1 TuiGatewayAdapter 实现完成**（2026-05-26, task 1447）：绑定 127.0.0.1:CORTEX_TUI_PORT（默认 3003），M4 WS 协议，EADDRINUSE 软失败，90s keepalive，per-conduit serial queue，session-repo registerConduitProvider hook。
- **EXP-067: Phase 1 七场景 smoke**（2026-05-26, task 760b）：4 PASS / 1 BLOCKED → 后续 PASS（299e Slack-coexist, 5f51 AskUserQuestion, f79c --resume picker 三条 carry 已全部关闭）。
- **DR-0012 Claude TUI mode 5/5 phases**（2026-05-15）：claudeBackend='tui' opt-in path，与本工程线（Cortex TUI）正交。

## 未解决问题

- **3 个 infra 任务等待用户审批**：a91c / f8e3 / 9500（per OVERVIEW.md 2026-03-28 评估）。
- **Phase 5（研究侧）触发条件**：等 `/scan` 或 `/evolve` 给出新候选；不主动开新方向。

## 下一步

- **TUI Phase 3 实施**（10 个新 task，2026-05-27 创建）：
  - 三个 high-prio foundation：`6e64` useMutate hook ✅（`edb28b34`）、`e278` ConfirmModal ✅（`b0edb3dd`）、`6911` AskUserModal ✅
  - `3919` PlanFeedbackModal ✅（`e0fa5d4e`）
  - 四个 dashboard tab 写操作并行（依赖 6e64 + e278）：`d12f` Schedules（pause/resume/remove）✅（`5e064ab6`）、`cb70` Threads（cancel）✅（`5e064ab6`）、`b271` Executions（cancel）、`a8c9` Tasks（claim/unclaim/complete/block-with-reason/unblock）
  - `fae7` E2E smoke EXP-069（6 场景：4 tab + AskUserModal round-trip + tasks block-with-reason）依赖五个实施 task
  - `d340` Phase 3 stage-gate 依赖 fae7 + 3919
- 其它就绪 task：`c2ab`（重写 cortex-run CLI → sendCommand）、`ec32`（测试重命名）；`7629` + `5737`（DR-0011 收尾）等上游完成。
