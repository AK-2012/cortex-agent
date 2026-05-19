// input:  Node test runner + agent-adapter/claude/tmux-control module
// output: TmuxControl pure-function argv + tempfile spec lock-down (DR-0012 Phase 1)
// pos:    Claude TUI adapter foundational utility regression tests
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { TmuxControl, type TmuxExecResult } from '../../src/agent-adapter/claude/tmux-control.js';

// --- Helpers ---

interface ExecCall {
  args: string[];
}

function makeMockExec(responses: Array<Partial<TmuxExecResult>>): { exec: (args: string[]) => TmuxExecResult; calls: ExecCall[] } {
  const calls: ExecCall[] = [];
  let i = 0;
  const exec = (args: string[]): TmuxExecResult => {
    calls.push({ args });
    const r = responses[i++] || {};
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? 0 };
  };
  return { exec, calls };
}

// --- hasSession ---

test('hasSession returns true when tmux has-session exits 0', () => {
  const { exec, calls } = makeMockExec([{ status: 0 }]);
  const t = new TmuxControl(exec);
  assert.equal(t.hasSession('cortex-claude-aaa'), true);
  assert.deepEqual(calls[0].args, ['has-session', '-t', 'cortex-claude-aaa']);
});

test('hasSession returns false when tmux has-session exits non-zero', () => {
  const { exec } = makeMockExec([{ status: 1, stderr: "can't find session" }]);
  const t = new TmuxControl(exec);
  assert.equal(t.hasSession('cortex-claude-bbb'), false);
});

// --- newSession ---

test('newSession builds detached argv with cwd and command', () => {
  const { exec, calls } = makeMockExec([{ status: 0 }]);
  const t = new TmuxControl(exec);
  t.newSession({
    name: 'cortex-claude-aaa',
    command: ['claude', '--session-id', 'uuid-1'],
    cwd: '/some/dir',
  });
  // Expected: tmux new-session -d -s <name> -c <cwd> -x 200 -y 50 -- <cmd...>
  assert.deepEqual(calls[0].args, [
    'new-session', '-d', '-s', 'cortex-claude-aaa',
    '-c', '/some/dir',
    '-x', '200', '-y', '50',
    '--',
    'claude', '--session-id', 'uuid-1',
  ]);
});

test('newSession honors custom dimensions and env vars (-e KEY=VAL)', () => {
  const { exec, calls } = makeMockExec([{ status: 0 }]);
  const t = new TmuxControl(exec);
  t.newSession({
    name: 'cortex-claude-aaa',
    command: ['claude'],
    cwd: '/tmp',
    env: { FOO: 'bar', BAZ: 'qux' },
    cols: 120,
    rows: 40,
  });
  const args = calls[0].args;
  assert.ok(args.includes('-x') && args[args.indexOf('-x') + 1] === '120');
  assert.ok(args.includes('-y') && args[args.indexOf('-y') + 1] === '40');
  // env keys come in as `-e KEY=VAL` pairs (order-stable from Object.entries)
  const eIdx = args.indexOf('-e');
  assert.ok(eIdx > -1, 'should include -e flag');
  // Each env var should produce one -e flag
  const envFlags = args.filter(a => a === '-e').length;
  assert.equal(envFlags, 2);
  assert.ok(args.includes('FOO=bar'));
  assert.ok(args.includes('BAZ=qux'));
});

test('newSession throws when tmux exits non-zero', () => {
  const { exec } = makeMockExec([{ status: 1, stderr: 'duplicate session' }]);
  const t = new TmuxControl(exec);
  assert.throws(
    () => t.newSession({ name: 'dup', command: ['claude'], cwd: '/tmp' }),
    /tmux new-session failed.*duplicate session/,
  );
});

// --- killSession ---

test('killSession builds correct argv and is idempotent on missing session', () => {
  const { exec, calls } = makeMockExec([{ status: 1, stderr: "can't find session" }]);
  const t = new TmuxControl(exec);
  // Idempotent: should NOT throw even if session is gone
  t.killSession('cortex-claude-aaa');
  assert.deepEqual(calls[0].args, ['kill-session', '-t', 'cortex-claude-aaa']);
});

// --- sendKeys ---

test('sendKeys passes -t and key tokens through verbatim', () => {
  const { exec, calls } = makeMockExec([{ status: 0 }]);
  const t = new TmuxControl(exec);
  t.sendKeys('cortex-claude-aaa', 'Escape');
  assert.deepEqual(calls[0].args, ['send-keys', '-t', 'cortex-claude-aaa', 'Escape']);

  const { exec: e2, calls: c2 } = makeMockExec([{ status: 0 }]);
  const t2 = new TmuxControl(e2);
  t2.sendKeys('foo', 'C-u');
  assert.deepEqual(c2[0].args, ['send-keys', '-t', 'foo', 'C-u']);
});

