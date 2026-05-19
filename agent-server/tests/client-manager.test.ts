// input:  Node test runner + client-manager lifecycle
// output: handshake + sendCommand + stop/idempotent tests
// pos:    client-manager observability entry point regression test
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket, WebSocketServer } from 'ws';
import {
  getOnlineDevices,
  isDeviceOnline,
  sendCommand,
  startClientManager,
  stopClientManager,
  buildRemoteSpawnCommand,
  startRemoteClient,
  _setSshExecForTesting,
  _setMachineRegistryProviderForTesting,
  _getRestartTimerCount,
  _testReset,
} from '../src/domain/remote/client-manager.js';

// Allocate an ephemeral port by listening on 0 once, capturing the port, then closing.
async function findEphemeralPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = new WebSocketServer({ port: 0 });
    probe.on('listening', () => {
      const addr = probe.address();
      if (typeof addr === 'object' && addr) {
        const port = addr.port;
        probe.close(() => resolve(port));
      } else {
        reject(new Error('WebSocketServer address() did not return an object'));
      }
    });
    probe.on('error', reject);
  });
}

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor timed out');
}

// A single test-suite-wide cleanup guard: if any test leaks a started server we stop it here.
after(() => {
  try { stopClientManager(); } catch {}
});

test('getOnlineDevices returns [] and isDeviceOnline returns false when no server started', () => {
  // With no WebSocket server running and no clients, the module-level `devices` Map is empty.
  // (If a previous test leaked state we still expect at most the previously-registered devices,
  //  but stopClientManager clears them — and this is the first test in the file.)
  assert.deepEqual(getOnlineDevices(), []);
  assert.equal(isDeviceOnline('any-device'), false);
});

test('sendCommand rejects immediately with "not online" for unknown device', async () => {
  await assert.rejects(
    () => sendCommand('device-does-not-exist', { action: 'bash', params: { cmd: 'echo hi' } }),
    /not online/,
  );
});

test('stopClientManager is idempotent — safe to call when not started', () => {
  assert.doesNotThrow(() => stopClientManager());
  // Second call should also be a no-op.
  assert.doesNotThrow(() => stopClientManager());
});

test('start + hello handshake populates devices; stopClientManager tears everything down', async (t) => {
  const port = await findEphemeralPort();
  startClientManager(port);
  t.after(() => stopClientManager());

  // Connect a fake client and send a hello frame.
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  ws.send(JSON.stringify({ type: 'hello', device: 'mock-device-1', platform: 'linux', capabilities: ['bash'] }));
  await waitFor(() => isDeviceOnline('mock-device-1'));

  const online = getOnlineDevices();
  assert.equal(online.length, 1);
  assert.equal(online[0].device, 'mock-device-1');
  assert.equal(online[0].platform, 'linux');
  assert.deepEqual(online[0].capabilities, ['bash']);
  assert.ok(online[0].connectedAt instanceof Date);
  assert.ok(online[0].lastHeartbeat instanceof Date);

  ws.close();
  await waitFor(() => !isDeviceOnline('mock-device-1'));
});

// --- Regression: WMI Win32_Process.Create cannot resolve npm-installed `.cmd` shims
//     via PATH, so the Windows spawn command must wrap with `cmd.exe /c`.
//     Without the wrapper, WMI returns ReturnValue=9 (Path Not Found) and an empty
//     ProcessId, which serializes to "" over SSH and the server logs
//     `Failed to parse PID for <device>: ""`. Observed live on my-pc 2026-05-14 → 17.
test('buildRemoteSpawnCommand wraps Windows cortex-client invocation with cmd.exe /c', () => {
  const cmd = buildRemoteSpawnCommand({ cortexPath: 'D:\\x', gpuCount: 0, ssh: 'user@host', win: true });
  // Must include the cmd.exe wrapper so PATH lookup resolves cortex-client.cmd.
  assert.match(cmd, /cmd\.exe \/c cortex-client/);
  // Must still be a PowerShell WMI Win32_Process.Create call (server-side parser
  // expects the ProcessId on stdout).
  assert.match(cmd, /Invoke-WmiMethod -Class Win32_Process -Name Create/);
  assert.match(cmd, /\.ProcessId/);
});

test('buildRemoteSpawnCommand uses nohup + echo $! on Linux remotes', () => {
  const cmd = buildRemoteSpawnCommand({ cortexPath: '/home/x', gpuCount: 0, ssh: 'user@host' });
  assert.match(cmd, /^nohup cortex-client/);
  assert.match(cmd, /echo \$!/);
});

// --- Regression: when SSH spawn returns an unparseable PID (the live failure mode
//     on my-pc), `startRemoteClient` previously only logged a WARN and returned —
//     no retry was scheduled. Combined with the WMI bug above, this caused my-pc to
//     stay silently offline for 3 days. Fix: always schedule a retry on spawn failure.
test('startRemoteClient schedules a retry when remote returns empty PID', async (t) => {
  t.after(() => _testReset());

  // Fake registry with one Windows device.
  _setMachineRegistryProviderForTesting(() => ({
    'fake-win': { cortexPath: 'D:\\x', gpuCount: 0, ssh: 'user@fake', win: true },
  }));
  // Fake sshExec that always returns empty (mimics WMI Path-Not-Found case).
  _setSshExecForTesting(async () => '');

  assert.equal(_getRestartTimerCount(), 0);
  await startRemoteClient('fake-win');
  assert.equal(_getRestartTimerCount(), 1, 'expected one pending restart timer after failed spawn');
});

test('startRemoteClient schedules a retry when SSH itself throws', async (t) => {
  t.after(() => _testReset());

  _setMachineRegistryProviderForTesting(() => ({
    'fake-linux': { cortexPath: '/home/x', gpuCount: 0, ssh: 'user@fake' },
  }));
  _setSshExecForTesting(async () => { throw new Error('SSH error: Connection refused'); });

  assert.equal(_getRestartTimerCount(), 0);
  await startRemoteClient('fake-linux');
  assert.equal(_getRestartTimerCount(), 1, 'expected retry timer when SSH fails outright');
});

test('sendCommand rejects pending commands when stopClientManager is called mid-flight', async (t) => {
  const port = await findEphemeralPort();
  startClientManager(port);
  t.after(() => stopClientManager());

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'hello', device: 'mock-device-2', platform: 'linux', capabilities: [] }));
  await waitFor(() => isDeviceOnline('mock-device-2'));

  // Issue a command that will never get a response (the fake client doesn't reply to `command` frames).
  const pending = sendCommand('mock-device-2', { action: 'bash', params: { cmd: 'sleep 9999' }, timeout: 60_000 });
  // Swallow the expected rejection so Node doesn't flag it as unhandled.
  const rejection = pending.catch((err: Error) => err);

  // Yield once so the send goes through before we stop.
  await new Promise((r) => setImmediate(r));

  stopClientManager();
  const err = await rejection;
  assert.ok(err instanceof Error);
  assert.match(err.message, /shutting down|disconnected|not online/);

  try { ws.close(); } catch {}
});
