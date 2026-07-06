import { Outlet } from 'react-router-dom';
import { LeftRail } from './LeftRail';
import { CommandPalette } from '@/features/command-palette/CommandPalette';
import { useCommandPalette } from '@/features/command-palette/useCommandPalette';

// App chrome: left rail nav + routed content. Each route owns its own content region — the
// workbench 3a is itself three-pane and provides its own right panel — so there is no shared
// global right panel here. Content is full-bleed; pages add their own padding/scroll.
// The ⌘K command palette (design 6c) is mounted here so it is global across all routes.
export function AppShell() {
  const { open, setOpen } = useCommandPalette();
  return (
    <div className="flex h-full w-full bg-surface-canvas">
      <LeftRail />
      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </div>
  );
}
