// Pure mapper: ThreadDetail (threads.get, B1) → the prototype inline-thread-card row model
// (prototype.dc.html L180–246). Frame-work-free so it is unit-tested in isolation (TDD). The card
// is the ONE live-data surface in the center chat; it renders whatever the real DTO carries
// (data-driven, not stage-name-string matched — same discipline as features/thread/thread-steps.ts).

import type {
  ThreadDetail,
  ThreadStepDetail,
  ThreadChildNode,
  ThreadInfo,
} from '@cortex-agent/ui-contract';

export interface ProtoPill {
  bg: string;
  color: string;
  text: string;
}

/** Thread status → the prototype status-pill pair + word (prototype pill(), L1838–1849). */
export function threadPill(status: ThreadInfo['status']): ProtoPill {
  switch (status) {
    case 'running':
      return { bg: '#EEF0FA', color: '#4655D4', text: 'Running' };
    case 'waiting':
      return { bg: '#F7ECCE', color: '#8A5B06', text: 'Waiting' };
    case 'completed':
      return { bg: '#E9F4EE', color: '#23854F', text: 'Done' };
    case 'failed':
      return { bg: '#FBEDEB', color: '#C03D33', text: 'Failed' };
    default:
      return { bg: '#F1F2F5', color: '#8A93A2', text: 'Cancelled' };
  }
}

export interface ProtoNested {
  name: string;
  level: string;
  running: boolean;
  meta: string;
}

export interface ProtoSub {
  name: string;
  level: string;
  chev: string;
  border: string;
  bg: string;
  iconColor: string;
  nameColor: string;
  pillBg: string;
  pillColor: string;
  pillText: string;
  hasLine: boolean;
  line: string;
  meta: string;
  nested: ProtoNested | null;
}

export interface ProtoRow {
  node: 'done' | 'running' | 'pending';
  hasTail: boolean;
  padB: string;
  name: string;
  fw: number;
  color: string;
  sub: string;
  subColor: string;
  meta: string;
  metaColor: string;
  chev: boolean;
  expanded: boolean;
  subs: ProtoSub[];
}

export interface ProtoCard {
  id: string;
  name: string;
  pill: ProtoPill;
  pillText: string;
  meta: string;
  rows: ProtoRow[];
}

function formatDuration(durationS: number): string {
  const total = Math.round(durationS);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/** display level: root children = L2, grandchildren = L3 (prototype uses L2/L3). */
function childLevel(depth: number): string {
  return 'L' + (depth + 2);
}

/** collapsed step meta: "3m · $0.04" from real duration/cost (both optional). */
function stepMeta(step: ThreadStepDetail): string {
  const parts: string[] = [];
  if (step.durationS != null) parts.push(formatDuration(step.durationS));
  if (step.costUsd != null) parts.push('$' + step.costUsd.toFixed(2));
  return parts.join(' · ');
}

function mapNested(node: ThreadChildNode): ProtoNested | null {
  const first = node.children[0];
  if (!first) return null;
  return {
    name: first.templateName ?? first.id,
    level: childLevel(first.depth),
    running: first.status === 'running',
    meta: first.status === 'running' ? 'running' : 'done',
  };
}

function mapSub(node: ThreadChildNode): ProtoSub {
  const running = node.status === 'running';
  const pill = threadPill(node.status);
  const nested = mapNested(node);
  return {
    name: node.templateName ?? node.id,
    level: childLevel(node.depth),
    chev: running ? '▾' : '▸',
    border: running ? '#E3E6F5' : '#EFF1F5',
    bg: running ? '#FBFBFE' : '#FBFBFC',
    iconColor: running ? '#4655D4' : '#8A93A2',
    nameColor: running ? '#191C22' : '#5B6472',
    pillBg: pill.bg,
    pillColor: pill.color,
    pillText: running ? 'Running' : pill.text,
    hasLine: nested != null,
    line: node.activeAgent ?? '',
    meta: node.costUsd ? '$' + node.costUsd.toFixed(2) : '',
    nested,
  };
}

/**
 * Build the prototype card model from a live ThreadDetail. Each step → a vertical row; only the
 * running (active) step expands its children (subthreads). Completed rows collapse to one line with
 * a chevron; pending rows show the empty ring node.
 */
export function buildThreadCard(detail: ThreadDetail): ProtoCard {
  const steps = detail.steps;
  const rows: ProtoRow[] = steps.map((step, i) => {
    const node: ProtoRow['node'] =
      step.status === 'completed' ? 'done' : step.status === 'running' ? 'running' : 'pending';
    const running = node === 'running';
    const done = node === 'done';
    const subs = running ? detail.children.map(mapSub) : [];
    const hasTail = i < steps.length - 1;
    return {
      node,
      hasTail,
      padB: hasTail ? '8px' : '2px',
      name: step.stage ?? `Step ${step.stepIndex + 1}`,
      fw: running ? 600 : 500,
      color: running ? '#191C22' : done ? '#5B6472' : '#B6BDC9',
      sub: running ? (detail.activeStage ?? '') : (step.outputSummary ?? ''),
      subColor: running ? '#98A1B0' : '#B6BDC9',
      meta: running ? stepMeta(step) || 'running' : done ? stepMeta(step) : 'gated',
      metaColor: running ? '#4655D4' : done ? '#B6BDC9' : '#D9DCE3',
      chev: done,
      expanded: running,
      subs,
    };
  });

  const pill = threadPill(detail.status);
  const pillText =
    detail.status === 'running' && detail.currentStep
      ? `Step ${detail.currentStep.index + 1}/${detail.totalSteps}`
      : pill.text;

  return {
    id: detail.id,
    name: detail.templateName,
    pill,
    pillText,
    meta: '$' + detail.totalCostUsd.toFixed(2),
    rows,
  };
}
