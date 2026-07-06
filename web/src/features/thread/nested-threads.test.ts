import { describe, expect, it } from 'vitest';
import type { ThreadChildNode } from '@cortex-agent/ui-contract';
import {
  MAX_LEVEL,
  INLINE_MAX_VISIBLE_LEVEL,
  nodeLevel,
  isMaxLevel,
  countDescendants,
  treeMaxLevel,
  flattenOutline,
} from './nested-threads';

// Build a ThreadChildNode with only the fields the pure logic touches.
function node(
  id: string,
  depth: number,
  children: ThreadChildNode[] = [],
  opts: Partial<ThreadChildNode> = {},
): ThreadChildNode {
  return {
    id,
    templateName: opts.templateName ?? 'coder-review',
    status: opts.status ?? 'running',
    activeAgent: opts.activeAgent ?? null,
    costUsd: opts.costUsd ?? 0,
    depth,
    createdAt: opts.createdAt ?? '2026-07-06T00:00:00.000Z',
    taskId: opts.taskId ?? null,
    children,
    truncated: opts.truncated ?? false,
  };
}

describe('nodeLevel', () => {
  it('maps direct child (depth 0) to level 2 — the root thread is level 1', () => {
    expect(nodeLevel(node('a', 0))).toBe(2);
  });
  it('maps depth 3 to level 5', () => {
    expect(nodeLevel(node('a', 3))).toBe(5);
  });
});

describe('isMaxLevel', () => {
  it('is true at MAX_LEVEL (level 5 = depth 3)', () => {
    expect(isMaxLevel(node('a', 3))).toBe(true);
  });
  it('is true when the node is truncated (deeper children were cut by the backend cap)', () => {
    expect(isMaxLevel(node('a', 1, [], { truncated: true }))).toBe(true);
  });
  it('is false for a shallow node with no truncation', () => {
    expect(isMaxLevel(node('a', 0))).toBe(false);
  });
});

describe('countDescendants', () => {
  it('counts all transitive children', () => {
    const tree = node('a', 0, [
      node('b', 1, [node('d', 2)]),
      node('c', 1),
    ]);
    expect(countDescendants(tree)).toBe(3);
  });
  it('is 0 for a leaf', () => {
    expect(countDescendants(node('a', 0))).toBe(0);
  });
});

describe('treeMaxLevel', () => {
  it('is 1 (root only) for an empty subthread tree', () => {
    expect(treeMaxLevel([])).toBe(1);
  });
  it('reflects the deepest node, mapped to a level', () => {
    // deepest node depth 2 → level 4
    const tree = [node('a', 0, [node('b', 1, [node('c', 2)])])];
    expect(treeMaxLevel(tree)).toBe(4);
  });
  it('never exceeds MAX_LEVEL even if the backend nests deeper', () => {
    const tree = [node('a', 0, [node('b', 1, [node('c', 2, [node('d', 3, [node('e', 4)])])])])];
    expect(treeMaxLevel(tree)).toBe(MAX_LEVEL);
  });
});

describe('flattenOutline', () => {
  it('emits one row per thread in pre-order (parent before children)', () => {
    const tree = [
      node('a', 0, [node('b', 1), node('c', 1)]),
      node('d', 0),
    ];
    expect(flattenOutline(tree).map((r) => r.node.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('annotates each row with level, hasChildren and isMax', () => {
    // node 'b' is truncated → its deeper children were cut by the backend cap, so it still
    // counts as having children (a drill affordance) even though `children` is empty.
    const tree = [node('a', 0, [node('b', 1, [], { truncated: true })])];
    const rows = flattenOutline(tree);
    expect(rows[0]).toMatchObject({ level: 2, hasChildren: true, isMax: false });
    expect(rows[1]).toMatchObject({ level: 3, hasChildren: true, isMax: true });
  });
  it('is empty for an empty tree', () => {
    expect(flattenOutline([])).toEqual([]);
  });
});

describe('constants', () => {
  it('caps the tree at 5 levels and inline-expands to level 3', () => {
    expect(MAX_LEVEL).toBe(5);
    expect(INLINE_MAX_VISIBLE_LEVEL).toBe(3);
  });
});
