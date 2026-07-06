import { NavLink } from 'react-router-dom';

const NAV = [
  { to: '/workbench', label: 'Workbench' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/threads', label: 'Threads' },
  { to: '/overview', label: 'Overview' },
  { to: '/settings', label: 'Settings' },
  { to: '/kit', label: 'Kit' },
] as const;

export function LeftRail() {
  return (
    <nav className="flex h-full w-56 shrink-0 flex-col gap-0.5g border-r border-card bg-surface-rail p-1g">
      <div className="px-1g py-1.5g font-mono text-ui font-medium tracking-tight text-state-ink">
        Cortex
      </div>
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            [
              'rounded-card px-1g py-0.5g text-ui transition-colors',
              isActive
                ? 'bg-pill-running-bg text-pill-running-fg'
                : 'text-state-ink/70 hover:bg-surface-canvas-alt',
            ].join(' ')
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
