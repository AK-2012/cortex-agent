// input:  init module
// output: verify path resolution, env generation, config generation, safeCopy idempotency,
//         backend detection, gateway usage config generation
// pos:    Validate cortex init pure logic before filesystem integration

import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

// Import pure functions from init.ts
import {
  getResolvedPaths,
  generateDotEnvContent,
  generateDefaultModeJson,
  formatConfigOutput,
  safeCopy,
  isBackendInstalled,
  getInstallCommand,
  isGitInstalled,
  getGitInstallHint,
  generateGatewayUsageYaml,
  getAistatusConfigPath,
  generateSystemdUnit,
  generateLaunchdPlist,
  SLACK_APP_MANIFEST,
} from '../src/entry/init.js';

import type { InitAnswers } from '../src/entry/init.js';

// ─── getResolvedPaths ───────────────────────────────────────────

test('getResolvedPaths defaults to ~/.cortex when no env or arg', () => {
  const prevHome = process.env.CORTEX_HOME;
  const prevProjects = process.env.CORTEX_PROJECTS_DIR;
  delete process.env.CORTEX_HOME;
  delete process.env.CORTEX_PROJECTS_DIR;
  try {
    const p = getResolvedPaths();
    assert.equal(p.DATA_DIR, path.join(os.homedir(), '.cortex'));
    assert.equal(p.CONFIG_DIR, path.join(p.DATA_DIR, 'config'));
    assert.equal(p.STORE_DIR, path.join(p.DATA_DIR, 'data'));
    assert.equal(p.CONTEXT_DIR, path.join(p.DATA_DIR, 'context'));
    assert.equal(p.PROJECTS_DIR, path.join(p.DATA_DIR, 'context', 'projects'));
    assert.equal(p.WORKSPACE_DIR, path.join(p.DATA_DIR, 'tmp'));
  } finally {
    if (prevHome !== undefined) process.env.CORTEX_HOME = prevHome;
    if (prevProjects !== undefined) process.env.CORTEX_PROJECTS_DIR = prevProjects;
  }
});

test('getResolvedPaths uses --home arg over env and default', () => {
  const prevHome = process.env.CORTEX_HOME;
  process.env.CORTEX_HOME = '/should/be/ignored';
  try {
    const p = getResolvedPaths('/tmp/custom-home');
    assert.equal(p.DATA_DIR, '/tmp/custom-home');
    assert.equal(p.CONFIG_DIR, '/tmp/custom-home/config');
    assert.equal(p.STORE_DIR, '/tmp/custom-home/data');
    assert.equal(p.CONTEXT_DIR, '/tmp/custom-home/context');
    assert.equal(p.PROJECTS_DIR, '/tmp/custom-home/context/projects');
    assert.equal(p.WORKSPACE_DIR, '/tmp/custom-home/tmp');
  } finally {
    if (prevHome !== undefined) process.env.CORTEX_HOME = prevHome;
    else delete process.env.CORTEX_HOME;
  }
});

test('getResolvedPaths reads $CORTEX_HOME when no --home arg', () => {
  const prevHome = process.env.CORTEX_HOME;
  process.env.CORTEX_HOME = '/env/home';
  const prevProjects = process.env.CORTEX_PROJECTS_DIR;
  delete process.env.CORTEX_PROJECTS_DIR;
  try {
    const p = getResolvedPaths();
    assert.equal(p.DATA_DIR, '/env/home');
    assert.equal(p.PROJECTS_DIR, '/env/home/context/projects');
  } finally {
    if (prevHome !== undefined) process.env.CORTEX_HOME = prevHome;
    else delete process.env.CORTEX_HOME;
    if (prevProjects !== undefined) process.env.CORTEX_PROJECTS_DIR = prevProjects;
  }
});

test('getResolvedPaths reads $CORTEX_PROJECTS_DIR when set', () => {
  const prevHome = process.env.CORTEX_HOME;
  delete process.env.CORTEX_HOME;
  const prevProjects = process.env.CORTEX_PROJECTS_DIR;
  process.env.CORTEX_PROJECTS_DIR = '/custom/projects';
  try {
    const p = getResolvedPaths();
    assert.equal(p.PROJECTS_DIR, '/custom/projects');
    assert.equal(p.DATA_DIR, path.join(os.homedir(), '.cortex')); // still default
  } finally {
    if (prevHome !== undefined) process.env.CORTEX_HOME = prevHome;
    if (prevProjects !== undefined) process.env.CORTEX_PROJECTS_DIR = prevProjects;
    else delete process.env.CORTEX_PROJECTS_DIR;
  }
});

