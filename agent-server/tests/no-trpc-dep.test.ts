// input:  agent-server/package.json
// output: guard test — core's production deps must NOT include @trpc/server (moved to the optional
//         @cortex-agent/ui-server package). Keeps Slack/TUI-only installs free of the UI/trpc weight.
// pos:    Regression guard for task 3606 (Stage 9 §9.1). Fails if @trpc/server is re-added to core
//         dependencies or optionalDependencies.
// >>> If I am updated, update my header comment <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

test('core production dependencies do not include @trpc/server', () => {
  assert.ok(!(pkg.dependencies && '@trpc/server' in pkg.dependencies),
    '@trpc/server must not be a core dependency — it lives in @cortex-agent/ui-server');
});

test('core optionalDependencies do not include @trpc/server', () => {
  assert.ok(!(pkg.optionalDependencies && '@trpc/server' in pkg.optionalDependencies),
    '@trpc/server must not be a core optionalDependency — it lives in @cortex-agent/ui-server');
});
