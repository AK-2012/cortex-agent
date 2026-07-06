import type { ReactNode } from 'react';
import type { SessionInfo } from '@cortex-agent/ui-contract';
import { Card, CardBody, CardHeader, EmptyState, ID, MonoText } from '@/design';

export interface ChatPlaceholderProps {
  session: SessionInfo | null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5g">
      <span className="w-24 shrink-0 text-ui text-state-ink/45">{label}</span>
      <span className="min-w-0 text-ui text-state-ink">{children}</span>
    </div>
  );
}

// Center pane (design 3a): chat placeholder. The current ui-service contract exposes only
// session metadata (no transcript / message-history query scope — live chat is Stage 4, §2.1),
// so this renders the selected session read-only + a note, or an empty prompt when none selected.
export function ChatPlaceholder({ session }: ChatPlaceholderProps) {
  if (!session) {
    return (
      <div className="flex h-full items-center justify-center p-2g">
        <EmptyState
          title="Select a session"
          description="Pick a session on the left to view it. Live chat arrives in a later stage."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2g overflow-auto p-2g">
      <Card>
        <CardHeader>
          <span className="text-body font-medium text-state-ink">{session.label || session.name}</span>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-1g">
            <Field label="Session">
              <ID value={session.sessionId} copyable />
            </Field>
            <Field label="Project">
              <MonoText muted>{session.projectId}</MonoText>
            </Field>
            <Field label="Backend">
              <MonoText muted>{session.backend}</MonoText>
            </Field>
            <Field label="Kind">
              <MonoText muted>{session.kind}</MonoText>
            </Field>
            <Field label="Created">
              <MonoText muted>{session.createdAt}</MonoText>
            </Field>
            <Field label="Last used">
              <MonoText muted>{session.lastUsedAt}</MonoText>
            </Field>
          </div>
        </CardBody>
      </Card>

      <EmptyState
        title="Chat is read-only"
        description="This is a placeholder. Sending messages and streaming assistant output land in a later stage (backend session mutate + event stream)."
        className="flex-1"
      />
    </div>
  );
}
