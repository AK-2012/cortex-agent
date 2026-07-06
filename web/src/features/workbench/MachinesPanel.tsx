import { EmptyState } from '@/design';

// Workbench right-panel Machines tab (design 3a): placeholder empty state. The machines
// registry query (machines.json + client-manager) is a Stage-7 backend extension (§2.1),
// so there is no real data to render yet. The Active/History filter is a no-op here.
export function MachinesPanel() {
  return (
    <EmptyState
      title="Machines"
      description="Connected machines and their status will appear here in a later stage."
      className="flex-1"
    />
  );
}
