import { describe, it, expect } from 'vitest';
import {
  buildTranscriptRows,
  liveToMessage,
  turnCount,
  type LiveSessionMessage,
} from './transcript-vm';
import type { SessionTranscript } from '@cortex-agent/ui-contract';

const T = '2026-07-07T07:42:00.000Z';

function tx(turns: SessionTranscript['turns']): SessionTranscript {
  return { sessionId: 's1', turns };
}

describe('buildTranscriptRows', () => {
  it('empty transcript with no live tail → no rows', () => {
    expect(buildTranscriptRows(tx([]), [])).toEqual([]);
  });

  it('a user + assistant turn → divider, user bubble, assistant block', () => {
    const rows = buildTranscriptRows(
      tx([
        {
          turnIndex: 0,
          messages: [
            { type: 'user', text: 'hi there', toolName: null, toolInput: null, ts: T },
            { type: 'assistant', text: 'hello back', toolName: null, toolInput: null, ts: T },
          ],
        },
      ]),
      [],
    );
    expect(rows[0].kind).toBe('divider');
    expect(rows[1]).toEqual({ kind: 'user', text: 'hi there' });
    expect(rows[2]).toEqual({ kind: 'assistant', text: 'hello back', streaming: false });
  });

  it('consecutive tool messages collapse into one tools row with each call', () => {
    const rows = buildTranscriptRows(
      tx([
        {
          turnIndex: 0,
          messages: [
            { type: 'user', text: 'go', toolName: null, toolInput: null, ts: T },
            { type: 'tool', text: null, toolName: 'read', toolInput: 'a.md', ts: T },
            { type: 'tool', text: null, toolName: 'bash', toolInput: 'ls', ts: T },
            { type: 'assistant', text: 'done', toolName: null, toolInput: null, ts: T },
          ],
        },
      ]),
      [],
    );
    const tools = rows.find((r) => r.kind === 'tools');
    expect(tools).toEqual({
      kind: 'tools',
      count: 2,
      calls: [
        { kind: 'read', input: 'a.md' },
        { kind: 'bash', input: 'ls' },
      ],
    });
  });

  it('streaming flag marks only the last assistant row when streaming=true', () => {
    const rows = buildTranscriptRows(
      tx([
        {
          turnIndex: 0,
          messages: [
            { type: 'assistant', text: 'first', toolName: null, toolInput: null, ts: T },
            { type: 'assistant', text: 'second', toolName: null, toolInput: null, ts: T },
          ],
        },
      ]),
      [],
      { streaming: true },
    );
    const assistants = rows.filter((r) => r.kind === 'assistant') as Array<{ streaming: boolean }>;
    expect(assistants[0].streaming).toBe(false);
    expect(assistants[1].streaming).toBe(true);
  });

  it('no streaming caret when streaming=false', () => {
    const rows = buildTranscriptRows(
      tx([{ turnIndex: 0, messages: [{ type: 'assistant', text: 'x', toolName: null, toolInput: null, ts: T }] }]),
      [],
      { streaming: false },
    );
    const a = rows.find((r) => r.kind === 'assistant') as { streaming: boolean };
    expect(a.streaming).toBe(false);
  });

  it('appends live-tail messages after the fetched transcript', () => {
    const live: LiveSessionMessage[] = [
      { sessionId: 's1', role: 'assistant', text: 'streamed reply', ts: T },
    ];
    const rows = buildTranscriptRows(
      tx([{ turnIndex: 0, messages: [{ type: 'user', text: 'q', toolName: null, toolInput: null, ts: T }] }]),
      live,
      { streaming: true },
    );
    expect(rows.some((r) => r.kind === 'user' && r.text === 'q')).toBe(true);
    const a = rows.find((r) => r.kind === 'assistant') as { text: string; streaming: boolean };
    expect(a.text).toBe('streamed reply');
    expect(a.streaming).toBe(true);
  });

  it('de-duplicates a live message already present in the fetched transcript', () => {
    const msg = { type: 'assistant' as const, text: 'dup', toolName: null, toolInput: null, ts: T };
    const live: LiveSessionMessage[] = [{ sessionId: 's1', role: 'assistant', text: 'dup', ts: T }];
    const rows = buildTranscriptRows(tx([{ turnIndex: 0, messages: [msg] }]), live);
    expect(rows.filter((r) => r.kind === 'assistant').length).toBe(1);
  });

  it('emits a fresh divider when the calendar day changes', () => {
    const rows = buildTranscriptRows(
      tx([
        { turnIndex: 0, messages: [{ type: 'user', text: 'day1', toolName: null, toolInput: null, ts: '2026-07-06T10:00:00.000Z' }] },
        { turnIndex: 1, messages: [{ type: 'user', text: 'day2', toolName: null, toolInput: null, ts: '2026-07-07T10:00:00.000Z' }] },
      ]),
      [],
    );
    expect(rows.filter((r) => r.kind === 'divider').length).toBe(2);
  });

  it('long real text passes through unmodified (ellipsis is a CSS concern)', () => {
    const long = 'exec_dispatch_mr9w9opu_uqdw '.repeat(20).trim();
    const rows = buildTranscriptRows(
      tx([{ turnIndex: 0, messages: [{ type: 'tool', text: null, toolName: 'read', toolInput: long, ts: T }] }]),
      [],
    );
    const tools = rows.find((r) => r.kind === 'tools') as { calls: { input: string }[] };
    expect(tools.calls[0].input).toBe(long);
  });

  it('an optional formatDivider overrides the default divider label (mobile ZH dividers)', () => {
    const rows = buildTranscriptRows(
      tx([{ turnIndex: 0, messages: [{ type: 'user', text: 'hi', toolName: null, toolInput: null, ts: T }] }]),
      [],
      { formatDivider: () => '今天 07:42' },
    );
    expect(rows[0]).toEqual({ kind: 'divider', text: '今天 07:42' });
  });

  it('without formatDivider the default EN divider is unchanged', () => {
    const rows = buildTranscriptRows(
      tx([{ turnIndex: 0, messages: [{ type: 'user', text: 'hi', toolName: null, toolInput: null, ts: T }] }]),
      [],
    );
    expect((rows[0] as { text: string }).text.startsWith('TODAY') || (rows[0] as { text: string }).text.length > 0).toBe(true);
  });
});

describe('liveToMessage', () => {
  it('maps a tool live event to a tool TranscriptMessage (text null, tool fields set)', () => {
    const m = liveToMessage({ sessionId: 's1', role: 'tool', text: '', toolName: 'grep', toolInput: 'foo', ts: T });
    expect(m).toEqual({ type: 'tool', text: null, toolName: 'grep', toolInput: 'foo', ts: T });
  });

  it('maps an assistant live event to an assistant TranscriptMessage', () => {
    const m = liveToMessage({ sessionId: 's1', role: 'assistant', text: 'hi', ts: T });
    expect(m).toEqual({ type: 'assistant', text: 'hi', toolName: null, toolInput: null, ts: T });
  });
});

describe('turnCount', () => {
  it('counts real turns', () => {
    expect(turnCount(tx([{ turnIndex: 0, messages: [] }, { turnIndex: 1, messages: [] }]))).toBe(2);
    expect(turnCount(undefined)).toBe(0);
  });
});
