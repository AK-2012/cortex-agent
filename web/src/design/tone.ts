// Status → visual tone mapping for the token pill palette (design §5).
// The ui-service contract emits several status vocabularies (thread / task / execution);
// all collapse onto the five pill tones defined in tailwind.config.ts.

export const TONES = ['running', 'waiting', 'done', 'failed', 'cancelled'] as const;

export type Tone = (typeof TONES)[number];

const STATUS_TONE: Record<string, Tone> = {
  running: 'running',
  open: 'running',
  waiting: 'waiting',
  completed: 'done',
  done: 'done',
  failed: 'failed',
  aborted: 'failed',
  cancelled: 'cancelled',
  stale: 'cancelled',
};

export function statusTone(status: string): Tone {
  return STATUS_TONE[status.toLowerCase()] ?? 'cancelled';
}
