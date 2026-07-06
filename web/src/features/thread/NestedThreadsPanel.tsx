import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ThreadChildNode } from '@cortex-agent/ui-contract';
import { Button, ID, MonoText, StatusPill } from '@/design';
import {
  INLINE_MAX_VISIBLE_LEVEL,
  countDescendants,
  flattenOutline,
  isMaxLevel,
  nodeLevel,
} from './nested-threads';

// Nested-thread panel (design 2b, DR-0018 §6.3 F2). Renders a ThreadDetail's recursive subthread
// tree (ThreadChildNode[]) with the three panel states:
//   A 就地展开 (inline)  — expand two levels in place (L2 subthreads + their L3 children as drill
//                          rows); deeper levels are reached by drilling, not by horizontal squeeze.
//   B 下钻   (drill down) — a node's "open ›" navigates to /threads/:id (a fresh threads.get
//                          re-rooted on that thread), carrying the ancestor trail for the breadcrumb.
//   C 大纲全览 (outline)  — one row per thread, the whole subtree flattened with tab-line indent.
// Constant 14px indent unit; token-only styling.

const INDENT_PX = 14;

// L-level badge shown on rows past the first expanded level / at the max depth.
function LevelBadge({ level, isMax }: { level: number; isMax: boolean }) {
  return (
    <span
      className={`shrink-0 rounded px-1 font-mono text-[10px] font-semibold ${
        isMax ? 'bg-pill-failed-bg text-pill-failed-fg' : 'bg-surface-canvas-alt text-state-ink/55'
      }`}
    >
      {isMax ? 'max' : `L${level}`}
    </span>
  );
}

function DrillButton({ node, onDrill }: { node: ThreadChildNode; onDrill: (id: string) => void }) {
  const descendants = countDescendants(node);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="ml-auto shrink-0"
      onClick={() => onDrill(node.id)}
      data-drill-thread-id={node.id}
    >
      {descendants > 0 || node.truncated ? `open › (${node.truncated ? '…' : descendants})` : 'open ›'}
    </Button>
  );
}

// A single node in the inline (Tree) view. L2 nodes with children can expand in place to reveal
// their L3 children as collapsed drill rows; anything at/after INLINE_MAX_VISIBLE_LEVEL or at the
// max depth is a drill row only.
function InlineNode({
  node,
  onDrill,
}: {
  node: ThreadChildNode;
  onDrill: (id: string) => void;
}) {
  const level = nodeLevel(node);
  const maxed = isMaxLevel(node);
  const canExpandInline = !maxed && level < INLINE_MAX_VISIBLE_LEVEL && node.children.length > 0;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-0.5g" data-nested-thread-id={node.id} data-level={level}>
      <div
        className="flex items-center gap-1g rounded-card border border-card bg-surface-card px-1g py-0.5g shadow-card"
        style={{ marginLeft: (level - 2) * INDENT_PX }}
      >
        {canExpandInline ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((e) => !e)}
            className="shrink-0 font-mono text-ui text-state-ink/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-run/40"
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-[1ch] shrink-0" />
        )}
        <StatusPill status={node.status} />
        <ID value={node.id} />
        <span className="truncate text-ui text-state-ink/70">{node.templateName ?? '—'}</span>
        {level >= INLINE_MAX_VISIBLE_LEVEL || maxed ? <LevelBadge level={level} isMax={maxed} /> : null}
        <MonoText muted className="ml-1g shrink-0">
          ${node.costUsd.toFixed(2)}
        </MonoText>
        {(node.children.length > 0 || node.truncated) && <DrillButton node={node} onDrill={onDrill} />}
      </div>
      {canExpandInline && expanded && (
        <div className="flex flex-col gap-0.5g">
          {node.children.map((c) => (
            <InlineNode key={c.id} node={c} onDrill={onDrill} />
          ))}
        </div>
      )}
    </div>
  );
}

function InlineView({
  nodes,
  onDrill,
}: {
  nodes: ThreadChildNode[];
  onDrill: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5g">
      {nodes.map((n) => (
        <InlineNode key={n.id} node={n} onDrill={onDrill} />
      ))}
    </div>
  );
}

// Outline (state C): one row per thread, the whole subtree flattened; monospace tab-line indent,
// right column = current stage (activeAgent) + status dot; click a row to drill into it.
function OutlineView({
  nodes,
  onDrill,
}: {
  nodes: ThreadChildNode[];
  onDrill: (id: string) => void;
}) {
  const rows = flattenOutline(nodes);
  return (
    <div className="flex flex-col" data-outline="true">
      {rows.map(({ node, level, isMax }) => (
        <button
          key={node.id}
          type="button"
          onClick={() => onDrill(node.id)}
          data-outline-thread-id={node.id}
          data-level={level}
          className="flex items-center gap-1g rounded px-1g py-0.5g text-left hover:bg-surface-canvas-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-run/40"
        >
          <span
            className="min-w-0 flex-1 truncate font-mono text-ui text-state-ink"
            style={{ paddingLeft: (level - 2) * INDENT_PX }}
          >
            {node.templateName ?? node.id}
          </span>
          <MonoText muted className="shrink-0">
            {node.activeAgent ?? '—'}
          </MonoText>
          {isMax && <LevelBadge level={level} isMax />}
          <StatusPill status={node.status} />
        </button>
      ))}
    </div>
  );
}

export interface NestedThreadsPanelProps {
  nodes: ThreadChildNode[];
  /** The focused thread on the current page — pushed onto the trail when drilling into a child. */
  focusId: string;
  /** Ancestor thread ids drilled through so far (for the breadcrumb of the drilled-into page). */
  trail: string[];
}

type View = 'tree' | 'outline';

export function NestedThreadsPanel({ nodes, focusId, trail }: NestedThreadsPanelProps) {
  const navigate = useNavigate();
  const [view, setView] = useState<View>('tree');

  const onDrill = (id: string) => {
    navigate(`/threads/${id}`, { state: { trail: [...trail, focusId] } });
  };

  if (nodes.length === 0) {
    return <div className="text-ui text-state-ink/40">No subthreads.</div>;
  }

  return (
    <div className="flex flex-col gap-1g" data-nested-panel="true">
      <div className="flex items-center gap-1g">
        <span className="text-ui text-state-ink/45">Subthreads</span>
        <div className="ml-auto flex items-center gap-0.5g" role="group" aria-label="Nested view">
          <Button
            variant={view === 'tree' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={view === 'tree'}
            onClick={() => setView('tree')}
          >
            Tree
          </Button>
          <Button
            variant={view === 'outline' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={view === 'outline'}
            onClick={() => setView('outline')}
          >
            Outline
          </Button>
        </div>
      </div>
      {view === 'tree' ? (
        <InlineView nodes={nodes} onDrill={onDrill} />
      ) : (
        <OutlineView nodes={nodes} onDrill={onDrill} />
      )}
    </div>
  );
}
