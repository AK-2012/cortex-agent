// input:  Node test runner, assert, tmp filesystem
// output: regression tests for version-tracking migration runner (compareCalVer, runMigrations)
// pos:    verifies store/version-migrations.ts idempotent migration behaviour
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Dynamic import of the module under test.
const { compareCalVer, runMigrations } = await import('../../src/store/version-migrations.js');

// ── Shared tmp directory ───────────────────────────────────────

let tmpDir: string;

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-version-migrations-test-'));
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────

let _testIdx = 0;

function setupDirs(idx: number): { dataDir: string; storeDir: string; configDir: string; defaultsDir: string } {
  const dataDir = path.join(tmpDir, `data-${idx}`);
  const storeDir = path.join(dataDir, 'data');
  const configDir = path.join(dataDir, 'config');
  // defaultsDir corresponds to DEFAULTS_DIR (= INSTALL_ROOT/defaults/).
  // The DEFAULTS_MAP maps config/thread-templates.json → config/thread-templates.json,
  // which is joined under DEFAULTS_DIR. So we put the actual file at defaultsDir/config/.
  const defaultsDir = path.join(dataDir, 'defaults');
  return { dataDir, storeDir, configDir, defaultsDir };
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

// ── compareCalVer tests ────────────────────────────────────────

test('compareCalVer - same version returns 0', () => {
  assert.equal(compareCalVer('2026.5.23', '2026.5.23'), 0);
  assert.equal(compareCalVer('2027.1.1', '2027.1.1'), 0);
});

test('compareCalVer - different day, same month/year', () => {
  assert.ok(compareCalVer('2026.5.23', '2026.5.9') > 0, '23 > 9');
  assert.ok(compareCalVer('2026.5.9', '2026.5.23') < 0, '9 < 23');
});

test('compareCalVer - cross-digit day boundary', () => {
  // String comparison would fail: "2026.5.9" > "2026.5.10" (because '9' > '1')
  // Numeric comparison is correct: 9 < 10
  assert.ok(compareCalVer('2026.5.9', '2026.5.10') < 0, '9 < 10');
  assert.ok(compareCalVer('2026.5.10', '2026.5.9') > 0, '10 > 9');
});

test('compareCalVer - different month', () => {
  assert.ok(compareCalVer('2026.6.1', '2026.5.23') > 0, 'June > May');
  assert.ok(compareCalVer('2026.5.23', '2026.6.1') < 0, 'May < June');
});

test('compareCalVer - cross-digit month boundary', () => {
  // 2026.10.1 vs 2026.5.1 — string compare would fail ('.' < '1')
  assert.ok(compareCalVer('2026.10.1', '2026.5.1') > 0, 'October > May');
  assert.ok(compareCalVer('2026.5.1', '2026.10.1') < 0, 'May < October');
});

test('compareCalVer - different year', () => {
  assert.ok(compareCalVer('2027.1.1', '2026.12.31') > 0, '2027 > 2026');
  assert.ok(compareCalVer('2026.12.31', '2027.1.1') < 0, '2026 < 2027');
});

test('compareCalVer - zero version', () => {
  assert.ok(compareCalVer('2026.5.23', '0.0.0') > 0, 'any version > 0.0.0');
  assert.ok(compareCalVer('0.0.0', '2026.5.23') < 0, '0.0.0 < any version');
});

// ── runMigrations tests ────────────────────────────────────────
// Each test uses an isolated temp dir passed as MigrationOptions to
// runMigrations(), avoiding dependency on the global CORTEX_HOME env var
// (which is locked at module load time via @core/paths).

test('runMigrations - no versions file, adds systemPrompt to agent missing it', async () => {
  const idx = _testIdx++;
  const { dataDir, storeDir, configDir, defaultsDir } = setupDirs(idx);

  // Write defaults with systemPrompt (defaults are at defaultsDir/config/thread-templates.json)
  await writeJson(path.join(defaultsDir, 'config', 'thread-templates.json'), {
    agents: {
      main: { name: 'main', profile: 'sonnet', persistSession: false, systemPrompt: 'file:direct.md', promptTemplate: 'direct' },
      coder: { name: 'coder', profile: 'sonnet', persistSession: false, systemPrompt: 'file:coder.md', promptTemplate: 'coder' },
    },
    templates: {},
  });

  // Write user config: main has no systemPrompt, coder has one, custom has no defaults counterpart
  await writeJson(path.join(configDir, 'thread-templates.json'), {
    agents: {
      main: { name: 'main', profile: 'sonnet', persistSession: false, promptTemplate: 'direct' },
      coder: { name: 'coder', profile: 'sonnet', persistSession: false, systemPrompt: 'file:custom-coder.md', promptTemplate: 'coder' },
      custom: { name: 'custom', profile: 'deepseek', persistSession: false, promptTemplate: 'custom' },
    },
    templates: {},
  });

  await runMigrations({ dataDir, defaultsDir, storeDir });

  // Verify
  const migrated = await readJson(path.join(configDir, 'thread-templates.json')) as any;
  // main: systemPrompt was missing, should be added from defaults
  assert.equal(migrated.agents.main.systemPrompt, 'file:direct.md');
  // coder: systemPrompt already existed, should NOT be overwritten
  assert.equal(migrated.agents.coder.systemPrompt, 'file:custom-coder.md');
  // custom: not in defaults, should be untouched and still have no systemPrompt
  assert.equal(migrated.agents.custom.systemPrompt, undefined);

  // Versions file should exist and track this file
  const versions = await readJson(path.join(storeDir, 'versions.json')) as any;
  assert.ok(versions['config/thread-templates.json']);
  assert.ok(compareCalVer(versions['config/thread-templates.json'], '0.0.0') > 0);
});

test('runMigrations - idempotent on second run', async () => {
  const idx = _testIdx++;
  const { dataDir, storeDir, configDir, defaultsDir } = setupDirs(idx);

  await writeJson(path.join(defaultsDir, 'config', 'thread-templates.json'), {
    agents: {
      main: { name: 'main', profile: 'sonnet', persistSession: false, systemPrompt: 'file:direct.md', promptTemplate: 'direct' },
    },
    templates: {},
  });

  await writeJson(path.join(configDir, 'thread-templates.json'), {
    agents: {
      main: { name: 'main', profile: 'sonnet', persistSession: false, promptTemplate: 'direct' },
    },
    templates: {},
  });

  // First run
  await runMigrations({ dataDir, defaultsDir, storeDir });
  const first = await readJson(path.join(configDir, 'thread-templates.json')) as any;
  assert.equal(first.agents.main.systemPrompt, 'file:direct.md');

  // Second run — should be a no-op
  await runMigrations({ dataDir, defaultsDir, storeDir });
  const second = await readJson(path.join(configDir, 'thread-templates.json')) as any;
  assert.equal(second.agents.main.systemPrompt, 'file:direct.md');
  assert.deepEqual(second, first);
});

test('runMigrations - skips when file is already up to date', async () => {
  const idx = _testIdx++;
  const { dataDir, storeDir, configDir, defaultsDir } = setupDirs(idx);

  await writeJson(path.join(defaultsDir, 'config', 'thread-templates.json'), {
    agents: {
      main: { name: 'main', profile: 'sonnet', persistSession: false, systemPrompt: 'file:direct.md', promptTemplate: 'direct' },
    },
    templates: {},
  });

  // User config already has systemPrompt
  await writeJson(path.join(configDir, 'thread-templates.json'), {
    agents: {
      main: { name: 'main', profile: 'sonnet', persistSession: false, systemPrompt: 'file:direct.md', promptTemplate: 'direct' },
    },
    templates: {},
  });

  // Manually write versions.json with up-to-date version
  await writeJson(path.join(storeDir, 'versions.json'), {
    'config/thread-templates.json': '2026.5.23',
  });

  await runMigrations({ dataDir, defaultsDir, storeDir });

  // Content should be unchanged
  const content = await readJson(path.join(configDir, 'thread-templates.json')) as any;
  assert.equal(content.agents.main.systemPrompt, 'file:direct.md');
  // Versions should still track the existing version
  const versions = await readJson(path.join(storeDir, 'versions.json')) as any;
  assert.equal(versions['config/thread-templates.json'], '2026.5.23');
});

test('runMigrations - handles missing user config file gracefully', async () => {
  const idx = _testIdx++;
  const { dataDir, storeDir, defaultsDir } = setupDirs(idx);

  await writeJson(path.join(defaultsDir, 'config', 'thread-templates.json'), {
    agents: { main: { name: 'main', systemPrompt: 'file:direct.md' } },
    templates: {},
  });
  // Do NOT create user config

  // Should not throw
  await runMigrations({ dataDir, defaultsDir, storeDir });

  // Versions file should NOT track this file (migration was skipped)
  try {
    const versions = await readJson(path.join(storeDir, 'versions.json')) as any;
    assert.equal(versions['config/thread-templates.json'], undefined);
  } catch (e: any) {
    // versions.json may not exist at all — that's also fine
    if (e.code !== 'ENOENT') throw e;
  }
});

test('runMigrations - handles corrupt user config gracefully', async () => {
  const idx = _testIdx++;
  const { dataDir, storeDir, configDir, defaultsDir } = setupDirs(idx);

  await writeJson(path.join(defaultsDir, 'config', 'thread-templates.json'), {
    agents: { main: { name: 'main', systemPrompt: 'file:direct.md' } },
    templates: {},
  });

  // Write invalid JSON
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, 'thread-templates.json'), '{ not valid json }');

  // Should not throw
  await runMigrations({ dataDir, defaultsDir, storeDir });

  // Versions file should NOT track this file
  try {
    const versions = await readJson(path.join(storeDir, 'versions.json')) as any;
    assert.equal(versions['config/thread-templates.json'], undefined);
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw e;
  }
});

