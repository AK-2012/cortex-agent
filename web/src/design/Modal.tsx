import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

// Token-styled wrapper over Radix Dialog (approved primitive layer, DR-0018 §1):
// focus trap, esc-to-close, aria-modal, scroll-lock and focus restore come from
// Radix; colors/spacing/radius/shadow are token-only. Supports controlled
// (`open`/`onOpenChange`) and uncontrolled (`trigger`) usage. A `title` is
// required so screen readers and Radix's a11y check are satisfied; pass
// `hideTitle` to keep it visually hidden while still announced.

const OVERLAY_CLASS =
  'fixed inset-0 z-40 bg-state-ink/40 ' +
  'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out ' +
  'motion-reduce:animate-none';

const CONTENT_CLASS =
  'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 ' +
  'flex max-h-[85vh] w-[90vw] max-w-lg flex-col gap-2g ' +
  'rounded-card border border-card bg-surface-card p-3g shadow-overlay ' +
  'focus:outline-none ' +
  'data-[state=open]:animate-zoom-in data-[state=closed]:animate-zoom-out ' +
  'motion-reduce:animate-none';

export interface ModalProps {
  title: ReactNode;
  description?: ReactNode;
  hideTitle?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Modal({
  title,
  description,
  hideTitle,
  children,
  footer,
  trigger,
  open,
  onOpenChange,
}: ModalProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger> : null}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={OVERLAY_CLASS} />
        <RadixDialog.Content className={CONTENT_CLASS}>
          <div className="flex items-start justify-between gap-2g">
            <RadixDialog.Title
              className={hideTitle ? 'sr-only' : 'text-body font-medium text-state-ink'}
            >
              {title}
            </RadixDialog.Title>
            <RadixDialog.Close
              aria-label="Close"
              className="-mr-1g -mt-1g rounded-card p-0.5g text-ui text-state-ink/60 transition-colors hover:bg-surface-canvas-alt hover:text-state-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-run/40"
            >
              ✕
            </RadixDialog.Close>
          </div>
          {description ? (
            <RadixDialog.Description className="text-ui text-state-ink/70">
              {description}
            </RadixDialog.Description>
          ) : null}
          {children ? <div className="overflow-y-auto text-ui text-state-ink/80">{children}</div> : null}
          {footer ? <div className="flex items-center justify-end gap-1g pt-1g">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const ModalClose = RadixDialog.Close;
