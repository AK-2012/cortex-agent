// input:  PlatformAdapter, MessageRef/RichBlock/ActionElement
// output: VirtualMessage class + append/flush/postStandalone/mutableTail
// pos:    Platform-independent continuous message aggregator
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { createLogger } from '@core/log.js';
import type { PlatformAdapter } from './adapter.js';
import type { MessageRef, MessageContent, RichBlock, ActionElement, Destination, DurableHooks } from './types.js';

const log = createLogger('virtual-message');

const SEPARATOR = '\n';
const TAIL_SEPARATOR = '\n';
const DEFAULT_MAX_CHUNK = 3000;
const MAX_HORIZONTAL_RULES = 3;
// Retry delays for transient adapter failures (Slack rate-limits typically last
// 1–5s). Total wall time across all retries: ~6.3s, comfortably under the
// caller-side timeouts but long enough to ride out a typical rate-limit.
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [200, 600, 1500, 4000];
let retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS;

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetries<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  const delays = retryDelaysMs;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < delays.length) {
        const delay = delays[attempt];
        log.warn(`${label} attempt ${attempt + 1} failed (${(e as Error).message}); retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

/**
 * Test-only: override retry delays to skip real wall-clock waits.
 * Pass [] for no retries, [0,0,0,0] to keep 4-attempt retry semantics with no wait.
 * Production code must never call this.
 */
export function _testSetRetryDelays(delays: readonly number[]): void {
  retryDelaysMs = delays;
}

/** Test-only: restore production retry delays. */
export function _testResetRetryDelays(): void {
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS;
}

function countHorizontalRules(text: string): number {
  return text.split('\n').filter(line => /^-{3,}\s*$/.test(line.trim())).length;
}

function countTables(text: string): number {
  const lines = text.split('\n');
  let count = 0;
  let inTable = false;
  for (const line of lines) {
    const isTableLine = /^\s*\|/.test(line);
    if (isTableLine && !inTable) { count++; inTable = true; }
    else if (!isTableLine) { inTable = false; }
  }
  return count;
}

function needsSplit(text: string, maxChunk: number): boolean {
  return countTables(text) > 1
    || text.length > maxChunk
    || countHorizontalRules(text) >= MAX_HORIZONTAL_RULES;
}

function chunkText(text: string, maxChunk: number): string[] {
  if (text.length <= maxChunk) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxChunk) {
    let splitAt = remaining.lastIndexOf('\n', maxChunk);
    if (splitAt <= 0) splitAt = maxChunk;
    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).replace(/^\n/, '');
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export class VirtualMessage {
  private adapter: PlatformAdapter;
  private destination: Destination;
  private threadId: string | null;
  private onMessagePosted: ((ref: MessageRef) => void) | null;
  private maxChunk: number;
  private durable: DurableHooks | null;

  /** Readable label for log messages, extracted from the Destination kind. */
  private get _logChannel(): string {
    if (this.destination.type === 'interactive-reply') return this.destination.conduit;
    if (this.destination.type === 'project-report') return this.destination.projectId;
    return 'system-notice';
  }

  private parentRef: MessageRef | null = null;
  private currentRef: MessageRef | null = null;
  private currentContent: string = '';
  // Unsealed tail text on the current Slack message. Slack displays
  // `currentContent + SEPARATOR + mutableTail`. Empty string means no tail open.
  // appendMutableTail opens/rotates; editMutableTail replaces; any append() or
  // postStandalone() auto-seals by folding mutableTail into currentContent.
  private mutableTail: string = '';
  private allRefs: MessageRef[] = [];
  private queue: Promise<void> = Promise.resolve();
  // Last error from a queued operation. flush() throws and clears this so
  // callers can detect that some messages did not reach the platform.
  private lastError: Error | null = null;

  constructor(adapter: PlatformAdapter, destination: Destination, opts?: {
    threadId?: string | null;
    onMessagePosted?: ((ref: MessageRef) => void) | null;
    durable?: DurableHooks | null;
  }) {
    this.adapter = adapter;
    this.destination = destination;
    this.threadId = opts?.threadId ?? null;
    this.onMessagePosted = opts?.onMessagePosted ?? null;
    this.durable = opts?.durable ?? null;
    this.maxChunk = adapter.capabilities.maxMessageLength || DEFAULT_MAX_CHUNK;
  }

  append(text: string): void {
    if (!text?.trim()) return;
    this.queue = this.queue.then(() => this._processAppend(text)).catch(e => {
      // Record the failure so flush() can surface it; swallow here so subsequent
      // appends still get a chance to run instead of a poisoned queue.
      log.error(`Queue error in channel ${this._logChannel} (text len=${text.length}):`, (e as Error).message);
      this.lastError = e instanceof Error ? e : new Error(String(e));
    });
  }

  /** Append `text` as a new mutable tail on the current Slack message.
   *  Seals any existing mutable tail into `currentContent` first, then writes
   *  the new tail via updateMessage (or postMessage if no message yet).
   *  Use this for "start a new tool group" or any ephemeral trailing line. */
  appendMutableTail(text: string): void {
    if (!text?.trim()) return;
    this.queue = this.queue.then(() => this._processAppendMutableTail(text)).catch(e => {
      log.error(`Queue error in appendMutableTail (channel ${this._logChannel}, len=${text.length}):`, (e as Error).message);
      this.lastError = e instanceof Error ? e : new Error(String(e));
    });
  }

  /** Replace the current mutable tail with `text`. No-op if no tail is open
   *  (use appendMutableTail to open one). Use this for "update same tool group". */
  editMutableTail(text: string): void {
    if (!text?.trim()) return;
    this.queue = this.queue.then(() => this._processEditMutableTail(text)).catch(e => {
      log.error(`Queue error in editMutableTail (channel ${this._logChannel}, len=${text.length}):`, (e as Error).message);
      this.lastError = e instanceof Error ? e : new Error(String(e));
    });
  }

  postStandalone(text: string, opts?: {
    richBlocks?: RichBlock[];
    actions?: ActionElement[];
  }): Promise<MessageRef | null> {
    const richBlocks = opts?.richBlocks;
    const actions = opts?.actions;
    return new Promise<MessageRef | null>((resolve, reject) => {
      this.queue = this.queue.then(async () => {
        this.currentRef = null;
        this.currentContent = '';
        this.mutableTail = '';

        const effectiveThreadId = this.threadId || this.parentRef?.messageId || undefined;
        let walId: string | null = null;
        try {
          walId = this.durable
            ? await this.durable.beforePost(this.destination, text, { threadId: effectiveThreadId, richBlocks })
            : null;
          const ref = await withRetries(async () => {
            return actions && actions.length > 0
              ? await this.adapter.postInteractive(this.destination, {
                  text,
                  richBlocks,
                  actions,
                }, { threadId: effectiveThreadId })
              : await this.adapter.postMessage(this.destination, {
                  text,
                  richBlocks,
                }, { threadId: effectiveThreadId });
          }, 'postStandalone');
          if (walId && this.durable) {
            await this.durable.afterSent(walId, ref.messageId).catch(e => {
              log.warn(`afterSent failed for walId=${walId}:`, (e as Error).message);
            });
          }

          if (!this.parentRef && !this.threadId) this.parentRef = ref;
          this.allRefs.push(ref);
          if (this.onMessagePosted) this.onMessagePosted(ref);
          resolve(ref);
        } catch (e) {
          if (walId && this.durable?.onSendFailed) {
            this.durable.onSendFailed(walId);
          }
          const err = e instanceof Error ? e : new Error(String(e));
          log.error(`Standalone post failed after retries in channel ${this._logChannel}:`, err.message);
          this.lastError = err;
          reject(err);
          throw err; // also propagate so flush() sees it
        }
      }).catch(e => {
        // Upstream queue error; surface it to the caller too.
        const err = e instanceof Error ? e : new Error(String(e));
        this.lastError = err;
        reject(err);
      });
    });
  }

  async flush(): Promise<void> {
    await this.queue.catch(() => { /* errors already captured into lastError */ });
    if (this.lastError) {
      const err = this.lastError;
      this.lastError = null;
      throw err;
    }
  }

  static async postOnce(adapter: PlatformAdapter, destination: Destination, text: string, opts?: {
    threadId?: string | null;
    onMessagePosted?: ((ref: MessageRef) => void) | null;
  }): Promise<MessageRef | null> {
    const vm = new VirtualMessage(adapter, destination, opts);
    vm.append(text);
    await vm.flush();
    return vm.getParentRef();
  }

  getRefs(): MessageRef[] {
    return [...this.allRefs];
  }

  getParentRef(): MessageRef | null {
    return this.parentRef;
  }

  /** Compatibility: return parentRef's messageId (maps to Slack's ts). */
  getParentTs(): string | null {
    return this.parentRef?.messageId ?? null;
  }

  private async _processAppend(text: string): Promise<void> {
    // Seal any open mutable tail into committed content first — plain append()
    // is a hard break for tools/trace. After this, mutableTail is empty and
    // currentContent includes what Slack already displays as the sealed prefix.
    this._sealMutableTailNow();

    if (this.currentRef === null) {
      await this._postNew(text);
      return;
    }

    const combined = this.currentContent + SEPARATOR + text;
    if (needsSplit(combined, this.maxChunk)) {
      await this._postNew(text);
      return;
    }

    // Only commit currentContent AFTER the update succeeds. If we mutate
    // currentContent before the await and the update fails, the next append
    // that triggers needsSplit would call _postNew(text) with only the new
    // text — silently dropping `text` from anywhere in Slack.
    const updateResult = await this._updateCurrent(combined);
    if (updateResult.delivered) {
      this.currentContent = combined;
    } else {
      // Update permanently failed (after retries). Don't lose `text` — fall
      // back to posting it as a new message so it remains visible to the user.
      // If THIS also fails, _postNew throws and the queue catch records lastError.
      log.error(`Update permanently failed in channel ${this._logChannel}; falling back to new post`);
      await this._postNew(text);
      // After fallback post succeeds, mark the stale update's WAL entry as
      // delivered so the drain loop doesn't retry it against the old message
      // (which would duplicate content already shown in the new message).
      if (updateResult.walId) {
        await this.durable?.afterSent(updateResult.walId).catch(() => {});
      }
    }
  }

  /** Combined display = currentContent [+ SEP + mutableTail]. */
  private _renderWithTail(tail: string): string {
    if (!this.currentContent) return tail;
    if (!tail) return this.currentContent;
    return this.currentContent + TAIL_SEPARATOR + tail;
  }

  /** Synchronously move mutableTail into currentContent. Slack state is
   *  already up-to-date with the tail displayed; this is pure bookkeeping. */
  private _sealMutableTailNow(): void {
    if (!this.mutableTail) return;
    this.currentContent = this.currentContent
      ? this.currentContent + TAIL_SEPARATOR + this.mutableTail
      : this.mutableTail;
    this.mutableTail = '';
  }

  private async _processAppendMutableTail(text: string): Promise<void> {
    // Seal any existing tail first, then open a fresh one containing `text`.
    this._sealMutableTailNow();
    const combined = this._renderWithTail(text);

    if (this.currentRef === null) {
      await this._postNew(combined);
      // _postNew leaves currentContent = combined (the whole blob). We want
      // committed='' tail=text since the whole freshly-posted blob is, in
      // fact, just the tail (currentContent was empty).
      this.currentContent = '';
      this.mutableTail = text;
      return;
    }

    if (needsSplit(combined, this.maxChunk)) {
      // Too long — commit everything that was already on screen, start a fresh
      // message whose content is just the new tail.
      await this._postNew(text);
      this.currentContent = '';
      this.mutableTail = text;
      return;
    }

    const updateResult = await this._updateCurrent(combined);
    if (updateResult.delivered) {
      this.mutableTail = text;
    } else {
      log.error(`Update failed in appendMutableTail (channel ${this._logChannel}); falling back to new post`);
      await this._postNew(text);
      this.currentContent = '';
      this.mutableTail = text;
      if (updateResult.walId) {
        await this.durable?.afterSent(updateResult.walId).catch(() => {});
      }
    }
  }

  private async _processEditMutableTail(text: string): Promise<void> {
    if (!this.mutableTail) return; // nothing to edit; caller must appendMutableTail first

    const combined = this._renderWithTail(text);

    if (this.currentRef === null) {
      // Shouldn't happen if a tail is open (tail implies a message exists),
      // but handle defensively: fall back to opening a fresh one.
      await this._postNew(combined);
      this.currentContent = '';
      this.mutableTail = text;
      return;
    }

    if (needsSplit(combined, this.maxChunk)) {
      // Overflow during same-group update — commit the old tail into content,
      // then open a fresh message carrying the new (larger) tail text.
      this._sealMutableTailNow();
      await this._postNew(text);
      this.currentContent = '';
      this.mutableTail = text;
      return;
    }

    const updateResult = await this._updateCurrent(combined);
    if (updateResult.delivered) {
      this.mutableTail = text;
    } else {
      log.error(`Update failed in editMutableTail (channel ${this._logChannel}); falling back to new post`);
      this._sealMutableTailNow();
      await this._postNew(text);
      this.currentContent = '';
      this.mutableTail = text;
      if (updateResult.walId) {
        await this.durable?.afterSent(updateResult.walId).catch(() => {});
      }
    }
  }

  private async _postNew(text: string): Promise<void> {
    const chunks = chunkText(text, this.maxChunk);

    let lastChunkSentIndex = -1;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // After chunk[0] succeeds, parentRef is set, so subsequent chunks go to
      // the thread automatically. If chunk[0] fails permanently, we abort the
      // remaining chunks — they would otherwise be posted as orphan top-level
      // messages without context.
      let effectiveThreadId: string | undefined;
      if (this.threadId) {
        effectiveThreadId = this.threadId;
      } else if (this.parentRef === null && i === 0) {
        effectiveThreadId = undefined;
      } else if (this.parentRef === null) {
        // chunk[0] failed and we have no parent — don't orphan subsequent chunks.
        throw new Error(`[virtual-message] aborting chunk ${i} — chunk 0 failed to post and would orphan subsequent chunks`);
      } else {
        effectiveThreadId = this.parentRef.messageId;
      }

      const ref = await this._postOne(chunk, effectiveThreadId);
      if (this.parentRef === null && !this.threadId) {
        this.parentRef = ref;
      }
      this.allRefs.push(ref);
      if (this.onMessagePosted) this.onMessagePosted(ref);
      lastChunkSentIndex = i;
    }

    if (lastChunkSentIndex >= 0) {
      this.currentRef = this.allRefs[this.allRefs.length - 1];
      this.currentContent = chunks[lastChunkSentIndex];
    }
  }

  /**
   * Post a single chunk with rich-text + plain-text fallback wrapped in
   * exponential-backoff retries. Throws on permanent failure (after retries).
   * When durable hooks are configured, persists intent to WAL before sending.
   */
  private async _postOne(chunk: string, threadId: string | undefined): Promise<MessageRef> {
    const richBlocks: RichBlock[] = [{ type: 'markdown', text: chunk }];
    const richContent: MessageContent = { text: chunk, richBlocks };
    const walId = this.durable
      ? await this.durable.beforePost(this.destination, chunk, { threadId, richBlocks })
      : null;
    try {
      const ref = await withRetries(async () => {
        try {
          return await this.adapter.postMessage(this.destination, richContent, { threadId });
        } catch {
          return await this.adapter.postMessage(this.destination, { text: chunk }, { threadId });
        }
      }, `postMessage(channel=${this._logChannel}, len=${chunk.length})`);
      if (walId && this.durable) {
        await this.durable.afterSent(walId, ref.messageId).catch(e => {
          log.warn(`afterSent failed for walId=${walId}:`, (e as Error).message);
        });
      }
      return ref;
    } catch (e) {
      // Inline send failed permanently — release the WAL claim so the drain
      // loop can retry delivery later.
      if (walId && this.durable?.onSendFailed) {
        this.durable.onSendFailed(walId);
      }
      throw e;
    }
  }

  private async _updateCurrent(content: string): Promise<{ delivered: boolean; walId?: string }> {
    if (!this.currentRef) return { delivered: true };
    const ref = this.currentRef;
    const richBlocks: RichBlock[] = [{ type: 'markdown', text: content }];
    const richContent: MessageContent = { text: content, richBlocks };
    const walId = this.durable
      ? await this.durable.beforeUpdate(this._logChannel, ref.messageId, content, { richBlocks })
      : null;
    try {
      await withRetries(async () => {
        try {
          await this.adapter.updateMessage(ref, richContent);
        } catch {
          await this.adapter.updateMessage(ref, { text: content });
        }
      }, `updateMessage(channel=${this._logChannel}, len=${content.length})`);
      if (walId && this.durable) {
        await this.durable.afterSent(walId).catch(e => {
          log.warn(`afterSent failed for walId=${walId}:`, (e as Error).message);
        });
      }
      return { delivered: true };
    } catch (e) {
      // Don't release the WAL claim yet — let the caller decide whether to
      // mark as delivered (after fallback _postNew succeeds) or release
      // (after fallback _postNew also fails, so drain loop can retry).
      // When no durable hooks are configured, return delivered:false without
      // a walId — the caller still needs to fall back to _postNew but
      // doesn't need to clean up any WAL entry.
      return { delivered: false, ...(walId ? { walId } : {}) };
    }
  }
}
