# TUI 渲染性能改造计划（消除闪烁 + 降低延迟）

状态：草案 / 待评审
范围：`agent-server/src/tui/`
作者：Cortex
日期：2026-06-26

## 1. 问题与现象

滚动、选择、输入时 TUI 出现闪烁（flicker）且延迟偏高。用户假设："是不是因为现在是全屏更新？能不能改成缓冲区对比，只更新 diff？"

这个假设方向基本正确，但需要修正一个事实：当前 TUI 基于 **Ink v5.2.1 + React 18**，Ink 内部**已经做了帧级（按行/字符串）diff**——它不是每次都 `\x1b[2J` 全清。真正导致闪烁的不是"完全没有 diff"，而是下面几个叠加因素：

1. **没有同步输出（synchronized output / DEC 2026）**。Ink 把一帧的擦除 + 重绘分多次 `stdout.write` 写出，终端在写到一半时就刷新，于是用户看到"擦掉旧帧 → 短暂空白 → 画新帧"的撕裂/闪烁。这是全屏 Ink 应用闪烁的头号原因。
2. **全屏高度下 Ink 退化为整屏擦除重绘**。当渲染输出的行数 ≥ 终端高度（全屏布局正是如此），Ink 无法用"光标上移 N 行就地覆盖"的快路径，转而擦除并重画整块可视区，放大了第 1 点的撕裂。
3. **交互事件零节流（no throttling）**。已确认 `useMouseHandler` 对滚轮、拖拽 selection 不做任何节流；`InputBox` 每次按键立即 `setValue` → 立即 rerender。滚轮快速滚动 / 连续打字 / 拖拽会触发每秒几十到上百次整树 reconcile + 整帧重绘，这是延迟与闪烁的主因之一。
4. **仅 stream 文本有 30ms 合批**（`useTranscript` 的 `BATCH_WINDOW_MS`），键盘、滚动、selection、modal 都没有合批。

结论：**"改成缓冲区对比只更新 diff" 是终极手段，但不是第一步**。先用低风险手段消掉 80% 的闪烁与延迟（同步输出 + 事件节流 + 记忆化），再评估是否真的需要自研 cell-diff 渲染层。分阶段交付，每阶段可独立验证、独立回滚。

## 2. 关键代码位置（已核实）

- 入口与渲染驱动：`agent-server/src/tui/index.tsx`
  - `enterFullscreen()` L72–95：写 `\x1b[?1049h\x1b[2J\x1b[H...` 进入 alt-screen，开启 SGR 鼠标(`?1002h/?1006h`) 与 bracketed paste。
  - `doRender()` L121–184：连接级状态变化时 `rerender(app)`；首次 `render(app, { exitOnCtrlC:false })`。
  - `onFrame` L206–282：帧路由；stream 帧走 `dispatchFrame` → React state（注释明确说不在此额外 doRender，避免每 token 整树 reconcile）。
- 布局根：`App.tsx`（~608 行），Transcript 与 Dashboard 互斥，底部 InputBox + StatusLine。
- 文本视图：`components/Transcript.tsx`，行级窗口化（`flattenTranscript` / `computeVisibleWindow`，见 `logic.ts`）。
- 输入框：`components/InputBox.tsx`，自定义多行受控输入，每键即渲染。
- 鼠标：`hooks/useMouseHandler.ts`，滚轮/拖拽/右键，**无节流**。
- transcript 数据 + 合批：`hooks/useTranscript.ts`，`BATCH_WINDOW_MS = 30`（仅 stream）。

已确认：全代码库**没有** `?2026` / synchronized / throttle / debounce / requestAnimationFrame 的使用。

## 3. 目标与验收

- 滚动、选择、连续输入时无可见闪烁（撕裂、空白帧）。
- 输入回显与滚动的交互延迟 < ~50ms 感知。
- 不破坏现有行为：alt-screen 进出、鼠标 selection/复制、bracketed paste、resize、退出清理、CJK 宽字符对齐。
- 每阶段有可测量指标（见 §6 基准）。

