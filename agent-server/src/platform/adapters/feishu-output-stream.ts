// input:  FeishuAdapter + output-stream interfaces
// output: FeishuOutputStream
// pos:    Feishu-specific OutputStream — no messageEdit, no coalescing.
//         Each emitText posts a new message; openMutable returns a no-op region.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { createLogger } from '@core/log.js';
import type { FeishuAdapter } from './feishu.js';
import type { OutputStream, MutableRegion, OpenOutputStreamOpts } from '../output-stream.js';
import type { MessageRef, Destination, RichBlock, ActionElement, DurableHooks } from '../types.js';
import { chunkText, DEFAULT_MAX_CHUNK } from '../output-stream-chunk.js';

const log = createLogger('feishu-output-stream');

export class FeishuOutputStream implements OutputStream {
  private adapter: FeishuAdapter;
  private destination: Destination;
  private threadId: string | null;
  private onMessagePosted: ((ref: MessageRef) => void) | null;
  private maxChunk: number;
  private durable: DurableHooks | null;

  private parentRef: MessageRef | null = null;
  private allRefs: MessageRef[] = [];
  private queue: Promise<void> = Promise.resolve();
  private lastError: Error | null = null;

  constructor(adapter: FeishuAdapter, destination: Destination, opts?: OpenOutputStreamOpts) {
    this.adapter = adapter;
    this.destination = destination;
    this.threadId = opts?.threadId ?? null;
    this.onMessagePosted = opts?.onMessagePosted ?? null;
    this.durable = opts?.durable ?? null;
    this.maxChunk = adapter.capabilities.maxMessageLength || DEFAULT_MAX_CHUNK;
  }

  emitText(text: string): void {
    if (!text?.trim()) return;
    this.queue = this.queue.then(() => this._postChunks(text)).catch(e => {
      log.error(`Queue error in emitText (len=${text.length}):`, (e as Error).message);
      this.lastError = e instanceof Error ? e : new Error(String(e));
    });
  }

  /** Feishu has no messageEdit — return a no-op MutableRegion. */
  openMutable(_text: string): MutableRegion {
    return { update: () => {} };
  }

  postInteractive(text: string, opts?: {
    richBlocks?: RichBlock[];
    actions?: ActionElement[];
  }): Promise<MessageRef | null> {
    const richBlocks = opts?.richBlocks;
    const actions = opts?.actions;
    return new Promise<MessageRef | null>((resolve, reject) => {
      this.queue = this.queue.then(async () => {
        try {
          const effectiveThreadId = this.threadId || this.parentRef?.messageId || undefined;
          const ref = actions && actions.length > 0
            ? await this.adapter.postInteractive(this.destination, { text, richBlocks, actions }, { threadId: effectiveThreadId })
            : await this.adapter.postMessage(this.destination, { text, richBlocks }, { threadId: effectiveThreadId });

          if (!this.parentRef && !this.threadId) this.parentRef = ref;
          this.allRefs.push(ref);
          if (this.onMessagePosted) this.onMessagePosted(ref);
          resolve(ref);
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          log.error(`postInteractive failed:`, err.message);
          this.lastError = err;
          reject(err);
          throw err;
        }
      }).catch(e => {
        const err = e instanceof Error ? e : new Error(String(e));
        this.lastError = err;
        reject(err);
      });
    });
  }

  async flush(): Promise<void> {
    await this.queue.catch(() => {});
    if (this.lastError) {
      const err = this.lastError;
      this.lastError = null;
      throw err;
    }
  }

  getRefs(): MessageRef[] {
    return [...this.allRefs];
  }

  getParentRef(): MessageRef | null {
    return this.parentRef;
  }

  private async _postChunks(text: string): Promise<void> {
    const chunks = chunkText(text, this.maxChunk);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      const effectiveThreadId = this.threadId || this.parentRef?.messageId || undefined;
      let walId: string | null = null;
      try {
        walId = this.durable
          ? await this.durable.beforePost(this.destination, chunk, { threadId: effectiveThreadId })
          : null;

        const ref = await this.adapter.postMessage(this.destination, { text: chunk }, { threadId: effectiveThreadId });

        if (walId && this.durable) {
          await this.durable.afterSent(walId, ref.messageId).catch(() => {});
        }

        if (!this.parentRef && !this.threadId && this.allRefs.length === 0 && i === 0) {
          this.parentRef = ref;
        }
        this.allRefs.push(ref);
        if (this.onMessagePosted) this.onMessagePosted(ref);
      } catch (e) {
        if (walId && this.durable?.onSendFailed) {
          this.durable.onSendFailed(walId);
        }
        throw e;
      }
    }
  }
}
