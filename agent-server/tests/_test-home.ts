// input:  process env (CORTEX_HOME)
// output: side effect — guarantees CORTEX_HOME points at an isolated temp dir for tests
// pos:    test isolation guard — MUST be the first import in any test file that writes to
//         STORE_DIR / DATA_DIR, so paths.ts binds DATA_DIR to a throwaway dir instead of
//         the real ~/.cortex. No-op when CORTEX_HOME is already set (e.g. run-tests.sh).
// >>> If I am updated, update my header comment <<<
//
// Why this exists: paths.ts resolves DATA_DIR = $CORTEX_HOME ?? ~/.cortex at IMPORT TIME.
// A test run directly (e.g. `npx tsx --test tests/session.test.ts`) without CORTEX_HOME set
// would therefore read/write the operator's live ~/.cortex/data — racing the running daemon
// and leaking fixtures (C-concurrent-*, sid-*, …) into the real sessions.json. Importing this
// module FIRST sets CORTEX_HOME to a fresh mkdtemp dir before paths.ts is evaluated, so every
// store path lands in the throwaway dir. ESM evaluates imports in source order, so as long as
// this is the first import the guarantee holds.

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

if (!process.env.CORTEX_HOME) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'cortex-test-home-'));
  process.env.CORTEX_HOME = home;
  // Seed the standard empty dir structure so store/task tests that write via a raw
  // fs.writeFile (no mkdir, unlike atomicWrite which mkdir -p's) still work in isolation.
  // This is NOT a full `cortex init` seed — tests needing seeded config must use run-tests.sh.
  for (const d of ['data', 'config', 'context', path.join('context', 'projects'), 'tmp', path.join('tmp', 'threads')]) {
    try { mkdirSync(path.join(home, d), { recursive: true }); } catch { /* best-effort */ }
  }
  // Best-effort cleanup when the test process exits (must be synchronous in 'exit').
  process.on('exit', () => {
    try { rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
}

export {};