## 4. 分阶段方案

### 阶段 0 — 测量与确认（0.5 天，无行为变更）

不改用户可见行为，先建立事实与基准，避免凭感觉优化。

1. 在 Ink 的输出路径上挂一个**计数/采样探针**（包裹传给 `render` 的 `stdout`，或临时 wrap `process.stdout.write`），统计：每秒写次数、每帧字节数、是否包含整屏擦除序列、rerender 频率。
2. 录制三个场景的指标：快速滚轮滚动、连续打字、拖拽 selection。
3. 用 `infocmp` / 环境确认目标终端是否支持 DEC 2026（同步输出）与 alt-screen（tmux、iTerm2、kitty、Windows Terminal、VS Code 集成终端分别确认）。

产出：`RENDER-PERF-PLAN.md` 追加 "Baseline" 一节，记录 before 数字。**这是后续每个阶段对比的锚点。**

### 阶段 1 — 同步输出（Synchronized Output / DEC 2026）（0.5–1 天，预计消除大部分闪烁）

把 Ink 写出的"擦除 + 重绘"整帧包进同步输出标记，终端在收到结束标记前不刷新，撕裂消失。

- 实现：拦截传给 `render()` 的 `stdout`，对每次 Ink 的批量 write 前后注入 `\x1b[?2026h`（Begin Synchronized Update, BSU）与 `\x1b[?2026l`（End, ESU）。Ink v5 每帧通过 `stdout.write` 写一次完整帧串，理想情况下每帧只需包一次。
  - 推荐做法：给 `render(app, { stdout: wrappedStdout })` 传一个**代理 stdout**，其 `write()` 方法在调用底层写之前/之后注入 BSU/ESU。这样对 Ink 完全透明，回滚只需去掉 wrapper。
- 兼容性：DEC 2026 是私有模式，**不支持的终端会忽略**这两个序列（无副作用），无需能力探测即可安全启用；但仍在阶段 0 抽查主要终端确认无残留可见字符。
- 风险：低。纯输出包裹，不改 React 树、不改事件。
- 验收：阶段 0 的三个场景重测，闪烁应显著下降或消失。

> 经验：对绝大多数"Ink 全屏应用闪烁"问题，阶段 1 单独就能解决可见闪烁。建议先做、先验证，再决定是否继续。

### 阶段 2 — 交互事件节流 / 合批（1–2 天，降低延迟与渲染风暴）

把高频交互事件合并到一次渲染，砍掉每秒上百次整树 reconcile。

1. **滚轮滚动节流**：`useMouseHandler` 中对 `onScrollUp/Down` 做累加 + rAF/`setTimeout(0)` 合批，一个 tick 内的多次滚轮合成一次 scrollOffset 更新。或在 `App` 层用 `requestAnimationFrame`-style 调度（Node 用 `setImmediate`/微批）。
2. **拖拽 selection 节流**：drag 的 `setSelection` 按 ~16ms（≈60fps）节流，拖拽时不再每个 motion 事件都整帧重绘。
3. **键盘输入合批**：把 InputBox 的 `setValue` 改为同一 microtask/tick 内合并（粘贴大段文本时收益明显）；保留即时光标反馈。
4. **统一帧调度器**：抽一个 `useFrameScheduler`，所有"导致重渲染"的状态更新都经它在一个 tick 合并，类似浏览器 rAF。把现有 `useTranscript` 的 30ms 合批并入这个统一调度（避免两套节流打架）。
- 风险：中。需小心交互"手感"——节流过度会让输入/滚动发涩。用阶段 0 指标 + 人工试用双重校验。
- 验收：连续打字、快速滚动时 rerender/s 显著下降，且无可感知输入延迟。

### 阶段 3 — React 渲染面收敛（1–2 天，减少每帧 reconcile 成本）

