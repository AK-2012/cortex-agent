// Tests for mergeThreadTemplates — ensures new agents/templates from defaults
// propagate to existing user config without overwriting user customizations.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mergeThreadTemplates } from '../../src/domain/threads/index.js';

const MINIMAL_DEFAULTS = {
  agents: {
    main: {
      name: 'main',
      description: 'General-purpose agent',
      profile: '__active__',
      persistSession: true,
      promptTemplate: '{{input}}',
      systemPrompt: 'file:direct.md',
    },
    worker: {
      name: 'worker',
      description: 'Worker agent',
      profile: '__active__',
      persistSession: false,
      promptTemplate: '{{input}}',
      systemPrompt: 'file:worker.md',
    },
  },
  templates: {
    default: {
      name: 'default',
      description: 'Default single-agent template',
      agents: ['main'],
      transitions: [],
      entryAgent: 'main',
      maxTotalSteps: 1,
    },
  },
};

describe('mergeThreadTemplates', () => {
  let tmpDir: string;
  let defaultsPath: string;
  let userPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cortex-merge-test-'));
    defaultsPath = join(tmpDir, 'defaults.json');
    userPath = join(tmpDir, 'user.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeDefaults(agents: Record<string, any> = {}, templates: Record<string, any> = {}) {
    writeFileSync(defaultsPath, JSON.stringify({ agents, templates }, null, 2), 'utf8');
  }

  function readUser(): any {
    return JSON.parse(readFileSync(userPath, 'utf8'));
  }

  function writeUser(agents: Record<string, any> = {}, templates: Record<string, any> = {}) {
    writeFileSync(userPath, JSON.stringify({ agents, templates }, null, 2), 'utf8');
  }

  // 1. No existing user config → copy defaults
  it('creates config when user file does not exist', () => {
    writeDefaults(MINIMAL_DEFAULTS.agents, MINIMAL_DEFAULTS.templates);

    const result = mergeThreadTemplates(defaultsPath, userPath);
    assert.equal(result, true);
    assert.ok(existsSync(userPath));

    const cfg = readUser();
    assert.ok(cfg.agents.main);
    assert.equal(cfg.agents.main.systemPrompt, 'file:direct.md');
    assert.ok(cfg.agents.worker);
    assert.ok(cfg.templates.default);
  });

  // 2. User missing some agents → new agents added
  it('adds new agents from defaults not in user config', () => {
    writeDefaults(MINIMAL_DEFAULTS.agents, MINIMAL_DEFAULTS.templates);
    writeUser(
      {
        main: { ...MINIMAL_DEFAULTS.agents.main, profile: 'custom' },
      },
      MINIMAL_DEFAULTS.templates,
    );

    const result = mergeThreadTemplates(defaultsPath, userPath);
    assert.equal(result, true);

    const cfg = readUser();
    // Existing agent preserved with user customization
    assert.equal(cfg.agents.main.profile, 'custom');
    // New agent added from defaults
    assert.ok(cfg.agents.worker);
    assert.equal(cfg.agents.worker.systemPrompt, 'file:worker.md');
  });

  // 3. User missing some templates → new templates added
  it('adds new templates from defaults not in user config', () => {
    writeDefaults(
      MINIMAL_DEFAULTS.agents,
      {
        default: MINIMAL_DEFAULTS.templates.default,
        reviewer: {
          name: 'reviewer',
          description: 'Review template',
          agents: ['reviewer'],
          transitions: [],
          entryAgent: 'reviewer',
          maxTotalSteps: 2,
        },
      },
    );
    writeUser(MINIMAL_DEFAULTS.agents, {
      default: { ...MINIMAL_DEFAULTS.templates.default, maxTotalSteps: 99 },
    });

    const result = mergeThreadTemplates(defaultsPath, userPath);
    assert.equal(result, true);

    const cfg = readUser();
    // Existing template preserved with user override
    assert.equal(cfg.templates.default.maxTotalSteps, 99);
    // New template added from defaults
    assert.ok(cfg.templates.reviewer);
    assert.equal(cfg.templates.reviewer.maxTotalSteps, 2);
  });

  // 4. User has all agents/templates → no changes
  it('returns false when user config already has everything', () => {
    writeDefaults(MINIMAL_DEFAULTS.agents, MINIMAL_DEFAULTS.templates);
    writeUser(MINIMAL_DEFAULTS.agents, MINIMAL_DEFAULTS.templates);

    const originalContent = readFileSync(userPath, 'utf8');
    const result = mergeThreadTemplates(defaultsPath, userPath);
    assert.equal(result, false);
    // File content unchanged
    const afterContent = readFileSync(userPath, 'utf8');
    assert.equal(afterContent, originalContent);
  });

  // 5. User has customized agent preserved, not overwritten
  it('preserves user-customized agents without overwriting', () => {
    const userCustomAgent = {
      name: 'main',
      description: 'My custom main agent',
      profile: 'my-profile',
      persistSession: true,
      promptTemplate: 'CUSTOM: {{input}}',
      systemPrompt: 'file:custom.md',
      tools: 'Bash,Read',
      pluginDirs: ['plugins/my-plugin'],
    };

    writeDefaults(MINIMAL_DEFAULTS.agents, MINIMAL_DEFAULTS.templates);
    writeUser({ main: userCustomAgent }, MINIMAL_DEFAULTS.templates);

    const result = mergeThreadTemplates(defaultsPath, userPath);
    assert.equal(result, true);

    const cfg = readUser();
    // User's custom main agent fully preserved
    assert.equal(cfg.agents.main.description, 'My custom main agent');
    assert.equal(cfg.agents.main.profile, 'my-profile');
    assert.equal(cfg.agents.main.systemPrompt, 'file:custom.md');
    assert.equal(cfg.agents.main.tools, 'Bash,Read');
    // New worker agent still added
    assert.ok(cfg.agents.worker);
  });

  // 6. Malformed user JSON → fallback to defaults
  it('falls back to defaults when user config is malformed JSON', () => {
    writeDefaults(MINIMAL_DEFAULTS.agents, MINIMAL_DEFAULTS.templates);
    writeFileSync(userPath, '{ this is not valid json }', 'utf8');

    const result = mergeThreadTemplates(defaultsPath, userPath);
    assert.equal(result, true);

    const cfg = readUser();
    assert.ok(cfg.agents.main);
    assert.ok(cfg.agents.worker);
  });

  // 7. Empty defaults → no-op if user matches
  it('returns false when defaults have no agents or templates and user is empty', () => {
    writeDefaults({}, {});
    writeUser({}, {});

    const result = mergeThreadTemplates(defaultsPath, userPath);
    assert.equal(result, false);
  });

  // 8. User config missing `agents` key → new agents added
  it('adds agents when user config has no agents key', () => {
    writeDefaults(MINIMAL_DEFAULTS.agents, MINIMAL_DEFAULTS.templates);
    writeFileSync(userPath, JSON.stringify({
      templates: {
        mytemplate: {
          name: 'mytemplate',
          description: 'Custom template',
          agents: ['main'],
          transitions: [],
          entryAgent: 'main',
          maxTotalSteps: 1,
        },
      },
    }), 'utf8');

    const result = mergeThreadTemplates(defaultsPath, userPath);
    assert.equal(result, true);

    const cfg = readUser();
    assert.ok(cfg.agents.main);
    assert.ok(cfg.agents.worker);
    // Custom template preserved
    assert.ok(cfg.templates.mytemplate);
    // Default template also added
    assert.ok(cfg.templates.default);
  });

  // 9. Unreadable defaults file → returns false
  it('returns false when defaults file cannot be read', () => {
    // defaultsPath doesn't exist in this test
    const result = mergeThreadTemplates(defaultsPath, userPath);
    assert.equal(result, false);
  });
});