test('runMigrations - handles corrupt versions.json gracefully', async () => {
  const idx = _testIdx++;
  const { dataDir, storeDir, configDir, defaultsDir } = setupDirs(idx);

  await writeJson(path.join(defaultsDir, 'config', 'thread-templates.json'), {
    agents: {
      main: { name: 'main', profile: 'sonnet', persistSession: false, systemPrompt: 'file:direct.md', promptTemplate: 'direct' },
    },
    templates: {},
  });

  await writeJson(path.join(configDir, 'thread-templates.json'), {
    agents: {
      main: { name: 'main', profile: 'sonnet', persistSession: false, promptTemplate: 'direct' },
    },
    templates: {},
  });

  // Write corrupt versions.json
  await fs.mkdir(storeDir, { recursive: true });
  await fs.writeFile(path.join(storeDir, 'versions.json'), 'not json {');

  // Should not throw — migration should still apply
  await runMigrations({ dataDir, defaultsDir, storeDir });

  const migrated = await readJson(path.join(configDir, 'thread-templates.json')) as any;
  assert.equal(migrated.agents.main.systemPrompt, 'file:direct.md');

  // Versions file should now be valid
  const versions = await readJson(path.join(storeDir, 'versions.json')) as any;
  assert.ok(versions['config/thread-templates.json']);
});

