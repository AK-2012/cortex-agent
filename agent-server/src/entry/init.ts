// input:  @clack/prompts, fs, path, os, yaml, @core/config-generator
// output: runInit — interactive CORTEX_HOME initialization
// pos:    cortex init subcommand — backend selection & install, gateway usage opt-in,
//         creates directory structure, generates .env, copies default configs,
//         auto-generates mcp-config.json and mode.json
//
// INSTALL_ROOT is computed from import.meta.url (agent-server dir, 2 levels up from dist/entry/).
// DATA_DIR is resolved via the --home arg, $CORTEX_HOME env, or ~/.cortex/ default.
// Run with: node dist/entry/cli.js init [--home <path>] [--force]

import { mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline/promises';
import { stdin as processStdin } from 'process';
import * as clack from '@clack/prompts';
import * as yaml from 'yaml';
import { buildFullConfig, buildCoreConfig, buildTuiConfig } from '@core/config-generator.js';
import { discoverEndpoints, generateGatewayYaml, writeGatewayYaml, dryRunGatewayYaml } from '@core/gateway-generator.js';
import { generateProfiles, mergeProfilesJson, writeProfilesJson, listChoices } from '@core/profile-generator.js';
import { mergeThreadTemplates } from '@domain/threads/index.js';
import type { ModelChoice } from '@core/profile-generator.js';
import { createLogger } from '@core/log.js';
import { INSTALL_ROOT, DEFAULTS_DIR } from '@core/utils.js';

// ─── Path computation (DATA_DIR resolved locally to support --home override) ──

const log = createLogger('init');

// MODULE_DIR kept for any consumers that still derive paths locally; the canonical roots
// (INSTALL_ROOT, DEFAULTS_DIR) come from @core/paths via @core/utils.
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export interface InitPaths {
  DATA_DIR: string;
  CONFIG_DIR: string;
  STORE_DIR: string;
  CONTEXT_DIR: string;
  PROJECTS_DIR: string;
  WORKSPACE_DIR: string;
}

/** Resolve DATA_DIR from --home arg, $CORTEX_HOME env, or ~/.cortex/ default. */
export function getResolvedPaths(homeDir?: string): InitPaths {
  const dataDir = homeDir
    ? path.resolve(homeDir)
    : process.env.CORTEX_HOME
      ? path.resolve(process.env.CORTEX_HOME)
      : path.join(os.homedir(), '.cortex');

  const contextDir = path.join(dataDir, 'context');
  return {
    DATA_DIR: dataDir,
    CONFIG_DIR: path.join(dataDir, 'config'),
    STORE_DIR: path.join(dataDir, 'data'),
    CONTEXT_DIR: contextDir,
    PROJECTS_DIR: process.env.CORTEX_PROJECTS_DIR
      ? path.resolve(process.env.CORTEX_PROJECTS_DIR)
      : path.join(contextDir, 'projects'),
    WORKSPACE_DIR: path.join(dataDir, 'tmp'),
  };
}

// ─── Types ──────────────────────────────────────────────────────

export type InitBackend = 'claude' | 'pi';
export type InitPlatform = 'slack' | 'feishu' | 'none';

export interface SlackInitConfig {
  botToken: string;
  signingSecret: string;
  appToken: string;
  adminChannel?: string;
}

export interface FeishuInitConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
  domain?: 'feishu' | 'lark';
}

export interface GatewayUsageConfig {
  enabled: boolean;
  name?: string;
  org?: string;
  email?: string;
}

export interface InitAnswers {
  backends: InitBackend[];
  machineName: string;
  gpuCount: number;
  platform: InitPlatform;
  slackConfig?: SlackInitConfig;
  feishuConfig?: FeishuInitConfig;
  gatewayUsage: GatewayUsageConfig;
  installService: boolean;
  /** Explicit (mode, model) for the `plan` profile. Non-interactive only; interactive picks
   *  inside runGatewaySetup once endpoints are discovered. Undefined → auto-infer. */
  planChoice?: ModelChoice;
  /** Explicit (mode, model) for the `execute` profile. Same semantics as planChoice. */
  executeChoice?: ModelChoice;
  /** Additional models to register as standalone named profiles. Non-interactive only. */
  extraProfiles?: ModelChoice[];
}

/** Parse "mode:model" stdin string into a ModelChoice. Returns undefined for empty/invalid. */
function parseChoiceLine(raw: string | undefined): ModelChoice | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx <= 0 || colonIdx === trimmed.length - 1) return undefined;
  return {
    mode: trimmed.substring(0, colonIdx).trim(),
    model: trimmed.substring(colonIdx + 1).trim(),
  };
}

/** Parse comma-separated "mode:model" pairs for extra profiles. Returns undefined for empty. */
function parseExtraProfilesLine(raw: string | undefined): ModelChoice[] | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const choices: ModelChoice[] = [];
  for (const part of trimmed.split(',')) {
    const choice = parseChoiceLine(part.trim());
    if (choice) choices.push(choice);
  }
  return choices.length > 0 ? choices : undefined;
}

// ─── Dot env generation ──────────────────────────────────────────

