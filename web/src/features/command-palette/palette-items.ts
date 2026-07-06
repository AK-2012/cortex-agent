import type { SessionInfo, ThreadInfo, TaskInfo } from '@cortex-agent/ui-contract';

// Pure mapping from the three real tRPC query results (sessions.list / threads.list /
// tasks.list) into flat, searchable command-palette items (design 6c). cmdk fuzzy-matches
// on the item's rendered text + `keywords`; the palette navigates via React Router to the
// entity's section route (detail routes are Stage 3/4 — see feature CORTEX.md), carrying the
// entity id in `focusId` so a future detail surface can consume it via location.state.

export type PaletteGroup = 'Sessions' | 'Threads' | 'Tasks';

export interface PaletteItem {
  /** Unique cmdk `value` (stable, collision-free across groups). */
  id: string;
  group: PaletteGroup;
  label: string;
  keywords: string[];
  route: string;
  focusId: string;
}

export interface PaletteSources {
  sessions: SessionInfo[];
  threads: ThreadInfo[];
  tasks: TaskInfo[];
}

export interface PaletteCommand {
  id: string;
  label: string;
  route: string;
  keywords: string[];
}

// Non-empty tokens only — cmdk keyword matching ignores empties but keep the list clean.
function tokens(...parts: (string | null | undefined)[]): string[] {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0);
}

export function buildPaletteItems({ sessions, threads, tasks }: PaletteSources): PaletteItem[] {
  const sessionItems: PaletteItem[] = sessions.map((s) => ({
    id: `session:${s.sessionId}`,
    group: 'Sessions',
    label: s.name || s.sessionId,
    keywords: tokens(s.sessionId, s.name, s.label, s.projectId, s.backend, s.kind),
    route: '/workbench',
    focusId: s.sessionId,
  }));

  const threadItems: PaletteItem[] = threads.map((t) => ({
    id: `thread:${t.id}`,
    group: 'Threads',
    label: `${t.id} · ${t.templateName}`,
    keywords: tokens(t.id, t.templateName, t.status, t.projectId),
    route: '/threads',
    focusId: t.id,
  }));

  const taskItems: PaletteItem[] = tasks.map((t) => ({
    id: `task:${t.id}`,
    group: 'Tasks',
    label: `${t.id} · ${t.text}`,
    keywords: tokens(t.id, t.text, t.project, t.status, t.priority),
    route: '/tasks',
    focusId: t.id,
  }));

  return [...sessionItems, ...threadItems, ...taskItems];
}

// Static navigation command items (design 6c "命令项"): jump to any app section.
export const NAV_COMMANDS: PaletteCommand[] = [
  { id: 'nav:workbench', label: 'Go to Workbench', route: '/workbench', keywords: ['home', 'chat'] },
  { id: 'nav:tasks', label: 'Go to Tasks', route: '/tasks', keywords: ['queue'] },
  { id: 'nav:threads', label: 'Go to Threads', route: '/threads', keywords: ['runs'] },
  { id: 'nav:overview', label: 'Go to Overview', route: '/overview', keywords: ['dashboard'] },
  { id: 'nav:settings', label: 'Go to Settings', route: '/settings', keywords: ['config'] },
  { id: 'nav:kit', label: 'Go to Kit', route: '/kit', keywords: ['components', 'design', 'demo'] },
];
