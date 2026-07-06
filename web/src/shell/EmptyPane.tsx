import { EmptyState } from '@/design';

export function EmptyPane({ title }: { title: string }) {
  return (
    <section className="flex h-full flex-col">
      <h1 className="mb-2g text-body font-medium text-state-ink">{title}</h1>
      <EmptyState title="Nothing here yet" className="flex-1" />
    </section>
  );
}
