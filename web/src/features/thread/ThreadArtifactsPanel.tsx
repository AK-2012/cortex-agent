import type { ThreadArtifactRefs } from '@cortex-agent/ui-contract';
import { Card, CardBody, CardHeader, ID, MonoText, StatusPill } from '@/design';

// Thread-level artifacts right rail (design 11b, DR-0018 §6.3 F2). The thread artifact belongs to
// the whole thread (all steps co-write it), so it lives here persistently — unchanged when the
// active step in the left pipeline switches.
//
// Scope-honesty (plan §2.1): the B1 `ThreadArtifactRefs` DTO carries only *references*
// (artifactPath/workspacePath/task), NOT the document body or per-step write-trail — reading file
// content over tRPC is a Stage-6 fs-read scope. This rail therefore renders the artifact refs; the
// live document viewer + write-trail is explicitly deferred.

function RefRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1g">
      <span className="w-[9ch] shrink-0 text-ui text-state-ink/45">{label}</span>
      <ID value={value} className="min-w-0 break-all" />
    </div>
  );
}

export interface ThreadArtifactsPanelProps {
  artifacts: ThreadArtifactRefs;
  live: boolean;
}

export function ThreadArtifactsPanel({ artifacts, live }: ThreadArtifactsPanelProps) {
  const hasAny =
    artifacts.artifactPath || artifacts.workspacePath || artifacts.taskId || artifacts.taskProject;

  return (
    <div data-thread-artifacts="true">
      <Card>
      <CardHeader>
        <div className="flex items-center gap-1g">
          <span className="text-ui font-medium text-state-ink">Thread artifact</span>
          {live && <StatusPill tone="running" label="live" />}
        </div>
      </CardHeader>
      <CardBody>
        {hasAny ? (
          <div className="flex flex-col gap-1g">
            {artifacts.artifactPath && <RefRow label="artifact" value={artifacts.artifactPath} />}
            {artifacts.workspacePath && <RefRow label="workspace" value={artifacts.workspacePath} />}
            {artifacts.taskProject && artifacts.taskId && (
              <RefRow label="task" value={`${artifacts.taskProject}/${artifacts.taskId}`} />
            )}
            {artifacts.taskProject && !artifacts.taskId && (
              <RefRow label="project" value={artifacts.taskProject} />
            )}
            <MonoText muted className="pt-1g text-state-ink/40">
              Document viewer + write-trail — Stage 6 (fs-read scope).
            </MonoText>
          </div>
        ) : (
          <div className="text-ui text-state-ink/40">No artifact for this thread.</div>
        )}
      </CardBody>
      </Card>
    </div>
  );
}
