import { useState } from 'react';
import type { SessionInfo } from '@cortex-agent/ui-contract';
import { SessionList } from './SessionList';
import { ChatPlaceholder } from './ChatPlaceholder';
import { RightPanelTabs } from './RightPanelTabs';

// Workbench (design 3a): three-pane core screen — session list (left) · chat placeholder
// (center) · Threads/Tasks/Machines tabs + Active/History filter (right). Renders full-bleed
// inside the app shell's content area; owns the selected-session state shared left↔center.
export function WorkbenchPage() {
  const [selected, setSelected] = useState<SessionInfo | null>(null);

  return (
    <div className="flex h-full w-full">
      <SessionList
        selectedId={selected?.sessionId ?? null}
        onSelect={(s: SessionInfo) => setSelected(s)}
      />
      <main className="min-w-0 flex-1 overflow-hidden">
        <ChatPlaceholder session={selected} />
      </main>
      <RightPanelTabs />
    </div>
  );
}
