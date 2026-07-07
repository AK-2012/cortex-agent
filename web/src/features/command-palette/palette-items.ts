import type { SessionInfo, ThreadInfo, TaskInfo } from '@cortex-agent/ui-contract';

// Pure mapping from the three real tRPC query results (sessions.list / threads.list /
// tasks.list) into the prototype's ⌘K flat-row item model (prototype.dc.html L1304–1311 +
// the `allCmdk` demo shape L2489–2499). Each row = glyph badge + label + sub + right-aligned
// kbd tag; the palette navigates via React Router. §8.3: the row structure is 1:1 with the
// prototype, real entities are the only variable. Threads route to their detail page
// `/threads/:id` (F2); sessions/tasks target their section route (detail surfaces are Stage 4/5),
// carrying the entity id in `focusId`.

export type CmdkKind = 'session' | 'thread' | 'task';

export interface CmdkItem {
  /** Unique cmdk `value` (stable, collision-free across kinds). */
  id: string;
  /** 2-letter mono badge — SE / TH / TK. */
  glyph: string;
  label: string;
  sub: string;
  /** Right-aligned mono type tag — session / thread / task. */
  kbd: string;
  route: string;
  focusId: string;
  keywords: string[];
}

export interface CmdkSources {
  sessions: SessionInfo[];
  threads: ThreadInfo[];
  tasks: TaskInfo[];
}

export interface CmdkCommand {
  id: string;
  glyph: string;
  label: string;
  sub: string;
  kbd: string;
  route: string;
  keywords: string[];
}

// A rendered palette row — nav command or entity, unified for display + selection.
export interface PaletteRow {
  id: string;
  glyph: string;
  label: string;
  sub: string;
  kbd: string;
  route: string;
  focusId?: string;
  keywords: string[];
}

export interface SelectOptions {
  /** Max entity rows per kind shown when the query is empty (keeps the DOM small). */
  restPerKind?: number;
  /** Max total rows shown while searching. */
  matchCap?: number;
}

// Non-empty tokens only — cmdk keyword matching ignores empties but keep the list clean.
function tokens(...parts: (string | null | undefined)[]): string[] {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0);
}

export function buildCmdkItems({ sessions, threads, tasks }: CmdkSources): CmdkItem[] {
  const sessionItems: CmdkItem[] = sessions.map((s) => ({
    id: `session:${s.sessionId}`,
    glyph: 'SE',
    label: s.name || s.sessionId,
    sub: s.projectId,
    kbd: 'session',
    route: '/workbench',
    focusId: s.sessionId,
    keywords: tokens(s.sessionId, s.name, s.label, s.projectId, s.backend, s.kind),
  }));

  const threadItems: CmdkItem[] = threads.map((t) => ({
    id: `thread:${t.id}`,
    glyph: 'TH',
    label: t.templateName,
    sub: t.id,
    kbd: 'thread',
    route: `/threads/${t.id}`,
    focusId: t.id,
    keywords: tokens(t.id, t.templateName, t.status, t.projectId),
  }));

  const taskItems: CmdkItem[] = tasks.map((t) => ({
    id: `task:${t.id}`,
    glyph: 'TK',
    label: t.text,
    sub: `${t.id} · ${t.project}`,
    kbd: 'task',
    route: '/tasks',
    focusId: t.id,
    keywords: tokens(t.id, t.text, t.project, t.status, t.priority),
  }));

  return [...sessionItems, ...threadItems, ...taskItems];
}

// Static navigation command rows (prototype OV/ST legs + section jumps). The prototype also lists
// Approvals + New schedule, but those are modal overlays not yet built (Stage R2+, plan §8.6) —
// deferred here (no route to jump to), same class as the file-search deferral (no fs-read scope,
// Stage 6). Settings sub-copy is verbatim from the prototype (L2496).
export const NAV_COMMAND_ITEMS: CmdkCommand[] = [
  {
    id: 'nav:overview',
    glyph: 'OV',
    label: 'Overview',
    sub: 'project dashboard',
    kbd: 'page',
    route: '/overview',
    keywords: ['dashboard'],
  },
  {
    id: 'nav:workbench',
    glyph: 'WB',
    label: 'Workbench',
    sub: 'session chat',
    kbd: 'page',
    route: '/workbench',
    keywords: ['home', 'chat'],
  },
  {
    id: 'nav:tasks',
    glyph: 'TK',
    label: 'Tasks',
    sub: 'task queue',
    kbd: 'page',
    route: '/tasks',
    keywords: ['queue'],
  },
  {
    id: 'nav:threads',
    glyph: 'TH',
    label: 'Threads',
    sub: 'thread runs',
    kbd: 'page',
    route: '/threads',
    keywords: ['runs'],
  },
  {
    id: 'nav:settings',
    glyph: 'ST',
    label: 'Settings',
    sub: 'platform · profiles · budget · machines…',
    kbd: 'modal',
    route: '/settings',
    keywords: ['config'],
  },
];

function commandToRow(c: CmdkCommand): PaletteRow {
  return { id: c.id, glyph: c.glyph, label: c.label, sub: c.sub, kbd: c.kbd, route: c.route, keywords: c.keywords };
}

// Prototype substring filter (prototype.dc.html L2498: `(label+' '+sub).indexOf(q)`), extended to
// keywords so an id/status also matches. We do the filtering ourselves (cmdk `shouldFilter={false}`)
// so we can CAP the rendered rows — feeding cmdk hundreds of real entities blows up the DOM and
// stalls the shared httpBatchLink fetch. Empty query → nav commands + a few recent entities per
// kind (proto-shot shows a short populated list); typing → all matches (nav + entities), capped.
export function selectPaletteRows(
  query: string,
  sources: CmdkSources,
  opts: SelectOptions = {},
): PaletteRow[] {
  const restPerKind = opts.restPerKind ?? 5;
  const matchCap = opts.matchCap ?? 50;
  const nav = NAV_COMMAND_ITEMS.map(commandToRow);
  const entities = buildCmdkItems(sources);
  const q = query.trim().toLowerCase();

  if (!q) {
    const byKind = (glyph: string) => entities.filter((e) => e.glyph === glyph).slice(0, restPerKind);
    return [...nav, ...byKind('SE'), ...byKind('TH'), ...byKind('TK')];
  }

  const matches = (r: PaletteRow) =>
    (r.label + ' ' + r.sub + ' ' + r.keywords.join(' ')).toLowerCase().includes(q);
  return [...nav, ...entities].filter(matches).slice(0, matchCap);
}
