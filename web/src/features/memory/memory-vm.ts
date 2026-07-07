import type { MemoryTree } from '@cortex-agent/ui-contract';

// Pure view-model helpers for the memory viewer 7b center view (prototype.dc.html L658–719). No JSX,
// no fabricated data. Precedent: features/overview/overview-vm.ts. `deriveActiveProjectId` is reused
// from overview-vm (single source of the active-project rule).

export interface TreeRow {
  /** Display name — dirs carry a trailing slash. */
  name: string;
  kind: 'file' | 'dir';
  /** memory.file path for a selectable file, else null (dirs cannot be listed — no dir scope). */
  path: string | null;
  selectable: boolean;
  selected: boolean;
  /** Right-aligned mono count — the real dir `entryCount`; null for files (no line-count backend). */
  right: string | null;
}

/**
 * Tree rows for the 200px file tree: the real top-level files (selectable → memory.file) followed by
 * the real memory dirs with their entryCount. Dirs are NON-selectable: the memory.tree scope returns
 * only dir names + counts, not their entries, so nested files cannot be enumerated (flagged gap). File
 * rows carry NO right-hand chip — the prototype's `≤120L`/`9` are mock line counts with no backend.
 */
export function buildTreeRows(tree: MemoryTree, selectedPath: string | null): TreeRow[] {
  const files: TreeRow[] = tree.files.map((f) => ({
    name: f.name,
    kind: 'file',
    path: f.name,
    selectable: true,
    selected: f.name === selectedPath,
    right: null,
  }));
  const dirs: TreeRow[] = tree.dirs.map((d) => ({
    name: `${d.name}/`,
    kind: 'dir',
    path: null,
    selectable: false,
    selected: false,
    right: String(d.entryCount),
  }));
  return [...files, ...dirs];
}

/** Default selected file = the first top-level file, else null (nothing to render). */
export function pickDefaultPath(tree: MemoryTree): string | null {
  return tree.files[0]?.name ?? null;
}

/** `updated 2m ago` from an ISO timestamp; `updated —` when missing/unparseable. */
export function relTimeAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return 'updated —';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'updated —';
  const ms = Math.max(0, now - t);
  const m = Math.round(ms / 60000);
  if (m < 1) return 'updated <1m ago';
  if (m < 60) return `updated ${m}m ago`;
  const h = Math.round(ms / 3600000);
  if (h < 24) return `updated ${h}h ago`;
  return `updated ${Math.round(ms / 86400000)}d ago`;
}

export interface DiffToggleStyle {
  label: string;
  color: string;
  bg: string;
  border: string;
}

/**
 * The diff-toggle pill's two visual states, verbatim from the prototype bindings (L2376/L2776):
 * ON → filled blue "Viewing diff"; OFF → light-outline "Diff hidden".
 */
export function diffToggle(on: boolean): DiffToggleStyle {
  return on
    ? { label: 'Viewing diff', color: '#fff', bg: '#4655D4', border: '#4655D4' }
    : { label: 'Diff hidden', color: '#4655D4', bg: '#fff', border: '#C9CFF2' };
}
