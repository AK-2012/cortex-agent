# cortex-client/src/ — Index

## Files

| File | Purpose |
|------|---------|
| `client.ts` | WebSocket client — receives commands from agent-server, executes locally, returns results |
| `auth-headers.ts` | `resolveClientToken`/`buildClientHeaders` — WS bearer token (`x-cortex-token`) from cortex-client.json `clientToken` or `CORTEX_CLIENT_TOKEN` env |
| `cortex-run-watcher.ts` | Standalone watchdog — spawns user command, detects stalls, writes state/output/result, touches callback.pending |
| `cortex-run-launch.ts` | Launch handler + callback scanning + orphan detection + ack handling — see DR-0011 §4.5 + §4.7 |
| `cortex-md-scanner.ts` | Scans CORTEX.md chain for a given path |
| `log.ts` | Logger with console + daily-rotating file sink |
| `paths.ts` | Path constants (DATA_DIR = `~/.cortex/`) |

## cortex-run-watcher

CLI entry bundled into `client/dist/cortex-run-watcher.js`. Spawned via `node dist/cortex-run-watcher.js` (not exposed as PATH bin).

### Usage

```
cortex-run-watcher --name NAME [--stall 10m] [--gpu auto] --state-dir DIR -- COMMAND [ARGS...]
```

### File layout (`<state-dir>/`)

| File | Writer | Contents |
|------|--------|----------|
| `state.json` | Watcher (every 5s / on exit) | Running state heartbeat: `status`, `pid`, `started_at`, `ended_at`, `exit_code`, `termination` |
| `output.log` | Watcher (streaming) | stdout+stderr of user command |
| `result.json` | Watcher (on completion) | Full result: name, command, timestamps, duration, exit code, termination, last output line, log path |
| `callback.pending` | Watcher (on completion) | Empty marker file — signals cortex-client to push `task-callback` to server |

### Termination values

- `completed` — user command exited 0
- `output_stall` — no output for stall timeout
- `progress_stall` — output flowing but last line unchanged for stall timeout
- `signal:<NAME>` — user command killed by signal (e.g., `signal:SIGTERM`)
- `interrupted` — watcher received SIGTERM/SIGINT

## Actions (DR-0011, implemented)

Registered in `client.ts` `handleCommand` switch:

### `cortex-run.launch`

**Params**: `{ name, command, stall?, gpu?, force?, cwd?, env?, taskProject?, taskId?, logTailBytes? }`
Creates `~/.cortex/tmp/cortex-run/<name>/` directory, writes `meta.json`, spawns watcher detached, writes `pid`. Returns `{ pid, callbackId, resultDir }`. See `cortex-run-launch.ts:handleCortexRunLaunch`.

### `cortex-run.cancel`

**Params**: `{ name, signal? }`
Reads `pid` file, sends signal to watcher process group. Returns `{ killed, pid }`. See `cortex-run-launch.ts:handleCortexRunCancel`.

### Callback scanning (`flushPendingCallbacks`)

Scans `~/.cortex/tmp/cortex-run/*/callback.pending` and sends `task-callback` WS messages with schema:

```
{ type: 'task-callback', device, callbackId, name, taskProject, taskId,
  termination, exitCode, durationSeconds, durationHuman,
  startedAt, endedAt, lastOutputLine, remoteResultPath, remoteLogPath, logTail }
```

Triggered on connect and every 60s. Orphan detection: if `state.json` says `running` but PID is dead, synthesizes `result.json` with `termination=orphaned` and touches `callback.pending`.

### `task-callback-ack`

Server acks with `{ type: 'task-callback-ack', callbackId, ok, message }`. Client removes `callback.pending` marker on ok. If ack fails or is missing, marker stays for retry.
