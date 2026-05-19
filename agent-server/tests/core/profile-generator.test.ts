// input:  profile-generator module
// output: verify profile generation rules — naming, --thinking xhigh scope, explicit choices, overwrite
// pos:    Validate profile-generator pure logic (no filesystem in generateProfiles/mergeProfilesJson)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  generateProfiles,
  mergeProfilesJson,
  listChoices,
  writeProfilesJson,
} from '../../src/core/profile-generator.js';
import type { DiscoveredEndpoint } from '../../src/core/gateway-generator.js';

// ─── Fixture helpers ────────────────────────────────────────────

/** Build a minimal DiscoveredEndpoint with sensible defaults for testing. */
function ep(mode: string, endpoint: string, models: string[]): DiscoveredEndpoint {
  return {
    mode,
    endpoint,
    base_url: 'https://example.test',
    auth_style: 'bearer',
    keys: ['stub-key'],
    passthrough: false,
    models,
    modelFallbacks: {},
  };
}

const ANTHROPIC_PLAN = ep('plan', 'anthropic', ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5']);
const DEEPSEEK_PI = ep('deepseek-anthropic', 'anthropic', ['deepseek-pro', 'deepseek-flash']);
const OPENAI_GPT = ep('openai', 'openai', ['gpt-5', 'gpt-5-mini']);

// ─── Empty endpoints → fallback ─────────────────────────────────

test('generateProfiles: empty endpoints returns minimal plan-only profile', () => {
  const result = generateProfiles([]);
  assert.equal(result.defaultProfile, 'plan');
  assert.deepEqual(Object.keys(result.profiles), ['plan']);
  assert.equal(result.profiles.plan.backend, 'claude');
  assert.equal(result.profiles.plan.mode, 'plan');
});

// ─── Standard naming: no provider suffix ────────────────────────

test('generateProfiles: anthropic-only produces "plan" and "execute" without provider suffix', () => {
  const result = generateProfiles([ANTHROPIC_PLAN]);
  assert.ok(result.profiles.plan, 'should have profile named "plan"');
  assert.ok(result.profiles.execute, 'should have profile named "execute"');
  // No suffixed names
  const names = Object.keys(result.profiles);
  for (const n of names) {
    assert.ok(!n.match(/^(plan|execute|write|qa)-/),
      `profile name "${n}" must not have plan-/execute-/write-/qa- prefix`);
  }
});

test('generateProfiles: never generates write or qa profile', () => {
  const result = generateProfiles([ANTHROPIC_PLAN, DEEPSEEK_PI, OPENAI_GPT]);
  for (const name of Object.keys(result.profiles)) {
    assert.ok(name !== 'write' && !name.startsWith('write-'),
      `unexpected write profile: ${name}`);
    assert.ok(name !== 'qa' && !name.startsWith('qa-'),
      `unexpected qa profile: ${name}`);
  }
});

test('generateProfiles: defaultProfile is "plan"', () => {
  const result = generateProfiles([ANTHROPIC_PLAN]);
  assert.equal(result.defaultProfile, 'plan');
});

// ─── plan profile: max-tier Anthropic by default ────────────────

test('generateProfiles: plan picks max-tier Anthropic (opus) by default', () => {
  const result = generateProfiles([ANTHROPIC_PLAN]);
  assert.match(result.profiles.plan.model, /opus/);
  assert.equal(result.profiles.plan.backend, 'claude');
});

// ─── execute profile: --thinking xhigh scope ────────────────────

test('generateProfiles: execute profile does NOT have --thinking xhigh for non-DeepSeek PI backend', () => {
  // Imagine a PI endpoint exposing a non-DeepSeek anthropic-compatible model
  const kimi = ep('kimi-anthropic', 'anthropic', ['kimi-k2-mini']);
  const result = generateProfiles([ANTHROPIC_PLAN, kimi]);
  // execute should pick kimi-k2-mini (mid-tier non-Claude-Code)
  // and must NOT carry --thinking xhigh
  assert.equal(result.profiles.execute?.extraOption?.['--thinking'], undefined,
    'execute profile must not auto-add --thinking xhigh for non-DeepSeek PI backend');
});

test('generateProfiles: execute profile does NOT add --thinking xhigh even when picking Anthropic mid', () => {
  const result = generateProfiles([ANTHROPIC_PLAN]);
  assert.equal(result.profiles.execute?.extraOption?.['--thinking'], undefined);
});

// ─── DeepSeek-specific profiles ──────────────────────────────────

test('generateProfiles: deepseek-pro PI backend keeps --thinking xhigh', () => {
  const result = generateProfiles([ANTHROPIC_PLAN, DEEPSEEK_PI]);
  assert.ok(result.profiles['deepseek-pro'], 'deepseek-pro profile should exist');
  assert.equal(result.profiles['deepseek-pro'].extraOption?.['--thinking'], 'xhigh');
});

test('generateProfiles: deepseek-flash does NOT have --thinking xhigh', () => {
  const result = generateProfiles([ANTHROPIC_PLAN, DEEPSEEK_PI]);
  assert.ok(result.profiles['deepseek-flash']);
  assert.equal(result.profiles['deepseek-flash'].extraOption?.['--thinking'], undefined);
});

// ─── Codex profile preserved ─────────────────────────────────────

test('generateProfiles: codex profile generated when OpenAI endpoint present', () => {
  const result = generateProfiles([ANTHROPIC_PLAN, OPENAI_GPT]);
  assert.ok(result.profiles.codex, 'codex profile should exist');
  assert.equal(result.profiles.codex.backend, 'codex');
});

// ─── Explicit planChoice / executeChoice ────────────────────────

test('generateProfiles: explicit planChoice overrides auto-inference', () => {
  const result = generateProfiles([ANTHROPIC_PLAN, DEEPSEEK_PI], {
    planChoice: { mode: 'deepseek-anthropic', model: 'deepseek-pro' },
  });
  assert.equal(result.profiles.plan.model, 'deepseek-pro');
  assert.equal(result.profiles.plan.mode, 'deepseek-anthropic');
});

test('generateProfiles: explicit executeChoice overrides auto-inference', () => {
  const result = generateProfiles([ANTHROPIC_PLAN, DEEPSEEK_PI], {
    executeChoice: { mode: 'plan', model: 'claude-haiku-4-5' },
  });
  assert.equal(result.profiles.execute.model, 'claude-haiku-4-5');
  assert.equal(result.profiles.execute.mode, 'plan');
});

test('generateProfiles: explicit choice for unknown (mode, model) throws', () => {
  assert.throws(() => {
    generateProfiles([ANTHROPIC_PLAN], {
      planChoice: { mode: 'nonexistent', model: 'fake-model' },
    });
  }, /not found/i);
});

// ─── listChoices ─────────────────────────────────────────────────

test('listChoices: flattens endpoints to (mode, model) tuples', () => {
  const choices = listChoices([ANTHROPIC_PLAN, DEEPSEEK_PI]);
  assert.equal(choices.length, 5); // 3 anthropic + 2 deepseek
  // Anthropic plan/api modes should come first (recommended for plan)
  assert.equal(choices[0].mode, 'plan');
  assert.match(choices[0].model, /opus/);
});

test('listChoices: each choice has {mode, model}', () => {
  const choices = listChoices([ANTHROPIC_PLAN]);
  for (const c of choices) {
    assert.equal(typeof c.mode, 'string');
    assert.equal(typeof c.model, 'string');
  }
});

// ─── mergeProfilesJson: overwrite behavior ──────────────────────

test('mergeProfilesJson: overwrite=false preserves existing plan/execute', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-profile-merge-'));
  try {
    const existing = {
      defaultProfile: 'plan',
      profiles: {
        plan: { model: 'user-custom-plan' },
        execute: { model: 'user-custom-execute' },
      },
    };
    fs.writeFileSync(path.join(tmpDir, 'profiles.json'), JSON.stringify(existing));
    const generated = {
      defaultProfile: 'plan',
      profiles: {
        plan: { model: 'claude-opus-4-7', backend: 'claude', mode: 'plan' },
        execute: { model: 'claude-sonnet-4-6', backend: 'claude', mode: 'plan' },
      },
    };
    const merged = mergeProfilesJson(generated, tmpDir, false);
    assert.equal(merged.profiles.plan.model, 'user-custom-plan');
    assert.equal(merged.profiles.execute.model, 'user-custom-execute');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('mergeProfilesJson: overwrite=true replaces plan/execute but keeps other custom profiles', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-profile-merge-'));
  try {
    const existing = {
      defaultProfile: 'plan',
      profiles: {
        plan: { model: 'user-custom-plan' },
        execute: { model: 'user-custom-execute' },
        'my-custom': { model: 'user-special' },
      },
    };
    fs.writeFileSync(path.join(tmpDir, 'profiles.json'), JSON.stringify(existing));
    const generated = {
      defaultProfile: 'plan',
      profiles: {
        plan: { model: 'claude-opus-4-7', backend: 'claude', mode: 'plan' },
        execute: { model: 'claude-sonnet-4-6', backend: 'claude', mode: 'plan' },
      },
    };
    const merged = mergeProfilesJson(generated, tmpDir, true);
    // plan/execute overwritten
    assert.equal(merged.profiles.plan.model, 'claude-opus-4-7');
    assert.equal(merged.profiles.execute.model, 'claude-sonnet-4-6');
    // custom profile preserved
    assert.equal(merged.profiles['my-custom'].model, 'user-special');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('mergeProfilesJson: no existing file returns generated as-is', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-profile-merge-'));
  try {
    const generated = {
      defaultProfile: 'plan',
      profiles: { plan: { model: 'm1', backend: 'claude', mode: 'plan' } },
    };
    const merged = mergeProfilesJson(generated, tmpDir, false);
    assert.deepEqual(merged, generated);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── writeProfilesJson: end-to-end ──────────────────────────────

test('writeProfilesJson: writes profiles.json containing plan and execute', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-profile-write-'));
  try {
    const outPath = writeProfilesJson([ANTHROPIC_PLAN], { outputDir: tmpDir });
    assert.equal(outPath, path.join(tmpDir, 'profiles.json'));
    const content = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    assert.ok(content.profiles.plan);
    assert.ok(content.profiles.execute);
    assert.equal(content.defaultProfile, 'plan');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeProfilesJson: respects explicit choices', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-profile-write-'));
  try {
    writeProfilesJson([ANTHROPIC_PLAN, DEEPSEEK_PI], {
      outputDir: tmpDir,
      planChoice: { mode: 'plan', model: 'claude-sonnet-4-6' },
      executeChoice: { mode: 'deepseek-anthropic', model: 'deepseek-flash' },
    });
    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, 'profiles.json'), 'utf-8'));
    assert.equal(content.profiles.plan.model, 'claude-sonnet-4-6');
    assert.equal(content.profiles.execute.model, 'deepseek-flash');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeProfilesJson: overwrite=true forces overwrite of existing plan/execute', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-profile-write-'));
  try {
    const existing = {
      defaultProfile: 'plan',
      profiles: { plan: { model: 'old' }, execute: { model: 'old' } },
    };
    fs.writeFileSync(path.join(tmpDir, 'profiles.json'), JSON.stringify(existing));
    writeProfilesJson([ANTHROPIC_PLAN], { outputDir: tmpDir, overwrite: true });
    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, 'profiles.json'), 'utf-8'));
    assert.notEqual(content.profiles.plan.model, 'old');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
