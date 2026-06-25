// input:  protocol frame types (structural)
// output: Pure UI logic helpers for the M5 Ink client — focus zone, response-frame
//         detection, stream-text collection, visible-window computation
// pos:    Testable logic extracted out of React components/hooks

import type { TuiFrame } from '../platform/tui/protocol.js';

// ── Focus arbitration ──
// Only one zone owns the keyboard at a time. Modals pre-empt everything; an open
// dashboard side panel takes focus from the input box (resolves the key conflict
// where dashboard hotkeys would leak into the message input).

export type FocusZone = 'modal' | 'dashboard' | 'input';

export function computeFocusZone(opts: { modalOpen: boolean; sidePanelVisible: boolean }): FocusZone {
  if (opts.modalOpen) return 'modal';
  if (opts.sidePanelVisible) return 'dashboard';
  return 'input';
}

// ── Agent-response detection ──
// The M4 protocol has no explicit turn-end frame. The arrival of any agent reply
// or stream frame is the signal that the agent has started responding — used to
// re-enable sending and clear the queued counter.

const AGENT_RESPONSE_TYPES: ReadonlySet<string> = new Set([
  'chat.post',
  'chat.update',
  'interactive.post',
  'stream.text',
  'stream.mutableOpen',
  'stream.mutableUpdate',
  'transcript.replay',
]);

export function isAgentResponseFrame(frame: TuiFrame): boolean {
  return AGENT_RESPONSE_TYPES.has((frame as { type: string }).type);
}

// ── Stream text collection ──
// Concatenate a message's stream segments + mutable regions into a single string
// so streamed output renders as flowing text rather than one-line-per-chunk.

export interface StreamLike {
  segments: string[];
  mutable: Map<string, string>;
}

export function collectStreamText(streams: Map<string, StreamLike>): string {
  let out = '';
  for (const [, stream] of streams) {
    out += stream.segments.join('');
    for (const [, regionText] of stream.mutable) {
      out += regionText;
    }
  }
  return out;
}

// ── Visible window ──
// Bottom-anchored viewport over the transcript id list. scrollOffset counts
// messages scrolled up from the bottom (0 = pinned to bottom).

export function computeVisibleWindow(
  idsLength: number,
  visibleCount: number,
  scrollOffset: number,
): { start: number; end: number } {
  if (idsLength <= 0) return { start: 0, end: 0 };
  const maxOffset = Math.max(0, idsLength - 1);
  const effectiveOffset = Math.min(Math.max(0, scrollOffset), maxOffset);
  const end = idsLength - effectiveOffset;
  const start = Math.max(0, end - Math.max(1, visibleCount));
  return { start, end };
}

// ── Focus-centered window ──
// A bounded viewport over a navigable list that always keeps the focused row visible.
// Dashboard tabs render every item by default, so a long list (schedules / executions)
// overflows the terminal — and Ink cannot clear lines that scrolled past the top, leaving
// permanent ghost rows. Capping the rendered slice fixes both the overflow and the
// corruption. Returns absolute [start, end) indices plus how many rows are hidden on each
// side (for "↑ N more" / "↓ N more" affordances).

export function computeFocusWindow(
  total: number,
  focusedIndex: number,
  maxVisible: number,
): { start: number; end: number; hiddenAbove: number; hiddenBelow: number } {
  if (total <= 0) return { start: 0, end: 0, hiddenAbove: 0, hiddenBelow: 0 };
  const cap = Math.max(1, maxVisible);
  if (total <= cap) return { start: 0, end: total, hiddenAbove: 0, hiddenBelow: 0 };

  const focus = Math.min(Math.max(0, focusedIndex), total - 1);
  // Center the focused row in the window, then clamp to the list bounds.
  let start = focus - Math.floor(cap / 2);
  start = Math.max(0, Math.min(start, total - cap));
  const end = start + cap;
  return { start, end, hiddenAbove: start, hiddenBelow: total - end };
}
