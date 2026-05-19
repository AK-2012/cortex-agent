// input:  ./types.js platform-agnostic message types
// output: PlatformAdapter interface (17 methods)
// pos:    Single abstraction boundary between core modules and messaging platform
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type {
  MessageRef,
  MessageContent,
  MessageContext,
  MessageEditContext,
  ActionContext,
  ModalSubmitContext,
  ModalDefinition,
  PlatformCapabilities,
  PlatformFileRef,
  DownloadedFile,
  PostMessageOpts,
  FileUploadOpts,
  RichBlock,
  ActionElement,
} from './types.js';

export interface PlatformAdapter {
  readonly name: string;
  readonly capabilities: PlatformCapabilities;

  // --- Lifecycle ---
  start(): Promise<void>;
  stop(): Promise<void>;

  // --- Event registration ---
  onMessage(handler: (ctx: MessageContext) => Promise<void>): void;
  onMessageEdit(handler: (ctx: MessageEditContext) => Promise<void>): void;
  onAction(actionId: string, handler: (ctx: ActionContext) => Promise<void>): void;
  onModalSubmit(callbackId: string, handler: (ctx: ModalSubmitContext) => Promise<void>): void;

  // --- Outbound messaging ---
  postMessage(channel: string, content: MessageContent, opts?: PostMessageOpts): Promise<MessageRef>;
  updateMessage(ref: MessageRef, content: MessageContent): Promise<void>;
  deleteMessage(ref: MessageRef): Promise<void>;

  // --- Interactive messages (buttons, actions) ---
  postInteractive(channel: string, content: MessageContent & {
    actions: ActionElement[];
  }, opts?: PostMessageOpts): Promise<MessageRef>;

  // --- Modals ---
  openModal(triggerId: string, modal: ModalDefinition): Promise<void>;

  // --- Reactions ---
  addReaction(ref: MessageRef, emoji: string): Promise<void>;

  // --- Files ---
  uploadFile(channel: string, filePath: string, opts?: FileUploadOpts): Promise<void>;
  downloadFile(fileRef: PlatformFileRef, destDir: string): Promise<DownloadedFile>;

  // --- Misc ---
  getPermalink(ref: MessageRef): Promise<string | null>;
  postEphemeral(channel: string, userId: string, text: string): Promise<void>;

  /** Platform-configured admin/notification channel (replaces hardcoded Slack DM ID). */
  getAdminChannel(): string | null;

  /** Access to the underlying platform client for edge cases during migration.
   *  New code should avoid this — it exists to support incremental Phase 2 adoption. */
  getRawClient(): unknown;
}
