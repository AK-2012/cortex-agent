// input:  ./adapter.js + ./types.js
// output: MockAdapter + recorded message/modal types
// pos:    In-memory mock adapter for unit tests
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { PlatformAdapter } from './adapter.js';
import type {
  MessageRef,
  MessageContent,
  MessageContext,
  MessageEditContext,
  ActionContext,
  ModalSubmitContext,
  ModalDefinition,
  ModalFieldValue,
  PlatformCapabilities,
  PlatformFileRef,
  DownloadedFile,
  Destination,
  PostMessageOpts,
  FileUploadOpts,
  ActionElement,
} from './types.js';
import { resolveDestinationConduit } from './types.js';

export interface PostedMessage {
  destination: Destination;
  content: MessageContent;
  threadId?: string;
  actions?: ActionElement[];
}

export interface UpdatedMessage {
  ref: MessageRef;
  content: MessageContent;
}

export interface DeletedMessage {
  ref: MessageRef;
}

export interface AddedReaction {
  ref: MessageRef;
  emoji: string;
}

export interface UploadedFile {
  destination: Destination;
  filePath: string;
  opts?: FileUploadOpts;
}

export interface OpenedModal {
  triggerId: string;
  modal: ModalDefinition;
}

export interface EphemeralMessage {
  channel: string;
  userId: string;
  text: string;
}

export class MockAdapter implements PlatformAdapter {
  readonly name = 'mock';
  readonly capabilities: PlatformCapabilities;

  posted: PostedMessage[] = [];
  updated: UpdatedMessage[] = [];
  deleted: DeletedMessage[] = [];
  reactions: AddedReaction[] = [];
  uploads: UploadedFile[] = [];
  modals: OpenedModal[] = [];
  ephemeralMessages: EphemeralMessage[] = [];

  /** Optional fault injection for tests: count of remaining failures, then succeed. */
  failPostMessageCount: number = 0;
  failUpdateMessageCount: number = 0;
  failPostInteractiveCount: number = 0;

  private nextId = 1000;
  private _adminChannel: string | null;
  private messageHandlers: Array<(ctx: MessageContext) => Promise<void>> = [];
  private editHandlers: Array<(ctx: MessageEditContext) => Promise<void>> = [];
  private actionHandlers = new Map<string, (ctx: ActionContext) => Promise<void>>();
  private modalHandlers = new Map<string, (ctx: ModalSubmitContext) => Promise<void>>();

