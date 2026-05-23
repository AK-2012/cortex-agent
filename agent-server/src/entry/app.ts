// input:  .env, PlatformAdapter, all extracted modules
// output: Cortex agent server main entry — composition root only
// pos:    agent-server main entry and wiring hub (S13: composition root, business branches in orchestration/)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<
import * as dotenv from 'dotenv';
import { mkdirSync } from 'fs';
import * as path from 'path';
import { createAdapterFromEnv } from '@platform/index.js';
import type { PlatformAdapter } from '@platform/index.js';
import { WORKSPACE_DIR, CONFIG_DIR } from '@core/utils.js';
import { closeAllSessions, closeSession as closeClaudePooledSession, shutdownCodex } from '@domain/agents/index.js';
import { closeAllAdapters } from '../agent-adapter/index.js';
import { recoverTuiOrphans } from '../agent-adapter/claude/adapter.js';
import { startWebhookServer } from '@orch/routing/webhook.js';
import * as pendingTaskTracker from '@domain/tasks/pending-tracker.js';
import * as executionRegistry from '@domain/executions/registry.js';
import { initHookBridge } from '@orch/routing/hook-bridge.js';
import { registerCommands } from '@orch/routing/commands/index.js';
import { taskStore } from '@domain/tasks/store.js';
import { channelRepo } from '@store/channel-repo.js';
import { projectDirRepo } from '@store/project-dir-repo.js';
import { projectStore } from '@domain/projects/index.js';
import { sendStartupDmIfConfigured } from './startup-notify.js';
import { startGateway, stopGateway } from '@domain/costs/gateway-manager.js';
import { startClientManager, stopClientManager, startAllRemoteClients } from '@domain/remote/client-manager.js';
import { checkAndUpdateClients, formatUpdateSlackMessage } from '@domain/remote/client-hot-reload.js';
import { threadStore } from '@store/thread-repo.js';
import { sessionRepo } from '@store/session-repo.js';
import { conversationLedger } from '@store/conversation-ledger-repo.js';
import { executionRepo } from '@store/execution-repo.js';
import { loadConfig as loadThreadConfig, startConfigWatcher as startThreadConfigWatcher, setAdminNotifier as setConfigNotifier } from '@domain/threads/index.js';
import { startMemoryWatcher } from '@domain/memory/watcher.js';
import { getActiveBackend } from '@domain/agents/index.js';
import { createEditHandler } from '@orch/routing/edit-handler.js';

// Extracted modules
import { cleanupLogs, ensureMcpConfig } from './startup-helpers.js';
import { createLogger } from '@core/log.js';
import { runningExecutions } from '@core/running-executions.js';
import { planApprovals } from '@orch/interactions/plan-approvals.js';
import { busyTracker } from '@orch/busy-tracker.js';
import { buildExecutionStatusReport } from '@orch/status-helpers.js';
import { reprocessMessage } from '@orch/lifecycle.js';
import { initScheduledRunner, createScheduler, setSchedulerRef, setBus, setInteractiveCallbacksFactory, cancelDispatchedTask } from '@domain/scheduling/runner.js';
import { buildInteractiveCallbacks } from '@orch/agent-runner.js';
import { registerInteractionHandlers, initInteractionHandlers } from '@orch/interactions/interaction-handlers.js';
import { CommandActionRouter } from '@orch/interactions/command-action-router.js';
import { registerMessageHandler } from '@orch/routing/message-router.js';
import { initRateLimitThrottle } from '@domain/costs/rate-limit-throttle.js';
import { scheduleRepo } from '@store/schedule-repo.js';
import { runMigrations } from '@store/version-migrations.js';
import { costRepo } from '@store/cost-repo.js';
import { profileRepo, startProfileWatcher, setAdminNotifier as setProfileNotifier } from '@store/profile-repo.js';
import { sessionStore } from '@store/session-registry-repo.js';
import { cleanupAllBackups } from '@domain/sessions/session-backup.js';
import { initDiskMonitor, stopDiskMonitor } from '@domain/monitor/disk-monitor.js';
import { loadMachinesFromFile, startMachineRegistryWatcher, stopMachineRegistryWatcher, setAdminNotifier as setMachineNotifier } from '@domain/tasks/dispatch-utils.js';
import { EventBus, createEventLogger } from '@events/index.js';
import { registerHookBridgeSubscribers } from '@orch/routing/hook-bridge-subscribers.js';
import { startDispatchReconciler } from '@orch/dispatch-reconciler.js';
import { ensurePIAgentDirs } from '../agent-adapter/pi/agent-dir.js';
import { initOutboundQueue, getOutboundQueue } from '@store/outbound-queue.js';

dotenv.config({ path: path.join(CONFIG_DIR, '.env') });

const log = createLogger('app');

