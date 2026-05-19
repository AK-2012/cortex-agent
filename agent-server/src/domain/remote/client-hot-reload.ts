// Client hot-reload via npm update — replaces the old SCP-based approach.
// On startup, checks all registered remote devices for outdated cortex-client
// and runs `npm update -g cortex-client` + restart when needed.
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getMachineRegistry, type MachineEntry } from '../tasks/dispatch-utils.js';
import { sshExec, clientPids } from './client-manager.js';
import { STORE_DIR } from '@core/utils.js';
import { createLogger } from '@core/log.js';

const log = createLogger('client-hot-reload');

const VERSION_FILE = path.join(STORE_DIR, 'client-version.json');

// --- Types ---

interface DeviceResult {
  device: string;
  updated: boolean;
  restarted: boolean;
  oldVersion?: string;
  newVersion?: string;
  error?: string;
}

interface ClientUpdateResult {
  oldVersion: string | null;
  newVersion: string;
  devices: DeviceResult[];
  duration: number;
}

// --- Version helpers ---

function getLocalClientVersion(): string | null {
  try {
    const result = execSync('npm ls -g cortex-client --json 2>/dev/null || true', { encoding: 'utf8', timeout: 10000 });
    try {
      const parsed = JSON.parse(result);
      return parsed?.dependencies?.['cortex-client']?.version || null;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

function loadStoredVersion(): { version: string; updatedAt: string } | null {
  try {
    return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveVersion(ver: string): void {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(VERSION_FILE, JSON.stringify({ version: ver, updatedAt: new Date().toISOString() }, null, 2));
}

// --- Per-device operations ---

async function killClientOnDevice(device: string, reg: MachineEntry): Promise<boolean> {
  const pid = clientPids.get(device);
  if (!pid) return false;

  try {
    if (!reg.ssh) {
      try { process.kill(pid, 'SIGTERM'); } catch {}
    } else if (reg.win) {
      await sshExec(reg.ssh, `taskkill /pid ${pid} /f /t 2>nul || echo ok`, 10000);
    } else {
      await sshExec(reg.ssh, `kill ${pid} 2>/dev/null || true`, 10000);
    }
    clientPids.delete(device);
    return true;
  } catch {
    return false;
  }
}

async function updateClientOnDevice(device: string, reg: MachineEntry): Promise<DeviceResult> {
  const res: DeviceResult = { device, updated: false, restarted: false };

  try {
    if (!reg.ssh) {
      // Local device: npm update + restart handled externally
      res.error = 'Local client update not yet supported (use npm update -g cortex-client manually)';
      return res;
    }

    // Kill existing client
    await killClientOnDevice(device, reg);

    // npm update
    const updateCmd = 'npm update -g cortex-client 2>&1';
    const updateOutput = await sshExec(reg.ssh, updateCmd, 60000);
    res.updated = true;
    log.info(`  ${device}: npm update output: ${updateOutput.slice(0, 200)}`);

    // Restart (config file is managed by LLM, not rewritten here)
    if (reg.win) {
      const wmiArg = 'cortex-client';
      await sshExec(reg.ssh,
        `powershell -Command "(Invoke-WmiMethod -Class Win32_Process -Name Create -ArgumentList '${wmiArg}').ProcessId"`,
        30000
      );
    } else {
      await sshExec(reg.ssh,
        `nohup cortex-client > /dev/null 2>&1 & echo $!`,
        30000
      );
    }
    res.restarted = true;
  } catch (err) {
    res.error = (err as Error).message;
    log.warn(`  ${device}: update failed — ${res.error}`);
  }

  return res;
}

// --- Main check-and-update ---

async function checkAndUpdateClients(): Promise<ClientUpdateResult | null> {
  const localVersion = getLocalClientVersion();
  const stored = loadStoredVersion();

  // First run: save version, skip update
  if (!stored) {
    const ver = localVersion || 'unknown';
    log.info(`First run — saving client version ${ver}, skipping update`);
    saveVersion(ver);
    return null;
  }

  // No local version info (cortex-client not installed locally)
  if (!localVersion) {
    log.info('cortex-client not found in local npm — skipping hot-reload');
    return null;
  }

  // No change
  if (stored.version === localVersion) {
    return null;
  }

  log.info(`cortex-client updated: ${stored.version} → ${localVersion}`);
  const start = Date.now();

  const registry = getMachineRegistry();

  const devices = await Promise.all(
    Object.entries(registry).map(async ([device, reg]): Promise<DeviceResult> => {
      return updateClientOnDevice(device, reg);
    })
  );

  const duration = Date.now() - start;
  saveVersion(localVersion);

  for (const d of devices) {
    const status = d.updated && d.restarted ? 'OK' : (d.error ? 'FAIL' : 'SKIP');
    log.info(`  ${d.device}: ${status}${d.error ? ` (${d.error})` : ''}`);
  }

  return { oldVersion: stored.version, newVersion: localVersion, devices, duration };
}

// --- Slack message formatting ---

function formatUpdateSlackMessage(result: ClientUpdateResult): string {
  const lines: string[] = [
    `:arrows_counterclockwise: *Client hot-reload*  \`${result.oldVersion}\` → \`${result.newVersion}\`  (${(result.duration / 1000).toFixed(1)}s)`,
  ];

  for (const d of result.devices) {
    const icon = d.updated && d.restarted ? ':white_check_mark:' : ':x:';
    lines.push(`  ${d.device}: ${icon}${d.error ? `  _${d.error}_` : ''}`);
  }

  return lines.join('\n');
}

export { checkAndUpdateClients, formatUpdateSlackMessage };
export type { ClientUpdateResult, DeviceResult };