- 对 `Transcript`、`Dashboard`、`InputBox`、`StatusLine` 等做 `React.memo` + 稳定 props（`useMemo`/`useCallback`），避免无关状态变更触发整棵子树重算。
- 核查 `index.tsx` 的 `doRender`：每次都 `React.createElement(App, {...})` 新建 props 对象与新的内联回调（`onReconnect`、`onResumeSelect` 等都是每次新函数）。把这些回调 `useRef`/模块级稳定化，减少 App 因连接级 rerender 带来的全量 props 变化。
- 验收：单次状态更新触及的组件数量下降（可用 React Profiler 或自插桩计数）。

### 阶段 4 —（可选）自研 cell-diff 渲染层（3–6 天，仅当 1–3 后仍不达标才做）

这才是用户说的"缓冲区对比，只更新 diff"。在 Ink 的字符串帧输出与终端之间插一层 **cell buffer 差分器**：

1. 维护当前屏幕的 2D cell 网格 `{char, fg, bg, attrs}`（前一帧的真实状态）。
2. 拦截 Ink 每帧输出的完整帧串，解析成新 cell 网格（需要一个 ANSI → cell 的解析器，或直接让 Ink 渲染到 off-screen 再读取；Ink 内部有 `Output`/`renderToString` 可借力，需调研其私有 API 稳定性）。
3. 逐 cell diff，只对变化的 cell 发 `\x1b[row;colH` 定位 + 写入，合并相邻变化为连续段，最小化光标移动与字节量。
4. 仍然用阶段 1 的同步输出包裹整个 delta，保证原子刷新。
5. 正确处理：CJK 宽字符（`string-width`）、SGR 属性继承、selection/光标的反显、resize 时整屏重建。

- 取舍：收益是"超大屏 / 极高频更新下进一步降字节与延迟"；成本是**重、且依赖 Ink 私有渲染 API**（Ink 升级可能破坏）。**默认不做**，把它作为阶段 1–3 验证后仍不达标时的升级路径。
- 备选：若阶段 1–3 不够，优先评估"换更适合全屏的库/自渲染"是否比 hack Ink 内部更划算（如基于 `@opentui` / 直接自绘）——但那是另一个更大的决策，需单独立项 + 审批。

## 5. 推荐执行顺序与决策点

1. 阶段 0（测量）→ 必做。
2. 阶段 1（同步输出）→ 必做，先验证。**决策点 A**：闪烁是否已消除？若是，阶段 4 基本不需要。
3. 阶段 2（事件节流）→ 必做，解决延迟。
4. 阶段 3（React 收敛）→ 视阶段 2 后剩余成本决定。**决策点 B**：延迟是否达标？
5. 阶段 4（cell-diff）→ 仅当 A 或 B 未达标。需用户确认（属架构性变更 + 依赖私有 API）。

## 6. 基准指标（阶段 0 填写，每阶段复测）

| 场景 | writes/s | bytes/frame | rerender/s | 主观闪烁(0-5) | 主观延迟(0-5) |
|------|----------|-------------|------------|---------------|---------------|
| 快速滚轮滚动 | — | — | — | — | — |
| 连续打字 | — | — | — | — | — |
| 拖拽 selection | — | — | — | — | — |

## 7. 风险与回滚

- 阶段 1：纯 stdout 包裹，去掉 wrapper 即回滚；不支持 2026 的终端自动忽略。
- 阶段 2/3：行为变更（手感），保留特性开关 / 可逐项回滚；用基准 + 人工试用守门。
- 阶段 4：高风险、依赖 Ink 私有 API，单独分支 + 审批后再做。
- 全程注意不破坏：alt-screen 进出与退出清理（`leaveFullscreen` 的 writeSync 路径）、SGR 鼠标 / bracketed paste 序列、CJK 对齐、resize 重建。

## 8. 待确认问题

- 目标终端集合？（tmux / VS Code 集成终端 / Windows Terminal / iTerm2 / kitty）决定 DEC 2026 覆盖率与阶段 1 收益。
- 是否接受为节流引入轻微"手感"调参（trade 即时性换流畅度）。
- 阶段 4 是否值得：取决于阶段 1–3 后的实测差距。