// --- EventBus + logger ---
const bus = new EventBus();
createEventLogger(bus);
initHookBridge(bus); // S5: wire hook-bridge to publish ask-user.requested / plan.submitted
runningExecutions.setBus(bus);   // S6-A: wire lifecycle events
planApprovals.setBus(bus);  // S6-A: wire plan.approved events
busyTracker.setBus(bus);    // S6-C: wire busy/idle IPC through event bus
initInteractionHandlers(bus); // BLK-1: wire ask-user.answered publisher

const TEMP_DIR = WORKSPACE_DIR;
mkdirSync(TEMP_DIR, { recursive: true });
mkdirSync(path.join(TEMP_DIR, 'threads'), { recursive: true });
ensurePIAgentDirs();

// --- Load machine registry (must happen before any module that uses getMachineRegistry()) ---
loadMachinesFromFile();
startMachineRegistryWatcher();

// --- Create platform adapter (replaces direct Slack App instantiation) ---
const adapter: PlatformAdapter = createAdapterFromEnv();

// --- Wire hot-reload admin notifiers ---
const notifyAdmin = (text: string) => {
  adapter.postMessage({ type: 'system-notice' }, { text }).catch(() => {});
};
setProfileNotifier(notifyAdmin);
setConfigNotifier(notifyAdmin);
setMachineNotifier(notifyAdmin);

// --- Init outbound message queue (WAL-based, survives restarts) ---
const oq = initOutboundQueue(adapter);

// --- Init extracted modules ---
initScheduledRunner(adapter);
setBus(bus);
setInteractiveCallbacksFactory(buildInteractiveCallbacks);
const scheduler = createScheduler();
scheduler.setAdminNotifier(notifyAdmin);
setSchedulerRef(scheduler);
initRateLimitThrottle(adapter, {
  save: (state) => scheduleRepo.setRateLimitThrottle(state),
  load: () => scheduleRepo.getRateLimitThrottle(),
}).catch(e => log.error(`initRateLimitThrottle failed: ${e.message}`));
initDiskMonitor(adapter);

const commandRouter = new CommandActionRouter();

const dispatchCommand = registerCommands({
  scheduler,
  cancelDispatchedTask,
  getExecutionStatusReport: buildExecutionStatusReport,
  commandRouter,
});

// Bind command action handlers (buttons, modals) to the platform adapter
commandRouter.bindToAdapter(adapter);

const handleMessageEdit = createEditHandler({
  activeAgents: runningExecutions,
  reprocessMessage,
  // Claude CLI runs in stream-json mode and pools the subprocess per channel; an alive
  // pooled process keeps the conversation history in memory and ignores the rolled-back
  // JSONL on disk. Close it here so the next runAgent spawns a fresh process with
  // `--resume <sessionId>`. PI/codex spawn fresh subprocesses per turn, so the close is
  // a no-op for them (we still call through for symmetry — adapter exits early when
  // there's nothing to close).
  closePooledSession: (channel, backend) => {
    if (backend === 'claude') closeClaudePooledSession(channel);
  },
});

// --- Register interaction handlers ---
registerInteractionHandlers(adapter);

// --- Register message handler ---
registerMessageHandler(adapter, { dispatchCommand, handleMessageEdit });

// --- Profile watcher (hot-reload profiles.json without restart) ---
let _stopProfileWatcher: (() => void) | null = null;

// --- Graceful shutdown ---
process.on('SIGTERM', async () => {
  closeAllSessions(); shutdownCodex(); closeAllAdapters().catch(() => {}); stopClientManager(); stopMachineRegistryWatcher(); _stopProfileWatcher?.();
  stopDiskMonitor();
  // Stop scheduler timers BEFORE draining repo writes — otherwise a late-firing
  // timer can enqueue a mutate() after scheduleRepo.flush() resolves, losing that write.
  scheduler.stop();
  // Stop outbound queue drain loop (pending WAL entries survive on disk for next startup).
  await oq.stop();
  // Drain in-flight atomic writes before exiting. Without this, SIGTERM landing between
  // `writeFile(tmp)` and `rename(tmp, target)` in atomic-write.ts leaves orphan .tmp.* siblings.
  // Daemon gives 5s before SIGKILL — well over the time needed to flush a few MB of JSON.
  try {
    await Promise.allSettled([bus.close(), oq.flush(), threadStore.flush(), sessionRepo.flush(), conversationLedger.flush(), taskStore.flush(), executionRepo.flush(), channelRepo.flush(), projectDirRepo.flush(), scheduleRepo.flush(), costRepo.flush(), profileRepo.flush(), sessionStore.flush()]);
  } catch {}
  await stopGateway(); process.exit(0);
});

