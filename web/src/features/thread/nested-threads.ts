// Pure selectors/formatters for the nested-thread panel (design 2b, §6.3 F2).
// Framework-free so the ≤5-level depth logic can be unit-tested in isolation (TDD).
// Source: ThreadDetail.children (recursive ThreadChildNode tree from threads.get, B1).
//
// Level model: the focused thread on the detail page is level 1; a direct subthread
// (backend depth 0) is level 2, and so on — so `level = node.depth + 2`. The backend caps
// its child tree at depth 4 and flags nodes whose deeper children were cut as `truncated`;
// a truncated node (or a node already at the max level) is "max" — you drill into it (a
// fresh threads.get re-rooted on that thread) to see below, rather than expanding in place.

import type { ThreadChildNode } from '@cortex-agent/ui-contract';

/** The focused thread (level 1) plus ≤4 descendant levels = 5 total. */
export const MAX_LEVEL = 5;

/** Inline view expands two levels in place (L2 subthreads + their L3 children as drill rows). */
export const INLINE_MAX_VISIBLE_LEVEL = 3;

/** Display level of a child node: root=1, direct child (depth 0)=2. */
export function nodeLevel(node: ThreadChildNode): number {
  return node.depth + 2;
}

/** A node at the max level, or one the backend truncated, cannot expand deeper in place. */
export function isMaxLevel(node: ThreadChildNode): boolean {
  return nodeLevel(node) >= MAX_LEVEL || node.truncated;
}

/** Total number of transitive descendants of a node. */
export function countDescendants(node: ThreadChildNode): number {
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

/** Deepest level present in the subthread tree (root=1 when empty), capped at MAX_LEVEL. */
export function treeMaxLevel(children: ThreadChildNode[]): number {
  let max = 1;
  const walk = (nodes: ThreadChildNode[]) => {
    for (const n of nodes) {
      if (nodeLevel(n) > max) max = nodeLevel(n);
      walk(n.children);
    }
  };
  walk(children);
  return Math.min(max, MAX_LEVEL);
}

export interface OutlineRow {
  node: ThreadChildNode;
  level: number;
  hasChildren: boolean;
  isMax: boolean;
}

/** Flatten the whole subtree into one row per thread in pre-order (design 2b state C — Outline). */
export function flattenOutline(children: ThreadChildNode[]): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const walk = (nodes: ThreadChildNode[]) => {
    for (const n of nodes) {
      rows.push({
        node: n,
        level: nodeLevel(n),
        hasChildren: n.children.length > 0 || n.truncated,
        isMax: isMaxLevel(n),
      });
      walk(n.children);
    }
  };
  walk(children);
  return rows;
}
