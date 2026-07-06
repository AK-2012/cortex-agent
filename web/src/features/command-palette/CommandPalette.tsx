import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { useTRPC } from '@/lib/trpc';
import { buildPaletteItems, NAV_COMMANDS, type PaletteGroup } from './palette-items';

const OVERLAY_CLASS =
  'fixed inset-0 z-40 bg-state-ink/40 ' +
  'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out ' +
  'motion-reduce:animate-none';

const CONTENT_CLASS =
  'fixed left-1/2 top-[15vh] z-50 -translate-x-1/2 ' +
  'flex max-h-[70vh] w-[90vw] max-w-xl flex-col overflow-hidden ' +
  'rounded-card border border-card bg-surface-card shadow-overlay ' +
  'focus:outline-none ' +
  'data-[state=open]:animate-zoom-in data-[state=closed]:animate-zoom-out ' +
  'motion-reduce:animate-none';

const GROUP_ORDER: PaletteGroup[] = ['Sessions', 'Threads', 'Tasks'];

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ⌘K command palette (design 6c): searches real sessions/threads/tasks over tRPC and
// navigates via React Router. Keyboard-only reachable — cmdk provides ↑/↓/Enter + focus
// trap; Esc/overlay close come from the underlying Radix Dialog. File search is out of
// scope (no fs-read tRPC scope until Stage 6, plan §2.1).
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const trpc = useTRPC();
  const navigate = useNavigate();

  // Fetch the three lists only while the palette is open; cmdk does the fuzzy filtering.
  const sessionsQuery = useQuery(trpc.sessions.list.queryOptions({}, { enabled: open }));
  const threadsQuery = useQuery(trpc.threads.list.queryOptions({}, { enabled: open }));
  const tasksQuery = useQuery(trpc.tasks.list.queryOptions({}, { enabled: open }));

  const items = useMemo(
    () =>
      buildPaletteItems({
        sessions: sessionsQuery.data ?? [],
        threads: threadsQuery.data ?? [],
        tasks: tasksQuery.data ?? [],
      }),
    [sessionsQuery.data, threadsQuery.data, tasksQuery.data],
  );

  const loading = sessionsQuery.isFetching || threadsQuery.isFetching || tasksQuery.isFetching;

  const go = (route: string, focusId?: string) => {
    navigate(route, focusId ? { state: { focusId } } : undefined);
    onOpenChange(false);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      overlayClassName={OVERLAY_CLASS}
      contentClassName={CONTENT_CLASS}
      loop
    >
      <Command.Input
        autoFocus
        placeholder="Search sessions, threads, tasks…"
        className="w-full border-b border-card bg-transparent px-2g py-1.5g text-body text-state-ink placeholder:text-state-ink/40 focus:outline-none"
      />
      <Command.List className="min-h-0 flex-1 overflow-y-auto p-1g">
        {loading && (
          <Command.Loading className="px-1.5g py-1g text-ui text-state-ink/40">
            Loading…
          </Command.Loading>
        )}
        <Command.Empty className="px-1.5g py-2g text-center text-ui text-state-ink/40">
          No results.
        </Command.Empty>

        <Command.Group
          heading="Commands"
          className="mb-1g text-ui [&_[cmdk-group-heading]]:px-1.5g [&_[cmdk-group-heading]]:py-0.5g [&_[cmdk-group-heading]]:text-ui [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-state-ink/45"
        >
          {NAV_COMMANDS.map((cmd) => (
            <Command.Item
              key={cmd.id}
              value={cmd.id}
              keywords={[cmd.label, ...cmd.keywords]}
              onSelect={() => go(cmd.route)}
              className="flex cursor-pointer items-center gap-1g rounded-card px-1.5g py-1g text-ui text-state-ink/80 data-[selected=true]:bg-pill-running-bg data-[selected=true]:text-pill-running-fg"
            >
              {cmd.label}
            </Command.Item>
          ))}
        </Command.Group>

        {GROUP_ORDER.map((group) => {
          const groupItems = items.filter((i) => i.group === group);
          if (groupItems.length === 0) return null;
          return (
            <Command.Group
              key={group}
              heading={group}
              className="mb-1g text-ui [&_[cmdk-group-heading]]:px-1.5g [&_[cmdk-group-heading]]:py-0.5g [&_[cmdk-group-heading]]:text-ui [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-state-ink/45"
            >
              {groupItems.map((item) => (
                <Command.Item
                  key={item.id}
                  value={item.id}
                  keywords={[item.label, ...item.keywords]}
                  onSelect={() => go(item.route, item.focusId)}
                  className="flex cursor-pointer items-center gap-1g rounded-card px-1.5g py-1g font-mono text-ui text-state-ink/80 data-[selected=true]:bg-pill-running-bg data-[selected=true]:text-pill-running-fg"
                >
                  {item.label}
                </Command.Item>
              ))}
            </Command.Group>
          );
        })}
      </Command.List>
    </Command.Dialog>
  );
}
