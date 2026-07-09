import { describe, it, expect } from 'vitest';
import { en, zh } from './vocab';

describe('vocab en/zh parity', () => {
  it('en and zh expose the exact same key set', () => {
    const enKeys = Object.keys(en).sort();
    const zhKeys = Object.keys(zh).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it('has a non-trivial number of keys', () => {
    expect(Object.keys(en).length).toBeGreaterThanOrEqual(60);
  });

  it('every en value is a non-empty string', () => {
    for (const [k, v] of Object.entries(en)) {
      expect(typeof v, `en.${k}`).toBe('string');
      expect(v.length, `en.${k}`).toBeGreaterThan(0);
    }
  });

  it('every zh value is a non-empty string', () => {
    for (const [k, v] of Object.entries(zh)) {
      expect(typeof v, `zh.${k}`).toBe('string');
      expect(v.length, `zh.${k}`).toBeGreaterThan(0);
    }
  });

  it('carries the prototype dict() keys verbatim', () => {
    expect(en.newSession).toBe('New session');
    expect(zh.newSession).toBe('新会话');
    expect(en.composerPh).toBe('Message Cortex — type / for commands');
    expect(zh.tasks).toBe('任务');
  });

  it('carries the mobile bottom-tab labels (会话/线程/任务/机器)', () => {
    expect(en.sessions).toBe('Sessions');
    expect(zh.sessions).toBe('会话');
    expect(zh.threads).toBe('线程');
    expect(zh.machines).toBe('机器');
  });

  it('carries the status-pill labels', () => {
    expect(en.pillRunning).toBe('Running');
    expect(zh.pillRunning).toBe('运行中');
    expect(zh.pillWaiting).toBe('等待中');
    expect(zh.pillCancelled).toBe('已取消');
  });
});
