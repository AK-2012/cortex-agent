# Rollout — switch production daemon to `npm install -g` mode

> Step 9 of `npm-install-refactor.md`. The code refactor (Steps 1-7) and Step 8
> smoke verification are committed. This file is the executable rollout plan
> for the live production daemon, to be run by the user when ready.

## Why a manual step

The production daemon (PID 2379497, child app.js 4096803) is currently the
process serving the active Slack/Claude session. If the rollout is performed
inside that session, killing the daemon kills the conversation.

User should run this when:
- No active Slack conversation depends on the daemon
- No scheduled task is due in the next ~30 seconds
- They have a terminal open for monitoring

## Pre-flight check

```bash
# Confirm running state
ps -ef | grep -E "node.*(daemon|app)\.js" | grep -v grep
cat /home/fangxin/.cortex/data/daemon.pid

# Confirm current symlink install
ls -la /home/fangxin/.npm-global/lib/node_modules/cortex-agent-server

# Confirm tarball is built and current
ls -la /home/fangxin/Cortex/agent-server/cortex-agent-server-*.tgz
```

Expected:
- daemon.js running, app.js child
- symlink to `/home/fangxin/Cortex/agent-server`
- tarball from the latest build (or rebuild with `cd agent-server && npm run build && npm pack`)

## Rollout

Run **from outside `/home/fangxin/Cortex/agent-server`** (so that `npm uninstall -g` doesn't try to remove the symlinked dir while you're in it):

```bash
cd /tmp

# 1. Rebuild + repack to be safe (if not already current)
(cd /home/fangxin/Cortex/agent-server && npm run build && npm pack)

# 2. Drop the symlink install
npm uninstall -g cortex-agent-server

# 3. Stop the running daemon (it's now an orphan — no bin links to it)
DAEMON_PID=$(cat /home/fangxin/.cortex/data/daemon.pid 2>/dev/null)
if [ -n "$DAEMON_PID" ]; then
  kill -TERM "$DAEMON_PID"
  # Wait up to 10s for graceful shutdown
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1; kill -0 "$DAEMON_PID" 2>/dev/null || break
  done
fi
ps -ef | grep -E "node.*(daemon|app)\.js" | grep -v grep   # should be empty

# 4. Install the tarball (real install, no symlink)
npm install -g /home/fangxin/Cortex/agent-server/cortex-agent-server-0.1.0.tgz

# 5. Verify the install
ls -la /home/fangxin/.npm-global/lib/node_modules/cortex-agent-server   # should NOT be a symlink
which cortex                                                            # → .../node_modules/.bin/cortex
cortex config                                                           # INSTALL_ROOT should point at the install dir, not the repo

# 6. Start the new daemon
nohup cortex daemon > /home/fangxin/.cortex/logs/daemon-stdout.log 2>&1 &
sleep 2
cat /home/fangxin/.cortex/data/daemon.pid
ps -ef | grep -E "node.*(daemon|app)\.js" | grep -v grep   # should show the new PIDs

# 7. Tail the log to confirm clean boot (Ctrl-C when satisfied)
tail -f /home/fangxin/.cortex/logs/server-$(date +%Y%m%d).log
```

Healthy log markers:
- `[daemon] INFO Cortex Daemon starting...`
- `[daemon] INFO Watching: <install>/dist (recursive)`
- `[daemon] INFO Starting app.ts...`
- `[client-manager] INFO WebSocket server started on port 3002` (no EADDRINUSE)
- `[thread-manager] INFO Loaded 16 agents, 7 templates` (no "Failed to read systemPrompt/directive" errors)
- `[scheduler] INFO Started with N task(s)`

## Future upgrade workflow

```bash
cd /home/fangxin/Cortex/agent-server
git pull                                # or however code lands
npm run build && npm pack
npm install -g ./cortex-agent-server-X.Y.Z.tgz   # postinstall touches .restart
# Daemon picks up trigger, drains current request, respawns from new dist
```

The `postinstall` hook + dist-watch + `.restart` trigger together mean the
daemon never needs manual restart after a normal upgrade. The only reason to
fully `kill + nohup cortex daemon &` again is when `daemon.js` itself changes
(daemon can't reload its own module).

## Rollback

If something goes wrong after `npm install -g <tgz>`:

```bash
# Kill the broken daemon
kill -TERM $(cat /home/fangxin/.cortex/data/daemon.pid)

# Switch back to the repo symlink
npm uninstall -g cortex-agent-server
cd /home/fangxin/Cortex/agent-server
npm link

# Restart from the symlinked location
nohup cortex daemon > /home/fangxin/.cortex/logs/daemon-stdout.log 2>&1 &
```

The DATA_DIR (`/home/fangxin/.cortex/`) is not touched by any of this — your
state, projects, sessions, configs all persist across install style changes.
