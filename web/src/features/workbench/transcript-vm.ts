import type { SessionTranscript, TranscriptMessage } from '@cortex-agent/ui-contract';

// Pure view-model for the workbench center-chat transcript (S4 chat, task aba0). Maps the real
// `sessions.transcript` DTO (+ a live `session.message` tail) into the prototype's exact message-row
// model (prototype.dc.html L145–356). Real data is the only variable — the render (MessageStream)
// owns every px/hex/font/copy; this module only decides which rows exist and what text they carry.

/** A live `session.message` event payload (the tRPC subscribe UiEvent.payload for that event). */
export interface LiveSessionMessage {
  sessionId: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  toolName?: string;
  toolInput?: string;
  ts: string;
}

export type ChatRow =
  | { kind: 'divider'; text: string }
  | { kind: 'user'; text: string }
  | { kind: 'tools'; count: number; calls: { kind: string; input: string }[] }
  | { kind: 'assistant'; text: string; streaming: boolean };

export interface BuildOpts {
  /** True while the session is actively producing output — marks the last assistant row's caret. */
  streaming?: boolean;
  /** Injected clock for deterministic day-relative divider labels (defaults to Date.now). */
  now?: Date;
  /**
   * Optional divider-label override (e.g. the mobile 5a screen's ZH 今天/昨天 dividers). Defaults to
   * the EN `dividerLabel` (TODAY / YESTERDAY / "MON D"). Receives the first message ts of the day.
   */
  formatDivider?: (ts: string, now: Date) => string;
}

/** Map a live `session.message` event into a `TranscriptMessage` (same shape the fetched DTO uses). */
export function liveToMessage(m: LiveSessionMessage): TranscriptMessage {
  const isTool = m.role === 'tool';
  return {
    type: m.role,
    text: isTool ? null : (m.text ?? ''),
    toolName: isTool ? (m.toolName ?? '') : null,
    toolInput: isTool ? (m.toolInput ?? '') : null,
    ts: m.ts,
  };
}

export function turnCount(transcript: SessionTranscript | undefined | null): number {
  return transcript?.turns.length ?? 0;
}

function msgKey(m: TranscriptMessage): string {
  return `${m.type}|${m.ts}|${m.text ?? ''}|${m.toolName ?? ''}|${m.toolInput ?? ''}`;
}

// Relative-day label matching the prototype divider vocabulary (TODAY / YESTERDAY / "MON D"),
// computed against the local calendar day. HH:MM is the local wall-clock of the first message.
function dividerLabel(ts: string, now: Date): string {
  const d = new Date(ts);
  const startOf = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDelta = Math.round((startOf(now) - startOf(d)) / 86400000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const time = `${hh}:${mm}`;
  if (dayDelta <= 0) return `TODAY ${time}`;
  if (dayDelta === 1) return `YESTERDAY ${time}`;
  const mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  return `${mon} ${d.getDate()} ${time}`;
}

function dayStamp(ts: string): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Build the ordered prototype chat-row list from the fetched transcript plus any live-tail events not
 * yet reflected in it. Consecutive tool messages collapse into one `tools` row; a `divider` is emitted
 * whenever the local calendar day changes (incl. before the first message); the last assistant row
 * carries the streaming caret when `opts.streaming` is set.
 */
export function buildTranscriptRows(
  transcript: SessionTranscript,
  liveTail: LiveSessionMessage[],
  opts: BuildOpts = {},
): ChatRow[] {
  const now = opts.now ?? new Date();

  const flat: TranscriptMessage[] = [];
  const seen = new Set<string>();
  const push = (m: TranscriptMessage): void => {
    const k = msgKey(m);
    if (seen.has(k)) return;
    seen.add(k);
    flat.push(m);
  };
  for (const turn of transcript.turns) for (const m of turn.messages) push(m);
  for (const lm of liveTail) push(liveToMessage(lm));

  const rows: ChatRow[] = [];
  let curDay: string | null = null;
  let toolBuf: { kind: string; input: string }[] = [];

  const flushTools = (): void => {
    if (toolBuf.length === 0) return;
    rows.push({ kind: 'tools', count: toolBuf.length, calls: toolBuf });
    toolBuf = [];
  };

  for (const m of flat) {
    const day = dayStamp(m.ts);
    if (day !== curDay) {
      flushTools();
      const label = opts.formatDivider ? opts.formatDivider(m.ts, now) : dividerLabel(m.ts, now);
      rows.push({ kind: 'divider', text: label });
      curDay = day;
    }
    if (m.type === 'tool') {
      toolBuf.push({ kind: m.toolName ?? '', input: m.toolInput ?? '' });
      continue;
    }
    flushTools();
    if (m.type === 'user') rows.push({ kind: 'user', text: m.text ?? '' });
    else rows.push({ kind: 'assistant', text: m.text ?? '', streaming: false });
  }
  flushTools();

  if (opts.streaming) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.kind === 'assistant') {
        rows[i] = { ...r, streaming: true };
        break;
      }
    }
  }

  return rows;
}
