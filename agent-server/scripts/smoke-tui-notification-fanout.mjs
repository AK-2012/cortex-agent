// Smoke test: TUI notification fan-out — cross-project delivery verification
// Verifies that a project-report sent to the gateway reaches connections
// in different projects as notification frames (not just chat.post).
//
// Usage: node --import tsx scripts/smoke-tui-notification-fanout.mjs

import { WebSocket } from 'ws';
import { TuiGatewayAdapter } from '../src/platform/adapters/tui/tui-gateway.js';

const ADAPTER_PORT = 0; // ephemeral

function log(msg) {
  console.log(`[smoke-notif] ${msg}`);
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  let exitCode = 0;

  try {
    // ── Setup ────────────────────────────────────────────────────────
    const adapter = new TuiGatewayAdapter({ port: ADAPTER_PORT, host: '127.0.0.1' });
    await adapter.start();
    const wss = adapter._wss;
    const addr = wss.address();
    const port = addr.port;
    log(`TUI gateway listening on ws://127.0.0.1:${port}`);

    // ── Connect 2 WS clients in different projects ───────────────────
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}`);
    await Promise.all([
      new Promise(r => ws1.on('open', r)),
      new Promise(r => ws2.on('open', r)),
    ]);
    log('Both WS connections opened');

    // Collect frames
    const frames1 = [];
    const frames2 = [];
    ws1.on('message', (data) => frames1.push(JSON.parse(data.toString())));
    ws2.on('message', (data) => frames2.push(JSON.parse(data.toString())));

    // Handshake: ws1 → project-a, ws2 → project-b
    ws1.send(JSON.stringify({ type: 'handshake.hello', protocolVersion: 1, clientName: 'smoke', clientVersion: '1.0', project: 'project-a' }));
    ws2.send(JSON.stringify({ type: 'handshake.hello', protocolVersion: 1, clientName: 'smoke', clientVersion: '1.0', project: 'project-b' }));

    // Wait for handshake.ack + session.switched for both
    await delay(1000);

    // Drain boot frames
    frames1.length = 0;
    frames2.length = 0;
    log('Handshakes complete, boot frames drained');

    // ── Test: Send project-report via adapter ────────────────────────
    const ref = await adapter.postMessage(
      { type: 'project-report', projectId: 'project-a', trigger: 'test', sessionId: '' },
      { text: 'Scheduled task completed in project-a' },
    );
    log(`postMessage returned ref: conduit=${ref.conduit}, messageId=${ref.messageId}`);

    await delay(500);

    // ── Assert ───────────────────────────────────────────────────────
    log(`Frames received: ws1=${frames1.length}, ws2=${frames2.length}`);

    // ws1 (project-a matching): should get chat.post
    const chatPost = frames1.find(f => f.type === 'chat.post');
    if (!chatPost) {
      log('FAIL: ws1 (project-a) did not receive chat.post');
      exitCode = 1;
    } else {
      log(`PASS: ws1 received chat.post: text="${chatPost.content.text}"`);
    }

    // ws2 (project-b cross-project): should get notification
    const notif = frames2.find(f => f.type === 'notification');
    if (!notif) {
      log('FAIL: ws2 (project-b) did not receive notification frame');
      exitCode = 1;
    } else if (notif.kind !== 'project-report') {
      log(`FAIL: ws2 notification kind is "${notif.kind}", expected "project-report"`);
      exitCode = 1;
    } else if (notif.projectId !== 'project-a') {
      log(`FAIL: ws2 notification projectId is "${notif.projectId}", expected "project-a"`);
      exitCode = 1;
    } else {
      log(`PASS: ws2 received notification: kind=${notif.kind}, projectId=${notif.projectId}`);
    }

    // ── Cleanup ──────────────────────────────────────────────────────
    ws1.close();
    ws2.close();
    await adapter.stop();
    log(`Smoke complete. exitCode=${exitCode}`);

  } catch (err) {
    log(`ERROR: ${err.message}`);
    console.error(err);
    exitCode = 1;
  }

  process.exit(exitCode);
}

main();
