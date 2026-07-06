import { Outlet } from 'react-router-dom';
import { LeftRail } from './LeftRail';
import { RightPanel } from './RightPanel';
import { CommandPalette } from '@/features/command-palette/CommandPalette';
import { useCommandPalette } from '@/features/command-palette/useCommandPalette';

// Three-pane workbench chrome (design 3a): left rail nav · center outlet · right panel.
// The ⌘K command palette (design 6c) is mounted here so it is global across all routes.
export function AppShell() {
  const { open, setOpen } = useCommandPalette();
  return (
    <div className="flex h-full w-full bg-surface-canvas">
      <LeftRail />
      <main className="min-w-0 flex-1 overflow-auto p-2g">
        <Outlet />
      </main>
      <RightPanel />
      <CommandPalette open={open} onOpenChange={setOpen} />
    </div>
  );
}
