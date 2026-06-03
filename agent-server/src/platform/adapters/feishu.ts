// input:  @larksuiteoapi/node-sdk, ../adapter.js, ../types.js
// output: FeishuAdapter + FeishuAdapterConfig
// pos:    Feishu platform PlatformAdapter implementation
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as lark from '@larksuiteoapi/node-sdk';
import type { PlatformAdapter } from '../adapter.js';
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
  RichBlock,
  ActionElement,
  ModalField,
} from '../types.js';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '@core/log.js';
import { STORE_DIR } from '@core/paths.js';
import type { OutputStream, OpenOutputStreamOpts } from '../output-stream.js';
import { FeishuOutputStream } from './feishu-output-stream.js';
import { ProjectConduitsStore } from './project-conduits.js';

const log = createLogger('feishu');

export interface FeishuAdapterConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
  adminChannel?: string;       // chat_id (oc_xxx)
  domain?: 'feishu' | 'lark';  // default: feishu
}

export class FeishuAdapter implements PlatformAdapter {
  readonly name = 'feishu';
  readonly capabilities: PlatformCapabilities = {
    threads: true,           // via reply API with reply_in_thread
    messageEdit: false,      // Feishu has no message_changed event
    modals: false,           // No native modal; openModal() degrades to card form
    reactions: true,         // im.v1.messageReaction.create
    fileUpload: true,        // im.v1.file.create + message
    richFormatting: true,    // Message cards with markdown
    maxMessageLength: 4000,  // Card 30KB limit, ~4000 chars safe
    maxThreadDepth: 1,       // UI shows 1 level
  };

  private client: lark.Client;
  private wsClient: lark.WSClient;
  private eventDispatcher: lark.EventDispatcher;
  private config: FeishuAdapterConfig;

  private messageHandler: ((ctx: MessageContext) => Promise<void>) | null = null;
  private actionHandlers = new Map<string, (ctx: ActionContext) => Promise<void>>();
  private modalHandlers = new Map<string, (ctx: ModalSubmitContext) => Promise<void>>();

