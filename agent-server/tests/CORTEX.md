Please update me when files in this folder change

agent-server TypeScript ESM regression tests. Reference production code from here via ../src/*.js.
Uses Node test runner + tsx loader + module-loader.ts to handle fresh imports.

## Cleanup Discipline: Use t.after() for long-lived resources, don't write at the end of the test body

If the module under test holds long-lived resources such as timer/interval/listener/child process (typical examples:
`rate-limit-throttle._resumeTimer`, `disk-monitor._timer`),
the test **must** register cleanup with `t.after(() => mod._testReset())` instead of writing `mod._testReset()` at the end of each test body.

Reason: when an assertion fails, code at the end of the test body does not execute; residual `setTimeout`/`setInterval` will cause the Node event loop
to refuse to exit, and the entire `npm test` hangs after the last test. `t.after()` runs in all three cases (pass/fail/throw)
and is the only safe cleanup location. The `afterEach` global hook or `try/finally` also work — choose any of the three.

Reference implementation: the `freshModuleWithCleanup(t)` helper in `tests/rate-limit-throttle.test.ts`.

## Note: Tests must not modify files actually in production use, must not actually send content, to avoid issues

| filename | role | function |
|---|---|---|
| `agent-adapter/` | Subdirectory | Three-backend fixture-replay tests |
| `orch/` | Subdirectory | Orch orchestration layer (running-executions / channel-queue / superseded-edits / plan-approvals / ask-user-question-pi) regression tests |
| `threads/` | Subdirectory | domain/threads/ domain layer regression tests ([S7]) |
| `agent-adapter.test.ts` | Test | getAdapter/Capability/tool-names contract |
| `agent-adapter-claude.test.ts` | Test | Claude buildSpawnArgs/hooks/summarizer |
| `agent-adapter-pi.test.ts` | Test | PI framing/spawn-args/bootstrap/close |
| `agent-adapter-pi-event-parser.test.ts` | Test | piRpcLineToNormalized full coverage |
| `agent-adapter-pi-hook-bridge.test.ts` | Test | PI hook-bridge toClaude/normalize |
| `agent-adapter-pi-mcp-bridge.test.ts` | Test | PI mcp-bridge content mapping and integration |
| `agent-adapter-pi-tool-shims.test.ts` | Test | PI tool-shims + extension_ui |
| `pi-cost-record.test.ts` | Test | PI agent_end produces cost integration |
| `run-with-adapter.test.ts` | Test | mode-manager event to callback drive |
| `app.test.ts` | Test | Startup DM + scheduled success flow |
| `auto-compound.test.ts` | Test | Compound skip conditions and concatenation |
| `codex-bridge.test.ts` | Test | Codex MCP config tsx loader |
| `codex-event-parser.test.ts` | Test | codexEventToNormalized pure function |
| `command-handlers.test.ts` | Test | !cancel/!cost/!status/!schedule/!nvtop |
| `cortex-run-cli-dispatch.test.ts` | Test | cortex-run.ts CLI dispatch (sendCommand pathway) |
| `daemon.test.ts` | Test | Import has no side effects |
| `project-store.test.ts` | Test | ProjectStore list/get/exists/getDefault/resolveFromMessage + scaffolding + cache refresh |
| `dispatch-utils.test.ts` | Test | Task dispatch commands and env injection |
| `execution-lock-release.test.ts` | Test | Auto lock-release on terminal execution transitions (complete/fail/cancel/stale) |
| `task-dispatcher.test.ts` | Test | Pre-filter + schedule guard + dispatch gate |
| `task-store.test.ts` | Test | runExclusive serialization and error propagation (verified through re-export path) |
| `store/task-repo.test.ts` | Test | TaskRepo concurrent add, state serialization, flush draining |
| `gpu-slot-scheduling.test.ts` | Test | Per-GPU slot scheduling |
| `task-parser.test.ts` | Test | Task CLI read path query/lint/health |
| `task-lint.test.ts` | Test | lintTasks unknown-template error unit coverage |
| `task-lifecycle.test.ts` | Test | Task CLI write path lifecycle |
| `task-id-utils.test.ts` | Test | Hash generation/backfill/collision check |
| `task-state.test.ts` | Test | Claim/pause/approve state transitions |
| `task-completion.test.ts` | Test | complete/uncomplete + done-when validation |
| `task-mutations.test.ts` | Test | addTask/batchEdit/decompose |
| `thread-manager.test.ts` | Test | resolveSystemVars/evaluateTransitions |
| `thread-runner.test.ts` | Test | buildThreadSummary/initThreadContext |
| `thread-abort.test.ts` | Test | detectAbortMarker/abortThread |
| `thread-stages.test.ts` | Test | Thread step stage progression |
| `thread-coder-review.e2e.test.ts` | Test | coder/reviewer two-stage e2e |
| `thread-extra-hooks.test.ts` | Test | per-call extraHooks serial injection |
| `interaction-handlers.test.ts` | Test | handleModalSubmit -> bus.publish('ask-user.answered') BLK-1 regression |
| `platform-mock-adapter.test.ts` | Test | MockAdapter 17 method coverage |
| `output-stream.test.ts` | Test | SlackOutputStream/FeishuOutputStream/MockOutputStream unit tests (46 cases) |
| `message-router.test.ts` | Test | Message routing branches |
| `session.test.ts` | Test | session.ts backend:channel CRUD |
| `session-hooks-profile-resolution.test.ts` | Test | resolveOnNewProfileName priority (registry > ledger) — regression for "Invalid signature in thinking block" caused by thread vs user session profile mismatch |
| `client-manager.test.ts` | Test | client-manager handshake/sendCommand + `buildRemoteSpawnCommand` cmd.exe-wrap regression + retry-on-spawn-failure regression |
| `cortex-run-callback-handler.test.ts` | Test | task-callback handler (DR-0011 §4.4): idempotency, skipVerify, ghost callback, blockTask note |
| `mcp-server.test.ts` | Test | Import safety and startup hints |
| `domain/mcp/tools-registration.test.ts` | Test | All 16 MCP tool names registered (9 legacy + cortex_context + 6 cortex_schedule_*) |
| `domain/mcp/server.test.ts` | Test | Server module loads without Slack env + no wildcard registration ([S10-A]) |
| `domain/mcp/cortex-schedule.test.ts` | Test | resolveTargetShorthand: __current__ to concrete ID 12-way resolution and error paths |
| `scheduled-target-dispatch.test.ts` | Test | planScheduledDispatch: fresh/channel/session/thread + fallback decision tree |
| `claude-md-scanner.test.ts` | Test | scanClaudeMDChain ancestor scanning |
| `claude-md-injector.test.ts` | Test | ClaudeMDInjector dedup and caching |
| `mode-manager.test.ts` | Test | Per-request mode URL routing |
| `gateway-per-request-mode.test.ts` | Test | Gateway /m/{mode}/ prefix and token |
| `memory-index-regen.test.ts` | Test | Index rebuild lifecycle partitioning |
| `session-activity-tracker.test.ts` | Test | sideband diff + inline marker fallback |
| `recommendation-extractor.test.ts` | Test | Recommendation extraction and dedup |
| `skill-scanner.test.ts` | Test | Plugin skill discovery and namespacing |
| `schedule-cli.test.ts` | Test | scheduler API + schedule CLI |
| `slack-message.test.ts` | Test | mergeSubstantialOutput merging |
| `slack-adapter-throttle.test.ts` | Test | SlackAdapter.updateMessage per-message throttle + 429 retry-after |
| `status-helpers.test.ts` | Test | writeStatus/sealStatus serialization |
| `tool-trace.test.ts` | Test | Tool lines merge via OutputStream mutable region |
| `update-prompt.test.ts` | Test | 8-path coverage: 3-button registration, click paths, stale, re-prompt, timeout ([DR-0013]) |
| `update-state.test.ts` | Test | update-state.ts round-trip / missing-file / malformed-json coverage ([DR-0013]) |
| `server-update-check.test.ts` | Test | compareCalVer (4 CalVer + suffix + cross-digit), isUpdateDevMode (3 cases), checkServerUpdate (11 branches, all deps injectable) ([DR-0013]) |
| `store/execution-repo.test.ts` | Test | ExecutionRepo concurrent mutate, index consistency, flush draining (Pattern B) |
| `store/schedule-repo.test.ts` | Test | ScheduleRepo concurrent mutate, flush ordering, CRUD, rateLimitThrottle |
| `store/cost-repo.test.ts` | Test | CostRepo concurrent recordEntry, 90-day prune, flush ordering, budget roundtrip |
| `store/profile-repo.test.ts` | Test | ProfileRepo concurrent mutate, flush ordering, readSync cache, save/read roundtrip |
| `store/session-registry-repo.test.ts` | Test | SessionRegistryRepo concurrent mutate, flush ordering, cache consistency (Pattern A) |
| `gateway-manager.test.ts` | Test | Gateway port conflict reuse |
| `disk-monitor.test.ts` | Test | shouldAlert decision coverage |
| `rate-limit-throttle.test.ts` | Test | Throttle activation/cross-restart/beforeRun |
| `scheduler-precheck.test.ts` | Test | preCheck exit code and env |
| `cli-utils.test.ts` | Test | formatHelp/formatError |
| `template-resolver.test.ts` | Test | Template variables/block/conditional |
| `threads/domain-threads-smoke.test.ts` | Test | domain/threads/ import smoke: parseTarget / resolveStageName / resolveSystemVars / THREAD_PROTOCOL_PREAMBLE |
| `module-loader.ts` | Utility | ESM fresh import + root path helper |
