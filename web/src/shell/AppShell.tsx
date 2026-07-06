import { Outlet } from 'react-router-dom';
import { LeftRail } from './LeftRail';
import { RightPanel } from './RightPanel';

// Three-pane workbench chrome (design 3a): left rail nav · center outlet · right panel.
export function AppShell() {
  return (
    <div className="flex h-full w-full bg-surface-canvas">
      <LeftRail />
      <main className="min-w-0 flex-1 overflow-auto p-2g">
        <Outlet />
      </main>
      <RightPanel />
    </div>
  );
}
