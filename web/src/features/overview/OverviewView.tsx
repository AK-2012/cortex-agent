import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ScheduleInfo, ExecutionInfo } from '@cortex-agent/ui-contract';
import { useTRPC } from '@/lib/trpc';
import { useExecutionLogDrawer } from '@/features/execution/ExecutionLogDrawerProvider';
import { useScheduleModal } from '@/features/schedule/ScheduleModalProvider';
import {
  formatMoney,
  deriveActiveProjectId,
  scheduleIntervalLabel,
  scheduleProfileLabel,
  nextRunLabel,
  lastRunLabel,
  execDurationMs,
  formatDuration,
  execMachine,
  execCost,
  execStatusPill,
  execSummary,
} from './overview-vm';

// PROJECT OVERVIEW 6a — 1:1 from prototype.dc.html L525–655 (Stage-R R2, task df67). Exact inline
// styles / px / hex / font / weight / EN copy reproduced verbatim; real tRPC data substituted into
// the design's structure: cost header (today/week/month) = real cost.summary; Schedules = real
// schedules.list; Executions = real executions.list. Data-gap regions render the prototype's
// structural chrome 1:1 with neutral placeholders (NOT fabricated numbers), each flagged:
//   - budget bar / budget-per-day / forecast today — CostSummary has no budget or forecast field (Stage 7)
//   - Last 14 days chart — no per-day cost series (structural skeleton, real todayCost label; Stage 7)
//   - Where it goes — byTrigger is free-form + global, no threads/sessions/schedules breakdown (Stage 7)
//   - Project memory — no fs-read tRPC scope → EXPLICIT placeholder (Stage 6)

const CARD: CSSProperties = {
  background: '#fff',
  border: '1px solid #E7E9EE',
  borderRadius: 10,
  boxShadow: '0 1px 2px rgba(16,24,40,.03)',
  // minWidth:0 lets the 1fr grid track shrink below its content's min-content size, so long real
  // data (schedule prompts, execution ids) truncates instead of blowing the column wide.
  minWidth: 0,
};

function CardHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 14px',
        borderBottom: '1px solid #EFF1F5',
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 650, color: '#191C22' }}>{title}</span>
      {right != null && (
        <span style={{ marginLeft: 'auto', font: "400 9.5px 'IBM Plex Mono',monospace", color: '#98A1B0' }}>
          {right}
        </span>
      )}
    </div>
  );
}

