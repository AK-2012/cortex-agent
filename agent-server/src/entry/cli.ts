// input:  process argv, child_process, @core/paths, @core/cli-utils, ./init, @domain/tasks/system/task-cli
// output: CLI dispatcher: cortex {init,start,daemon,task,config}
// pos:    Bin entry point (`cortex`). Dispatches to:
//           init [--home <path>]  — interactive init (async, runInit)
//           start                 — fork app.js
//           daemon                — fork daemon.js
//           task <subcommand>     — delegate to task-cli
//           config                — show resolved paths
//         Packaged as dist/entry/cli.js, registered in package.json bin.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { fork } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync, mkdirSync, writeFileSync, utimesSync } from 'fs';
import { INSTALL_ROOT, DATA_DIR, STORE_DIR, PROJECTS_DIR, WORKSPACE_DIR, isMainModule } from '@core/utils.js';
import { formatHelp } from '@core/cli-utils.js';
import { createLogger } from '@core/log.js';
import { runCli as taskRunCli } from '@domain/tasks/system/task-cli.js';
import {
  getResolvedPaths,
  formatConfigOutput,
  runInit,
} from './init.js';
import type { ConfigStatus } from './init.js';
import { discoverEndpoints, generateGatewayYaml, writeGatewayYaml, dryRunGatewayYaml } from '@core/gateway-generator.js';
import { generateProfiles, writeProfilesJson } from '@core/profile-generator.js';

// ─── Paths ──────────────────────────────────────────────────────

const log = createLogger('cli');

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = path.join(MODULE_DIR, 'app.js');
const DAEMON_JS = path.join(MODULE_DIR, 'daemon.js');

// ─── Help ───────────────────────────────────────────────────────

export function getInitHelp(): string {
  return [
    'Initialize Cortex data directory',
    '',
    'Usage: cortex init [--home <path>] [--gateway-config-dir <path>]',
    '',
    'Creates the CORTEX_HOME directory structure, prompts for backends,',
    'interaction platform (Slack / Feishu), gateway usage, and system service.',
    'Generates .env with platform tokens, copies default configs, and',
    'auto-generates mcp-config.json and mode.json.',
    '',
    'Options:',
    '  --home <path>               Set CORTEX_HOME (default: $CORTEX_HOME or ~/.cortex/)',
    '  --gateway-config-dir <path>  Gateway config output directory (default: ~/.aistatus/)',
    '  --force                     Overwrite existing configs (.env, budget.json, mode.json, etc.)',
    '  --help, -h                  Show this help',
  ].join('\n');
}

export function getSetupGatewayHelp(): string {
  return [
    'Auto-detect Claude Code / PI configurations and generate gateway.yaml + profiles.json',
    '',
    'Usage: cortex setup-gateway [--dry-run] [--output-dir <path>]',
    '',
    'Discovers backend endpoints from local Claude Code and PI configs, then',
    'writes ~/.aistatus/gateway.yaml (with backup) and $CORTEX_HOME/config/profiles.json.',
    'Without flags, this command writes files in place.',
    '',
    'Options:',
    '  --dry-run               Print the generated gateway.yaml to stdout without writing anything',
    '  --output-dir <path>     Write gateway.yaml and profiles.json under <path> instead of the defaults',
    '  --help, -h              Show this help',
  ].join('\n');
}

export function getCliHelp(): string {
  return formatHelp({
    name: 'cortex',
    description: 'Cortex CLI — server management and initialization',
    usage: 'cortex <command> [options]',
    commands: [
      { name: 'init', description: 'Initialize CORTEX_HOME directory with configs and API keys' },
      { name: 'start', description: 'Start the Cortex server (node dist/entry/app.js)' },
      { name: 'daemon', description: 'Daemon mode with file watching and auto-restart' },
      { name: 'restart', description: 'Signal a running daemon to drain and respawn app.js (touches $STORE_DIR/.restart)' },
      { name: 'task', description: 'Task system CLI (delegate to cortex-task)' },
      { name: 'config', description: 'Show resolved paths and initialization status' },
      { name: 'setup-gateway', description: 'Auto-detect Claude/PI configs and generate gateway.yaml + profiles.json' },
    ],
    options: [
      { flag: '--help, -h', description: 'Show this help' },
    ],
    examples: [
      { description: 'Interactive init', command: 'cortex init' },
      { description: 'Init to custom directory', command: 'cortex init --home /tmp/my-cortex' },
      { description: 'Show resolved paths', command: 'cortex config' },
      { description: 'Re-generate gateway config', command: 'cortex setup-gateway' },
      { description: 'Start the server', command: 'cortex start' },
    ],
  });
}

// ─── Config output ──────────────────────────────────────────────

export function getConfigOutput(): string {
  const paths = {
    INSTALL_ROOT,
    ...getResolvedPaths(),
  };

  const dotEnvPath = path.join(paths.CONFIG_DIR, '.env');
  const mcpConfigPath = path.join(paths.CONFIG_DIR, 'mcp-config.json');
  const modeJsonPath = path.join(paths.STORE_DIR, 'mode.json');

  let storeFileCount = 0;
  try { storeFileCount = readdirSync(paths.STORE_DIR).length; } catch {}

  const status: ConfigStatus = {
    dataDirExists: existsSync(paths.DATA_DIR) && storeFileCount > 0,
    dotEnvExists: existsSync(dotEnvPath),
    mcpConfigExists: existsSync(mcpConfigPath),
    modeJsonExists: existsSync(modeJsonPath),
  };

  return formatConfigOutput(paths, status);
}

