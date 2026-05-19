// Unit tests for cortex-run-watcher.ts
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  parseDuration,
  pickBestGpu,
  checkStallConditions,
  writeStateFile,
  computeResult,
  killProcessGroup,
} from './cortex-run-watcher.js';

// --- parseDuration ---

describe('parseDuration', () => {
  it('parses minutes', () => {
    assert.strictEqual(parseDuration('10m'), 600);
    assert.strictEqual(parseDuration('0m'), 0);
    assert.strictEqual(parseDuration('1m'), 60);
  });

  it('parses hours', () => {
    assert.strictEqual(parseDuration('1h'), 3600);
    assert.strictEqual(parseDuration('2h'), 7200);
    assert.strictEqual(parseDuration('0h'), 0);
  });

  it('parses seconds', () => {
    assert.strictEqual(parseDuration('30s'), 30);
    assert.strictEqual(parseDuration('0s'), 0);
  });

  it('parses days', () => {
    assert.strictEqual(parseDuration('1d'), 86400);
    assert.strictEqual(parseDuration('7d'), 604800);
  });

  it('parses bare numbers as seconds', () => {
    assert.strictEqual(parseDuration('300'), 300);
    assert.strictEqual(parseDuration('0'), 0);
  });

  it('handles whitespace', () => {
    assert.strictEqual(parseDuration('  10m  '), 600);
  });

  it('returns NaN for invalid input', () => {
    assert.ok(isNaN(parseDuration('xyz')));
    assert.ok(isNaN(parseDuration('')));

  });
});

// --- pickBestGpu ---

describe('pickBestGpu', () => {
  it('picks GPU with lowest memory usage', () => {
    const mockSpawn = ((() => ({
      status: 0,
      stdout: '0, 1024\n1, 512\n2, 2048\n',
      stderr: '',
      pid: 0,
      output: [],
      signal: null,
      error: undefined,
    })) as unknown) as typeof spawnSync;

    assert.strictEqual(pickBestGpu(mockSpawn), '1');
  });

  it('returns null when nvidia-smi fails', () => {
    const mockSpawn = ((() => ({
      status: 1,
      stdout: '',
      stderr: '',
      pid: 0,
      output: [],
      signal: null,
      error: undefined,
    })) as unknown) as typeof spawnSync;

    assert.strictEqual(pickBestGpu(mockSpawn), null);
  });

  it('returns null on empty GPU list', () => {
    const mockSpawn = ((() => ({
      status: 0,
      stdout: '',
      stderr: '',
      pid: 0,
      output: [],
      signal: null,
      error: undefined,
    })) as unknown) as typeof spawnSync;

    assert.strictEqual(pickBestGpu(mockSpawn), null);
  });

  it('returns null when spawn throws', () => {
    const mockSpawn = (() => { throw new Error('nvidia-smi not found'); }) as unknown as typeof spawnSync;
    assert.strictEqual(pickBestGpu(mockSpawn), null);
  });

  it('handles single GPU', () => {
    const mockSpawn = ((() => ({
      status: 0,
      stdout: '0, 256\n',
      stderr: '',
      pid: 0,
      output: [],
      signal: null,
      error: undefined,
    })) as unknown) as typeof spawnSync;

    assert.strictEqual(pickBestGpu(mockSpawn), '0');
  });

  it('picks first GPU when memory is tied', () => {
    const mockSpawn = ((() => ({
      status: 0,
      stdout: '0, 1024\n1, 1024\n',
      stderr: '',
      pid: 0,
      output: [],
      signal: null,
      error: undefined,
    })) as unknown) as typeof spawnSync;

    assert.strictEqual(pickBestGpu(mockSpawn), '0');
  });
});

// --- checkStallConditions ---

