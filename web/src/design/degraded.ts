// Degraded / exception status language (design §5, design 10c).
// The four degraded variants (rate-limit throttle · backend fallback · machine
// offline · over-budget pause) share one color language, collapsed onto three
// severities that map to the already-token-defined pill tones (see ./tone.ts):
//   琥珀 amber = waiting  (auto-paused, awaits window reset / approval)
//   红   red   = human    (needs human attention — lost exec, offline machine)
//   蓝   blue  = info     (transient in-step note, e.g. backend fallback — non-blocking)

import type { Tone } from './tone';

export const DEGRADED_SEVERITIES = ['waiting', 'human', 'info'] as const;

export type DegradedSeverity = (typeof DEGRADED_SEVERITIES)[number];

const SEVERITY_TONE: Record<DegradedSeverity, Tone> = {
  waiting: 'waiting',
  human: 'failed',
  info: 'running',
};

export function severityTone(severity: DegradedSeverity): Tone {
  return SEVERITY_TONE[severity];
}