  constructor(config: FeishuAdapterConfig) {
    this.config = config;
    const domain = config.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu;

    this.client = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      appType: lark.AppType.SelfBuild,
      domain,
    });

    // EventDispatcher handles both regular events and card action callbacks
    // via WebSocket long connection.
    this.eventDispatcher = new lark.EventDispatcher({
      encryptKey: config.encryptKey || '',
      verificationToken: config.verificationToken || '',
    });

    // Register message receive event
    this.eventDispatcher.register({
      'im.message.receive_v1': async (data: any) => {
        if (!this.messageHandler) return;
        await this.handleIncomingMessage(data);
      },
    });

    // Register card action callback — routes to actionHandlers or modalHandlers
    this.eventDispatcher.register({
      'card.action.trigger': async (data: any) => {
        return await this.handleCardAction(data);
      },
    });

    this.wsClient = new lark.WSClient({
      appId: config.appId,
      appSecret: config.appSecret,
      domain,
      loggerLevel: lark.LoggerLevel.info,
    });
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    await this.wsClient.start({
      eventDispatcher: this.eventDispatcher,
    });
  }

  async stop(): Promise<void> {
    this.wsClient.close();
  }

  // --- Event registration ---

  onMessage(handler: (ctx: MessageContext) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onMessageEdit(_handler: (ctx: MessageEditContext) => Promise<void>): void {
    // Feishu does not support message edit events — no-op.
  }

  onAction(actionId: string, handler: (ctx: ActionContext) => Promise<void>): void {
    this.actionHandlers.set(actionId, handler);
  }

  onModalSubmit(callbackId: string, handler: (ctx: ModalSubmitContext) => Promise<void>): void {
    this.modalHandlers.set(callbackId, handler);
  }

  // --- Outbound messaging ---

  async postMessage(destination: Destination, content: MessageContent, opts?: PostMessageOpts): Promise<MessageRef> {
    const resolved = await this.resolveDestination(destination);
    if (!resolved.channel) {
      return { conduit: '', messageId: '' };
    }
    const threadId = opts?.threadId;

    // If replying in a thread, use the reply API
    if (threadId) {
      return this.replyInThread(threadId, content, resolved.channel);
    }

    const { msgType, msgContent } = this.buildMessagePayload(content);
    const res = await this.client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: resolved.channel,
        msg_type: msgType,
        content: msgContent,
      },
    });

    const messageId = (res as any)?.data?.message_id || '';
    return { conduit: resolved.channel, messageId };
  }

  async updateMessage(ref: MessageRef, content: MessageContent): Promise<void> {
    // Feishu only supports updating interactive (card) messages via PATCH.
    const cardJson = this.buildCardJson(content);
    await this.client.im.v1.message.patch({
      path: { message_id: ref.messageId },
      data: { content: JSON.stringify(cardJson) },
    });
  }

  async deleteMessage(ref: MessageRef): Promise<void> {
    await this.client.im.v1.message.delete({
      path: { message_id: ref.messageId },
    });
  }

  // --- Interactive messages ---

  async postInteractive(
    destination: Destination,
    content: MessageContent & { actions: ActionElement[] },
    opts?: PostMessageOpts,
  ): Promise<MessageRef> {
    const resolved = await this.resolveDestination(destination);
    if (!resolved.channel) {
      return { conduit: '', messageId: '' };
    }
    const elements = content.richBlocks
      ? this.richBlocksToFeishuElements(content.richBlocks)
      : [];

    // Add action buttons
    elements.push({
      tag: 'action',
      actions: content.actions.map(a => this.actionElementToFeishu(a)),
    });

    const cardJson = {
      schema: '2.0',
      header: {
        title: { tag: 'plain_text', content: content.text },
      },
      body: { elements },
    };

    const threadId = opts?.threadId;
    if (threadId) {
      const res = await this.client.im.v1.message.reply({
        path: { message_id: threadId },
        data: {
          msg_type: 'interactive',
          content: JSON.stringify(cardJson),
        },
      });
      const messageId = (res as any)?.data?.message_id || '';
      return { conduit: resolved.channel, messageId, threadId };
    }

    const res = await this.client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: resolved.channel,
        msg_type: 'interactive',
        content: JSON.stringify(cardJson),
      },
    });

    const messageId = (res as any)?.data?.message_id || '';
    return { conduit: resolved.channel, messageId };
  }

  async openModal(triggerId: string, modal: ModalDefinition): Promise<void> {
    // Feishu has no native modal. Degrade to posting a card with an embedded
    // form container to the channel. triggerId format: "chatId:messageId"
    const [channel] = triggerId.split(':');
    if (!channel) return;

    const cardJson = this.modalToFeishuCard(modal);

    await this.client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: channel,
        msg_type: 'interactive',
        content: JSON.stringify(cardJson),
      },
    });
  }

  // --- Queue backpressure ---

  private async _addHourglassReaction(ref: MessageRef): Promise<void> {
    try {
      await this.client.im.v1.messageReaction.create({
        path: { message_id: ref.messageId },
        data: { reaction_type: { emoji_type: 'hourglass' } },
      });
    } catch {
      // Best-effort: emoji name may not map to Feishu's emoji set
    }
  }

  async markQueued(ref: MessageRef): Promise<void> {
    await this._addHourglassReaction(ref);
  }

  // --- Files ---

  async uploadFile(destination: Destination, filePath: string, opts?: FileUploadOpts): Promise<void> {
    const destResolved = await this.resolveDestination(destination);
    if (!destResolved.channel) {
      return;
    }
    const { resolved: fileResolved } = this.resolveFilePath(filePath);
    const fileName = opts?.filename || path.basename(fileResolved);

    // Upload file to get file_key
    const uploadRes = await this.client.im.v1.file.create({
      data: {
        file_type: this.inferFeishuFileType(fileName),
        file_name: fileName,
        file: fs.readFileSync(fileResolved),
      },
    });

    const fileKey = (uploadRes as any)?.data?.file_key;
    if (!fileKey) throw new Error('Feishu file upload failed: no file_key returned');

    // Send file message
    const msgContent = JSON.stringify({ file_key: fileKey });
    const threadId = opts?.threadId;

    if (threadId) {
      await this.client.im.v1.message.reply({
        path: { message_id: threadId },
        data: { msg_type: 'file', content: msgContent },
      });
    } else {
      await this.client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: destResolved.channel,
          msg_type: 'file',
          content: msgContent,
        },
      });
    }
  }

  async downloadFile(fileRef: PlatformFileRef, destDir: string): Promise<DownloadedFile> {
    const raw = (fileRef.raw as any) || {};
    const messageId: string | undefined = raw.message_id;
    const type: 'file' | 'image' = raw.resourceType === 'image' ? 'image' : 'file';

    const ext = path.extname(fileRef.name) || '';
    const localPath = path.join(destDir, `${fileRef.id}${ext}`);

    // Message attachments must be fetched via messageResource.get (requires the
    // owning message_id + a resource type). im.v1.file.get only works for files
    // we uploaded ourselves, so it's a last-resort fallback when message_id is
    // somehow missing.
    let resp: any;
    if (messageId) {
      resp = await this.client.im.v1.messageResource.get({
        path: { message_id: messageId, file_key: fileRef.id },
        params: { type },
      });
    } else {
      log.warn(`downloadFile: no message_id on fileRef "${fileRef.id}"; falling back to file.get`);
      resp = await this.client.im.v1.file.get({ path: { file_key: fileRef.id } });
    }

    await (resp as any).writeFile(localPath);
    return { localPath, mimetype: fileRef.mimetype, name: fileRef.name };
  }

  // --- Misc ---

  async getPermalink(_ref: MessageRef): Promise<string | null> {
    // Feishu has no public permalink API.
    return null;
  }

  // --- Output stream ---

  openOutputStream(destination: Destination, opts?: OpenOutputStreamOpts): OutputStream {
    return new FeishuOutputStream(this, destination, opts);
  }

  // --- Project conduit mapping (file-backed, separate file from Slack) ---

  private _conduitsStore: ProjectConduitsStore | null = null;

  private _getConduitsStore(): ProjectConduitsStore {
    if (!this._conduitsStore) {
      this._conduitsStore = new ProjectConduitsStore(
        path.join(STORE_DIR, 'feishu-channel-registry.json'),
      );
    }
    return this._conduitsStore;
  }

  async bindProjectConduit(projectId: string, conduitHint: string): Promise<void> {
    await this._getConduitsStore().set(projectId, conduitHint);
  }

  async unbindProjectConduit(projectId: string): Promise<void> {
    await this._getConduitsStore().remove(projectId);
  }

  async getProjectConduits(): Promise<Record<string, string>> {
    return this._getConduitsStore().getAll();
  }

  async resolveInboundProject(conduit: string): Promise<string | null> {
    const conduits = await this._getConduitsStore().getAll();
    for (const [project, ch] of Object.entries(conduits)) {
      if (ch === conduit) return project;
    }
    return null;
  }

  /**
   * Resolve a Destination to a concrete Feishu chat_id + kind label.
   * Returns channel=null for destinations that should be silently dropped
   * (unconfigured admin channel).
   */
  private async resolveDestination(dest: Destination): Promise<{ channel: string | null; kind: string }> {
    switch (dest.type) {
      case 'interactive-reply':
        return { channel: dest.conduit, kind: 'interactive-reply' };
      case 'project-report': {
        const conduits = await this.getProjectConduits();
        const channel = conduits[dest.projectId];
        if (!channel) {
          log.warn(`No conduit registered for project "${dest.projectId}"; dropping project-report`);
          return { channel: null, kind: 'project-report-noop' };
        }
        return { channel, kind: 'project-report' };
      }
      case 'system-notice':
        if (!this.config.adminChannel) {
          log.warn('No admin channel configured; dropping system-notice');
          return { channel: null, kind: 'system-notice-noop' };
        }
        return { channel: this.config.adminChannel, kind: 'system-notice' };
      default:
        return { channel: null, kind: 'unknown' };
    }
  }

  // =========================================================================
  // Internal: Inbound event handlers
  // =========================================================================

  private async handleIncomingMessage(data: any): Promise<void> {
    if (!this.messageHandler) return;

    const message = data.message || data;
    const sender = data.sender || {};
    const senderId = sender.sender_id?.open_id || sender.sender_id?.user_id || '';
    const isBot = sender.sender_type === 'app';

    const chatId = message.chat_id || '';
    const messageId = message.message_id || '';
    const rootId = message.root_id || undefined;
    const parentId = message.parent_id || undefined;
    const messageType = message.message_type || '';

    // Parse message content (JSON string). For file/image/media/audio messages,
    // the resource key (file_key/image_key) lives inside this JSON — NOT on the
    // message object itself.
    let parsed: any = {};
    try {
      parsed = JSON.parse(message.content || '{}');
    } catch {
      parsed = {};
    }
    const text: string = typeof parsed.text === 'string'
      ? parsed.text
      : (typeof message.content === 'string' && !message.content.startsWith('{') ? message.content : '');

    const ref: MessageRef = {
      conduit: chatId,
      messageId,
      threadId: rootId || parentId || undefined,
    };

    // Extract file references from the parsed content. The id (file_key/image_key)
    // plus message_id + resourceType are needed by downloadFile (messageResource.get).
    const files = this.extractInboundFiles(messageType, parsed, messageId);

    // TODO: Parse Feishu forwarded/merged messages (merge_forward msg type) into
    // IncomingAttachment[]. Feishu's format differs from Slack's msg.attachments.
    const kind: 'user' | 'file_share' = files ? 'file_share' : 'user';

    const incoming = {
      ref,
      text,
      senderId,
      isBot,
      files,
      kind,
      raw: data,
    };

    const adapter = this;
    await this.messageHandler({
      message: incoming,
      async reply(content, replyOpts) {
        return adapter.postMessage({ type: 'interactive-reply', conduit: ref.conduit, sessionId: '' }, content, {
          threadId: replyOpts?.threadId || ref.threadId,
        });
      },
    });
  }

  /**
   * Build PlatformFileRef[] from a parsed Feishu message content payload.
   * Feishu stores the resource key inside `content` (not on the message object):
   *   - file / media (video): { file_key, file_name? }
   *   - image:               { image_key }
   *   - audio:               { file_key }
   * message_id + resourceType are stashed in `raw` so downloadFile() can call
   * im.v1.messageResource.get (which requires both message_id and a type param).
   */
  private extractInboundFiles(messageType: string, parsed: any, messageId: string): PlatformFileRef[] | undefined {
    const mk = (id: string, name: string, mimetype: string, resourceType: 'file' | 'image'): PlatformFileRef[] => [
      { id, name, mimetype, url: '', raw: { message_id: messageId, resourceType } },
    ];

    switch (messageType) {
      case 'file':
        if (!parsed.file_key) return undefined;
        return mk(parsed.file_key, parsed.file_name || parsed.file_key, '', 'file');
      case 'media':
        if (!parsed.file_key) return undefined;
        return mk(parsed.file_key, parsed.file_name || `${parsed.file_key}.mp4`, 'video/mp4', 'file');
      case 'audio':
        if (!parsed.file_key) return undefined;
        return mk(parsed.file_key, `${parsed.file_key}.opus`, 'audio/opus', 'file');
      case 'image':
        if (!parsed.image_key) return undefined;
        return mk(parsed.image_key, `${parsed.image_key}.png`, 'image/png', 'image');
      default:
        return undefined;
    }
  }

  private async handleCardAction(data: any): Promise<any> {
    const event = data.event || data;
    const action = event.action || {};
    const operator = event.operator || {};
    const context = event.context || {};

    const chatId = context.open_chat_id || '';
    const messageId = context.open_message_id || '';
    const userId = operator.open_id || '';

    // Check if this is a form submission (has form_value)
    if (action.form_value && typeof action.form_value === 'object') {
      // Form submission → route to modalHandlers
      // The form name serves as the callbackId
      const formName = action.name || '';
      const handler = this.modalHandlers.get(formName);
      if (handler) {
        const normalizedValues = this.normalizeFormValues(action.form_value);
        await handler({
          callbackId: formName,
          privateMetadata: JSON.stringify(action.value || {}),
          values: normalizedValues,
          userId,
          async ack(_response) {
            // Feishu ack is implicit via the callback return value — nothing to do.
          },
        });
        // Return toast or updated card if needed
        return { toast: { type: 'success', content: 'OK' } };
      }
      return undefined;
    }

    // Button click → route to actionHandlers
    // actionId can be in action.value.actionId (our convention) or action.name
    const actionId = action.value?.actionId || action.name || '';
    const actionValue = action.value?.value ?? JSON.stringify(action.value || {});
    const handler = this.actionHandlers.get(actionId);

    if (handler) {
      await handler({
        actionId,
        value: typeof actionValue === 'string' ? actionValue : JSON.stringify(actionValue),
        triggerId: `${chatId}:${messageId}`,
        messageRef: messageId ? { conduit: chatId, messageId } : undefined,
        userId,
        channelId: chatId,
      });
      return { toast: { type: 'success', content: 'OK' } };
    }

    return undefined;
  }

  // =========================================================================
  // Internal: Outbound converters
  // =========================================================================

  private buildMessagePayload(content: MessageContent): { msgType: string; msgContent: string } {
    if (content.richBlocks && content.richBlocks.length > 0) {
      const cardJson = this.buildCardJson(content);
      return { msgType: 'interactive', msgContent: JSON.stringify(cardJson) };
    }
    return { msgType: 'text', msgContent: JSON.stringify({ text: content.text }) };
  }

  private buildCardJson(content: MessageContent): any {
    const elements = content.richBlocks
      ? this.richBlocksToFeishuElements(content.richBlocks)
      : [{ tag: 'markdown', content: content.text }];

    return {
      schema: '2.0',
      body: { elements },
    };
  }

  private async replyInThread(threadMessageId: string, content: MessageContent, conduit: string): Promise<MessageRef> {
    const { msgType, msgContent } = this.buildMessagePayload(content);
    const res = await this.client.im.v1.message.reply({
      path: { message_id: threadMessageId },
      data: {
        msg_type: msgType,
        content: msgContent,
      },
    });

    const messageId = (res as any)?.data?.message_id || '';
    return { conduit, messageId, threadId: threadMessageId };
  }

  /** Convert RichBlock[] to Feishu card schema 2.0 elements. */
  private richBlocksToFeishuElements(blocks: RichBlock[]): any[] {
    return blocks.map(block => {
      switch (block.type) {
        case 'markdown':
          return { tag: 'markdown', content: block.text };
        case 'section':
          return {
            tag: 'div',
            text: {
              tag: block.format === 'plain' ? 'plain_text' : 'lark_md',
              content: block.text,
            },
          };
        case 'context':
          return {
            tag: 'note',
            elements: [{ tag: 'plain_text', content: block.text }],
          };
        case 'divider':
          return { tag: 'hr' };
        case 'actions':
          return {
            tag: 'action',
            actions: block.elements.map(e => this.actionElementToFeishu(e)),
          };
        default:
          return { tag: 'markdown', content: (block as any).text || '' };
      }
    });
  }

  /** Convert a ButtonElement to Feishu card button JSON. */
  private actionElementToFeishu(el: ActionElement): any {
    return {
      tag: 'button',
      text: { tag: 'plain_text', content: el.text },
      type: el.style === 'danger' ? 'danger' : el.style === 'primary' ? 'primary' : 'default',
      name: el.actionId,
      value: { actionId: el.actionId, value: el.value },
    };
  }

  /**
   * Convert ModalDefinition to a Feishu card with embedded form container.
   * Since Feishu has no native modal, we post a card message containing a
   * form that users can fill out and submit inline.
   */
  private modalToFeishuCard(modal: ModalDefinition): any {
    const formElements: any[] = [];

    for (const field of modal.fields) {
      switch (field.type) {
        case 'section':
          formElements.push({
            tag: 'div',
            text: { tag: 'lark_md', content: field.text },
          });
          break;
        case 'select':
          formElements.push({
            tag: 'select_static',
            name: `${field.blockId}::${field.actionId}::select`,
            placeholder: field.placeholder
              ? { tag: 'plain_text', content: field.placeholder }
              : undefined,
            options: field.options.map(o => ({
              text: { tag: 'plain_text', content: o.label },
              value: o.value,
            })),
          });
          break;
        case 'multi_select':
          formElements.push({
            tag: 'multi_select_static',
            name: `${field.blockId}::${field.actionId}::multi`,
            placeholder: field.placeholder
              ? { tag: 'plain_text', content: field.placeholder }
              : undefined,
            options: field.options.map(o => ({
              text: { tag: 'plain_text', content: o.label },
              value: o.value,
            })),
          });
          break;
        case 'text_input':
          formElements.push({
            tag: 'input',
            name: `${field.blockId}::${field.actionId}::text`,
            placeholder: field.placeholder
              ? { tag: 'plain_text', content: field.placeholder }
              : undefined,
          });
          break;
      }
    }

    // Add submit button inside form.
    // The button's `name` is what arrives as `event.action.name` in the
    // card.action.trigger callback — handleCardAction uses it to look up the
    // modal handler, which is registered under modal.callbackId. So the button
    // name MUST equal callbackId (not a literal "submit"), otherwise the
    // submission is silently dropped.
    formElements.push({
      tag: 'button',
      text: { tag: 'plain_text', content: modal.submitLabel || 'Submit' },
      type: 'primary',
      name: modal.callbackId,
      action_type: 'form_submit',
    });

    return {
      schema: '2.0',
      header: {
        title: { tag: 'plain_text', content: modal.title },
      },
      body: {
        elements: [{
          tag: 'form',
          name: modal.callbackId,
          elements: formElements,
        }],
      },
      config: {
        update_multi: true, // Allow card updates after interaction
      },
    };
  }

  /**
   * Normalize Feishu form_value into the platform-agnostic ModalFieldValue format.
   * Feishu form_value is a flat dict { field_name: value } where field_name follows
   * our convention "{blockId}::{actionId}::{kind}" (kind ∈ select | multi | text).
   * The kind segment is what lets us map a single-select (a bare string) to
   * `selectedOption` rather than `value` — the downstream consumer
   * (interaction-handlers.ts) reads `selectedOption.value` for single-select.
   * We reconstruct the two-level { blockId: { actionId: ModalFieldValue } } structure.
   */
  private normalizeFormValues(formValue: Record<string, any>): Record<string, Record<string, ModalFieldValue>> {
    const normalized: Record<string, Record<string, ModalFieldValue>> = {};

    for (const [fieldName, rawValue] of Object.entries(formValue)) {
      const parts = fieldName.split('::');
      const blockId = parts[0] ?? fieldName;
      const actionId = parts[1] ?? fieldName;
      const kind = parts[2]; // select | multi | text | undefined

      if (!normalized[blockId]) normalized[blockId] = {};

      if (kind === 'multi' || Array.isArray(rawValue)) {
        // Multi-select: array of selected values
        const arr = Array.isArray(rawValue) ? rawValue : [rawValue];
        normalized[blockId][actionId] = {
          selectedOptions: arr.map(v => ({ value: String(v) })),
        };
      } else if (kind === 'select') {
        // Single-select: Feishu sends the option value as a bare string
        const value = rawValue && typeof rawValue === 'object'
          ? String((rawValue as any).value ?? '')
          : String(rawValue ?? '');
        normalized[blockId][actionId] = { selectedOption: { value } };
      } else {
        // Text input (or unknown): plain string value
        normalized[blockId][actionId] = { value: String(rawValue ?? '') };
      }
    }

    return normalized;
  }

  // =========================================================================
  // Internal: Utilities
  // =========================================================================

  private resolveFilePath(filePath: string): { resolved: string; size: number } {
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error(`Not a file: ${resolved}`);
    return { resolved, size: stat.size };
  }

  private inferFeishuFileType(fileName: string): 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream' {
    const ext = path.extname(fileName).toLowerCase();
    const typeMap: Record<string, 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt'> = {
      '.opus': 'opus', '.mp4': 'mp4', '.pdf': 'pdf', '.doc': 'doc',
      '.docx': 'doc', '.xls': 'xls', '.xlsx': 'xls', '.ppt': 'ppt',
      '.pptx': 'ppt',
    };
    return typeMap[ext] || 'stream';
  }
}
