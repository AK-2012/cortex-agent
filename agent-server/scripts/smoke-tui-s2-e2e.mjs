// E2E smoke: TUI Phase 2 S2 — Live event delivery via subscribe
//
// Verifies that task lifecycle mutations publish task.{claimed,completed}
// events through the EventBus → M3 subscribe → TUI gateway → WS pipeline.
//
// Usage: node scripts/smoke-tui-s2-e2e.mjs
// Requires: running daemon on port 3003 with code changes from task c39d

import { WebSocket } from 'ws';

const PORT = process.env.CORTEX_TUI_PORT || 3003;
const URL = `ws://127.0.0.1:${PORT}`;

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 5000);
  });
}

function sendFrame(ws, frame) {
  ws.send(JSON.stringify(frame));
}

function expectFrame(ws, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for frame matching ${predicate.toString().slice(0,60)}`)), timeout);
    const handler = (raw) => {
      let frame;
      try { frame = JSON.parse(raw.toString()); } catch { return; }
      if (predicate(frame)) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(frame);
      }
    };
    ws.on('message', handler);
  });
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

let passed = 0;
let failed = 0;

function assert(label, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}: ${detail}`);
  }
}

async function main() {
  console.log(`\n=== TUI Phase 2 S2: E2E Live Event Delivery ===`);
  console.log(`Target: ${URL}\n`);

  // ── S2: Subscribe + query + mutate → verify ui.event delivery ──
  console.log(`--- S2: Live Event Delivery via Subscribe ---`);
  const ws = await connect();

  // Handshake
  sendFrame(ws, { type: 'handshake.hello', protocolVersion: 1, clientName: 'smoke-s2-e2e', clientVersion: 'dev' });
  const ack = await expectFrame(ws, f => f.type === 'handshake.ack');
  assert('S2.0 handshake.ack received', !!ack, `conduitId: ${ack.conduitId}`);

  // Subscribe to task events
  sendFrame(ws, { type: 'ui.subscribe', id: 'sub-tasks-e2e', filter: { events: ['task.claimed', 'task.completed', 'task.dispatched'] } });
  await sleep(300);

  // Query 1: all tasks (baseline for count comparison in S2.9)
  sendFrame(ws, { type: 'ui.query', id: 'q-tasks-base', scope: 'tasks.list', params: {} });
  const baseResult = await expectFrame(ws, f => f.type === 'ui.queryResult' && f.id === 'q-tasks-base');
  assert('S2.1 baseline tasks query', baseResult?.ok === true,
    baseResult?.ok ? `count=${Array.isArray(baseResult.data) ? baseResult.data.length : '?'}` : `error=${baseResult?.error?.code}`);
  const baselineTasks = Array.isArray(baseResult?.data) ? baseResult.data : [];

  // Query 2: actionable tasks (open, unclaimed, unblocked, not paused) for candidate selection
  sendFrame(ws, { type: 'ui.query', id: 'q-tasks-actions', scope: 'tasks.list', params: { actionable: true } });
  const actionsResult = await expectFrame(ws, f => f.type === 'ui.queryResult' && f.id === 'q-tasks-actions');
  const actionableTasks = Array.isArray(actionsResult?.data) ? actionsResult.data : [];

  const candidateTask = actionableTasks[0] || null;
  if (candidateTask) {
    console.log(`  ℹ Using task: [${candidateTask.project}] ${candidateTask.text.substring(0, 60)} (id=${candidateTask.id})`);
  } else {
    console.log('  ⚠ No actionable (open/unclaimed/unblocked/not-paused) tasks found');
  }

  let targetTask = candidateTask;

  if (!targetTask) {
    // Last resort: try to use cortex-task CLI to create a task
    console.log('  ⚠ Attempting to create a test task...');
    const { execSync } = await import('child_process');
    try {
      const out = execSync('cortex-task add --project general --text "E2E smoke test task" --why "Automated E2E verification for task c39d" --done-when "test passes" --priority low --template coder-review 2>&1', {
        encoding: 'utf8', timeout: 10000,
      });
      console.log(`  ℹ Created task: ${out.substring(0, 80)}`);
      // Re-query to get the new task
      sendFrame(ws, { type: 'ui.query', id: 'q-tasks-reload', scope: 'tasks.list', params: {} });
      const reloadResult = await expectFrame(ws, f => f.type === 'ui.queryResult' && f.id === 'q-tasks-reload');
      const reloadedTasks = Array.isArray(reloadResult?.data) ? reloadResult.data : [];
      targetTask = reloadedTasks.find(t =>
        t.status === 'open' && !t.claimedBy && !t.blockedBy
      ) || null;
    } catch (e) {
      console.log(`  ⚠ Could not create test task: ${e.message}`);
    }
  }

  if (!targetTask) {
    assert('S2.2 available task for test', false, 'no claimable tasks found');
  } else {
    // ── Phase A: Claim the task ──
    const claimEventPromise = expectFrame(ws, f => f.type === 'ui.event' && f.event?.type === 'task.claimed', 5000);
    const claimStart = Date.now();
    sendFrame(ws, { type: 'ui.mutate', id: 'mut-claim', op: 'tasks.claim', args: { projectId: targetTask.project, taskId: targetTask.id } });

    const claimResult = await expectFrame(ws, f => f.type === 'ui.mutateResult' && f.id === 'mut-claim');
    assert('S2.2 claim mutate accepted', claimResult?.ok === true,
      claimResult?.ok ? 'ok' : `error=${claimResult?.error?.code}: ${claimResult?.error?.message}`);

    if (claimResult?.ok) {
      const claimedEvent = await claimEventPromise;
      const claimLatency = Date.now() - claimStart;
      assert('S2.3 task.claimed event delivered via ui.event',
        claimedEvent?.event?.type === 'task.claimed' && claimedEvent?.event?.payload?.taskId === targetTask.id,
        `type=${claimedEvent?.event?.type} taskId=${claimedEvent?.event?.payload?.taskId} (expected ${targetTask.id}) latency=${claimLatency}ms`);
      assert('S2.4 claim event within 1s', claimLatency < 1000, `latency=${claimLatency}ms`);

      // ── Phase B: Complete the task ──
      const completeEventPromise = expectFrame(ws, f => f.type === 'ui.event' && f.event?.type === 'task.completed', 5000);
      const completeStart = Date.now();
      sendFrame(ws, { type: 'ui.mutate', id: 'mut-complete', op: 'tasks.complete', args: { projectId: targetTask.project, taskId: targetTask.id, note: 'E2E smoke test completion' } });

      const completeResult = await expectFrame(ws, f => f.type === 'ui.mutateResult' && f.id === 'mut-complete');
      assert('S2.5 complete mutate accepted', completeResult?.ok === true,
        completeResult?.ok ? 'ok' : `error=${completeResult?.error?.code}: ${completeResult?.error?.message}`);

      if (completeResult?.ok) {
        const completedEvent = await completeEventPromise;
        const completeLatency = Date.now() - completeStart;
        assert('S2.6 task.completed event delivered via ui.event',
          completedEvent?.event?.type === 'task.completed' && completedEvent?.event?.payload?.taskId === targetTask.id,
          `type=${completedEvent?.event?.type} taskId=${completedEvent?.event?.payload?.taskId} (expected ${targetTask.id}) latency=${completeLatency}ms`);
        assert('S2.7 complete event within 1s', completeLatency < 1000, `latency=${completeLatency}ms`);
      }

      // ── Phase C: Re-query and verify row count ──
      await sleep(300);
      sendFrame(ws, { type: 'ui.query', id: 'q-tasks-final', scope: 'tasks.list', params: {} });
      const finalResult = await expectFrame(ws, f => f.type === 'ui.queryResult' && f.id === 'q-tasks-final');
      const finalTasks = Array.isArray(finalResult?.data) ? finalResult.data : [];
      assert('S2.8 tasks query after mutation cycle', finalResult?.ok === true,
        finalResult?.ok ? `count=${finalTasks.length}` : `error=${finalResult?.error?.code}`);

      const stillOpen = finalTasks.filter(t => t.status === 'open').length;
      const wasOpen = baselineTasks.filter(t => t.status === 'open').length;
      console.log(`  ℹ Task counts: total ${baselineTasks.length} -> ${finalTasks.length}, open: ${wasOpen} -> ${stillOpen}`);
      if (wasOpen > 0) {
        assert('S2.9 open task count reflects completion', stillOpen <= wasOpen,
          `open: ${wasOpen} -> ${stillOpen}`);
      }
    }
  }

  // Unsubscribe and close
  sendFrame(ws, { type: 'ui.unsubscribe', id: 'sub-tasks-e2e' });
  await sleep(200);
  ws.close();

  // ── Summary ──
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