export function OverviewView(): JSX.Element {
  const navigate = useNavigate();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { open: openExecutionLog } = useExecutionLogDrawer();
  const { open: openScheduleModal } = useScheduleModal();
  const now = Date.now();

  const projectsQuery = useQuery(trpc.projects.list.queryOptions({}));
  const sessionsQuery = useQuery(trpc.sessions.list.queryOptions({}));
  const projects = projectsQuery.data ?? [];
  const sessions = sessionsQuery.data ?? [];
  const activeProjectId = useMemo(
    () => deriveActiveProjectId(sessions, projects),
    [sessions, projects],
  );
  const projName = activeProjectId ?? '—';

  const costQuery = useQuery({
    ...trpc.cost.summary.queryOptions({ projectId: activeProjectId ?? undefined }),
    enabled: !!activeProjectId,
  });
  const cost = costQuery.data;

  const schedulesQuery = useQuery({
    ...trpc.schedules.list.queryOptions({ projectId: activeProjectId ?? undefined }),
    enabled: !!activeProjectId,
  });
  const schedules = schedulesQuery.data ?? [];

  // executions.list has no projectId filter → fetch recent and filter client-side by project.
  const executionsQuery = useQuery(trpc.executions.list.queryOptions({ limit: 50 }));
  const executions = useMemo<ExecutionInfo[]>(() => {
    const all = executionsQuery.data ?? [];
    const scoped = activeProjectId ? all.filter((e) => e.projectId === activeProjectId) : all;
    return scoped.slice(0, 6);
  }, [executionsQuery.data, activeProjectId]);

  const resume = useMutation(
    trpc.schedules.resume.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries(trpc.schedules.list.queryFilter());
      },
    }),
  );

  return (
    <div data-pane="center" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#fff' }}>
      {/* header bar (prototype L526–556) */}
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
          onClick={() => navigate('/workbench')}
          style={{ fontSize: 14, color: '#5B6472', cursor: 'pointer', padding: '4px 8px 4px 0' }}
        >
          ‹
        </span>
        <span style={{ font: "500 12px 'IBM Plex Mono',monospace", color: '#8A93A2' }}>{projName}</span>
        <span style={{ color: '#D9DCE3' }}>/</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#191C22' }}>Overview</span>
        <span style={{ position: 'relative', marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {/* Adjust budget — no budget-mutate scope, inert (GAP, Stage 7) */}
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              border: '1px solid #D9DCE3',
              borderRadius: 7,
              padding: '4px 12px',
              color: '#191C22',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            Adjust budget
          </span>
          {/* ⋯ overflow menu — decorative for this view */}
          <span style={{ color: '#8A93A2', fontSize: 15, letterSpacing: 1, padding: '2px 6px', borderRadius: 6, cursor: 'pointer' }}>
            ⋯
          </span>
        </span>
      </div>

      {/* cost summary bar (prototype L557–563) */}
      <div
        style={{
          flex: 'none',
          borderBottom: '1px solid #E7E9EE',
          display: 'flex',
          alignItems: 'center',
          gap: 30,
          padding: '12px 20px 14px',
          background: '#fff',
        }}
      >
        <div style={{ minWidth: 180 }}>
          <div style={{ fontSize: 10, color: '#98A1B0', marginBottom: 3 }}>today</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ font: "600 22px 'IBM Plex Mono',monospace", color: '#191C22', letterSpacing: '-.02em' }}>
              {formatMoney(cost?.today)}
            </span>
            {/* budget progress bar — GAP: no daily-budget field, empty track (Stage 7) */}
            <div style={{ flex: 1, height: 5, borderRadius: 999, background: '#EFF1F5', overflow: 'hidden', marginTop: 2 }}>
              <div style={{ width: '0%', height: '100%', background: '#4655D4' }} />
            </div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#98A1B0', marginBottom: 3 }}>this week</div>
          <div style={{ font: "600 15px 'IBM Plex Mono',monospace", color: '#22262E' }}>{formatMoney(cost?.week)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#98A1B0', marginBottom: 3 }}>this month</div>
          <div style={{ font: "600 15px 'IBM Plex Mono',monospace", color: '#22262E' }}>{formatMoney(cost?.month)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#98A1B0', marginBottom: 3 }}>budget</div>
          {/* GAP: no budget scope (Stage 7) */}
          <div style={{ font: "600 15px 'IBM Plex Mono',monospace", color: '#22262E' }}>
            —<span style={{ fontSize: 10, color: '#98A1B0', fontWeight: 400 }}> /day</span>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: '#98A1B0', marginBottom: 3 }}>forecast today</div>
          {/* GAP: no forecast field (Stage 7) */}
          <div style={{ font: "600 15px 'IBM Plex Mono',monospace", color: '#A96B0B' }}>—</div>
        </div>
      </div>

      {/* card grid (prototype L564–655) */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          minHeight: 0,
          padding: '14px 20px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridAutoRows: 'min-content',
          gap: 12,
          background: '#F7F8FA',
          alignContent: 'start',
        }}
      >
        {/* Last 14 days — GAP: no per-day cost series; structural skeleton + real today label (Stage 7) */}
        <div style={CARD}>
          <CardHeader title="Last 14 days" right="avg —/day" />
          <div style={{ padding: '14px 14px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 96 }}>
              {[22, 34, 18, 41, 12, 8, 29, 47, 36, 64, 52, 58, 71].map((h, i) => (
                <div key={i} style={{ flex: 1, background: '#E3E6F0', borderRadius: '3px 3px 0 0', height: `${h}%` }} />
              ))}
              <div style={{ flex: 1, position: 'relative', background: '#4655D4', borderRadius: '3px 3px 0 0', height: '42%' }}>
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    marginBottom: 5,
                    font: "600 9.5px 'IBM Plex Mono',monospace",
                    color: '#4655D4',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatMoney(cost?.today)}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 7, font: "400 9px 'IBM Plex Mono',monospace", color: '#B6BDC9' }}>
              <span>—</span>
              <span style={{ marginLeft: 'auto', color: '#4655D4', fontWeight: 600 }}>today</span>
            </div>
          </div>
        </div>

        {/* Project memory — REAL: memory viewer 7b now backed by the memory.tree/memory.file fs scope */}
        <div style={{ ...CARD, cursor: 'pointer' }} onClick={() => navigate('/memory')}>
          <CardHeader title="Project memory" right="git-backed" />
          <div style={{ padding: '18px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textAlign: 'center' }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: '#4655D4' }}>Open memory viewer ›</div>
            <div style={{ fontSize: 10.5, color: '#B6BDC9', lineHeight: 1.5 }}>
              Mission · roadmap · STATUS · TASKS + experiments / knowledge / patterns / decisions.
            </div>
          </div>
        </div>

        {/* Where it goes — GAP: byTrigger is free-form + global, no per-category breakdown (Stage 7) */}
        <div style={CARD}>
          <CardHeader title="Where it goes" right="this week" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '13px 14px 14px' }}>
            {(['threads', 'sessions', 'schedules'] as const).map((label, i) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ fontSize: 10.5, color: '#5B6472', width: 56 }}>{label}</span>
                <div style={{ flex: 1, height: 6, borderRadius: 999, background: '#EFF1F5', overflow: 'hidden' }}>
                  <div style={{ width: '0%', height: '100%', background: ['#4655D4', '#9AA3E8', '#D4D8F4'][i] }} />
                </div>
                <span style={{ font: "500 10px 'IBM Plex Mono',monospace", color: '#191C22', width: 40, textAlign: 'right' }}>—</span>
              </div>
            ))}
          </div>
        </div>

        {/* Schedules — REAL schedules.list */}
        <div style={CARD}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #EFF1F5' }}>
            <span style={{ fontSize: 12, fontWeight: 650, color: '#191C22' }}>Schedules</span>
            {/* + New — opens the New-schedule overlay (design 7c), real schedules.add */}
            <span
              onClick={() => openScheduleModal({ projectId: activeProjectId })}
              style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: '#4655D4', cursor: 'pointer' }}
            >
              + New
            </span>
          </div>
          <div style={{ padding: '9px 14px 11px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            {schedules.length === 0 && (
              <div style={{ fontSize: 10.5, color: '#B6BDC9', padding: '4px 0' }}>No schedules for this project.</div>
            )}
            {schedules.map((s: ScheduleInfo, idx: number) => (
              <div key={s.id}>
                {idx > 0 && <div style={{ height: 1, background: '#F3F4F7', margin: '0 0 9px' }} />}
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke={s.paused ? '#8A93A2' : '#5B6472'} strokeWidth="1.5">
                    <circle cx="7" cy="7" r="5.6" />
                    <path d="M7 4v3.2l2.2 1.3" />
                  </svg>
                  <span
                    title={s.message}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: s.paused ? '#8A93A2' : '#191C22',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {s.message}
                  </span>
                  {s.paused && (
                    <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 999, background: '#F1F2F5', color: '#8A93A2' }}>
                      paused
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', font: "400 9.5px 'IBM Plex Mono',monospace", color: '#98A1B0' }}>
                    {scheduleIntervalLabel(s)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', fontSize: 10, color: '#8A93A2', marginTop: 2, paddingLeft: 18 }}>
                  <span>
                    {s.paused
                      ? `${lastRunLabel(s.lastRun, now)}`
                      : `${nextRunLabel(s.nextRun, now)} · ${lastRunLabel(s.lastRun, now)}`}
                  </span>
                  {/* Real agent profile from ScheduleInfo.profile (schedule config source). Omitted
                      when the schedule has no recorded profile — honest placeholder, no fabrication. */}
                  {scheduleProfileLabel(s) && (
                    <span
                      title="profile"
                      style={{ marginLeft: 7, font: "400 9.5px 'IBM Plex Mono',monospace", color: '#98A1B0' }}
                    >
                      {scheduleProfileLabel(s)}
                    </span>
                  )}
                  {s.paused && (
                    <span
                      onClick={() => !resume.isPending && resume.mutate({ scheduleId: s.id })}
                      style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 600, color: '#4655D4', cursor: 'pointer' }}
                    >
                      Resume
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Executions — REAL executions.list (span 2) */}
        <div style={{ ...CARD, gridColumn: 'span 2', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #EFF1F5' }}>
            <span style={{ fontSize: 12, fontWeight: 650, color: '#191C22' }}>Executions</span>
            <span style={{ font: "400 9.5px 'IBM Plex Mono',monospace", color: '#98A1B0', marginLeft: 8 }}>every cortex-run, auditable</span>
            <span style={{ marginLeft: 'auto', font: "400 9.5px 'IBM Plex Mono',monospace", color: '#B6BDC9' }}>executions.json</span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '88px 1fr 76px 52px 56px 86px 46px',
              padding: '6px 14px',
              borderBottom: '1px solid #F3F4F7',
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: '.05em',
              color: '#98A1B0',
            }}
          >
            <span>ID</span>
            <span>SUMMARY</span>
            <span>MACHINE</span>
            <span>DUR</span>
            <span>COST</span>
            <span>STATUS</span>
            <span />
          </div>
          {executions.length === 0 && (
            <div style={{ padding: '10px 14px', fontSize: 10.5, color: '#B6BDC9' }}>No executions for this project.</div>
          )}
          {executions.map((x: ExecutionInfo) => {
            const pill = execStatusPill(x.status);
            return (
              <div
                key={x.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '88px 1fr 76px 52px 56px 86px 46px',
                  padding: '7.5px 14px',
                  borderBottom: '1px solid #F7F8FA',
                  alignItems: 'center',
                  fontSize: 11,
                  color: '#22262E',
                }}
              >
                <span
                  title={x.id}
                  style={{
                    font: "400 10px 'IBM Plex Mono',monospace",
                    color: '#5B6472',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    paddingRight: 8,
                  }}
                >
                  {x.id}
                </span>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 12 }}>
                  {execSummary(x)}
                </span>
                <span style={{ font: "400 10px 'IBM Plex Mono',monospace" }}>{execMachine(x)}</span>
                <span style={{ font: "400 10px 'IBM Plex Mono',monospace" }}>{formatDuration(execDurationMs(x, now))}</span>
                <span style={{ font: "400 10px 'IBM Plex Mono',monospace" }}>{execCost(x.cost)}</span>
                <span>
                  <span style={{ fontSize: 9, fontWeight: 600, padding: '1.5px 7px', borderRadius: 999, background: pill.bg, color: pill.color }}>
                    {pill.dot ? '• ' : ''}
                    {pill.text}
                  </span>
                </span>
                <span
                  onClick={() => openExecutionLog(x.id)}
                  style={{ fontSize: 10.5, fontWeight: 600, color: '#4655D4', cursor: 'pointer' }}
                >
                  Logs
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