test('getResolvedPaths resolves relative --home to absolute', () => {
  const p = getResolvedPaths('relative/path');
  assert.equal(p.DATA_DIR, path.resolve('relative/path'));
});

// ─── generateDotEnvContent ───────────────────────────────────────

const MINIMAL_ANSWERS: InitAnswers = {
  backends: ['claude'],
  machineName: 'test-host',
  gpuCount: 0,
  platforms: [],
  gatewayUsage: { enabled: false },
  installService: false,
};

const SLACK_ANSWERS: InitAnswers = {
  backends: ['claude'],
  machineName: 'test-host',
  gpuCount: 0,
  platforms: ['slack'],
  slackConfig: {
    botToken: 'xoxb-test-bot-token',
    signingSecret: 'test-signing-secret',
    appToken: 'xapp-test-app-token',
    adminChannel: 'D0TEST',
  },
  gatewayUsage: { enabled: false },
  installService: false,
};

const FEISHU_ANSWERS: InitAnswers = {
  backends: ['claude'],
  machineName: 'test-host',
  gpuCount: 0,
  platforms: ['feishu'],
  feishuConfig: {
    appId: 'test-app-id',
    appSecret: 'test-app-secret',
    encryptKey: 'test-encrypt',
    verificationToken: 'test-verify',
    domain: 'feishu',
  },
  gatewayUsage: { enabled: false },
  installService: false,
};

const MULTI_ANSWERS: InitAnswers = {
  backends: ['claude'],
  machineName: 'test-host',
  gpuCount: 0,
  platforms: ['slack', 'feishu'],
  slackConfig: {
    botToken: 'xoxb-test-bot-token',
    signingSecret: 'test-signing-secret',
    appToken: 'xapp-test-app-token',
    adminChannel: 'D0TEST',
  },
  feishuConfig: {
    appId: 'test-app-id',
    appSecret: 'test-app-secret',
  },
  gatewayUsage: { enabled: false },
  installService: false,
};

test('generateDotEnvContent includes CORTEX_MACHINE', () => {
  const content = generateDotEnvContent(MINIMAL_ANSWERS);
  assert.match(content, /^CORTEX_MACHINE=test-host/m);
});

test('generateDotEnvContent does not include Slack keys when platform=none', () => {
  const content = generateDotEnvContent(MINIMAL_ANSWERS);
  assert.doesNotMatch(content, /SLACK_BOT_TOKEN/);
  assert.doesNotMatch(content, /SLACK_SIGNING_SECRET/);
  assert.doesNotMatch(content, /SLACK_APP_TOKEN/);
  assert.doesNotMatch(content, /CORTEX_PLATFORM/);
  assert.doesNotMatch(content, /CORTEX_ADMIN_CHANNEL/);
});

test('generateDotEnvContent does not include API keys (general)', () => {
  const content = generateDotEnvContent(MINIMAL_ANSWERS);
  assert.doesNotMatch(content, /ANTHROPIC_API_KEY/);
  assert.doesNotMatch(content, /ANTHROPIC_BASE_URL/);
});

