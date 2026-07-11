import { describe, it, expect } from 'vitest';
import { slashItemDispatch } from './composer-slash';
import { SLASH_COMMANDS } from './chat-content';

describe('slashItemDispatch (slash-menu run → real slash command)', () => {
  it('dispatches the command verbatim', () => {
    expect(slashItemDispatch('/dispatch')).toEqual({ text: '/dispatch' });
  });

  it('trims surrounding whitespace', () => {
    expect(slashItemDispatch('  /status ')).toEqual({ text: '/status' });
  });

  it('returns null for blank input', () => {
    expect(slashItemDispatch('')).toBeNull();
    expect(slashItemDispatch('   ')).toBeNull();
  });

  it('returns null for a non-slash input (defensive)', () => {
    expect(slashItemDispatch('hi')).toBeNull();
  });

  it('dispatches every menu command as its own real slash command (1:1 menu → dispatch)', () => {
    for (const c of SLASH_COMMANDS) {
      expect(slashItemDispatch(c.cmd)).toEqual({ text: c.cmd });
    }
  });
});
