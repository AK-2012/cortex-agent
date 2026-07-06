import type { ReactNode } from 'react';

// Surface card primitive (DR-0018 §5): white card, 1px token border, 10px radius,
// subtle token shadow. `padded` applies the standard 16px (2g) inset.

export interface CardProps {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}

export function Card({ children, className, padded }: CardProps) {
  return (
    <div
      className={[
        'rounded-card border border-card bg-surface-card shadow-card',
        padded ? 'p-2g' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={['border-b border-card px-2g py-1.5g', className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={['p-2g', className].filter(Boolean).join(' ')}>{children}</div>;
}