test('sendKeys with multiple keys joins them in one invocation', () => {
  const { exec, calls } = makeMockExec([{ status: 0 }]);
  const t = new TmuxControl(exec);
  t.sendKeys('foo', 'C-u', 'Enter');
  assert.deepEqual(calls[0].args, ['send-keys', '-t', 'foo', 'C-u', 'Enter']);
});

test('sendKeys with empty key list is a no-op (does not invoke tmux)', () => {
  const { exec, calls } = makeMockExec([]);
  const t = new TmuxControl(exec);
  t.sendKeys('foo');
  assert.equal(calls.length, 0);
});

// --- pasteText (load-buffer + paste-buffer) ---

test('pasteText writes a tempfile, loads it into buffer, pastes, and cleans up', async (tCtx) => {
  // Real tempfile path captured via mock exec — we'll inspect it before tmux pretends to consume it
  let observedTempfile: string | null = null;
  let observedContent: string | null = null;
  const exec = (args: string[]): TmuxExecResult => {
    if (args[0] === 'load-buffer') {
      // args: ['load-buffer', '-b', '<bufname>', <path>]
      const p = args[args.length - 1];
      observedTempfile = p;
      try { observedContent = fs.readFileSync(p, 'utf8'); } catch {}
    }
    return { stdout: '', stderr: '', status: 0 };
  };
  const t = new TmuxControl(exec);
  const text = 'hello\n你好\n`$\\"\'';
  t.pasteText('cortex-claude-aaa', text);

  assert.equal(observedContent, text, 'tempfile content must match input exactly');
  assert.ok(observedTempfile !== null);
  assert.ok(!fs.existsSync(observedTempfile!), 'tempfile should be deleted after paste');
});

test('pasteText invokes load-buffer with a named buffer, paste-buffer with -d to delete after paste', () => {
  const { exec, calls } = makeMockExec([
    { status: 0 }, // load-buffer
    { status: 0 }, // paste-buffer
  ]);
  const t = new TmuxControl(exec);
  t.pasteText('cortex-claude-aaa', 'hi');

  assert.equal(calls.length, 2);
  assert.equal(calls[0].args[0], 'load-buffer');
  // Buffer is named (so concurrent calls don't collide) and -t/target session present
  const loadArgs = calls[0].args;
  assert.ok(loadArgs.includes('-b'), 'load-buffer must use named buffer (-b)');
  assert.equal(calls[1].args[0], 'paste-buffer');
  assert.ok(calls[1].args.includes('-d'), 'paste-buffer must use -d to free buffer after paste');
  assert.ok(calls[1].args.includes('-t'), 'paste-buffer must target the session');
});

// --- capturePane ---

test('capturePane returns stdout', () => {
  const { exec, calls } = makeMockExec([{ stdout: 'line1\nline2\n', status: 0 }]);
  const t = new TmuxControl(exec);
  const out = t.capturePane('foo');
  assert.equal(out, 'line1\nline2\n');
  assert.deepEqual(calls[0].args, ['capture-pane', '-t', 'foo', '-p']);
});

// --- listSessions ---

test('listSessions parses tmux ls -F output and filters by prefix', () => {
  const { exec, calls } = makeMockExec([{
    stdout: 'cortex-claude-aaa\ncortex-claude-bbb\nother-session\nirrelevant\n',
    status: 0,
  }]);
  const t = new TmuxControl(exec);
  const names = t.listSessions('cortex-claude-');
  assert.deepEqual(names, ['cortex-claude-aaa', 'cortex-claude-bbb']);
  assert.deepEqual(calls[0].args, ['list-sessions', '-F', '#{session_name}']);
});

test('listSessions returns empty list when tmux server not running (status=1)', () => {
  const { exec } = makeMockExec([{ status: 1, stderr: 'no server running' }]);
  const t = new TmuxControl(exec);
  assert.deepEqual(t.listSessions(), []);
});

test('listSessions with no prefix returns all sessions', () => {
  const { exec } = makeMockExec([{
    stdout: 'a\nb\nc\n',
    status: 0,
  }]);
  const t = new TmuxControl(exec);
  assert.deepEqual(t.listSessions(), ['a', 'b', 'c']);
});