  constructor(opts?: Partial<PlatformCapabilities> | { adminChannel?: string; capabilities?: Partial<PlatformCapabilities> }) {
    const isLegacy = opts && !('adminChannel' in opts) && !('capabilities' in opts);
    const capabilities = isLegacy ? opts as Partial<PlatformCapabilities> : (opts as any)?.capabilities;
    this._adminChannel = isLegacy ? 'mock-admin' : ((opts as any)?.adminChannel ?? null);
    this.capabilities = {
      threads: true,
      messageEdit: true,
      modals: true,
      reactions: true,
      ephemeral: true,
      fileUpload: true,
      richFormatting: true,
      maxMessageLength: 3000,
      maxThreadDepth: 1,
      ...capabilities,
    };
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  onMessage(handler: (ctx: MessageContext) => Promise<void>): void {
    this.messageHandlers.push(handler);
  }

  onMessageEdit(handler: (ctx: MessageEditContext) => Promise<void>): void {
    this.editHandlers.push(handler);
  }

  onAction(actionId: string, handler: (ctx: ActionContext) => Promise<void>): void {
    this.actionHandlers.set(actionId, handler);
  }

  onModalSubmit(callbackId: string, handler: (ctx: ModalSubmitContext) => Promise<void>): void {
    this.modalHandlers.set(callbackId, handler);
  }

  async postMessage(destination: Destination, content: MessageContent, opts?: PostMessageOpts): Promise<MessageRef> {
    if (this.failPostMessageCount > 0) {
      this.failPostMessageCount--;
      throw new Error('mock: postMessage transient failure');
    }
    const channel = resolveDestinationConduit(destination, this._adminChannel);
    const messageId = String(this.nextId++);
    this.posted.push({ destination, content, threadId: opts?.threadId });
    return { channel, messageId, threadId: opts?.threadId };
  }

  async updateMessage(ref: MessageRef, content: MessageContent): Promise<void> {
    if (this.failUpdateMessageCount > 0) {
      this.failUpdateMessageCount--;
      throw new Error('mock: updateMessage transient failure');
    }
    this.updated.push({ ref, content });
  }

  async deleteMessage(ref: MessageRef): Promise<void> {
    this.deleted.push({ ref });
  }

  async postInteractive(destination: Destination, content: MessageContent & { actions: ActionElement[] }, opts?: PostMessageOpts): Promise<MessageRef> {
    if (this.failPostInteractiveCount > 0) {
      this.failPostInteractiveCount--;
      throw new Error('mock: postInteractive transient failure');
    }
    const channel = resolveDestinationConduit(destination, this._adminChannel);
    const messageId = String(this.nextId++);
    this.posted.push({ destination, content, threadId: opts?.threadId, actions: content.actions });
    return { channel, messageId, threadId: opts?.threadId };
  }

  async openModal(triggerId: string, modal: ModalDefinition): Promise<void> {
    this.modals.push({ triggerId, modal });
  }

  async addReaction(ref: MessageRef, emoji: string): Promise<void> {
    this.reactions.push({ ref, emoji });
  }

  async uploadFile(destination: Destination, filePath: string, opts?: FileUploadOpts): Promise<void> {
    this.uploads.push({ destination, filePath, opts });
  }

  async downloadFile(fileRef: PlatformFileRef, destDir: string): Promise<DownloadedFile> {
    return { localPath: `${destDir}/${fileRef.id}`, mimetype: fileRef.mimetype, name: fileRef.name };
  }

  async getPermalink(ref: MessageRef): Promise<string | null> {
    return `https://mock.test/permalink/${ref.channel}/${ref.messageId}`;
  }

  async postEphemeral(channel: string, userId: string, text: string): Promise<void> {
    this.ephemeralMessages.push({ channel, userId, text });
  }

  getRawClient(): null {
    return null;
  }

  // --- Test helpers ---

  /** Simulate an inbound message for testing event handlers. */
  async simulateMessage(channel: string, text: string, opts?: { senderId?: string; threadId?: string; isBot?: boolean }): Promise<void> {
    const ref: MessageRef = {
      channel,
      messageId: String(this.nextId++),
      threadId: opts?.threadId,
    };
    const adapter = this;
    const ctx: MessageContext = {
      message: {
        ref,
        text,
        senderId: opts?.senderId || 'user-1',
        isBot: opts?.isBot ?? false,
        raw: {},
      },
      async reply(content, replyOpts) {
        return adapter.postMessage({ type: 'interactive-reply', conduit: channel, sessionId: '' }, content, {
          threadId: replyOpts?.threadId || ref.threadId,
        });
      },
    };
    for (const handler of this.messageHandlers) {
      await handler(ctx);
    }
  }

  /** Simulate a message edit for testing edit handlers. */
  async simulateMessageEdit(channel: string, messageId: string, newText: string): Promise<void> {
    const ctx: MessageEditContext = {
      originalRef: { channel, messageId },
      newText,
      raw: {},
    };
    for (const handler of this.editHandlers) {
      await handler(ctx);
    }
  }

  /** Simulate a button/action click for testing action handlers. */
  async simulateAction(actionId: string, value: string, opts?: { channelId?: string; userId?: string; triggerId?: string; messageRef?: MessageRef }): Promise<void> {
    const handler = this.actionHandlers.get(actionId);
    if (!handler) return;
    await handler({
      actionId,
      value,
      triggerId: opts?.triggerId || 'trigger-1',
      channelId: opts?.channelId || 'C123',
      userId: opts?.userId || 'user-1',
      messageRef: opts?.messageRef,
    });
  }

  /** Simulate a modal submission for testing modal handlers. */
  async simulateModalSubmit(callbackId: string, values: Record<string, Record<string, ModalFieldValue>>, opts?: { privateMetadata?: string; userId?: string }): Promise<void> {
    const handler = this.modalHandlers.get(callbackId);
    if (!handler) return;
    let acked = false;
    await handler({
      callbackId,
      privateMetadata: opts?.privateMetadata || '',
      values,
      userId: opts?.userId || 'user-1',
      async ack(response) {
        acked = true;
      },
    });
  }

  /** Reset all recorded state. */
  reset(): void {
    this.posted = [];
    this.updated = [];
    this.deleted = [];
    this.reactions = [];
    this.uploads = [];
    this.modals = [];
    this.ephemeralMessages = [];
    this.nextId = 1000;
    this.failPostMessageCount = 0;
    this.failUpdateMessageCount = 0;
    this.failPostInteractiveCount = 0;
  }
}