describe('checkStallConditions', () => {
  const stallMs = 600_000; // 10 minutes

  it('returns null when within output stall window', () => {
    const now = Date.now();
    const result = checkStallConditions(now - 60_000, now - 60_000, now, stallMs, 'hello');
    assert.strictEqual(result, null);
  });

  it('returns output_stall when past output stall window', () => {
    const now = Date.now();
    const result = checkStallConditions(now - 700_000, now - 700_000, now, stallMs, 'hello');
    assert.strictEqual(result, 'output_stall');
  });

  it('returns null when output flowing and line changed', () => {
    const now = Date.now();
    const result = checkStallConditions(now - 60_000, now - 60_000, now, stallMs, 'new line');
    assert.strictEqual(result, null);
  });

  it('returns progress_stall when line stuck past stall window', () => {
    const now = Date.now();
    const result = checkStallConditions(now - 60_000, now - 700_000, now, stallMs, 'stuck line');
    assert.strictEqual(result, 'progress_stall');
  });

  it('returns null for progress check when no lastLineContent', () => {
    const now = Date.now();
    // Output flowing (within output window) but no lastLineContent yet
    const result = checkStallConditions(now - 60_000, now - 700_000, now, stallMs, '');
    assert.strictEqual(result, null);
  });

  it('prefers output_stall over progress_stall when both triggered', () => {
    const now = Date.now();
    // Both output and progress are past stall window
    const result = checkStallConditions(now - 700_000, now - 700_000, now, stallMs, 'stuck');
    // Output stall is checked first
    assert.strictEqual(result, 'output_stall');
  });

  it('returns null at exact boundary', () => {
    const now = Date.now();
    const result = checkStallConditions(now - 600_000, now - 600_000, now, 600_000, 'line');
    assert.strictEqual(result, null);
  });

  it('returns output_stall just past boundary', () => {
    const now = Date.now();
    const result = checkStallConditions(now - 600_001, now - 600_001, now, 600_000, 'line');
    assert.strictEqual(result, 'output_stall');
  });
});

// --- writeStateFile ---

