import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { SessionInfo } from '@cortex-agent/ui-contract';
import { useTRPC } from '@/lib/trpc';
import { groupSessions, sessionMeta, projectInitials } from './session-groups';
import { buildSwitchList, projMenuSubLabel, runningCountByProject } from './project-menu';
import { ProjectMenu } from './ProjectMenu';
import { NewProjectModal } from './NewProjectModal';

// LEFT RAIL — 1:1 from prototype.dc.html L42–100 (Stage-R RB, task f528). Exact inline styles /
// px / hex / font / weight / EN copy reproduced verbatim; real tRPC data (projects.list /
// sessions.list / cost.summary) substituted into the design's exact structure. Data gaps rendered
// structurally + flagged (see the completion note): approvals banner has no tRPC scope (Stage 5);
// SessionInfo carries no turns/cost/running fields (session meta = time+kind, no pulse dot);
// ProjectConduitInfo has no phase/milestone field (project sub-line is cost-only).
export function LeftRail(): JSX.Element {
  const navigate = useNavigate();
  const trpc = useTRPC();
  const projectsQuery = useQuery(trpc.projects.list.queryOptions({}));
  const sessionsQuery = useQuery(trpc.sessions.list.queryOptions({}));

  const projects = projectsQuery.data ?? [];
  const sessions = sessionsQuery.data ?? [];

  // Active project = project of the most-recently-used session, else the first listed project.
  const activeProjectId = useMemo<string | null>(() => {
    if (sessions.length) {
      const latest = [...sessions].sort(
        (a, b) =>
          Date.parse(b.lastUsedAt || b.createdAt) - Date.parse(a.lastUsedAt || a.createdAt),
      )[0];
      if (latest?.projectId) return latest.projectId;
    }
    return projects[0]?.id ?? null;
  }, [sessions, projects]);

  const costQuery = useQuery({
    ...trpc.cost.summary.queryOptions({ projectId: activeProjectId ?? undefined }),
    enabled: !!activeProjectId,
  });

  // Real per-project running counts drive the project switcher popover (projects.list carries no
  // status/phase field). ThreadInfo has projectId + status, so this is real data.
  const threadsQuery = useQuery(trpc.threads.list.queryOptions({}));
  const threads = threadsQuery.data ?? [];
  const runningCounts = useMemo(() => runningCountByProject(threads), [threads]);

  const projName = activeProjectId ?? '—';
  const projInitials = activeProjectId ? projectInitials(activeProjectId) : '··';
  const todayCost = costQuery.data?.today;
  const projSub = typeof todayCost === 'number' ? '$' + todayCost.toFixed(2) + ' today' : '';

  // Project-card dropdown (prototype L1565–1607, task c3ce).
  const [projMenuOpen, setProjMenuOpen] = useState(false);
  // New-project modal (prototype L1407–1429, task c551).
  const [newProjOpen, setNewProjOpen] = useState(false);
  const activeRunning = activeProjectId ? runningCounts[activeProjectId] ?? 0 : 0;
  const projMenuSub = projMenuSubLabel(activeRunning, todayCost);
  const switchRows = useMemo(
    () => buildSwitchList(projects, activeProjectId, runningCounts),
    [projects, activeProjectId, runningCounts],
  );
  useEffect(() => {
    if (!projMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProjMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [projMenuOpen]);
  // GAP: switching has no backend scope or cross-pane current-project state.
  const onSwitchProject = () => setProjMenuOpen(false);
  // New project — wired to the real projects.create mutation via NewProjectModal (task c551).
  const onNewProject = () => {
    setProjMenuOpen(false);
    setNewProjOpen(true);
  };
  const onOpenOverview = () => {
    setProjMenuOpen(false);
    navigate('/overview');
  };

  const groups = useMemo(() => groupSessions(sessions, Date.now()), [sessions]);

  // Local selection drives only the row highlight (center chat is the Stage-R sibling-B stub).
  // Default to the most-recent session so the rail matches the proto-shot's one active row.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveSelected =
    selectedId ??
    (groups[0]?.items[0]?.sessionId ?? null);

  // GAP-1: no approvals tRPC scope (Stage 5) — banner conditionally hidden with real empty data.
  const pendingCount = 0;
  const hasPendingApprovals = pendingCount > 0;
  const pendingLabel =
    pendingCount + ' ' + (pendingCount > 1 ? 'approvals pending' : 'approval pending');

  // ⌘N — the "New session" affordance. No session-create mutate scope exists yet, so the shortcut
  // is registered but inert (flagged); it mirrors the prototype's Cmd-N binding.
  const onNewSession = () => {
    /* inert stub — session create has no backend scope */
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        onNewSession();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [hover, setHover] = useState<string | null>(null);
  const hp = (key: string) => ({
    onMouseEnter: () => setHover(key),
    onMouseLeave: () => setHover((h) => (h === key ? null : h)),
  });
  const isHover = (key: string) => hover === key;

  return (
    <div
      data-pane="left"
      style={{
        width: 240,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        background: '#FBFBFC',
        borderRight: '1px solid #E7E9EE',
        minHeight: 0,
      }}
    >
      {/* header: cx logo + Cortex + daemon status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '16px 16px 12px', flex: 'none' }}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            background: '#191C22',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            font: "600 12px 'IBM Plex Mono',monospace",
          }}
        >
          cx
        </div>
        <div style={{ fontWeight: 650, fontSize: 14, color: '#191C22', letterSpacing: '-.01em' }}>Cortex</div>
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 10,
            color: '#23854F',
            fontWeight: 600,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#23854F' }} />
          daemon
        </div>
      </div>

      {/* project card */}
      <div
        {...hp('projcard')}
        data-card="project"
        onClick={() => setProjMenuOpen((o) => !o)}
        style={{
          margin: '6px 12px 0',
          padding: '9px 11px',
          background: '#fff',
          border: '1px solid ' + (isHover('projcard') ? '#D9DCE3' : '#E7E9EE'),
          borderRadius: 9,
          display: 'flex',
          gap: 9,
          alignItems: 'center',
          boxShadow: '0 1px 2px rgba(16,24,40,.03)',
          cursor: 'pointer',
          flex: 'none',
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: '#EEF0FA',
            color: '#4655D4',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            font: "600 9.5px 'IBM Plex Mono',monospace",
            flex: 'none',
          }}
        >
          {projInitials}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: '#191C22',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {projName}
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: '#98A1B0',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {projSub}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', color: '#98A1B0', fontSize: 10 }}>▾</div>
      </div>

      {/* + New session */}
      <div
        {...hp('newsess')}
        onClick={onNewSession}
        style={{
          margin: '12px 12px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          border: '1px solid #D9DCE3',
          borderRadius: 8,
          padding: '7px 11px',
          background: isHover('newsess') ? '#F7F8FA' : '#fff',
          cursor: 'pointer',
          flex: 'none',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: '#191C22' }}>+ New session</span>
        <span style={{ marginLeft: 'auto', font: "500 10px 'IBM Plex Mono',monospace", color: '#B6BDC9' }}>⌘N</span>
      </div>

      {/* session groups */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 12px 4px', minHeight: 0 }}>
        {groups.map((g) => (
          <div key={g.label}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '.07em',
                color: '#B6BDC9',
                padding: '6px 4px 6px',
              }}
            >
              {g.label}
            </div>
            {g.items.map((s: SessionInfo) => {
              const active = s.sessionId === effectiveSelected;
              const running = false; // GAP-2: SessionInfo has no running field
              const rowKey = 'sess:' + s.sessionId;
              const bg = active ? '#EFF1F5' : isHover(rowKey) ? '#F1F2F5' : 'transparent';
              return (
                <div
                  key={s.sessionId}
                  {...hp(rowKey)}
                  className="sess-row"
                  data-session-id={s.sessionId}
                  onClick={() => setSelectedId(s.sessionId)}
                  style={{ borderRadius: 8, padding: '8px 10px', cursor: 'pointer', background: bg, position: 'relative' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    {running && (
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: '#4655D4',
                          flex: 'none',
                          animation: 'cxpulse 1.6s ease-in-out infinite',
                        }}
                      />
                    )}
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 12.5,
                        fontWeight: active ? 600 : 400,
                        color: '#191C22',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {s.label ?? s.name}
                    </span>
                    <span
                      className="sess-more"
                      style={{
                        flex: 'none',
                        color: '#98A1B0',
                        fontSize: 13,
                        letterSpacing: 1,
                        padding: '0 4px',
                        borderRadius: 5,
                        lineHeight: 1.2,
                      }}
                    >
                      ⋯
                    </span>
                  </div>
                  <div
                    style={{
                      font: "400 10px 'IBM Plex Mono',monospace",
                      color: '#98A1B0',
                      marginTop: 3,
                      paddingLeft: running ? 14 : 0,
                    }}
                  >
                    {sessionMeta(s)}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* approval-pending banner (GAP-1: hidden — no approvals scope) */}
      {hasPendingApprovals && (
        <div
          {...hp('approval')}
          style={{
            margin: '0 12px 10px',
            padding: '9px 12px',
            background: '#FDF9F0',
            border: '1px solid ' + (isHover('approval') ? '#E3C88A' : '#EFDDB0'),
            borderRadius: 9,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            flex: 'none',
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#C99A2E',
              flex: 'none',
              animation: 'cxpulse 2s ease-in-out infinite',
            }}
          />
          <div style={{ fontSize: 11.5, color: '#8A5B06', fontWeight: 600 }}>{pendingLabel}</div>
          <div style={{ marginLeft: 'auto', color: '#C0A96E', fontSize: 11 }}>→</div>
        </div>
      )}

      {/* footer: EN/中 toggle (EN active) + Settings */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px 14px',
          borderTop: '1px solid #EFF1F5',
          flex: 'none',
        }}
      >
        <div style={{ display: 'flex', border: '1px solid #E7E9EE', borderRadius: 6, overflow: 'hidden' }}>
          <span style={{ fontSize: 10, fontWeight: 600, padding: '2.5px 7px', cursor: 'pointer', background: '#191C22', color: '#fff' }}>
            EN
          </span>
          <span style={{ fontSize: 10, fontWeight: 600, padding: '2.5px 7px', cursor: 'pointer', background: 'transparent', color: '#8A93A2' }}>
            中
          </span>
        </div>
        <span
          {...hp('settings')}
          onClick={() => navigate('/settings')}
          style={{ marginLeft: 'auto', fontSize: 11.5, color: isHover('settings') ? '#191C22' : '#8A93A2', cursor: 'pointer' }}
        >
          Settings
        </span>
      </div>

      {projMenuOpen && (
        <ProjectMenu
          projName={projName}
          projInitials={projInitials}
          subLabel={projMenuSub}
          rows={switchRows}
          onClose={() => setProjMenuOpen(false)}
          onOpenOverview={onOpenOverview}
          onSwitch={onSwitchProject}
          onNewProject={onNewProject}
        />
      )}

      {newProjOpen && <NewProjectModal onClose={() => setNewProjOpen(false)} />}
    </div>
  );
}
