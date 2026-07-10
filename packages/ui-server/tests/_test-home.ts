// input:  process env (CORTEX_HOME)
// output: side effect — guarantees CORTEX_HOME points at a per-process isolated temp dir
// pos:    test isolation guard for @cortex-agent/ui-server tests. MUST be imported FIRST, before
//         any module that transitively loads @cortex-agent/server's paths.ts (which binds
//         DATA_DIR = $CORTEX_HOME ?? ~/.cortex at import time). Without this, the transport-host's
//         logger would write into the operator's live ~/.cortex, racing the running daemon.
// >>> If I am updated, update my header comment <<<

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const _home = mkdtempSync(path.join(os.tmpdir(), 'cortex-uiserver-test-home-'));

for (const d of ['data', 'config', 'context', path.join('context', 'projects'), 'tmp', path.join('tmp', 'threads')]) {
  try { mkdirSync(path.join(_home, d), { recursive: true }); } catch { /* best-effort */ }
}

process.env.CORTEX_HOME = _home;

process.on('exit', () => {
  try { rmSync(_home, { recursive: true, force: true }); } catch { /* best-effort */ }
});

export {};
