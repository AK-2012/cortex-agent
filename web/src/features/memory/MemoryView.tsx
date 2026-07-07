import { useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { deriveActiveProjectId } from '@/features/overview/overview-vm';
import { buildTreeRows, pickDefaultPath, relTimeAgo, diffToggle, type TreeRow } from './memory-vm';
import { MarkdownView } from './MarkdownView';

// MEMORY VIEWER 7b — 1:1 from prototype.dc.html L658–719. CENTER-pane view mounted in the
// workbench frame (LeftRail + RightPanel persist, like Overview). Exact inline styles / px / hex /
// font / weight / EN copy reproduced; real fs-read data substituted via the existing memory.tree /
// memory.file tRPC scopes. HONEST placeholders (never fabricated numbers) where the prototype shows
// git-diff data (task ref / +42−7 / commit hash) — there is no git-diff backend scope.

const MONO = "'IBM Plex Mono',monospace";

function TreeRowView({ row, onPick }: { row: TreeRow; onPick: (path: string) => void }) {
  const [hover, setHover] = useState(false);
  const bg = row.selected ? '#EEF0FA' : hover && row.selectable ? '#F1F2F5' : 'transparent';
  const weight = row.selected ? 600 : row.kind === 'dir' ? 600 : 500;
  const color = row.selected ? '#4655D4' : '#22262E';
  return (
    <div
      onClick={row.selectable && row.path ? () => onPick(row.path!) : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '5px 8px',
        background: bg,
        borderRadius: 7,
        cursor: row.selectable ? 'pointer' : 'default',
      }}
    >
      <span
        style={{
          font: `${weight} 10.5px ${MONO}`,
          color,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {row.name}
      </span>
      {row.right != null && (
        <span style={{ marginLeft: 'auto', font: `400 8.5px ${MONO}`, color: '#B6BDC9', flex: 'none' }}>
          {row.right}
        </span>
      )}
    </div>
  );
}

const CENTER: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  background: '#fff',
};

export function MemoryView(): JSX.Element {
  const navigate = useNavigate();
  const trpc = useTRPC();
  const now = Date.now();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diffOn, setDiffOn] = useState(true);

  const projectsQuery = useQuery(trpc.projects.list.queryOptions({}));
  const sessionsQuery = useQuery(trpc.sessions.list.queryOptions({}));
  const projects = projectsQuery.data ?? [];
  const sessions = sessionsQuery.data ?? [];
  const activeProjectId = useMemo(() => deriveActiveProjectId(sessions, projects), [sessions, projects]);
  const projName = activeProjectId ?? '—';

  const treeQuery = useQuery({
    ...trpc.memory.tree.queryOptions({ projectId: activeProjectId ?? '' }),
    enabled: !!activeProjectId,
  });
  const tree = treeQuery.data;

  // Effective selection: explicit pick, else the first file once the tree resolves.
  const effectivePath = selectedPath ?? (tree ? pickDefaultPath(tree) : null);

  const fileQuery = useQuery({
    ...trpc.memory.file.queryOptions({ projectId: activeProjectId ?? '', path: effectivePath ?? '' }),
    enabled: !!activeProjectId && !!effectivePath,
  });
  const file = fileQuery.data;

  const rows = tree ? buildTreeRows(tree, effectivePath) : [];
  const dt = diffToggle(diffOn);

  return (
    <div data-pane="center" style={CENTER}>
      {/* header (prototype L660–666) */}
      <div
        style={{
          height: 50,
          flex: 'none',
          borderBottom: '1px solid #E7E9EE',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '0 20px',
          background: '#fff',
        }}
      >
        <span
          onClick={() => navigate('/overview')}
          style={{ fontSize: 14, color: '#5B6472', cursor: 'pointer', padding: '4px 8px 4px 0' }}
        >
          ‹
        </span>
        <span
          onClick={() => navigate('/overview')}
          style={{ font: `500 12px ${MONO}`, color: '#8A93A2', cursor: 'pointer' }}
        >
          {projName}
        </span>
        <span style={{ color: '#D9DCE3' }}>/</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#191C22' }}>Memory</span>
        <span style={{ color: '#D9DCE3' }}>/</span>
        <span style={{ font: `500 12px ${MONO}`, color: '#5B6472' }}>{effectivePath ?? '—'}</span>
        <span style={{ marginLeft: 'auto', font: `400 10px ${MONO}`, color: '#98A1B0' }}>git-backed</span>
      </div>

      {/* body: 200px tree + fluid rendered pane (prototype L667) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        <div
          style={{
            width: 200,
            flex: 'none',
            borderRight: '1px solid #E7E9EE',
            background: '#FBFBFC',
            padding: '8px 6px',
            overflow: 'auto',
          }}
        >
          {treeQuery.isLoading && (
            <div style={{ fontSize: 10.5, color: '#B6BDC9', padding: '6px 8px' }}>Loading…</div>
          )}
          {!treeQuery.isLoading && rows.length === 0 && (
            <div style={{ fontSize: 10.5, color: '#B6BDC9', padding: '6px 8px' }}>No memory files.</div>
          )}
          {rows.map((r) => (
            <TreeRowView key={r.name} row={r} onPick={setSelectedPath} />
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0, background: '#fff', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* diff bar (prototype L678–684) */}
          <div
            style={{
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 20px',
              background: '#F5F6FD',
              borderBottom: '1px solid #E3E6F5',
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4655D4', flex: 'none' }} />
            <span style={{ fontSize: 11, color: '#3A3F6E' }}>{relTimeAgo(file?.modifiedAt, now)}</span>
            {/* HONEST placeholder: task ref / +42−7 / commit hash have no backend scope. Never fabricated. */}
            <span style={{ font: `400 9.5px ${MONO}`, color: '#98A1B0' }}>diff metadata unavailable</span>
            <span
              onClick={() => setDiffOn((v) => !v)}
              style={{
                marginLeft: 'auto',
                fontSize: 10,
                fontWeight: 600,
                color: dt.color,
                background: dt.bg,
                border: `1px solid ${dt.border}`,
                borderRadius: 999,
                padding: '2px 10px',
                cursor: 'pointer',
              }}
            >
              {dt.label}
            </span>
          </div>

          {/* rendered markdown (prototype L685–716) */}
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: '18px 24px 24px' }}>
            {diffOn && (
              <div
                style={{
                  fontSize: 10.5,
                  color: '#8A5B06',
                  background: '#FDF9F0',
                  border: '1px solid #EFDDB0',
                  borderRadius: 7,
                  padding: '6px 11px',
                  marginBottom: 12,
                  lineHeight: 1.5,
                }}
              >
                Line-level +/− diff is unavailable — there is no git-diff backend scope, so added/removed
                lines are not highlighted. The file below is the current committed content.
              </div>
            )}
            {fileQuery.isLoading && <div style={{ fontSize: 11.5, color: '#B6BDC9' }}>Loading file…</div>}
            {fileQuery.isError && (
              <div style={{ fontSize: 11.5, color: '#C03D33' }}>Could not read this file.</div>
            )}
            {file && <MarkdownView content={file.content} />}
            {!fileQuery.isLoading && !fileQuery.isError && !file && (
              <div style={{ fontSize: 11.5, color: '#B6BDC9' }}>Select a file to view.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