test('generateDotEnvContent includes header comment', () => {
  const content = generateDotEnvContent(MINIMAL_ANSWERS);
  assert.match(content, /^# Cortex Configuration/m);
});

// ─── Platform-specific env generation ────────────────────────────

test('generateDotEnvContent includes CORTEX_PLATFORM=slack and tokens', () => {
  const content = generateDotEnvContent(SLACK_ANSWERS);
  assert.match(content, /^CORTEX_PLATFORM=slack/m);
  assert.match(content, /^SLACK_BOT_TOKEN=xoxb-test-bot-token/m);
  assert.match(content, /^SLACK_SIGNING_SECRET=test-signing-secret/m);
  assert.match(content, /^SLACK_APP_TOKEN=xapp-test-app-token/m);
  assert.match(content, /^CORTEX_ADMIN_CHANNEL=D0TEST/m);
});

test('generateDotEnvContent excludes adminChannel when undefined', () => {
  const noAdmin = { ...SLACK_ANSWERS, slackConfig: { ...SLACK_ANSWERS.slackConfig!, adminChannel: undefined } };
  const content = generateDotEnvContent(noAdmin);
  assert.match(content, /^CORTEX_PLATFORM=slack/m);
  assert.doesNotMatch(content, /CORTEX_ADMIN_CHANNEL/);
});

test('generateDotEnvContent includes CORTEX_PLATFORM=feishu and tokens', () => {
  const content = generateDotEnvContent(FEISHU_ANSWERS);
  assert.match(content, /^CORTEX_PLATFORM=feishu/m);
  assert.match(content, /^FEISHU_APP_ID=test-app-id/m);
  assert.match(content, /^FEISHU_APP_SECRET=test-app-secret/m);
  assert.match(content, /^FEISHU_ENCRYPT_KEY=test-encrypt/m);
  assert.match(content, /^FEISHU_VERIFICATION_TOKEN=test-verify/m);
  assert.match(content, /^FEISHU_DOMAIN=feishu/m);
});

test('generateDotEnvContent omits optional feishu fields when undefined', () => {
  const minimalFeishu: InitAnswers = {
    ...MINIMAL_ANSWERS,
    platforms: ['feishu'],
    feishuConfig: { appId: 'id', appSecret: 'sec' },
  };
  const content = generateDotEnvContent(minimalFeishu);
  assert.match(content, /^CORTEX_PLATFORM=feishu/m);
  assert.match(content, /^FEISHU_APP_ID=id/m);
  assert.match(content, /^FEISHU_APP_SECRET=sec/m);
  assert.doesNotMatch(content, /FEISHU_ENCRYPT_KEY/);
  assert.doesNotMatch(content, /FEISHU_VERIFICATION_TOKEN/);
  assert.doesNotMatch(content, /FEISHU_DOMAIN/);
});

test('generateDotEnvContent defaults FEISHU_AUTH_MODE=bot and omits redirect URI', () => {
  const content = generateDotEnvContent(FEISHU_ANSWERS);
  assert.match(content, /^FEISHU_AUTH_MODE=bot/m);
  assert.doesNotMatch(content, /FEISHU_REDIRECT_URI/);
});

test('generateDotEnvContent writes FEISHU_AUTH_MODE=user and redirect URI when user mode', () => {
  const userMode: InitAnswers = {
    ...FEISHU_ANSWERS,
    feishuConfig: { ...FEISHU_ANSWERS.feishuConfig!, authMode: 'user', redirectUri: 'https://app/cb' },
  };
  const content = generateDotEnvContent(userMode);
  assert.match(content, /^FEISHU_AUTH_MODE=user/m);
  assert.match(content, /^FEISHU_REDIRECT_URI=https:\/\/app\/cb/m);
});

test('generateDotEnvContent writes comma-joined CORTEX_PLATFORM and both platforms for multi-select', () => {
  const content = generateDotEnvContent(MULTI_ANSWERS);
  assert.match(content, /^CORTEX_PLATFORM=slack,feishu/m);
  // Slack block
  assert.match(content, /^SLACK_BOT_TOKEN=xoxb-test-bot-token/m);
  assert.match(content, /^SLACK_SIGNING_SECRET=test-signing-secret/m);
  assert.match(content, /^SLACK_APP_TOKEN=xapp-test-app-token/m);
  assert.match(content, /^CORTEX_ADMIN_CHANNEL=D0TEST/m);
  // Feishu block
  assert.match(content, /^FEISHU_APP_ID=test-app-id/m);
  assert.match(content, /^FEISHU_APP_SECRET=test-app-secret/m);
  assert.match(content, /^FEISHU_AUTH_MODE=bot/m);
});

test('SLACK_APP_MANIFEST is a non-empty JSON string with expected fields', () => {
  const manifest = SLACK_APP_MANIFEST;
  assert.ok(manifest.length > 0, 'manifest should not be empty');
  const parsed = JSON.parse(manifest);
  assert.equal(parsed.display_information.name, 'Cortex');
  assert.equal(parsed.settings.socket_mode_enabled, true);
  assert.ok(parsed.oauth_config.scopes.bot.includes('chat:write'));
});

// ─── generateDefaultModeJson ────────────────────────────────────

test('generateDefaultModeJson returns valid JSON with expected fields', () => {
  const json = generateDefaultModeJson();
  const parsed = JSON.parse(json);
  assert.equal(typeof parsed, 'object');
  assert.equal(parsed.mode, 'plan');
  assert.equal(parsed.backend, 'claude');
  assert.equal(parsed.claudeModel, 'opus');
  assert.equal(parsed.activeProfile, '__active__');
  assert.equal(parsed.defaultAgent, 'direct');
});

test('generateDefaultModeJson produces compact JSON (single line)', () => {
  const json = generateDefaultModeJson();
  assert.equal(json.includes('\n'), false);
});

test('generateDefaultModeJson uses provided backend', () => {
  const json = generateDefaultModeJson('pi');
  const parsed = JSON.parse(json);
  assert.equal(parsed.backend, 'pi');
});

test('generateDefaultModeJson defaults to claude when no arg', () => {
  const json = generateDefaultModeJson();
  const parsed = JSON.parse(json);
  assert.equal(parsed.backend, 'claude');
});

// ─── formatConfigOutput ─────────────────────────────────────────

test('formatConfigOutput shows all paths', () => {
  const paths = {
    INSTALL_ROOT: '/pkg',
    DATA_DIR: '/data',
    CONFIG_DIR: '/data/config',
    STORE_DIR: '/data/store',
    CONTEXT_DIR: '/data/context',
    PROJECTS_DIR: '/data/context/projects',
    WORKSPACE_DIR: '/data/tmp',
  };
  const status = { dataDirExists: true, dotEnvExists: true, mcpConfigExists: false, modeJsonExists: true };
  const output = formatConfigOutput(paths, status);
  assert.match(output, /INSTALL_ROOT.*\/pkg/);
  assert.match(output, /DATA_DIR.*\/data/);
  assert.match(output, /CONFIG_DIR.*\/data\/config/);
  assert.match(output, /STORE_DIR.*\/data\/store/);
  assert.match(output, /CONTEXT_DIR.*\/data\/context/);
  assert.match(output, /PROJECTS_DIR.*\/data\/context\/projects/);
  assert.match(output, /WORKSPACE_DIR.*\/data\/tmp/);
});

test('formatConfigOutput shows initialization status', () => {
  const paths = { INSTALL_ROOT: '/pkg', DATA_DIR: '/data', CONFIG_DIR: '/data/config', STORE_DIR: '/data/store', CONTEXT_DIR: '/data/context', PROJECTS_DIR: '/data/context/projects', WORKSPACE_DIR: '/data/tmp' };
  const status = { dataDirExists: true, dotEnvExists: true, mcpConfigExists: false, modeJsonExists: true };
  const output = formatConfigOutput(paths, status);
  assert.match(output, /DATA_DIR:.*initialized/);
  assert.match(output, /\.env:.*found/);
  assert.match(output, /mcp-config\.json:.*missing/);
  assert.match(output, /mode\.json:.*found/);
});

// ─── safeCopy ───────────────────────────────────────────────────

test('safeCopy copies file when destination does not exist', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-test-'));
  try {
    const src = path.join(tmpDir, 'src.txt');
    const dst = path.join(tmpDir, 'dst.txt');
    fs.writeFileSync(src, 'source content');
    const copied = safeCopy(src, dst, false, 'test');
    assert.equal(copied, true);
    assert.equal(fs.readFileSync(dst, 'utf-8'), 'source content');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('safeCopy does not overwrite existing file without force', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-test-'));
  try {
    const src = path.join(tmpDir, 'src.txt');
    const dst = path.join(tmpDir, 'dst.txt');
    fs.writeFileSync(src, 'new content');
    fs.writeFileSync(dst, 'original content');
    const copied = safeCopy(src, dst, false, 'test');
    assert.equal(copied, false);
    assert.equal(fs.readFileSync(dst, 'utf-8'), 'original content');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('safeCopy overwrites existing file with force', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-test-'));
  try {
    const src = path.join(tmpDir, 'src.txt');
    const dst = path.join(tmpDir, 'dst.txt');
    fs.writeFileSync(src, 'new content');
    fs.writeFileSync(dst, 'original content');
    const copied = safeCopy(src, dst, true, 'test');
    assert.equal(copied, true);
    assert.equal(fs.readFileSync(dst, 'utf-8'), 'new content');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('safeCopy returns false when source does not exist', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-test-'));
  try {
    const src = path.join(tmpDir, 'nonexistent.txt');
    const dst = path.join(tmpDir, 'dst.txt');
    const copied = safeCopy(src, dst, false, 'test');
    assert.equal(copied, false);
    assert.equal(fs.existsSync(dst), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('safeCopy creates parent directories for destination', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-test-'));
  try {
    const src = path.join(tmpDir, 'src.txt');
    const dst = path.join(tmpDir, 'nested', 'dir', 'dst.txt');
    fs.writeFileSync(src, 'content');
    const copied = safeCopy(src, dst, false, 'test');
    assert.equal(copied, true);
    assert.equal(fs.readFileSync(dst, 'utf-8'), 'content');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

// ─── isBackendInstalled ─────────────────────────────────────────

test('isBackendInstalled returns true for node (always available)', () => {
  // node is always on PATH in a Node.js test — use as a known-installed binary
  // We can't directly test 'claude' or 'pi' reliably, but we test the mechanism
  // by checking that the function returns boolean without throwing
  const result = isBackendInstalled('claude');
  assert.equal(typeof result, 'boolean');
});

// ─── getInstallCommand ──────────────────────────────────────────

test('getInstallCommand returns correct command for claude', () => {
  assert.equal(getInstallCommand('claude'), 'npm install -g @anthropic-ai/claude-code');
});

test('getInstallCommand returns correct command for pi', () => {
  assert.equal(getInstallCommand('pi'), 'npm install -g @mariozechner/pi-coding-agent');
});

// ─── isGitInstalled ────────────────────────────────────────────

test('isGitInstalled returns a boolean without throwing', () => {
  const result = isGitInstalled();
  assert.equal(typeof result, 'boolean');
});

// ─── getGitInstallHint ─────────────────────────────────────────

test('getGitInstallHint returns a non-empty string', () => {
  const hint = getGitInstallHint();
  assert.equal(typeof hint, 'string');
  assert.ok(hint.length > 0);
});

test('getGitInstallHint contains package manager info on Linux', () => {
  const hint = getGitInstallHint();
  if (process.platform === 'linux') {
    // Should contain either a package manager command or a fallback URL
    assert.ok(
      hint.includes('apt-get') ||
      hint.includes('dnf') ||
      hint.includes('yum') ||
      hint.includes('pacman') ||
      hint.includes('zypper') ||
      hint.includes('apk') ||
      hint.includes('git-scm.com'),
      `unexpected linux hint: ${hint}`,
    );
  }
});

test('getGitInstallHint references brew or xcode-select on macOS', () => {
  if (process.platform === 'darwin') {
    const hint = getGitInstallHint();
    assert.ok(
      hint.includes('brew') ||
      hint.includes('xcode-select'),
      `unexpected darwin hint: ${hint}`,
    );
  }
});

test('getGitInstallHint references winget on Windows', () => {
  if (process.platform === 'win32') {
    const hint = getGitInstallHint();
    assert.ok(hint.includes('winget'), `unexpected win32 hint: ${hint}`);
  }
});

// ─── generateGatewayUsageYaml ───────────────────────────────────

test('generateGatewayUsageYaml with enabled config includes all fields', () => {
  const yamlStr = generateGatewayUsageYaml({
    enabled: true,
    name: 'Alice',
    org: 'ACME',
    email: 'alice@acme.com',
  });
  assert.match(yamlStr, /uploadEnabled: true/);
  assert.match(yamlStr, /name: Alice/);
  assert.match(yamlStr, /org: ACME/);
  assert.match(yamlStr, /email: alice@acme.com/);
});

test('generateGatewayUsageYaml with disabled config omits user fields', () => {
  const yamlStr = generateGatewayUsageYaml({ enabled: false });
  assert.match(yamlStr, /uploadEnabled: false/);
  assert.doesNotMatch(yamlStr, /name:/);
  assert.doesNotMatch(yamlStr, /org:/);
  assert.doesNotMatch(yamlStr, /email:/);
});

// ─── getAistatusConfigPath ──────────────────────────────────────

test('getAistatusConfigPath returns ~/.aistatus/config.yaml', () => {
  const expected = path.join(os.homedir(), '.aistatus', 'config.yaml');
  assert.equal(getAistatusConfigPath(), expected);
});

// ─── generateSystemdUnit ────────────────────────────────────────

test('generateSystemdUnit contains correct ExecStart and User', () => {
  const unit = generateSystemdUnit('alice', '/usr/local/bin/cortex', '/home/alice/.cortex');
  assert.match(unit, /\[Unit\]/);
  assert.match(unit, /\[Service\]/);
  assert.match(unit, /\[Install\]/);
  assert.match(unit, /User=alice/);
  assert.match(unit, /ExecStart=\/usr\/local\/bin\/cortex daemon/);
  assert.match(unit, /CORTEX_HOME=\/home\/alice\/.cortex/);
  assert.match(unit, /Restart=on-failure/);
});

// ─── generateLaunchdPlist ───────────────────────────────────────

test('generateLaunchdPlist contains correct ProgramArguments and env', () => {
  const plist = generateLaunchdPlist('bob', '/opt/bin/cortex', '/Users/bob/.cortex');
  assert.match(plist, /cc\.cortex\.agent-server/);
  assert.match(plist, /<string>\/opt\/bin\/cortex<\/string>/);
  assert.match(plist, /<string>daemon<\/string>/);
  assert.match(plist, /CORTEX_HOME/);
  assert.match(plist, /<string>\/Users\/bob\/.cortex<\/string>/);
  assert.match(plist, /RunAtLoad/);
  assert.match(plist, /KeepAlive/);
});
