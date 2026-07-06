import { useCallback, useState } from 'react';
import { MonoText } from './MonoText';

// Identifier primitive: renders an id in monospace. When `copyable`, clicking
// copies the value to the clipboard with a transient ✓ affordance (no toast dep).

export interface IDProps {
  value: string;
  copyable?: boolean;
  className?: string;
}

export function ID({ value, copyable, className }: IDProps) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [value]);

  if (!copyable) {
    return (
      <MonoText muted className={className}>
        {value}
      </MonoText>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? 'Copied' : 'Copy'}
      className={[
        'group inline-flex items-center gap-0.5g rounded-card px-0.5g font-mono text-ui',
        'text-state-ink/60 transition-colors hover:bg-surface-canvas-alt hover:text-state-ink',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-run/40',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {value}
      <span className="text-state-ink/40 group-hover:text-state-ink/70">
        {copied ? '✓' : '⧉'}
      </span>
    </button>
  );
}