// --- Start ---
(async () => {
  cleanupLogs();
  ensureMcpConfig();
  await runMigrations();
  // DR-0012 §3.6: clean up orphan TUI tmux sessions from a previous agent-server lifetime.
  // We can't re-adopt them (sessionKey↔tmux mapping was never persisted) so the honest move
  // is to kill any leftovers — otherwise a later session that reuses the same sessionId will
  // collide with `tmux new-session -s <name>` (which fails on duplicates).
  try {
    const { found, killed } = recoverTuiOrphans();
    if (found.length > 0) {
      log.info(`Startup: swept ${killed.length}/${found.length} orphan TUI tmux session(s)`);
    }
  } catch (e) {
    log.warn(`Startup: recoverTuiOrphans failed: ${(e as Error).message}`);
  }
  executionRepo.load();
  await executionRegistry.markMissingRunningExecutionsStale((record) => record.kind === 'dispatch');
  await adapter.start();

  try {
    const notified = await sendStartupDmIfConfigured(adapter, {
      machine: process.env.CORTEX_MACHINE,
      restartReason: process.env.CORTEX_RESTART_REASON,
    });
    if (!notified) log.info('Startup DM skipped: no admin channel configured.');
  } catch (error) {
    log.warn(`Failed to send startup DM: ${(error as Error).message}`);
  }

  // Recover unsent messages from WAL and start drain loop
  const recoveredCount = await oq.recover();
  if (recoveredCount > 0) {
    log.info(`OutboundQueue: recovered ${recoveredCount} pending messages from WAL`);
    oq.drain().catch(e => log.error(`OutboundQueue drain failed: ${(e as Error).message}`));
  }
  oq.startDrainLoop();

  pendingTaskTracker.init(adapter);
  taskStore.load();

  loadThreadConfig();
  startThreadConfigWatcher();
  _stopProfileWatcher = startProfileWatcher();
  threadStore.load();
  await threadStore.markRunningAsFailedOnStartup();
  await threadStore.cleanup();

  // GC: prune stale sessions (older than 7 days, unreferenced by running executions or active threads)
  sessionStore.setOnPruneSession(cleanupAllBackups);
  try {
    const pruned = await sessionStore.pruneStale(7 * 24 * 60 * 60 * 1000);
    if (pruned > 0) log.info(`Startup GC: pruned ${pruned} stale session(s)`);
  } catch (e) {
    log.warn(`Startup GC: pruneStale failed: ${(e as Error).message}`);
  }

  // M1: Initialize project registry (scaffolds general/, scans PROJECTS_DIR, starts fs.watch watcher)
  await projectStore.initialize();

  startGateway();
  startClientManager(parseInt(process.env.CORTEX_CLIENT_PORT || '3002', 10));

  setTimeout(async () => {
    try {
      const updateResult = await checkAndUpdateClients();
      if (updateResult) {
        log.info(`Client hot-reload: ${updateResult.devices.length} devices updated in ${updateResult.duration}ms`);
        await adapter.postMessage({ type: 'system-notice' }, { text: formatUpdateSlackMessage(updateResult) }).catch((e: any) => log.warn(`Hot-reload DM failed: ${e.message}`));
      }
    } catch (e) {
      log.error(`Client hot-reload check failed: ${(e as Error).message}`);
    }
    await startAllRemoteClients();
  }, 2000);

  await scheduler.start();

  // One-time migration: resume tasks left paused by the old scheduler-based rate-limit mechanism.
  // The new provider-aware rate-limit-throttle no longer pauses tasks via the scheduler guard.
  // Any tasks paused with pausedBy='rate-limit' by the old mechanism will never be resumed
  // unless we do it here on startup. Idempotent — on subsequent restarts no such tasks remain.
  for (const t of await scheduler.list()) {
    if (t.isPaused && t.pausedBy === 'rate-limit') {
      log.info(`Migration: resuming task ${t.id} ("${t.message}") paused by old rate-limit mechanism`);
      await scheduler.resume(t.id);
    }
  }

  // Periodic GC for stale sessions (every 6 hours)
  const PRUNE_STALE_INTERVAL = 6 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      const removed = await sessionStore.pruneStale(7 * 24 * 60 * 60 * 1000);
      if (removed > 0) log.info(`Periodic GC: pruned ${removed} stale session(s)`);
    } catch (e) {
      log.error(`Periodic GC: pruneStale failed: ${(e as Error).message}`);
    }
  }, PRUNE_STALE_INTERVAL);

  startWebhookServer();

  // S13: register hook-bridge event subscribers (bodies extracted to orch/routing/hook-bridge-subscribers.ts)
  registerHookBridgeSubscribers(bus, adapter, planApprovals);

  startMemoryWatcher();
  startDispatchReconciler();

  log.info(`Cortex agent is running (${adapter.name}) — backend: ${getActiveBackend()}`);
})();
