// Smoke test: TUI S2 live-daemon verification
// Connects to the running daemon's TUI gateway at ws://127.0.0.1:3003
// in a non-cortex-self project, and captures notification frames
// produced by scheduled-task fan-out via the CompositeAdapter.
//
// Usage: node scripts/smoke-tui-s2-live-daemon.mjs [--timeout SECONDS]
//
// Exit codes: 0 = PASS (notification received), 1 = FAIL (timeout or error)

import { WebSocket } from 'ws';

const TUI_PORT = parseInt(process.env.CORTEX_TUI_PORT || '3003', 10);
const TUI_HOST = '127.0.0.1';
const WS_URL = `ws://${TUI_HOST}:${TUI_PORT}`;
const MY_PROJECT = 'general'; // different from cortex-self → triggers cross-project notification

const TIMEOUT_SECONDS = parseInt(process.argv.find(a => a.startsWith('--timeout='))?.split('=')[1] || '180', 10);
const POLL_INTERVAL = process.argv.includes('--poll') ? parseInt(process.argv[process.argv.indexOf('--poll') + 1], 10) || 2000 : 2000;

function log(msg) {
  console.log(`[s2-live] ${msg}`);
}

let receivedFrames = [];
let connectionClosed = false;

async function main() {
  let exitCode = 0;

  try {
    log(`Connecting to ${WS_URL} (project=${MY_PROJECT}, timeout=${TIMEOUT_SECONDS}s)`);
    const ws = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000);
      ws.on('open', () => { clearTimeout(t); resolve(); });
      ws.on('error', (err) => { clearTimeout(t); reject(err); });
    });
    log('Connected');

    // Wire frame collector
    ws.on('message', (data) => {
      let frame;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        log(`WARN: unparseable frame: ${data.toString().slice(0, 80)}`);
        return;
      }
      receivedFrames.push(frame);
      log(`RX: type=${frame.type}${frame.kind ? ` kind=${frame.kind}` : ''}${frame.projectId ? ` projectId=${frame.projectId}` : ''}`);
    });

    ws.on('close', (code, reason) => {
      connectionClosed = true;
      log(`Connection closed: code=${code} reason=${reason?.toString() || 'none'}`);
    });

    ws.on('error', (err) => {
      log(`WebSocket error: ${err.message}`);
    });

    // Handshake: register in MY_PROJECT (non-cortex-self)
    ws.send(JSON.stringify({
      type: 'handshake.hello',
      protocolVersion: 1,
      clientName: 's2-live-daemon-test',
      clientVersion: '1.0',
      project: MY_PROJECT,
    }));

    // Wait for handshake.ack + session.switched
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Log boot frames for diagnostics
    const bootFrames = receivedFrames.splice(0);
    const ack = bootFrames.find(f => f.type === 'handshake.ack');
    const switched = bootFrames.find(f => f.type === 'session.switched');
    log(`Handshake: ack=${ack ? `conduit=${ack.conduitId}` : 'MISSING'}, switched=${switched ? `session=${switched.sessionId} project=${switched.projectId}` : 'MISSING'}`);

    if (!ack || !switched) {
      log('FAIL: handshake incomplete');
      ws.close();
      process.exit(1);
    }

    // Now watch for notification frames from scheduled-task fan-out
    log(`Watching for notification frames (timeout=${TIMEOUT_SECONDS}s)...`);

    const deadline = Date.now() + TIMEOUT_SECONDS * 1000;
    let foundNotification = false;

    while (Date.now() < deadline) {
      if (connectionClosed) {
        log('FAIL: connection closed before notification received');
        exitCode = 1;
        break;
      }

      // Check if we received a notification
      const notifFrames = receivedFrames.filter(f => f.type === 'notification');
      for (const notif of notifFrames) {
        if (notif.kind === 'project-report' && notif.projectId === 'cortex-self') {
          log(`PASS: Received cross-project notification frame:`);
          log(`      kind=${notif.kind}, projectId=${notif.projectId}, sessionId=${notif.sessionId}`);
          log(`      title="${notif.title}", body="${notif.body?.slice(0, 120)}"`);
          foundNotification = true;
          exitCode = 0;
          break;
        }
      }
      if (foundNotification) break;

      // Send keepalive ping
      ws.send(JSON.stringify({ type: 'ping' }));

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    if (!foundNotification && !connectionClosed) {
      log(`FAIL: No cross-project notification received within ${TIMEOUT_SECONDS}s`);
      log(`Frames received during watch: ${receivedFrames.length}`);
      for (const f of receivedFrames) {
        log(`  ${f.type}${f.kind ? `/${f.kind}` : ''}${f.projectId ? ` project=${f.projectId}` : ''}`);
      }
      exitCode = 1;
    }

    // Cleanup
    log('Closing connection...');
    ws.close();
    await new Promise(resolve => setTimeout(resolve, 500));

  } catch (err) {
    log(`ERROR: ${err.message}`);
    exitCode = 1;
  }

  log(`Exit code: ${exitCode}`);
  process.exit(exitCode);
}

main();
