import { describe, it, expect } from 'vitest';
import { toolCallsLabel, SLASH_COMMANDS, REPRESENTATIVE_APPROVAL, DEFAULT_CHAT_PROFILE } from './chat-content';

describe('toolCallsLabel', () => {
  it('singular / plural', () => {
    expect(toolCallsLabel(1)).toBe('1 tool call');
    expect(toolCallsLabel(4)).toBe('4 tool calls');
  });
});

describe('SLASH_COMMANDS (verbatim from prototype)', () => {
  it('is the exact prototype command set', () => {
    expect(SLASH_COMMANDS.map((c) => c.cmd)).toEqual(['/dispatch', '/diff', '/devices', '/pause', '/status']);
    expect(SLASH_COMMANDS[0].desc).toBe('Dispatch a task to a remote machine');
  });
});

describe('REPRESENTATIVE_APPROVAL (Stage-5 GAP-B, flagged)', () => {
  it('is the prototype APR-0007 content', () => {
    expect(REPRESENTATIVE_APPROVAL.id).toBe('APR-0007');
    expect(REPRESENTATIVE_APPROVAL.tagText).toBe('Approval required');
    expect(REPRESENTATIVE_APPROVAL.title).toBe('Over-budget dispatch — 8×A100 ablation sweep');
    expect(REPRESENTATIVE_APPROVAL.desc).toBe('Estimated $12.40 vs $10.00 daily budget · requested by thr_8f2c');
  });
});

describe('DEFAULT_CHAT_PROFILE', () => {
  it('defaults to research (prototype chatProfile default)', () => {
    expect(DEFAULT_CHAT_PROFILE).toBe('research');
  });
});
