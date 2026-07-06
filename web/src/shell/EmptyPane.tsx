export function EmptyPane({ title }: { title: string }) {
  return (
    <section className="flex h-full flex-col">
      <h1 className="mb-2g text-body font-medium text-state-ink">{title}</h1>
      <div className="flex flex-1 items-center justify-center rounded-card border border-card bg-surface-card text-ui text-state-ink/40 shadow-card">
        Nothing here yet
      </div>
    </section>
  );
}
