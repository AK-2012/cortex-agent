import { Outlet } from 'react-router-dom';
import { CommandPalette } from '@/features/command-palette/CommandPalette';
import { useCommandPalette } from '@/features/command-palette/useCommandPalette';
import { ExecutionLogDrawerProvider } from '@/features/execution/ExecutionLogDrawerProvider';

// App shell (Stage-R RB, task f528): a pass-through layout. The prototype is a single full-screen
// frame owned by each view — `/workbench` (WorkbenchPage) renders the 240/fluid/400 three-pane
// frame including its own left rail; other routes render full-bleed. The old token-summary nav
// LeftRail was removed (superseded). The global ⌘K command palette (design 6c) and the execution
// log drawer (design 09-exec-logs) stay mounted here so any dispatch row can open the drawer.
export function AppShell() {
  const { open, setOpen } = useCommandPalette();
  return (
    <ExecutionLogDrawerProvider>
      <Outlet />
      <CommandPalette open={open} onOpenChange={setOpen} />
    </ExecutionLogDrawerProvider>
  );
}
