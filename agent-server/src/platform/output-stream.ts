// input:  nothing (pure types module)
// output: OutputStream / MutableRegion / OpenOutputStreamOpts types
// pos:    Platform-neutral output streaming interface

import type { MessageRef, Destination, RichBlock, ActionElement, DurableHooks } from './types.js';

export interface MutableRegion {
  /** Replace the region's content. No-op once the stream commits past this region. */
  update(text: string): void;
}

export interface OutputStream {
  /** Emit committed assistant text — a hard boundary for aggregation. */
  emitText(text: string): void;

  /** Open a fresh mutable region, returning a handle for updates.
   *  The region is sealed when emitText, openMutable, or postInteractive is called next. */
  openMutable(text: string): MutableRegion;

  /** Post an independent interactive message (buttons, actions). Resets the internal cursor. */
  postInteractive(text: string, opts?: {
    richBlocks?: RichBlock[];
    actions?: ActionElement[];
  }): Promise<MessageRef | null>;

  /** Await all queued operations and surface any captured errors. */
  flush(): Promise<void>;

  /** All MessageRefs posted by this stream, in order. */
  getRefs(): MessageRef[];

  /** The first MessageRef posted (the parent / root of the thread). */
  getParentRef(): MessageRef | null;
}

export interface OpenOutputStreamOpts {
  threadId?: string | null;
  onMessagePosted?: ((ref: MessageRef) => void) | null;
  durable?: DurableHooks | null;
}
