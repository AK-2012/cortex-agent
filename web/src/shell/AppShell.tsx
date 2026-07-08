import { Outlet } from 'react-router-dom';
import { CommandPalette } from '@/features/command-palette/CommandPalette';
import { useCommandPalette } from '@/features/command-palette/useCommandPalette';
import { ExecutionLogDrawerProvider } from '@/features/execution/ExecutionLogDrawerProvider';
import { ScheduleModalProvider } from '@/features/schedule/ScheduleModalProvider';

// App shell (Stage-R RB, task f528): a pass-through layout. The prototype is a single full-screen
// frame owned by each view — `/workbench` (WorkbenchPage) renders the 240/fluid/400 three-pane
// frame including its own left rail; other routes render full-bleed. The old token-summary nav
// LeftRail was removed (superseded). The global ⌘K command palette (design 6c), the execution
// log drawer (design 09-exec-logs) and the New-schedule overlay (design 7c) stay mounted here so
// any surface can open them.
export function AppShell() {
  const { open, setOpen } = useCommandPalette();
  return (
    <ExecutionLogDrawerProvider>
      <ScheduleModalProvider>
        <Outlet />
        <CommandPalette open={open} onOpenChange={setOpen} />
      </ScheduleModalProvider>
    </ExecutionLogDrawerProvider>
  );
}
