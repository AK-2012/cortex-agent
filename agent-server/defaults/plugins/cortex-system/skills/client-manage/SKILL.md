---
name: client-manage
description: "Use when creating, deploying, updating, or troubleshooting cortex-client instances on remote devices"
author: Cortex
version: 1.1.0
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - mcp__cortex-core__remote_bash
  - mcp__cortex-core__remote_read
  - mcp__cortex-core__remote_write
  - mcp__cortex-core__remote_edit
  - mcp__cortex-core__remote_glob
  - mcp__cortex-core__remote_grep
date: 2026-05-03
---

# Client Manage

You are Cortex. You manage remote `cortex-client` instances that run on registered devices. The client connects to the server via WebSocket and executes commands (bash, read, write, edit, glob, grep) on behalf of the server.

The server (`client-manager.ts`) starts clients automatically. Your job is to ensure each device has a working client installation **and a reachable network path** back to the server.

## Architecture

```
cortex-agent-server ──SSH──► starts cortex-client on remote device
        ▲                                    │
        │  WebSocket ws://<serverHost>:3002   │
        └────────────────────────────────────┘
      (client initiates this connection back to server)
```

**Critical:** The WebSocket connection is initiated FROM the remote device TO the server. The `serverHost` in the config MUST be an IP the remote device can reach. The server's SSH access to the device is separate — it's used for lifecycle management (start/kill/update) but not for the real-time command channel.

## Config File

`~/.cortex/config/cortex-client.json`:

```json
{
  "serverHost": "<reachable-ip>",
  "serverPort": 3002,
  "deviceName": "<device-name>"
}
```

- `serverHost` — The IP the client connects TO. **Must be reachable from the remote device.** Use Tailscale IP when available (`tailscale ip -4` on server), LAN IP for devices on same subnet, `127.0.0.1` for same-machine.
- `serverPort` — Usually `3002`.
- `deviceName` — Must match the name in `machines.json` on the server.

**This config file is managed by you (LLM).** The server never writes it. Server only starts/kills the client process.

## Connectivity — The Most Important Part

The bidirectional path must work:

```
server → remote:  SSH (server starts/kills/updates client)
remote → server:  WebSocket to <serverHost>:3002 (client connects back)
```

### Verify the Return Path

When bootstrapping a new device or debugging connection issues, ALWAYS verify the remote device can reach the server's WebSocket port:

```bash
ssh user@host "timeout 3 bash -c 'echo > /dev/tcp/<serverHost>/3002' 2>&1 && echo REACHABLE || echo UNREACHABLE"
```

### How to Fix Connectivity

| Situation | Fix |
|-----------|-----|
| Same LAN, unreachable | Check firewall: `sudo ufw allow 3002` on server |
| Different network | Use Tailscale IP (works through NAT) |
| STCP tunnel only | Use Tailscale or set up reverse SSH: `ssh -R 3002:localhost:3002 user@host` on server |
| Tailscale but unreachable | `tailscale status` — ensure both devices are connected, check ACLs |
| Can SSH but can't TCP | SSH works on port 22 only. Either open port 3002 or use Tailscale/reverse tunnel |

### Determine the Right serverHost

```bash
# On the server, get candidate IPs:
tailscale ip -4               # Tailscale CGNAT (works everywhere) — PREFERRED
hostname -I | awk '{print $1}'  # Primary LAN IP
```

Test each candidate from the remote device. Use the first one that works.

## Device Reference

Read `machines.json` on the server for the current device list. Key fields per device:

- `ssh` — How the server reaches this device (empty = local)
- `cortexPath` — Path to user's workspace on the device
- `gpuCount` — Number of GPUs
- `win` — `true` for Windows

## Bootstrap — New Device

### 1. Register in machines.json

Edit `machines.json` on the server to add the device entry.

### 2. Install cortex-client

```bash
# Build from source
cd <cortex-repo>/client && npm run build && npm pack

# Transfer and install
scp cortex-agent-client-*.tgz user@host:~/
ssh user@host "npm install -g ./cortex-agent-client-*.tgz"
```

### 3. Write the config

First, determine the correct `serverHost` (see Connectivity section above). Then write:

```bash
ssh user@host 'mkdir -p ~/.cortex/config && cat > ~/.cortex/config/cortex-client.json << EOF
{
  "serverHost": "<REACHABLE_IP>",
  "serverPort": 3002,
  "deviceName": "<device-name>"
}
EOF'
```

Or use `mcp__cortex-core__remote_write` if the device is already reachable via another client.

### 4. Verify connectivity

```bash
ssh user@host "timeout 3 bash -c 'echo > /dev/tcp/<serverHost>/3002' 2>&1 && echo REACHABLE || echo UNREACHABLE"
```

### 5. Restart the server

```bash
touch <cortex-repo>/agent-server/.restart
```

The server will pick up the new device and start the client automatically.

## Maintenance

### Check if a client is online

```
mcp__cortex-core__remote_bash({ device: "<device-name>", command: "hostname" })
```

"Device is not online" means the client is down or disconnected.

### View client logs

```bash
ssh user@host "tail -20 ~/.cortex/logs/client-\$(date +%Y%m%d).log"
```

### Update cortex-client

```bash
# Update and restart
ssh user@host "npm update -g @cortex-agent/client && pkill -f 'node.*cortex-client'"
# Server's client-manager will restart it automatically via scheduleRestart()
```

### Edit the config

```
mcp__cortex-core__remote_edit({
  device: "<device-name>",
  file_path: "~/.cortex/config/cortex-client.json",
  old_string: "\"serverHost\": \"<old-ip>\"",
  new_string: "\"serverHost\": \"<new-ip>\""
})
```

After editing, kill the client — server will restart it:

```bash
ssh user@host "pkill -f 'node.*cortex-client'"
```

## Troubleshooting

| Symptom | Likely Cause | Check |
|---------|-------------|-------|
| "Device is not online" | Client process died | `ssh user@host "pgrep -f cortex-client"` |
| Client exits on start | Config missing or bad serverHost | Check `~/.cortex/config/cortex-client.json` exists and serverHost is reachable |
| "Device already connected" | Stale process | `ssh user@host "pkill -f cortex-client"`, server will restart |
| WebSocket connect EHOSTUNREACH | Wrong serverHost | Verify with `/dev/tcp` test, fix the IP |
| Exit code 127 | cortex-client binary not on PATH | `ssh user@host "which cortex-client"`, reinstall with `npm i -g` |
| Server can't SSH to device | SSH key or tunnel issue | `ssh user@host hostname` from server |