// ─── CLI Result type ────────────────────────────────────────────

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

// ─── runCli (synchronous/async commands) ────────────────────────

export async function runCli(argv: string[]): Promise<CliResult> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    return { exitCode: 0, stdout: getCliHelp(), stderr: '' };
  }

  const cmd = argv[0];
  const rest = argv.slice(1);

  switch (cmd) {
    case 'init': {
      if (rest.includes('--help') || rest.includes('-h')) {
        return { exitCode: 0, stdout: getInitHelp(), stderr: '' };
      }
      const homeIndex = rest.indexOf('--home');
      const homeDir = homeIndex !== -1 && rest[homeIndex + 1] ? rest[homeIndex + 1] : undefined;
      const gatewayIndex = rest.indexOf('--gateway-config-dir');
      const gatewayConfigDir = gatewayIndex !== -1 && rest[gatewayIndex + 1] ? rest[gatewayIndex + 1] : undefined;
      const force = rest.includes('--force');
      try {
        await runInit({ homeDir, force, gatewayConfigDir });
        return { exitCode: 0, stdout: '', stderr: '' };
      } catch (err: any) {
        return { exitCode: 1, stdout: '', stderr: err.message || String(err) };
      }
    }

    case 'config':
      return { exitCode: 0, stdout: getConfigOutput(), stderr: '' };

    case 'restart': {
      const trigger = path.join(STORE_DIR, '.restart');
      try {
        mkdirSync(STORE_DIR, { recursive: true });
        if (existsSync(trigger)) {
          const now = new Date();
          utimesSync(trigger, now, now);
        } else {
          writeFileSync(trigger, '');
        }
        return { exitCode: 0, stdout: `Restart trigger touched: ${trigger}\nIf a daemon is running it will drain and respawn app.js.\n`, stderr: '' };
      } catch (err: any) {
        return { exitCode: 1, stdout: '', stderr: `Could not write ${trigger}: ${err.message || String(err)}` };
      }
    }

    case 'setup-gateway': {
      if (rest.includes('--help') || rest.includes('-h')) {
        return { exitCode: 0, stdout: getSetupGatewayHelp(), stderr: '' };
      }
      const dryRun = rest.includes('--dry-run');
      const outDirIndex = rest.indexOf('--output-dir');
      const outputDir = outDirIndex !== -1 && rest[outDirIndex + 1] ? rest[outDirIndex + 1] : undefined;
      try {
        if (dryRun) {
          const yaml = dryRunGatewayYaml();
          return { exitCode: 0, stdout: yaml, stderr: '' };
        }
        const endpoints = discoverEndpoints();
        if (endpoints.length === 0) {
          return { exitCode: 0, stdout: 'No backends discovered. Log into Claude Code and/or PI first.\n', stderr: '' };
        }
        const yaml = generateGatewayYaml(endpoints);
        const gatewayPath = writeGatewayYaml(yaml, outputDir);
        const profilesPath = writeProfilesJson(endpoints, outputDir);
        const profiles = generateProfiles(endpoints);
        const profileNames = Object.keys(profiles.profiles).join(', ');
        return {
          exitCode: 0,
          stdout: [
            outputDir ? `[TEST MODE] Output directory: ${outputDir}` : '',
            `Gateway config: ${gatewayPath}`,
            `Profiles: ${profilesPath}`,
            `Discovered ${endpoints.length} endpoint modes`,
            `Generated profiles: ${profileNames} (default: ${profiles.defaultProfile})`,
          ].filter(Boolean).join('\n'),
          stderr: '',
        };
      } catch (err: any) {
        return { exitCode: 1, stdout: '', stderr: err.message || String(err) };
      }
    }

    case 'task': {
      const result = taskRunCli(rest.length > 0 ? rest : ['list']);
      return result;
    }

    case 'start':
    case 'daemon':
      return { exitCode: 0, stdout: '', stderr: `'${cmd}' must be run from the main entry point, not imported.\nUse: node dist/entry/cli.js ${cmd}` };

    default:
      return { exitCode: 1, stdout: '', stderr: `Unknown command: '${cmd}'. Use --help to see available commands.` };
  }
}

// ─── Main entry point (bin invocation) ─────────────────────────

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(getCliHelp());
    process.exit(0);
  }

  const cmd = args[0];
  const rest = args.slice(1);

  // ── Subcommands that replace the process (fork + wait) ──
  if (cmd === 'start') {
    if (!existsSync(APP_JS)) {
      log.error(`Entry not found: ${APP_JS}`);
      log.error('Run `npm run build` first.');
      process.exit(1);
    }
    const child = fork(APP_JS, [], {
      cwd: DATA_DIR,
      stdio: 'inherit',
      env: { ...process.env },
    });
    child.on('exit', (code) => process.exit(code ?? 0));
    return; // let the event loop keep the process alive
  }

  if (cmd === 'daemon') {
    if (!existsSync(DAEMON_JS)) {
      log.error(`Entry not found: ${DAEMON_JS}`);
      log.error('Run `npm run build` first.');
      process.exit(1);
    }
    const child = fork(DAEMON_JS, [], {
      cwd: DATA_DIR,
      stdio: 'inherit',
      env: { ...process.env },
    });
    child.on('exit', (code) => process.exit(code ?? 0));
    return; // let the event loop keep the process alive
  }

  // ── Subcommands that return results ──
  runCli(args).then((result) => {
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(result.exitCode);
  });
}

// ─── Export for testing & reuse ─────────────────────────────────

export { main };

if (isMainModule(import.meta.url)) {
  main();
}
