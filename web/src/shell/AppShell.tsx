import { Outlet } from 'react-router-dom';
import { LeftRail } from './LeftRail';

// App chrome: left rail nav + routed content. Each route owns its own content region — the
// workbench 3a is itself three-pane and provides its own right panel — so there is no shared
// global right panel here. Content is full-bleed; pages add their own padding/scroll.
export function AppShell() {
  return (
    <div className="flex h-full w-full bg-surface-canvas">
      <LeftRail />
      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
