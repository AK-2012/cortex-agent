import type { ReactNode } from 'react';
import type { ExecutionDetailInfo } from '@cortex-agent/ui-contract';
import { Button, Card, CardBody, CardHeader, ID, MonoText, SectionHeader, StatusPill } from '@/design';
import {
  formatCost,
  formatDuration,
  formatGpu,
  formatNum,
  isStoppable,
} from './execution-detail';

// Execution detail right rail (design 8b, DR-0018 §6.3 F3): lifecycle / watchdog / GPU / cost,
// plus the Stop (executions.cancel) + Extend-cap controls. Purely presentational — the cancel
// mutation is wired in ExecutionDetailPage and passed as onStop. Token-only styling (no hard-coded hex).

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-1g py-0.5g">
      <span className="shrink-0 text-ui text-state-ink/50">{label}</span>
      <span className="min-w-0 truncate text-right text-ui text-state-ink">{children}</span>
    </div>
  );
}

export interface ExecutionDetailRailProps {
  detail: ExecutionDetailInfo;
  onStop: () => void;
  stopping: boolean;
}

export function ExecutionDetailRail({ detail, onStop, stopping }: ExecutionDetailRailProps) {
  const d = detail.dispatch;
  const stoppable = isStoppable(detail.status);

  return (
    <div className="flex flex-col gap-2g" data-execution-rail={detail.id}>
      <Card>
        <CardBody className="flex items-center gap-1g">
          <Button
            variant="danger"
            size="sm"
            disabled={!stoppable || stopping}
            onClick={onStop}
            data-action="stop"
          >
            {stopping ? 'Stopping…' : 'Stop'}
          </Button>
          {/* Extend cap: no backend op exists to extend a running execution's watchdog cap
              (MutateOp has only *.cancel / tasks.* / schedules.*). Rendered as a disabled
              affordance documenting the 8b surface; native title explains why (task 032e class). */}
          <span
            title="Extending a running execution's cap needs a backend op that does not exist yet (tracked follow-up)."
            className="inline-flex"
          >
            <Button variant="secondary" size="sm" disabled data-action="extend-cap">
              Extend cap
            </Button>
          </span>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeader title="Lifecycle" />
        </CardHeader>
        <CardBody className="flex flex-col py-1g">
          <Field label="Status">
            <StatusPill status={detail.status} />
          </Field>
          <Field label="Type">
            <MonoText muted>{detail.type}</MonoText>
          </Field>
          <Field label="Kind">
            <MonoText muted>{detail.kind}</MonoText>
          </Field>
          <Field label="Started">
            <MonoText muted>{detail.runtime.startedAt}</MonoText>
          </Field>
          <Field label="Updated">
            <MonoText muted>{detail.runtime.updatedAt}</MonoText>
          </Field>
          <Field label="Ended">
            <MonoText muted>{detail.runtime.endedAt ?? '—'}</MonoText>
          </Field>
          {detail.threadId && (
            <Field label="Thread">
              <ID value={detail.threadId} />
            </Field>
          )}
          {detail.projectId && (
            <Field label="Project">
              <MonoText muted>{detail.projectId}</MonoText>
            </Field>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeader title="Watchdog" />
        </CardHeader>
        <CardBody className="flex flex-col py-1g">
          <Field label="Machine">
            <MonoText muted>{d?.machine ?? 'local'}</MonoText>
          </Field>
          <Field label="PID">
            <MonoText muted>{d?.pid ?? '—'}</MonoText>
          </Field>
          <Field label="tmux">
            <MonoText muted>{d?.tmuxName ?? '—'}</MonoText>
          </Field>
          <Field label="Session">
            <MonoText muted>{d?.sessionName ?? '—'}</MonoText>
          </Field>
          <Field label="Run name">
            <MonoText muted>{d?.runName ?? '—'}</MonoText>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeader title="GPU" />
        </CardHeader>
        <CardBody className="flex flex-col py-1g">
          <Field label="Devices">
            <MonoText muted>{formatGpu(detail.gpu)}</MonoText>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeader title="Cost" />
        </CardHeader>
        <CardBody className="flex flex-col py-1g">
          <Field label="Cost">
            <MonoText muted>{formatCost(detail.metrics.costUsd)}</MonoText>
          </Field>
          <Field label="Turns">
            <MonoText muted>{formatNum(detail.metrics.numTurns)}</MonoText>
          </Field>
          <Field label="Duration">
            <MonoText muted>{formatDuration(detail.metrics.durationS)}</MonoText>
          </Field>
        </CardBody>
      </Card>
    </div>
  );
}
