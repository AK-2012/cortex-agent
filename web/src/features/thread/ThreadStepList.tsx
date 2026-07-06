import type { ReactNode } from 'react';
import type {
  ThreadDetail,
  ThreadStepDetail,
  ThreadDispatchInfo,
  ThreadChildNode,
  ThreadAgentFlow,
} from '@cortex-agent/ui-contract';
import { ID, MonoText, StatusPill } from '@/design';
import { activeStepChildren, selectActiveStep, stepSummaryParts } from './thread-steps';

// Shared thread-pipeline primitive (design 11a/11b/2b, DR-0018 §6.3 F1). Renders a ThreadDetail's
// steps as a vertical pipeline: completed/pending steps collapse to one line; the single active
// (running) step expands its children — machine dispatches (Execute) and/or subthreads (Review) —
// plus the live agent flow. Purely presentational: data fetching + live-sync live in the consuming
// card (InlineThreadCard). Token-only styling (no hard-coded hex).

function stepLabel(step: ThreadStepDetail): string {
  return step.stage ?? `step ${step.stepIndex + 1}`;
}

function CollapsedStep({ step, totalSteps }: { step: ThreadStepDetail; totalSteps: number }) {
  const parts = stepSummaryParts(step).filter((p) => p !== step.stage);
  return (
    <div
      data-step-index={step.stepIndex}
      data-step-status={step.status}
      className="flex items-center gap-1g py-0.5g"
    >
      <StatusPill status={step.status} />
      <span className="font-mono text-ui text-state-ink/45">
        {step.stepIndex + 1}/{totalSteps}
      </span>
      <span className="truncate text-ui text-state-ink" title={step.outputSummary ?? undefined}>
        {stepLabel(step)}
      </span>
      {parts.length > 0 && (
        <MonoText muted className="ml-auto shrink-0">
          {parts.join(' · ')}
        </MonoText>
      )}
    </div>
  );
}

function DispatchRow({ dispatch }: { dispatch: ThreadDispatchInfo }) {
  return (
    <div
      data-dispatch-id={dispatch.executionId}
      className="flex items-center gap-1g rounded-card border border-card bg-surface-card px-1g py-0.5g shadow-card"
    >
      <StatusPill status={dispatch.status} />
      <span className="truncate text-ui text-state-ink">{dispatch.machine ?? 'local'}</span>
      <MonoText muted className="shrink-0">
        {dispatch.type}
      </MonoText>
      <ID value={dispatch.executionId} className="ml-auto shrink-0" />
    </div>
  );
}

function SubthreadRow({ node }: { node: ThreadChildNode }) {
  return (
    <div
      data-child-thread-id={node.id}
      className="flex items-center gap-1g rounded-card border border-card bg-surface-card px-1g py-0.5g shadow-card"
    >
      <StatusPill status={node.status} />
      <ID value={node.id} />
      <span className="truncate text-ui text-state-ink/70">{node.templateName ?? '—'}</span>
      <MonoText muted className="ml-auto shrink-0">
        ${node.costUsd.toFixed(2)}
      </MonoText>
    </div>
  );
}

function AgentFlowRow({ flow }: { flow: ThreadAgentFlow }) {
  return (
    <div className="flex items-center gap-1g text-ui">
      <StatusPill status={flow.status} />
      <span className="text-state-ink">{flow.profile}</span>
      {flow.stage && <MonoText muted>{flow.stage}</MonoText>}
      {flow.lastOutput && (
        <span className="truncate text-state-ink/50" title={flow.lastOutput}>
          {flow.lastOutput}
        </span>
      )}
    </div>
  );
}

function ActiveStep({
  step,
  totalSteps,
  dispatches,
  subthreads,
  agentFlow,
  renderSubthreads,
}: {
  step: ThreadStepDetail;
  totalSteps: number;
  dispatches: ThreadDispatchInfo[];
  subthreads: ThreadChildNode[];
  agentFlow: ThreadAgentFlow | null;
  renderSubthreads?: (subthreads: ThreadChildNode[]) => ReactNode;
}) {
  return (
    <div
      data-step-index={step.stepIndex}
      data-step-status={step.status}
      data-active-step="true"
      className="rounded-card border border-state-run/30 bg-pill-running-bg/40 px-1.5g py-1g"
    >
      <div className="flex items-center gap-1g">
        <StatusPill status={step.status} />
        <span className="font-mono text-ui text-state-ink/45">
          {step.stepIndex + 1}/{totalSteps}
        </span>
        <span className="text-ui font-medium text-state-ink">{stepLabel(step)}</span>
      </div>

      <div className="mt-1g flex flex-col gap-1g pl-1.5g">
        {agentFlow && <AgentFlowRow flow={agentFlow} />}

        {dispatches.length > 0 && (
          <div className="flex flex-col gap-0.5g">
            <span className="text-ui text-state-ink/45">Dispatches</span>
            {dispatches.map((d) => (
              <DispatchRow key={d.executionId} dispatch={d} />
            ))}
          </div>
        )}

        {subthreads.length > 0 &&
          (renderSubthreads ? (
            // Slot owns the whole SUB-THREADS section incl. its own header (11b nested panel 2b).
            renderSubthreads(subthreads)
          ) : (
            <div className="flex flex-col gap-0.5g">
              <span className="text-ui text-state-ink/45">Subthreads</span>
              {subthreads.map((n) => (
                <SubthreadRow key={n.id} node={n} />
              ))}
            </div>
          ))}

        {!agentFlow && dispatches.length === 0 && subthreads.length === 0 && (
          <span className="text-ui text-state-ink/40">No active work yet.</span>
        )}
      </div>
    </div>
  );
}

export interface ThreadStepListProps {
  detail: ThreadDetail;
  // Optional slot for the active step's SUB-THREADS region. Default = a flat list of one-line
  // subthread rows (11a inline card). The 11b detail page passes the nested-thread panel (2b).
  renderSubthreads?: (subthreads: ThreadChildNode[]) => ReactNode;
}

export function ThreadStepList({ detail, renderSubthreads }: ThreadStepListProps) {
  const active = selectActiveStep(detail);
  const children = activeStepChildren(detail);

  if (detail.steps.length === 0) {
    return <div className="text-ui text-state-ink/40">No steps yet.</div>;
  }

  return (
    <ol className="flex flex-col gap-0.5g">
      {detail.steps.map((step) => {
        const isActive = active != null && step.stepIndex === active.stepIndex;
        return (
          <li key={step.stepIndex}>
            {isActive && children ? (
              <ActiveStep
                step={step}
                totalSteps={detail.totalSteps}
                dispatches={children.dispatches}
                subthreads={children.subthreads}
                agentFlow={children.agentFlow}
                renderSubthreads={renderSubthreads}
              />
            ) : (
              <CollapsedStep step={step} totalSteps={detail.totalSteps} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