test('runMigrations - vector-clock: only runs versions newer than tracked', async () => {
  const idx = _testIdx++;
  const { dataDir, storeDir, configDir, defaultsDir } = setupDirs(idx);

  await writeJson(path.join(defaultsDir, 'config', 'thread-templates.json'), {
    agents: {
      main: { name: 'main', profile: 'sonnet', persistSession: false, systemPrompt: 'file:direct.md', promptTemplate: 'direct' },
    },
    templates: {},
  });

  await writeJson(path.join(configDir, 'thread-templates.json'), {
    agents: {
      main: { name: 'main', profile: 'sonnet', persistSession: false, promptTemplate: 'direct' },
    },
    templates: {},
  });

  // Tracked version is at 2026.5.10 — migrations at 2026.5.23 should still run
  await writeJson(path.join(storeDir, 'versions.json'), {
    'config/thread-templates.json': '2026.5.10',
  });

  await runMigrations({ dataDir, defaultsDir, storeDir });

  const migrated = await readJson(path.join(configDir, 'thread-templates.json')) as any;
  assert.equal(migrated.agents.main.systemPrompt, 'file:direct.md');

  // Version should be bumped to the highest applied migration version
  const versions = await readJson(path.join(storeDir, 'versions.json')) as any;
  assert.equal(compareCalVer(versions['config/thread-templates.json'], '2026.5.10') > 0, true);
});

test('runMigrations - no defaults file, still runs (migration function handles undefined)', async () => {
  const idx = _testIdx++;
  const { dataDir, storeDir, configDir, defaultsDir } = setupDirs(idx);

  // Do NOT create defaults file

  await writeJson(path.join(configDir, 'thread-templates.json'), {
    agents: {
      main: { name: 'main', profile: 'sonnet', persistSession: false, promptTemplate: 'direct' },
    },
    templates: {},
  });

  // Should not throw — migration function checks for undefined defaults
  await runMigrations({ dataDir, defaultsDir, storeDir });

  // File should be unchanged (no defaults means no systemPrompt to copy)
  const content = await readJson(path.join(configDir, 'thread-templates.json')) as any;
  assert.equal(content.agents.main.systemPrompt, undefined);

  // But version should still be tracked (migration was "applied" — it was a no-op)
  const versions = await readJson(path.join(storeDir, 'versions.json')) as any;
  assert.ok(versions['config/thread-templates.json']);
});
