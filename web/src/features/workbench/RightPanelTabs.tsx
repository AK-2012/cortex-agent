import { useState } from 'react';
import { Tab, TabPanel, TabsList, TabsRoot } from '@/design';
import { TasksPanel } from '@/features/tasks/TasksPanel';
import { ThreadsPanel } from './ThreadsPanel';
import { MachinesPanel } from './MachinesPanel';
import { SCOPES, taskScopeFilter, type Scope } from './scope';

const SCOPE_LABEL: Record<Scope, string> = { active: 'Active', history: 'History' };

function ScopeToggle({ scope, onChange }: { scope: Scope; onChange: (s: Scope) => void }) {
  return (
    <div className="flex items-center gap-0.5g rounded-card bg-surface-canvas-alt p-0.5g">
      {SCOPES.map((s) => (
        <button
          key={s}
          type="button"
          data-scope={s}
          aria-pressed={scope === s}
          onClick={() => onChange(s)}
          className={[
            'rounded-card px-1g py-0.5g text-ui font-medium transition-colors',
            scope === s
              ? 'bg-surface-card text-state-ink shadow-card'
              : 'text-state-ink/50 hover:text-state-ink',
          ].join(' ')}
        >
          {SCOPE_LABEL[s]}
        </button>
      ))}
    </div>
  );
}

// Right pane (design 3a): Threads | Tasks | Machines tabs + a shared Active/History filter.
// The filter drives Threads (status[]) and Tasks (open|done); Machines ignores it (placeholder).
export function RightPanelTabs() {
  const [scope, setScope] = useState<Scope>('active');

  return (
    <aside className="flex h-full w-96 shrink-0 flex-col border-l border-card bg-surface-rail p-1.5g">
      <TabsRoot defaultValue="threads" className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-1g">
          <TabsList>
            <Tab value="threads">Threads</Tab>
            <Tab value="tasks">Tasks</Tab>
            <Tab value="machines">Machines</Tab>
          </TabsList>
          <ScopeToggle scope={scope} onChange={setScope} />
        </div>

        <TabPanel value="threads" className="flex min-h-0 flex-1 flex-col">
          <ThreadsPanel scope={scope} />
        </TabPanel>
        <TabPanel value="tasks" className="flex min-h-0 flex-1 flex-col">
          <TasksPanel lifecycle={taskScopeFilter(scope)} />
        </TabPanel>
        <TabPanel value="machines" className="flex min-h-0 flex-1 flex-col">
          <MachinesPanel />
        </TabPanel>
      </TabsRoot>
    </aside>
  );
}
