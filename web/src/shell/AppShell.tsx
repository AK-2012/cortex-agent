import { Outlet } from 'react-router-dom';
import { CommandPalette } from '@/features/command-palette/CommandPalette';
import { useCommandPalette } from '@/features/command-palette/useCommandPalette';
import { ExecutionLogDrawerProvider } from '@/features/execution/ExecutionLogDrawerProvider';
import { ApprovalsProvider } from '@/features/approvals/ApprovalsProvider';

// App shell (Stage-R RB, task f528): a pass-through layout. The prototype is a single full-screen
// frame owned by each view — `/workbench` (WorkbenchPage) renders the 240/fluid/400 three-pane
// frame including its own left rail; other routes render full-bleed. The old token-summary nav
// LeftRail was removed (superseded). The global ⌘K command palette (design 6c), the execution
// log drawer (design 09-exec-logs), and the approval center overlay (design 7a) stay mounted here
// so any banner / dispatch row / approval card can open them.
export function AppShell() {
  const { open, setOpen } = useCommandPalette();
  return (
    <ExecutionLogDrawerProvider>
      <ApprovalsProvider>
        <Outlet />
        <CommandPalette open={open} onOpenChange={setOpen} />
      </ApprovalsProvider>
    </ExecutionLogDrawerProvider>
  );
}