/** Generate .env content — includes CORTEX_MACHINE, CORTEX_PLATFORM, and platform-specific tokens. */
export function generateDotEnvContent(answers: InitAnswers): string {
  const lines: string[] = [
    '# Cortex Configuration',
    '# Generated by `cortex init`',
    '',
    `CORTEX_MACHINE=${answers.machineName}`,
  ];

  if (answers.platform && answers.platform !== 'none') {
    lines.push(`CORTEX_PLATFORM=${answers.platform}`);
    lines.push('');

    if (answers.platform === 'slack' && answers.slackConfig) {
      lines.push('# Slack configuration');
      lines.push(`SLACK_BOT_TOKEN=${answers.slackConfig.botToken}`);
      lines.push(`SLACK_SIGNING_SECRET=${answers.slackConfig.signingSecret}`);
      lines.push(`SLACK_APP_TOKEN=${answers.slackConfig.appToken}`);
      if (answers.slackConfig.adminChannel) {
        lines.push(`CORTEX_ADMIN_CHANNEL=${answers.slackConfig.adminChannel}`);
      }
    } else if (answers.platform === 'feishu' && answers.feishuConfig) {
      lines.push('# Feishu configuration');
      lines.push(`FEISHU_APP_ID=${answers.feishuConfig.appId}`);
      lines.push(`FEISHU_APP_SECRET=${answers.feishuConfig.appSecret}`);
      if (answers.feishuConfig.encryptKey) {
        lines.push(`FEISHU_ENCRYPT_KEY=${answers.feishuConfig.encryptKey}`);
      }
      if (answers.feishuConfig.verificationToken) {
        lines.push(`FEISHU_VERIFICATION_TOKEN=${answers.feishuConfig.verificationToken}`);
      }
      if (answers.feishuConfig.domain) {
        lines.push(`FEISHU_DOMAIN=${answers.feishuConfig.domain}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ─── Configuration generation ────────────────────────────────────

/** Generate default mode.json content (compact JSON, single line). */
export function generateDefaultModeJson(primaryBackend: InitBackend = 'claude'): string {
  return JSON.stringify({
    mode: 'plan',
    backend: primaryBackend,
    claudeModel: 'opus',
    activeProfile: '__active__',
    defaultAgent: 'direct',
  });
}

// ─── Config output formatting ────────────────────────────────────

/** Status info for the config display */
export interface ConfigStatus {
  dataDirExists: boolean;
  dotEnvExists: boolean;
  mcpConfigExists: boolean;
  modeJsonExists: boolean;
}

/** Format resolved paths and initialization status for `cortex config` output. */
export function formatConfigOutput(paths: InitPaths & { INSTALL_ROOT: string }, status: ConfigStatus): string {
  const lines: string[] = [
    'Cortex configuration:',
    `  INSTALL_ROOT:  ${paths.INSTALL_ROOT}`,
    `  DATA_DIR:      ${paths.DATA_DIR}`,
    `  CONFIG_DIR:    ${paths.CONFIG_DIR}`,
    `  STORE_DIR:     ${paths.STORE_DIR}`,
    `  CONTEXT_DIR:   ${paths.CONTEXT_DIR}`,
    `  PROJECTS_DIR:  ${paths.PROJECTS_DIR}`,
    `  WORKSPACE_DIR: ${paths.WORKSPACE_DIR}`,
    '',
    'Status:',
    `  DATA_DIR:      ${status.dataDirExists ? 'initialized' : 'not initialized'}`,
    `  .env:          ${status.dotEnvExists ? 'found' : 'missing'}`,
    `  mcp-config.json: ${status.mcpConfigExists ? 'found' : 'missing'}`,
    `  mode.json:     ${status.modeJsonExists ? 'found' : 'missing'}`,
  ];
  return lines.join('\n');
}

// ─── Backend detection & installation ────────────────────────────

const BACKEND_INFO: Record<InitBackend, { bin: string; npmPackage: string; label: string; loginHint: string }> = {
  claude: {
    bin: 'claude',
    npmPackage: '@anthropic-ai/claude-code',
    label: 'Claude Code',
    loginHint: 'Run `claude login` to authenticate.',
  },
  pi: {
    bin: 'pi',
    npmPackage: '@mariozechner/pi-coding-agent',
    label: 'PI',
    loginHint: 'Configure your provider in PI settings.',
  },
};

// ─── Slack App Manifest ──────────────────────────────────────────

/** Slack App Manifest for Cortex bot. Users paste this when creating a Slack App via "From a manifest". */
export const SLACK_APP_MANIFEST = JSON.stringify({
  display_information: {
    name: 'Cortex',
    description: 'Autonomous research agent',
    background_color: '#2c2d30',
  },
  features: {
    bot_user: {
      display_name: 'Cortex',
      always_online: true,
    },
  },
  oauth_config: {
    scopes: {
      bot: [
        'chat:write',
        'im:history',
        'im:write',
        'reactions:read',
        'reactions:write',
        'users:read',
        'commands',
        'app_mentions:read',
        'channels:history',
        'channels:read',
        'groups:history',
        'files:read',
        'files:write',
        'emoji:read',
        'pins:read',
        'pins:write',
      ],
    },
  },
  settings: {
    event_subscriptions: {
      bot_events: [
        'message.im',
        'message.channels',
        'message.groups',
        'app_mention',
      ],
    },
    interactivity: {
      is_enabled: false,
    },
    org_deploy_enabled: false,
    socket_mode_enabled: true,
    token_rotation_enabled: false,
  },
}, null, 2);

// ─── Clipboard utilities ─────────────────────────────────────────

/**
 * Copy text to system clipboard.
 * Tries OSC 52 escape sequence first (works in modern terminals without external tools,
 * same approach Claude Code uses), then falls back to platform-specific CLI tools.
 * Returns true on success.
 */
function copyToClipboard(text: string): boolean {
  // 1. OSC 52 escape sequence — no external tool needed, works in VS Code, iTerm2,
  //    Windows Terminal, Kitty, WezTerm, foot, and most modern terminal emulators.
  if (process.stdout.isTTY) {
    const b64 = Buffer.from(text, 'utf-8').toString('base64');
    // BEL-terminated variant (wider terminal support than ST)
    process.stdout.write(`\x1b]52;c;${b64}\x07`);
    // Assume success — terminals silently ignore OSC 52 if unsupported/disabled
    return true;
  }

  // 2. Platform-specific external clipboard tools (fallback for non-TTY)
  const commands: [string, string[]][] = process.platform === 'darwin'
    ? [['pbcopy', []]]
    : process.platform === 'win32'
    ? [['clip', []]]
    : [
        ['xclip', ['-selection', 'clipboard']],
        ['wl-copy', []],
        ['xsel', ['--clipboard', '--input']],
      ];

  for (const [bin, args] of commands) {
    try {
      const cmd = [bin, ...args].join(' ');
      execSync(cmd, { input: text, stdio: 'pipe', timeout: 3000 });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

/** Prompt user to press 'c' to copy manifest to clipboard. Single-key, no Enter needed. */
async function promptCopyManifestToClipboard(manifest: string): Promise<void> {
  if (!process.stdin.isTTY) return; // Non-interactive mode, skip

  process.stdout.write('\nPress "c" to copy manifest to clipboard (any other key to skip)...');

  return new Promise((resolve) => {
    const wasRaw = (process.stdin as NodeJS.ReadStream & { isRaw?: boolean }).isRaw ?? false;
    try {
      process.stdin.setRawMode(true);
      process.stdin.resume();
    } catch {
      process.stdout.write('\r\x1b[K');
      resolve();
      return;
    }

    const onData = (key: Buffer) => {
      const ch = key.toString();

      // Erase the typed character from screen
      process.stdout.write('\b \b');

      // Restore stdin to previous state
      try {
        process.stdin.setRawMode(wasRaw);
        process.stdin.pause();
      } catch { /* best effort */ }
      process.stdin.removeListener('data', onData);

      // Clear the prompt line
      process.stdout.write('\r\x1b[K');

      if (ch.toLowerCase() === 'c') {
        const ok = copyToClipboard(manifest);
        if (ok) {
          clack.log.success('Manifest copied to clipboard!');
        } else {
          clack.log.warn('Could not copy. If running in a terminal, ensure OSC 52 is enabled.');
          clack.log.info('The manifest text is shown above — please copy it manually.');
        }
      }
      resolve();
    };

    process.stdin.on('data', onData);
  });
}

/** Parse existing Slack configuration from a .env file. Returns null if no Slack config found. */
function parseExistingEnvSlackConfig(envPath: string): { signingSecret?: string; appToken?: string; botToken?: string; adminChannel?: string } | null {
  if (!existsSync(envPath)) return null;
  try {
    const content = readFileSync(envPath, 'utf-8');
    const result: { signingSecret?: string; appToken?: string; botToken?: string; adminChannel?: string } = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.substring(0, eqIdx).trim();
      const value = trimmed.substring(eqIdx + 1).trim();
      if (key === 'SLACK_SIGNING_SECRET') result.signingSecret = value;
      else if (key === 'SLACK_APP_TOKEN') result.appToken = value;
      else if (key === 'SLACK_BOT_TOKEN') result.botToken = value;
      else if (key === 'CORTEX_ADMIN_CHANNEL') result.adminChannel = value;
    }
    if (!result.signingSecret && !result.appToken && !result.botToken) return null;
    return result;
  } catch {
    return null;
  }
}

/** Check whether a backend binary is on PATH. */
export function isBackendInstalled(backend: InitBackend): boolean {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const { bin } = BACKEND_INFO[backend];
  try {
    execSync(`${cmd} ${bin}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Return the npm install command for a backend. */
export function getInstallCommand(backend: InitBackend): string {
  return `npm install -g ${BACKEND_INFO[backend].npmPackage}`;
}

/** Detect GPU count via nvidia-smi. Returns 0 if nvidia-smi is unavailable or no GPUs found. */
function detectGpuCount(): number {
  try {
    const result = execSync('nvidia-smi --query-gpu=count --format=csv,noheader', {
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 5000,
    });
    const count = parseInt(result.trim(), 10);
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

/** Check and install selected backends. Returns list of backends that were installed. */
async function checkAndInstallBackends(backends: InitBackend[]): Promise<void> {
  for (const backend of backends) {
    const info = BACKEND_INFO[backend];
    const installed = isBackendInstalled(backend);

    if (installed) {
      clack.log.success(`${info.label} is already installed.`);
    } else {
      const s = clack.spinner();
      s.start(`Installing ${info.label}...`);
      try {
        execSync(getInstallCommand(backend), { stdio: 'pipe', timeout: 120_000 });
        s.stop(`${info.label} installed successfully.`);
      } catch (err: any) {
        s.stop(`Failed to install ${info.label}.`);
        clack.log.error(`Installation failed. Install manually: ${getInstallCommand(backend)}`);
      }
    }

    clack.log.info(info.loginHint);
  }
}

// ─── Gateway usage config ────────────────────────────────────────

/** Path to aistatus config file. */
export function getAistatusConfigPath(): string {
  return path.join(os.homedir(), '.aistatus', 'config.yaml');
}

/** Generate gateway usage config YAML string. */
export function generateGatewayUsageYaml(config: GatewayUsageConfig): string {
  const doc: Record<string, unknown> = { uploadEnabled: config.enabled };
  if (config.enabled) {
    doc.name = config.name || '';
    doc.org = config.org || '';
    doc.email = config.email || '';
  }
  return yaml.stringify(doc);
}

/** Write gateway usage config to ~/.aistatus/config.yaml, or <configDir>/config.yaml if configDir is given. */
function writeGatewayUsageConfig(config: GatewayUsageConfig, configDir?: string): void {
  const configPath = configDir
    ? path.join(configDir, 'config.yaml')
    : getAistatusConfigPath();
  const configDirPath = path.dirname(configPath);
  mkdirSync(configDirPath, { recursive: true });

  // Preserve existing fields (e.g. gateway.yaml keys) if config.yaml already exists
  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      existing = yaml.parse(readFileSync(configPath, 'utf-8')) || {};
    } catch { /* ignore parse errors, overwrite */ }
  }

  const merged = {
    ...existing,
    name: config.enabled ? (config.name || '') : (existing.name ?? ''),
    org: config.enabled ? (config.org || '') : (existing.org ?? ''),
    email: config.enabled ? (config.email || '') : (existing.email ?? ''),
    uploadEnabled: config.enabled,
  };

  writeFileSync(configPath, yaml.stringify(merged));
}

// ─── Service registration ────────────────────────────────────────

/** Generate systemd unit file content for Linux. */
export function generateSystemdUnit(user: string, cortexBin: string, dataDir: string): string {
  return [
    '[Unit]',
    'Description=Cortex Agent Server',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    `User=${user}`,
    `ExecStart=${cortexBin} daemon`,
    `Environment=CORTEX_HOME=${dataDir}`,
    'Restart=on-failure',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}

/** Generate launchd plist content for macOS. */
export function generateLaunchdPlist(user: string, cortexBin: string, dataDir: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    '  <string>cc.cortex.agent-server</string>',
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${cortexBin}</string>`,
    '    <string>daemon</string>',
    '  </array>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    '    <key>CORTEX_HOME</key>',
    `    <string>${dataDir}</string>`,
    '  </dict>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>StandardOutPath</key>',
    `  <string>${dataDir}/logs/cortex-stdout.log</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${dataDir}/logs/cortex-stderr.log</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/** Resolve the cortex binary path (used in service files). */
function resolveCortexBin(): string {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    return execSync(`${cmd} cortex`, { stdio: 'pipe', encoding: 'utf-8' }).trim();
  } catch {
    // Fallback: node + cli.js
    return `${process.execPath} ${path.join(INSTALL_ROOT, 'dist', 'entry', 'cli.js')}`;
  }
}

/** Check if we have sudo/root access (Linux/macOS only). */
function hasSudo(): boolean {
  if (process.platform === 'win32') return false;
  try {
    execSync('sudo -n true', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Install the service file. Returns true if installed by us, false if manual action needed. */
function installService(dataDir: string): void {
  const user = os.userInfo().username;
  const cortexBin = resolveCortexBin();
  const platform = process.platform;

  if (platform === 'darwin') {
    const plistName = 'cc.cortex.agent-server.plist';
    const plistContent = generateLaunchdPlist(user, cortexBin, dataDir);
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', plistName);

    writeFileSync(plistPath, plistContent);
    clack.log.success(`launchd plist written to ${plistPath}`);
    clack.log.info('To start now: launchctl load ' + plistPath);
  } else if (platform === 'linux') {
    const unitContent = generateSystemdUnit(user, cortexBin, dataDir);
    const unitName = 'cortex.service';
    const systemPath = `/etc/systemd/system/${unitName}`;
    const userUnitDir = path.join(os.homedir(), '.config', 'systemd', 'user');

    // Try user-level systemd first (no sudo needed)
    try {
      mkdirSync(userUnitDir, { recursive: true });
      const userUnitPath = path.join(userUnitDir, unitName);
      writeFileSync(userUnitPath, unitContent);
      clack.log.success(`systemd unit written to ${userUnitPath}`);
      clack.log.info('To enable: sudo systemctl --user enable --now cortex');
      return;
    } catch {
      // Fall through to system-level
    }

    // System-level: needs sudo
    if (hasSudo()) {
      try {
        const tmpPath = path.join(os.tmpdir(), unitName);
        writeFileSync(tmpPath, unitContent);
        execSync(`sudo cp ${tmpPath} ${systemPath} && sudo systemctl daemon-reload`, { stdio: 'pipe' });
        clack.log.success(`systemd unit installed to ${systemPath}`);
        clack.log.info('To enable: sudo systemctl enable --now cortex');
      } catch (err: any) {
        clack.log.warn(`Failed to install system service: ${err.message}`);
      }
    } else {
      // No sudo — write to config dir and show instructions
      const localPath = path.join(dataDir, 'config', unitName);
      writeFileSync(localPath, unitContent);
      clack.log.warn('No sudo access. Service file saved locally.');
      clack.log.info(`To install manually:\n  sudo cp ${localPath} ${systemPath}\n  sudo systemctl daemon-reload\n  sudo systemctl enable --now cortex`);
    }
  } else {
    clack.log.warn(`Service registration is not supported on ${platform}. Start Cortex manually with \`cortex daemon\`.`);
  }
}

// ─── Interactive prompts (TTY) ───────────────────────────────────

function handleCancel(value: unknown): asserts value {
  if (clack.isCancel(value)) {
    clack.cancel('Init cancelled.');
    process.exit(0);
  }
}

async function collectSlackConfig(prefill?: { signingSecret?: string; appToken?: string; botToken?: string; adminChannel?: string }): Promise<SlackInitConfig> {
  clack.note(SLACK_APP_MANIFEST, 'Slack App Manifest — copy and paste when creating the app');

  clack.note(
    [
      'To set up Slack, you need a Slack App:',
      '',
      '1. Go to https://api.slack.com/apps',
      '2. Click "Create New App" → "From a manifest"',
      '3. Select your workspace, then paste the manifest (shown above)',
      '4. Go to "Basic Information" → copy the Signing Secret',
      '5. Under Basic Information, generate an App-Level Token',
      '   (scope: connections:write, name it "cortex-socket")',
      '6. Go to "OAuth & Permissions" → Install to Workspace',
      '   Copy the *Bot User OAuth Token* after installing',
      '7. Go to "App Home" → Show Tabs → enable *Messages Tab*',
      '   and check "Allow users to send messages from the messages tab"',
      '   (required for DM support)',
      '',
      'The manifest includes socket_mode_enabled, so Socket Mode',
      'is automatically enabled when you import it.',
      '',
      'Required Bot Token Scopes (included in manifest):',
      '  chat:write, im:history, im:write, reactions:read, reactions:write,',
      '  users:read, commands, app_mentions:read,',
      '  channels:history, channels:read, groups:history,',
      '  files:read, files:write, emoji:read, pins:read, pins:write',
    ].join('\n'),
    'Slack App Setup Guide',
  );

  await promptCopyManifestToClipboard(SLACK_APP_MANIFEST);

  const hasPrefill = prefill && (prefill.signingSecret || prefill.appToken || prefill.botToken);

  let signingSecret: string | symbol;
  let appToken: string | symbol;
  let botToken: string | symbol;
  let adminChannelRaw: string | symbol;

  if (hasPrefill) {
    clack.log.info('Found existing Slack configuration. Press Enter to skip, or type anything to re-enter.');
    const skip = await clack.text({
      message: 'Skip Slack configuration? (Enter = skip, any key + Enter = re-enter)',
      placeholder: 'Press Enter to skip',
      defaultValue: '',
    });
    handleCancel(skip);

    if ((skip as string).trim() === '') {
      // User pressed Enter — reuse prefill values.
      signingSecret = prefill!.signingSecret!;
      appToken = prefill!.appToken!;
      botToken = prefill!.botToken!;
      adminChannelRaw = prefill!.adminChannel ?? '';
    }
  }

  if (!signingSecret) {
    signingSecret = await (clack.password as any)({
      message: 'Step 1/4: SLACK_SIGNING_SECRET (from Basic Information):',
      validate(value) {
        if (!value) return 'Signing secret is required.';
      },
    });
    handleCancel(signingSecret);

    appToken = await (clack.password as any)({
      message: 'Step 2/4: SLACK_APP_TOKEN (App-Level Token, starts with xapp-):',
      validate(value) {
        if (!value) return 'App token is required.';
        if (!value.startsWith('xapp-')) return 'Token should start with xapp-';
      },
    });
    handleCancel(appToken);

    botToken = await (clack.password as any)({
      message: 'Step 3/4: SLACK_BOT_TOKEN (Bot User OAuth Token, starts with xoxb-):',
      validate(value) {
        if (!value) return 'Bot token is required.';
        if (!value.startsWith('xoxb-')) return 'Token should start with xoxb-';
      },
    });
    handleCancel(botToken);

    adminChannelRaw = await clack.text({
      message: 'Step 4/4: CORTEX_ADMIN_CHANNEL (optional — Slack channel ID for admin notifications):',
      placeholder: 'e.g. C0123456789 or D0123456789 (leave blank to configure later)',
      initialValue: prefill?.adminChannel,
    });
    handleCancel(adminChannelRaw);
  }

  return {
    signingSecret: signingSecret as string,
    appToken: appToken as string,
    botToken: botToken as string,
    adminChannel: (adminChannelRaw as string).trim() || undefined,
  };
}

async function collectFeishuConfig(): Promise<FeishuInitConfig> {
  clack.note(
    [
      'To set up Feishu (飞书), create a Feishu app:',
      '',
      '1. Go to https://open.feishu.cn/app',
      '2. Create a new app with bot capability enabled',
      '3. Get App ID and App Secret from "Credentials & Basic Info"',
      '4. Enable bot events and subscribe to: im.message.receive_v1',
      '5. Publish the app and get it approved by your admin',
    ].join('\n'),
    'Feishu App Setup Guide',
  );

  const appId = await clack.text({
    message: 'FEISHU_APP_ID:',
    validate(value) {
      if (!value) return 'App ID is required.';
    },
  });
  handleCancel(appId);

  const appSecret = await clack.password({
    message: 'FEISHU_APP_SECRET:',
    validate(value) {
      if (!value) return 'App secret is required.';
    },
  });
  handleCancel(appSecret);

  const encryptKeyRaw = await clack.text({
    message: 'FEISHU_ENCRYPT_KEY (optional):',
    placeholder: 'leave blank to skip',
  });
  handleCancel(encryptKeyRaw);

  const verificationTokenRaw = await clack.text({
    message: 'FEISHU_VERIFICATION_TOKEN (optional):',
    placeholder: 'leave blank to skip',
  });
  handleCancel(verificationTokenRaw);

  const domainRaw = await clack.text({
    message: 'FEISHU_DOMAIN (optional, "feishu" or "lark"):',
    placeholder: 'feishu (leave blank to use default)',
  });
  handleCancel(domainRaw);

  const domainVal = (domainRaw as string).trim().toLowerCase();
  const domain = (domainVal === 'feishu' || domainVal === 'lark')
    ? (domainVal as 'feishu' | 'lark')
    : undefined;

  return {
    appId: appId as string,
    appSecret: appSecret as string,
    encryptKey: (encryptKeyRaw as string).trim() || undefined,
    verificationToken: (verificationTokenRaw as string).trim() || undefined,
    domain,
  };
}

async function collectAnswersInteractive(paths: InitPaths): Promise<InitAnswers> {
  clack.intro('Cortex Setup');

  // Step 1: Backend selection
  clack.note(
    'Both Claude Code and PI support API key access to any model.',
    'Backend info',
  );
  const backends = await clack.multiselect({
    message: 'Which backends would you like to use?',
    options: [
      { value: 'claude' as InitBackend, label: 'Claude Code', hint: 'recommended, for Claude subscription' },
      { value: 'pi' as InitBackend, label: 'PI', hint: 'for other subscription' },
    ],
    required: true,
  });
  handleCancel(backends);

  // Step 2: Platform selection
  const platform = await clack.select({
    message: 'Which interaction platform would you like to use?',
    options: [
      { value: 'slack' as InitPlatform, label: 'Slack', hint: 'recommended' },
      { value: 'none' as InitPlatform, label: 'Skip — configure later manually' },
    ],
  });
  handleCancel(platform);

  // Step 2b: Platform-specific token input
  let slackConfig: SlackInitConfig | undefined;
  let feishuConfig: FeishuInitConfig | undefined;

  if (platform === 'slack') {
    const envPath = path.join(paths.CONFIG_DIR, '.env');
    const existingSlackConfig = parseExistingEnvSlackConfig(envPath);
    slackConfig = await collectSlackConfig(existingSlackConfig ?? undefined);
  } else if (platform === 'feishu') {
    feishuConfig = await collectFeishuConfig();
  }

  // Step 3: Machine identity
  const hostname = os.hostname();
  const machineName = await clack.text({
    message: 'Machine name for this device:',
    placeholder: hostname,
    defaultValue: hostname,
    validate(value) {
      if (!value) return 'Machine name is required.';
    },
  });
  handleCancel(machineName);

  // GPU detection
  const gpuCount = detectGpuCount();
  if (gpuCount > 0) {
    clack.log.success(`Detected ${gpuCount} NVIDIA GPU(s)`);
  } else {
    clack.log.info('No NVIDIA GPU detected (gpuCount=0)');
  }

  // Step 4: Gateway usage
  clack.note(
    [
      'Cortex includes an open-source local gateway that proxies all',
      'LLM calls, providing multi-key rotation, automatic failover,',
      'and per-request cost tracking.',
      '',
      'You can optionally share anonymous token usage with aistatus.cc,',
      'an AI model status monitoring site. Your token usage will appear',
      'on the public leaderboard (name + org + token counts). Email is',
      'used only as an identity key and is never displayed.',
      '',
      'Learn more: https://aistatus.cc',
    ].join('\n'),
    'Gateway & aistatus',
  );

  const enableGateway = await clack.confirm({
    message: 'Enable token usage reporting to aistatus?',
    initialValue: true,
  });
  handleCancel(enableGateway);

  let gatewayUsage: GatewayUsageConfig = { enabled: false };
  if (enableGateway) {
    const name = await clack.text({ message: 'Name:', placeholder: 'your name' });
    handleCancel(name);

    const org = await clack.text({ message: 'Organization:', placeholder: 'your organization' });
    handleCancel(org);

    const email = await clack.text({
      message: 'Email (identity only, not displayed):',
      placeholder: 'you@example.com',
    });
    handleCancel(email);

    gatewayUsage = { enabled: true, name: name as string, org: org as string, email: email as string };
  }

  // Step 5: Service registration
  const wantService = await clack.confirm({
    message: 'Register Cortex as a system service (auto-start on boot)?',
    initialValue: true,
  });
  handleCancel(wantService);

  return {
    backends: backends as InitBackend[],
    machineName: machineName as string,
    gpuCount,
    platform: platform as InitPlatform,
    slackConfig,
    feishuConfig,
    gatewayUsage,
    installService: wantService as boolean,
  };
}

// ─── Non-interactive prompts (piped stdin) ───────────────────────

async function collectAnswersNonInteractive(): Promise<InitAnswers> {
  const lines: string[] = [];
  const rl = createInterface({ input: processStdin });
  for await (const line of rl) {
    lines.push(line);
  }

  // Line format:
  //   backends, platform, gatewayEnabled, name, org, email, installService
  //   [+ platform-specific tokens: signingSecret, appToken, botToken, adminChannel (slack)]
  const [backendsRaw, platformRaw, gatewayEnabledRaw, name, org, email, installServiceRaw] = lines;

  const backends = (backendsRaw || 'claude')
    .split(',')
    .map(s => s.trim())
    .filter((s): s is InitBackend => s === 'claude' || s === 'pi');

  const platform: InitPlatform = (platformRaw && ['slack', 'feishu'].includes(platformRaw))
    ? platformRaw as InitPlatform
    : 'none';

  const gatewayEnabled = gatewayEnabledRaw?.toLowerCase() === 'y';

  log.info('Cortex Initialization (non-interactive)');

  // Parse platform-specific tokens from remaining lines (starting at index 7).
  // After platform tokens, optional planChoice and executeChoice lines (format "mode:model";
  // empty string → auto-infer). Index varies by platform:
  //   none   → planChoice at 7, executeChoice at 8
  //   slack  → planChoice at 11, executeChoice at 12
  //   feishu → planChoice at 12, executeChoice at 13
  let slackConfig: SlackInitConfig | undefined;
  let feishuConfig: FeishuInitConfig | undefined;
  let profileChoiceStart = 7;

  if (platform === 'slack' && lines.length >= 11) {
    slackConfig = {
      signingSecret: lines[7] || '',
      appToken: lines[8] || '',
      botToken: lines[9] || '',
      adminChannel: lines[10]?.trim() || undefined,
    };
    profileChoiceStart = 11;
  } else if (platform === 'feishu' && lines.length >= 12) {
    const domainVal = (lines[11] || '').trim().toLowerCase();
    feishuConfig = {
      appId: lines[7] || '',
      appSecret: lines[8] || '',
      encryptKey: lines[9]?.trim() || undefined,
      verificationToken: lines[10]?.trim() || undefined,
      domain: (domainVal === 'feishu' || domainVal === 'lark')
        ? (domainVal as 'feishu' | 'lark')
        : undefined,
    };
    profileChoiceStart = 12;
  }

  const planChoice = parseChoiceLine(lines[profileChoiceStart]);
  const executeChoice = parseChoiceLine(lines[profileChoiceStart + 1]);
  const extraProfiles = parseExtraProfilesLine(lines[profileChoiceStart + 2]);

  return {
    backends: backends.length > 0 ? backends : ['claude'],
    machineName: os.hostname(),
    gpuCount: detectGpuCount(),
    platform,
    slackConfig,
    feishuConfig,
    gatewayUsage: gatewayEnabled
      ? { enabled: true, name: name || '', org: org || '', email: email || '' }
      : { enabled: false },
    installService: installServiceRaw?.toLowerCase() === 'y',
    planChoice,
    executeChoice,
    extraProfiles,
  };
}

// ─── Directory creation ─────────────────────────────────────────

function createDirectories(paths: InitPaths): void {
  const dirs = [
    paths.DATA_DIR,
    paths.CONFIG_DIR,
    paths.STORE_DIR,
    path.join(paths.DATA_DIR, 'logs', 'sessions'),
    path.join(paths.WORKSPACE_DIR, 'threads'),
    paths.PROJECTS_DIR,
    // Dense Context structure
    path.join(paths.CONTEXT_DIR, 'user'),
    path.join(paths.CONTEXT_DIR, 'decisions'),
    path.join(paths.CONTEXT_DIR, 'scans'),
    path.join(paths.CONTEXT_DIR, 'ideas'),
    path.join(paths.CONTEXT_DIR, 'retrospectives'),
    // Claude Code config
    path.join(paths.DATA_DIR, '.claude', 'hooks'),
    path.join(paths.DATA_DIR, '.claude', 'rules'),
    // Runtime directories
    path.join(paths.DATA_DIR, 'plugins'),
    path.join(paths.DATA_DIR, 'prompts', 'directives'),
    path.join(paths.DATA_DIR, 'prompts', 'systemPrompts'),
    path.join(paths.DATA_DIR, 'prompts', 'promptTemplates'),
    path.join(paths.DATA_DIR, 'hooks'),
    path.join(paths.DATA_DIR, 'plan'),
    path.join(paths.DATA_DIR, 'logs', 'sessions-pi'),
  ];

  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
}

// ─── Git detection & installation ────────────────────────────────

/** Check whether git is available on PATH. */
export function isGitInstalled(): boolean {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    execSync(`${cmd} git`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the system package manager on Linux and return its install command prefix.
 * Returns null if no known package manager is found.
 */
function detectLinuxPkgInstall(): string | null {
  const candidates: { bin: string; install: string }[] = [
    { bin: '/usr/bin/apt-get', install: 'apt-get install -y' },
    { bin: '/usr/bin/dnf',     install: 'dnf install -y' },
    { bin: '/usr/bin/yum',     install: 'yum install -y' },
    { bin: '/usr/bin/pacman',  install: 'pacman -S --noconfirm' },
    { bin: '/usr/bin/zypper',  install: 'zypper install -y' },
    { bin: '/sbin/apk',        install: 'apk add' },
  ];
  for (const c of candidates) {
    if (existsSync(c.bin)) return c.install;
  }
  return null;
}

/** Return a human-readable install instruction for git on the current platform. */
export function getGitInstallHint(): string {
  switch (process.platform) {
    case 'linux': {
      const pkg = detectLinuxPkgInstall();
      if (pkg) return `sudo ${pkg} git`;
      return 'Install git via your package manager or download from https://git-scm.com/downloads/linux';
    }
    case 'darwin':
      return 'xcode-select --install  (or  brew install git  if you use Homebrew)';
    case 'win32':
      return 'winget install --id Git.Git -e --source winget';
    default:
      return 'Download from https://git-scm.com/downloads';
  }
}

/**
 * Ensure git is available on PATH. If missing, attempt automatic installation.
 * Returns true if git is now available, false otherwise.
 */
export function ensureGitInstalled(): boolean {
  if (isGitInstalled()) return true;

  clack.log.warn('Git is required but was not found on your system.');

  // Build the auto-install command for the current platform
  let installCmd: string | null = null;
  if (process.platform === 'linux') {
    const pkg = detectLinuxPkgInstall();
    if (pkg) installCmd = `sudo ${pkg} git`;
  } else if (process.platform === 'darwin') {
    // Prefer brew in headless contexts; xcode-select --install opens a GUI dialog
    try {
      execSync('which brew', { stdio: 'pipe' });
      installCmd = 'brew install git';
    } catch {
      installCmd = 'xcode-select --install';
    }
  } else if (process.platform === 'win32') {
    installCmd = 'winget install --id Git.Git -e --source winget --silent';
  }

  if (installCmd) {
    const s = clack.spinner();
    s.start('Attempting automatic git installation...');
    try {
      execSync(installCmd, { stdio: 'pipe', timeout: 120_000 });
      s.stop('Git installed successfully.');
      // Verify the install actually put git on PATH
      if (isGitInstalled()) return true;
      clack.log.warn('Git was installed but is not on PATH. You may need to restart your shell.');
    } catch (err: any) {
      s.stop('Automatic installation failed.');
      clack.log.warn(err.message);
    }
  }

  const hint = getGitInstallHint();
  clack.log.info(`Please install git manually:  ${hint}`);
  return false;
}

// ─── Git repo initialization ────────────────────────────────────

function ensureGitRepo(dataDir: string): void {
  if (existsSync(path.join(dataDir, '.git'))) return;
  try {
    execSync('git init', { cwd: dataDir, stdio: 'pipe' });
  } catch (err: any) {
    clack.log.warn(`git init failed: ${err.message}`);
  }
}

// ─── Safe copy helpers ──────────────────────────────────────────

export function safeCopy(src: string, dst: string, force: boolean, _label: string): boolean {
  if (!existsSync(src)) return false;
  if (existsSync(dst) && !force) return false;
  const dstDir = path.dirname(dst);
  if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });
  copyFileSync(src, dst);
  return true;
}

/**
 * Recursively seed a directory tree from defaults/ into DATA_DIR. Per-file behavior matches
 * safeCopy(): existing files are preserved unless force=true. New files in defaults/ that the
 * user hasn't created are always added (so package upgrades automatically deliver new
 * directives/skills without overwriting user edits).
 */
function safeCopyDir(srcDir: string, dstDir: string, force: boolean): void {
  if (!existsSync(srcDir)) return;
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      safeCopyDir(srcPath, dstPath, force);
    } else if (entry.isFile()) {
      if (existsSync(dstPath) && !force) continue;
      copyFileSync(srcPath, dstPath);
    }
  }
}

// ─── Config copy & generation ──────────────────────────────────

function copyDefaults(paths: InitPaths, force: boolean): void {
  // Scaffold files — never overwrite (user-customized content)
  safeCopy(path.join(DEFAULTS_DIR, 'CORTEX.md'), path.join(paths.DATA_DIR, 'CORTEX.md'), false, 'CORTEX.md');
  safeCopy(path.join(DEFAULTS_DIR, 'gitignore'), path.join(paths.DATA_DIR, '.gitignore'), false, '.gitignore');
  safeCopy(path.join(DEFAULTS_DIR, '.claude', 'settings.json'), path.join(paths.DATA_DIR, '.claude', 'settings.json'), false, '.claude/settings.json');

  // Context scaffold files — never overwrite
  safeCopy(path.join(DEFAULTS_DIR, 'context', 'CORTEX.md'), path.join(paths.CONTEXT_DIR, 'CORTEX.md'), false, 'context/CORTEX.md');
  safeCopy(path.join(DEFAULTS_DIR, 'context', 'projects', 'CORTEX.md'), path.join(paths.PROJECTS_DIR, 'CORTEX.md'), false, 'context/projects/CORTEX.md');
  safeCopy(path.join(DEFAULTS_DIR, 'context', 'scans', 'CORTEX.md'), path.join(paths.CONTEXT_DIR, 'scans', 'CORTEX.md'), false, 'context/scans/CORTEX.md');
  safeCopy(path.join(DEFAULTS_DIR, 'context', 'ideas', 'CORTEX.md'), path.join(paths.CONTEXT_DIR, 'ideas', 'CORTEX.md'), false, 'context/ideas/CORTEX.md');
  safeCopy(path.join(DEFAULTS_DIR, 'context', 'user', 'CORTEX.md'), path.join(paths.CONTEXT_DIR, 'user', 'CORTEX.md'), false, 'context/user/CORTEX.md');

  // Config defaults — budget and session-hooks overwrite only with --force;
  // thread-templates are merged (new agents/templates added, existing preserved)
  safeCopy(path.join(DEFAULTS_DIR, 'config', 'budget.json'), path.join(paths.CONFIG_DIR, 'budget.json'), force, 'budget.json');
  mergeThreadTemplates(
    path.join(DEFAULTS_DIR, 'config', 'thread-templates.json'),
    path.join(paths.CONFIG_DIR, 'thread-templates.json'),
  );
  safeCopy(path.join(DEFAULTS_DIR, 'config', 'session-hooks.json'), path.join(paths.CONFIG_DIR, 'session-hooks.json'), force, 'session-hooks.json');

  // Seed asset trees — per-file safeCopy semantics: new files always added, existing files
  // preserved unless force=true. These directories are referenced at runtime; without them
  // thread-manager / skill-scanner / rules-loader can't find their inputs.
  safeCopyDir(path.join(DEFAULTS_DIR, 'prompts'), path.join(paths.DATA_DIR, 'prompts'), force);
  safeCopyDir(path.join(DEFAULTS_DIR, 'rules'), path.join(paths.DATA_DIR, 'rules'), force);
  safeCopyDir(path.join(DEFAULTS_DIR, 'plugins'), path.join(paths.DATA_DIR, 'plugins'), force);
  safeCopyDir(path.join(DEFAULTS_DIR, 'context', 'decisions'), path.join(paths.CONTEXT_DIR, 'decisions'), force);
}

/**
 * Deploy hook scripts from defaults/hooks/ to DATA_DIR/hooks/.
 * All hooks are standalone .mjs files referenced via HOOKS_DIR.
 */
function deployHooks(paths: InitPaths, force: boolean): void {
  const hooksDir = path.join(paths.DATA_DIR, 'hooks');
  const srcDir = path.join(DEFAULTS_DIR, 'hooks');

  if (!existsSync(srcDir)) return;
  mkdirSync(hooksDir, { recursive: true });

  const files = readdirSync(srcDir);
  for (const file of files) {
    if (!file.endsWith('.mjs')) continue;
    const src = path.join(srcDir, file);
    const dst = path.join(hooksDir, file);
    safeCopy(src, dst, force, `hooks/${file}`);
  }
}

function generateConfigs(paths: InitPaths, answers: InitAnswers, force: boolean): void {
  // MCP configs — always regenerate (machine-specific, in .gitignore)
  writeFileSync(path.join(paths.CONFIG_DIR, 'mcp-config.json'), JSON.stringify(buildFullConfig(INSTALL_ROOT), null, 2));
  writeFileSync(path.join(paths.CONFIG_DIR, 'mcp-config-core.json'), JSON.stringify(buildCoreConfig(INSTALL_ROOT), null, 2));
  writeFileSync(path.join(paths.CONFIG_DIR, 'mcp-config-tui.json'), JSON.stringify(buildTuiConfig(INSTALL_ROOT), null, 2));

  // mode.json — skip if exists (user may have customized)
  const modeJsonPath = path.join(paths.STORE_DIR, 'mode.json');
  if (!existsSync(modeJsonPath) || force) {
    const primaryBackend = answers.backends[0] || 'claude';
    writeFileSync(modeJsonPath, generateDefaultModeJson(primaryBackend));
  }

  // machines.json — runtime machine registry, server won't start without it
  const machinesJsonPath = path.join(paths.CONFIG_DIR, 'machines.json');
  if (!existsSync(machinesJsonPath) || force) {
    const entry: Record<string, unknown> = {
      cortexPath: paths.DATA_DIR,
      gpuCount: answers.gpuCount,
    };
    const machines = { [answers.machineName]: entry };
    writeFileSync(machinesJsonPath, JSON.stringify(machines, null, 2) + '\n');
  }
}

/**
 * Seed schedules.json from defaults/data/schedules.json into STORE_DIR.
 * Replaces __ADMIN_CHANNEL__ placeholder with the configured admin channel,
 * and stamps createdAt with the current timestamp. Never overwrites existing file.
 */
function seedSchedules(paths: InitPaths, answers: InitAnswers, force: boolean): void {
  const dstPath = path.join(paths.STORE_DIR, 'schedules.json');
  if (existsSync(dstPath) && !force) return;

  const srcPath = path.join(DEFAULTS_DIR, 'data', 'schedules.json');
  if (!existsSync(srcPath)) return;

  const adminChannel = answers.slackConfig?.adminChannel || '';
  const now = Date.now();

  let content = readFileSync(srcPath, 'utf-8');
  content = content.replace(/__ADMIN_CHANNEL__/g, adminChannel);

  // Stamp createdAt on all seed tasks
  const data = JSON.parse(content);
  for (const task of data.tasks) {
    if (task.createdAt === 0) task.createdAt = now;
  }

  mkdirSync(path.dirname(dstPath), { recursive: true });
  writeFileSync(dstPath, JSON.stringify(data, null, 2) + '\n');
}

function writeDotEnv(paths: InitPaths, answers: InitAnswers, force: boolean): void {
  const envPath = path.join(paths.CONFIG_DIR, '.env');
  if (existsSync(envPath) && !force) return;
  const content = generateDotEnvContent(answers);
  writeFileSync(envPath, content);
}

// ─── Gateway & profile auto-setup ──────────────────────────────

/** Detect whether a profiles.json at <configDir>/profiles.json already has `plan` or `execute`. */
function detectExistingPlanOrExecute(configDir: string): boolean {
  const profilesPath = path.join(configDir, 'profiles.json');
  if (!existsSync(profilesPath)) return false;
  try {
    const data = JSON.parse(readFileSync(profilesPath, 'utf-8'));
    return !!(data?.profiles?.plan || data?.profiles?.execute);
  } catch {
    return false;
  }
}

/**
 * Interactively pick plan / execute (mode, model) from discovered endpoints, plus optional
 * fallback chains. Lists are sorted lexicographically; the first entry is pre-selected.
 *
 * Returns `overwrite: false` if the user declined to overwrite an existing profile — in that
 * case all *Choice / *Fallback fields are undefined.
 */
async function pickPlanExecuteInteractive(
  endpoints: ReturnType<typeof discoverEndpoints>,
  configDir: string,
): Promise<{
  planChoice?: ModelChoice;
  executeChoice?: ModelChoice;
  planFallback?: ModelChoice[];
  executeFallback?: ModelChoice[];
  extraProfiles?: ModelChoice[];
  overwrite: boolean;
}> {
  // If existing profiles.json has plan/execute, ask before overwriting
  if (detectExistingPlanOrExecute(configDir)) {
    const confirm = await clack.confirm({
      message: 'Existing `plan` or `execute` profile detected. Overwrite with a new selection?',
      initialValue: false,
    });
    handleCancel(confirm);
    if (!confirm) {
      return { overwrite: false };
    }
  }

  const choices = listChoices(endpoints);
  if (choices.length === 0) return { overwrite: true };

  const formatValue = (c: ModelChoice) => `${c.mode}:${c.model}`;
  const parseValue = (v: string): ModelChoice => {
    const colonIdx = v.indexOf(':');
    return { mode: v.substring(0, colonIdx), model: v.substring(colonIdx + 1) };
  };

  const options = choices.map(c => ({
    value: formatValue(c),
    label: `${c.mode} / ${c.model}`,
  }));

  // Default = first lexicographic entry (no tier inference).
  const firstChoiceValue = formatValue(choices[0]);

  const planSel = await clack.select({
    message: 'Pick model for the `plan` profile (used by executor agents — planner, doc-writer, coder, etc.):',
    options,
    initialValue: firstChoiceValue,
  });
  handleCancel(planSel);

  const execSel = await clack.select({
    message: 'Pick model for the `execute` profile (used by reviewer agents — reviewer, doc-reviewer, coder-reviewer, etc.):',
    options,
    initialValue: firstChoiceValue,
  });
  handleCancel(execSel);

  const planChoice = parseValue(planSel as string);
  const execChoice = parseValue(execSel as string);

  // ── Fallback selection (multi-select, ordered) ──
  // Build fallback options excluding the primary choice. If no candidates remain (e.g. only
  // one discovered model), skip the prompt entirely.
  const planFallbackOptions = options.filter(o => o.value !== planSel);
  const execFallbackOptions = options.filter(o => o.value !== execSel);

  let planFallback: ModelChoice[] | undefined;
  if (planFallbackOptions.length > 0) {
    const sel = await clack.multiselect({
      message: 'Pick fallback models for `plan` (in order, space to toggle, enter to confirm, leave empty for no fallback):',
      options: planFallbackOptions,
      required: false,
      initialValues: [],
    });
    handleCancel(sel);
    const arr = sel as string[];
    if (arr.length > 0) planFallback = arr.map(parseValue);
  }

  let executeFallback: ModelChoice[] | undefined;
  if (execFallbackOptions.length > 0) {
    const sel = await clack.multiselect({
      message: 'Pick fallback models for `execute` (in order, space to toggle, enter to confirm, leave empty for no fallback):',
      options: execFallbackOptions,
      required: false,
      initialValues: [],
    });
    handleCancel(sel);
    const arr = sel as string[];
    if (arr.length > 0) executeFallback = arr.map(parseValue);
  }

  // ── Extra profiles: additional models to register as standalone named profiles ──
  let extraProfiles: ModelChoice[] | undefined;
  if (options.length > 0) {
    const sel = await clack.multiselect({
      message: 'Pick additional models to register as standalone profiles (profile name = model name, space to toggle, enter to confirm, leave empty to skip):',
      options,
      required: false,
      initialValues: [],
    });
    handleCancel(sel);
    const arr = sel as string[];
    if (arr.length > 0) extraProfiles = arr.map(parseValue);
  }

  return {
    planChoice,
    executeChoice: execChoice,
    planFallback,
    executeFallback,
    extraProfiles,
    overwrite: true,
  };
}

async function runGatewaySetup(
  backends: InitBackend[],
  paths: InitPaths,
  gatewayConfigDir?: string,
  answers?: Pick<InitAnswers, 'planChoice' | 'executeChoice' | 'extraProfiles'>,
): Promise<void> {
  // Discover endpoints from Claude/PI local configs — filtered by user-selected backends
  const endpoints = discoverEndpoints(backends);

  if (endpoints.length === 0) {
    clack.log.warn('No backends discovered. Make sure you have logged into Claude Code and/or PI first.');
    clack.log.info('You can re-run detection later with: cortex setup-gateway');
    return;
  }

  // Show discovered summary
  const summary = endpoints.map(ep =>
    `  ${ep.mode}/${ep.endpoint}: ${ep.models.slice(0, 3).join(', ')}${ep.models.length > 3 ? ', ...' : ''} (${ep.keys.length > 0 ? 'with key' : 'passthrough'})`,
  ).join('\n');
  clack.log.success(`Discovered ${endpoints.length} endpoint modes:\n${summary}`);

  // Generate gateway.yaml — scoped to gatewayConfigDir when provided (test/alt env),
  // otherwise defaults to ~/.aistatus/gateway.yaml (production).
  const yamlContent = generateGatewayYaml(endpoints);
  const gatewayPath = writeGatewayYaml(yamlContent, gatewayConfigDir);
  clack.log.success(`Gateway config written to ${gatewayPath}`);

  // Resolve plan/execute choices + fallback chains + extra profiles + overwrite intent.
  let planChoice = answers?.planChoice;
  let executeChoice = answers?.executeChoice;
  let planFallback: ModelChoice[] | undefined;
  let executeFallback: ModelChoice[] | undefined;
  let extraProfiles = answers?.extraProfiles;
  let overwrite: boolean;

  if (processStdin.isTTY) {
    // Interactive: prompt for selection (with overwrite confirmation if needed)
    const picked = await pickPlanExecuteInteractive(endpoints, paths.CONFIG_DIR);
    planChoice = picked.planChoice ?? planChoice;
    executeChoice = picked.executeChoice ?? executeChoice;
    planFallback = picked.planFallback;
    executeFallback = picked.executeFallback;
    extraProfiles = picked.extraProfiles ?? extraProfiles;
    overwrite = picked.overwrite;
  } else {
    // Non-interactive: stdin already provided choices (or empty → lex-first default).
    // Fallback chains are not configurable via stdin in this iteration — extend the stdin
    // protocol if scripted installs need fallback.
    overwrite = true;
  }

  // Generate profiles.json
  const profilesPath = writeProfilesJson(endpoints, {
    outputDir: paths.CONFIG_DIR,
    planChoice,
    executeChoice,
    planFallback,
    executeFallback,
    extraProfiles,
    overwrite,
  });
  clack.log.success(`Profiles written to ${profilesPath}`);

  // Show profile summary (reflects what was actually generated, not what was merged)
  const profiles = generateProfiles(endpoints, { planChoice, executeChoice, planFallback, executeFallback, extraProfiles });
  const profileNames = Object.keys(profiles.profiles).join(', ');
  clack.log.info(`Generated profiles: ${profileNames} (default: ${profiles.defaultProfile})`);
}

// ─── Main entry point ────────────────────────────────────────────

export interface InitOptions {
  homeDir?: string;
  force?: boolean;
  /** Override gateway.yaml output directory (defaults to ~/.aistatus/ when unset). */
  gatewayConfigDir?: string;
}

export async function runInit(options: InitOptions = {}): Promise<void> {
  const paths = getResolvedPaths(options.homeDir);
  const force = options.force ?? false;

  // 1. Collect user choices
  const answers = processStdin.isTTY
    ? await collectAnswersInteractive(paths)
    : await collectAnswersNonInteractive();

  // 2. Check & install backends
  await checkAndInstallBackends(answers.backends);

  // 3. Ensure git + directory structure
  ensureGitInstalled();
  createDirectories(paths);
  ensureGitRepo(paths.DATA_DIR);

  // 4. Write configs
  writeDotEnv(paths, answers, force);
  copyDefaults(paths, force);
  deployHooks(paths, force);
  generateConfigs(paths, answers, force);
  seedSchedules(paths, answers, force);

  // 5. Gateway usage
  writeGatewayUsageConfig(answers.gatewayUsage, paths.CONFIG_DIR);

  // 6. Service registration
  if (answers.installService) {
    installService(paths.DATA_DIR);
  }

  // 7. Gateway & profile auto-setup (detect from Claude/PI local configs)
  if (processStdin.isTTY) {
    clack.note(
      [
        'Cortex can auto-detect your Claude Code and PI configurations',
        'to generate gateway.yaml and profiles.json automatically.',
        '',
        'Make sure you have logged into:',
        '  • Claude Code:  claude login',
        '  • PI:            pi login (if using PI)',
      ].join('\n'),
      'Gateway & Profile Setup',
    );

    const ready = await clack.confirm({
      message: 'Have you logged into Claude Code and/or PI? Ready to auto-detect?',
      initialValue: true,
    });

    if (!clack.isCancel(ready) && ready) {
      await runGatewaySetup(answers.backends, paths, options.gatewayConfigDir, answers);
    } else {
      clack.log.info('Skipped. Run `cortex setup-gateway` later to auto-configure.');
    }
  } else {
    // Non-interactive: auto-detect silently, passing stdin-supplied choices
    try {
      await runGatewaySetup(answers.backends, paths, options.gatewayConfigDir, answers);
    } catch (e) {
      log.warn(`Gateway setup failed (non-interactive): ${(e as Error).message}`);
    }
  }

  // 8. Patch mode.json activeProfile to match profiles.json defaultProfile
  try {
    const profilesJsonPath = path.join(paths.CONFIG_DIR, 'profiles.json');
    const modeJsonPath = path.join(paths.STORE_DIR, 'mode.json');
    if (existsSync(profilesJsonPath) && existsSync(modeJsonPath)) {
      const profilesData = JSON.parse(readFileSync(profilesJsonPath, 'utf8'));
      const modeData = JSON.parse(readFileSync(modeJsonPath, 'utf8'));
      if (modeData.activeProfile === '__active__' && profilesData.defaultProfile) {
        modeData.activeProfile = profilesData.defaultProfile;
        writeFileSync(modeJsonPath, JSON.stringify(modeData));
        log.info(`mode.json activeProfile set to "${profilesData.defaultProfile}"`);
      }
    }
  } catch (e) {
    log.warn(`Failed to update activeProfile in mode.json: ${(e as Error).message}`);
  }

  // 9. Done
  clack.outro(`Cortex initialized at ${paths.DATA_DIR}. Run \`cortex start\` to launch.`);
}
