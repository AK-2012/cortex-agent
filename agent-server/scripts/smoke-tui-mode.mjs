#!/usr/bin/env node
// DR-0012 Phase 5 smoke test — run real `claude` under tmux via ClaudeTuiSession.
//
// Why a script and not a regular test: this exercises the real claude binary + tmux,
// makes API calls, and writes to ~/.claude/projects/. It must NOT run in CI (no claude
// auth, would burn tokens). Invoke manually:
//
//   node agent-server/scripts/smoke-tui-mode.mjs
//
// Outputs PASS/FAIL with timing. Cleans up its tmux session and tempdir on exit.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// Import compiled adapter — the smoke script runs against built code, mirroring production.
const distAdapterTui = path.join(repoRoot, 'dist/agent-adapter/claude/adapter-tui.js');
const distTmuxControl = path.join(repoRoot, 'dist/agent-adapter/claude/tmux-control.js');
if (!fs.existsSync(distAdapterTui)) {
  console.error(`Missing ${distAdapterTui}. Run \`pnpm build\` first.`);
  process.exit(2);
}

const { ClaudeTuiSession, defaultTailFactory } = await import(distAdapterTui);
const { TmuxControl } = await import(distTmuxControl);

// --- Test fixture ---

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-tui-smoke-'));
const sessionId = crypto.randomUUID();
const channel = 'C-SMOKE';

let pass = true;
const t0 = Date.now();
function step(name, ok, detail) {
  const tag = ok ? '✓ PASS' : '✗ FAIL';
  console.log(`  ${tag}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) pass = false;
}

console.log(`smoke-tui-mode  cwd=${cwd}  sessionId=${sessionId}`);

const sess = new ClaudeTuiSession({
  channel,
  sessionId,
  sessionKey: channel,
  cwd,
  needsResume: false,
  deps: {
    tmux: new TmuxControl(),
    tailFactory: defaultTailFactory,
    waitForJsonlMs: 10_000,
  },
});

let cleanedUp = false;
async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  try { sess.kill(); } catch {}
  // Defensive: explicit tmux kill in case sess.kill() raced
  try { spawnSync('tmux', ['kill-session', '-t', `cortex-claude-${sessionId}`], { stdio: 'ignore' }); } catch {}
  try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {}
  // jsonl cleanup
  const encoded = cwd.replace(/\//g, '-');
  const jsonlPath = path.join(os.homedir(), '.claude/projects', encoded, `${sessionId}.jsonl`);
  try { fs.rmSync(path.dirname(jsonlPath), { recursive: true, force: true }); } catch {}
}
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });
process.on('uncaughtException', async (e) => { console.error('UNCAUGHT:', e); await cleanup(); process.exit(2); });

// --- Test 1: single turn end-to-end ---

try {
  console.log('\n[1] single-turn smoke: ask claude to reply exactly "PING"');
  const events = [];
  const t1 = Date.now();
  const result = await sess.sendMessage(
    'Reply with exactly the word PING and nothing else.',
    { onEvent: (ev) => events.push(ev.type) },
  );
  const dur = Date.now() - t1;

  step('returned an AgentResult', !!result, `${dur}ms`);
  step('finalOutput includes PING', /PING/i.test(result.finalOutput || ''), `text=${JSON.stringify(result.finalOutput?.slice(0, 60) || '')}`);
  step('num_turns >= 1', (result.num_turns ?? 0) >= 1, `num_turns=${result.num_turns}`);
  step('total_cost_usd > 0', (result.total_cost_usd ?? 0) > 0, `cost=$${(result.total_cost_usd ?? 0).toFixed(6)}`);
  step('onEvent fired turn_complete', events.includes('turn_complete'));
  step('onEvent fired cost_record', events.includes('cost_record'));
  step('isAlive() true after turn', sess.isAlive());
} catch (e) {
  console.error('  ERR:', e.message);
  pass = false;
}

// --- Test 2: second turn reuses session ---

try {
  console.log('\n[2] multi-turn smoke: second prompt reuses live tmux session');
  const t2 = Date.now();
  const result = await sess.sendMessage(
    'What word did I just ask you to reply with? Answer with just the word.',
    {},
  );
  const dur = Date.now() - t2;
  step('second turn resolved', !!result, `${dur}ms`);
  step('claude remembered context (mentions PING)', /PING/i.test(result.finalOutput || ''));
} catch (e) {
  console.error('  ERR:', e.message);
  pass = false;
}

await cleanup();

const total = Date.now() - t0;
console.log(`\nResult: ${pass ? 'PASS' : 'FAIL'} (${total}ms total)`);
process.exit(pass ? 0 : 1);