describe('writeStateFile', () => {
  it('writes state.json with running status', () => {
    const tmpDir = mkdtempSync('cortex-watcher-test-');
    try {
      writeStateFile(tmpDir, {
        status: 'running',
        pid: 42,
        started_at: '2026-01-01T00:00:00.000Z',
      });

      const content = JSON.parse(readFileSync(join(tmpDir, 'state.json'), 'utf8'));
      assert.strictEqual(content.status, 'running');
      assert.strictEqual(content.pid, 42);
      assert.strictEqual(content.started_at, '2026-01-01T00:00:00.000Z');
      assert.strictEqual(content.ended_at, undefined);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('writes state.json with completed status and all fields', () => {
    const tmpDir = mkdtempSync('cortex-watcher-test-');
    try {
      writeStateFile(tmpDir, {
        status: 'completed',
        pid: 42,
        started_at: '2026-01-01T00:00:00.000Z',
        ended_at: '2026-01-01T01:00:00.000Z',
        exit_code: 0,
        termination: 'completed',
      });

      const content = JSON.parse(readFileSync(join(tmpDir, 'state.json'), 'utf8'));
      assert.strictEqual(content.status, 'completed');
      assert.strictEqual(content.exit_code, 0);
      assert.strictEqual(content.termination, 'completed');
      assert.strictEqual(content.ended_at, '2026-01-01T01:00:00.000Z');
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('writes state.json with failed status', () => {
    const tmpDir = mkdtempSync('cortex-watcher-test-');
    try {
      writeStateFile(tmpDir, {
        status: 'failed',
        pid: 42,
        started_at: '2026-01-01T00:00:00.000Z',
        ended_at: '2026-01-01T00:30:00.000Z',
        exit_code: 1,
        termination: 'output_stall',
      });

      const content = JSON.parse(readFileSync(join(tmpDir, 'state.json'), 'utf8'));
      assert.strictEqual(content.status, 'failed');
      assert.strictEqual(content.exit_code, 1);
      assert.strictEqual(content.termination, 'output_stall');
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('is idempotent on retry', () => {
    const tmpDir = mkdtempSync('cortex-watcher-test-');
    try {
      writeStateFile(tmpDir, { status: 'running', pid: 1, started_at: '2026-01-01T00:00:00.000Z' });
      writeStateFile(tmpDir, { status: 'running', pid: 1, started_at: '2026-01-01T00:00:00.000Z' });

      const content = JSON.parse(readFileSync(join(tmpDir, 'state.json'), 'utf8'));
      assert.strictEqual(content.status, 'running');
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});

// --- computeResult ---

describe('computeResult', () => {
  it('produces correct result shape for short run', () => {
    const result = computeResult(
      'test-run',
      ['echo', 'hello'],
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:05:00.000Z',
      0,
      'completed',
      'hello world',
      '/tmp/test-run/output.log',
      '10m',
    );

    assert.strictEqual(result.name, 'test-run');
    assert.deepStrictEqual(result.command, ['echo', 'hello']);
    assert.strictEqual(result.exit_code, 0);
    assert.strictEqual(result.termination, 'completed');
    assert.strictEqual(result.duration_seconds, 300);
    assert.strictEqual(result.duration_human, '5m');
    assert.strictEqual(result.last_output_line, 'hello world');
    assert.strictEqual(result.log_file, '/tmp/test-run/output.log');
    assert.strictEqual(result.stall_limit, '10m');
  });

  it('produces duration_human in hours for long runs', () => {
    const result = computeResult(
      'long-run',
      ['python', 'train.py'],
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T03:30:00.000Z',
      0,
      'completed',
      'done',
      '/tmp/long-run/output.log',
      '30m',
    );

    assert.strictEqual(result.duration_human, '3.5h');
    assert.strictEqual(result.duration_seconds, 12600);
  });

  it('includes termination output_stall', () => {
    const result = computeResult(
      'stall-run',
      ['sleep', '100'],
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:10:00.000Z',
      -1,
      'output_stall',
      'last line',
      '/tmp/stall-run/output.log',
      '5m',
    );

    assert.strictEqual(result.termination, 'output_stall');
    assert.strictEqual(result.exit_code, -1);
  });

  it('truncates last_output_line to 500 chars', () => {
    const longLine = 'x'.repeat(1000);
    const result = computeResult(
      'truncate-test',
      ['echo'],
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:01:00.000Z',
      0,
      'completed',
      longLine,
      '/tmp/test/output.log',
      '10m',
    );

    assert.strictEqual(result.last_output_line.length, 500);
  });
});

// --- killProcessGroup ---

describe('killProcessGroup', () => {
  it('calls process.kill with negative pid and SIGTERM', () => {
    const mockKill = mock.method(process, 'kill', () => {});

    try {
      killProcessGroup(12345);

      assert.strictEqual(mockKill.mock.callCount(), 1);
      const args = mockKill.mock.calls[0].arguments;
      assert.strictEqual(args[0], -12345);
      assert.strictEqual(args[1], 'SIGTERM');
    } finally {
      mockKill.mock.restore();
    }
  });

  it('does not throw when kill fails (process already gone)', () => {
    const mockKill = mock.method(process, 'kill', () => {
      throw new Error('ESRCH: no such process');
    });

    try {
      // Should not throw
      killProcessGroup(99999);
      // SIGTERM was attempted — we know the mock was called
      assert.strictEqual(mockKill.mock.callCount(), 1);
    } finally {
      mockKill.mock.restore();
    }
  });
});

// --- Integration: signal handler structure (lightweight) ---

describe('signal handler registration', () => {
  it('cortex-run-watcher module exports all expected functions', () => {
    // Verify all exported functions exist and are callable
    assert.strictEqual(typeof parseDuration, 'function');
    assert.strictEqual(typeof pickBestGpu, 'function');
    assert.strictEqual(typeof checkStallConditions, 'function');
    assert.strictEqual(typeof writeStateFile, 'function');
    assert.strictEqual(typeof computeResult, 'function');
    assert.strictEqual(typeof killProcessGroup, 'function');
  });
});
