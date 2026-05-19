// input:  nothing (pure types module)
// output: Platform-independent message/block/modal type family
// pos:    Type foundation of the Platform abstraction
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

// --- Message Identity ---

/** Universal reference to a message on any platform.
 *  Replaces the Slack-specific (channel, ts, thread_ts) triplet. */
export interface MessageRef {
  channel: string;
  messageId: string;
  threadId?: string;
}

// --- Inbound Types ---

export interface IncomingMessage {
  ref: MessageRef;
  text: string;
  senderId: string;
  isBot: boolean;
  files?: PlatformFileRef[];
  attachments?: IncomingAttachment[];
  subtype?: string;
  raw: unknown;
}

export interface IncomingAttachment {
  authorName?: string;
  text?: string;
  url?: string;
  isForwarded: boolean;
}

export interface PlatformFileRef {
  id: string;
  name: string;
  mimetype: string;
  url: string;
  raw: unknown;
}

export interface DownloadedFile {
  localPath: string;
  mimetype: string;
  name: string;
}

// --- Outbound Content ---

export interface MessageContent {
  text: string;
  richBlocks?: RichBlock[];
}

export type RichBlock =
  | { type: 'markdown'; text: string }
  | { type: 'section'; text: string; format?: 'plain' | 'markdown' }
  | { type: 'context'; text: string }
  | { type: 'divider' }
  | { type: 'actions'; elements: ActionElement[] };

export type ActionElement = ButtonElement;

export interface ButtonElement {
  type: 'button';
  text: string;
  actionId: string;
  value: string;
  style?: 'primary' | 'danger';
}

// --- Modal Types ---

export interface ModalDefinition {
  callbackId: string;
  title: string;
  submitLabel?: string;
  closeLabel?: string;
  privateMetadata?: string;
  fields: ModalField[];
}

export type ModalField =
  | ModalSelectField
  | ModalMultiSelectField
  | ModalTextInputField
  | ModalSectionField;

export interface ModalSelectField {
  type: 'select';
  blockId: string;
  label: string;
  actionId: string;
  placeholder?: string;
  options: SelectOption[];
  optional?: boolean;
}

export interface ModalMultiSelectField {
  type: 'multi_select';
  blockId: string;
  label: string;
  actionId: string;
  placeholder?: string;
  options: SelectOption[];
  optional?: boolean;
}

export interface ModalTextInputField {
  type: 'text_input';
  blockId: string;
  label: string;
  actionId: string;
  placeholder?: string;
  multiline?: boolean;
  optional?: boolean;
}

export interface ModalSectionField {
  type: 'section';
  text: string;
}

export interface SelectOption {
  label: string;
  value: string;
}

// --- Modal Submit Values ---

export interface ModalFieldValue {
  selectedOption?: { value: string };
  selectedOptions?: { value: string }[];
  value?: string;
}

// --- Event Contexts ---

export interface MessageContext {
  message: IncomingMessage;
  reply(content: MessageContent, opts?: { threadId?: string }): Promise<MessageRef>;
}

export interface MessageEditContext {
  originalRef: MessageRef;
  newText: string;
  raw: unknown;
}

export interface ActionContext {
  actionId: string;
  value: string;
  triggerId: string;
  messageRef?: MessageRef;
  userId: string;
  channelId: string;
}

export interface ModalSubmitContext {
  callbackId: string;
  privateMetadata: string;
  values: Record<string, Record<string, ModalFieldValue>>;
  userId: string;
  ack(response?: { errors?: Record<string, string> }): Promise<void>;
}

// --- Platform Capabilities ---

export interface PlatformCapabilities {
  threads: boolean;
  messageEdit: boolean;
  modals: boolean;
  reactions: boolean;
  ephemeral: boolean;
  fileUpload: boolean;
  richFormatting: boolean;
  maxMessageLength: number;
  maxThreadDepth: number;
}

// --- Post Options ---

export interface PostMessageOpts {
  threadId?: string;
}

export interface FileUploadOpts {
  filename?: string;
  comment?: string;
  threadId?: string;
}

// --- Durable Message Hooks ---

export interface DurableHooks {
  beforePost(channel: string, text: string, opts?: { threadId?: string; richBlocks?: RichBlock[] }): Promise<string>;
  beforeUpdate(channel: string, messageId: string, text: string, opts?: { richBlocks?: RichBlock[] }): Promise<string>;
  afterSent(walId: string, slackTs?: string): Promise<void>;
  /** Release the in-flight claim when the inline send path fails permanently.
   *  This allows the drain loop to retry delivery. */
  onSendFailed?(walId: string): void;
}
