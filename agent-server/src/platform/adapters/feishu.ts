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
import { resolveDestinationConduit } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

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
    ephemeral: false,        // Feishu has no ephemeral messages
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
    const channel = this._resolveChannel(destination);
    const threadId = opts?.threadId;

    // If replying in a thread, use the reply API
    if (threadId) {
      return this.replyInThread(threadId, content);
    }

    const { msgType, msgContent } = this.buildMessagePayload(content);
    const res = await this.client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: channel,
        msg_type: msgType,
        content: msgContent,
      },
    });

    const messageId = (res as any)?.data?.message_id || '';
    return { channel, messageId };
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
    const channel = this._resolveChannel(destination);
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
      return { channel, messageId, threadId };
    }

    const res = await this.client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: channel,
        msg_type: 'interactive',
        content: JSON.stringify(cardJson),
      },
    });

    const messageId = (res as any)?.data?.message_id || '';
    return { channel, messageId };
  }

  // --- Modals (degraded to card forms) ---

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

  // --- Reactions ---

  async addReaction(ref: MessageRef, emoji: string): Promise<void> {
    try {
      await this.client.im.v1.messageReaction.create({
        path: { message_id: ref.messageId },
        data: { reaction_type: { emoji_type: emoji } },
      });
    } catch {
      // Best-effort: emoji name may not map to Feishu's emoji set
    }
  }

  // --- Files ---

  async uploadFile(destination: Destination, filePath: string, opts?: FileUploadOpts): Promise<void> {
    const channel = this._resolveChannel(destination);
    const { resolved, size } = this.resolveFilePath(filePath);
    const fileName = opts?.filename || path.basename(resolved);

    // Upload file to get file_key
    const uploadRes = await this.client.im.v1.file.create({
      data: {
        file_type: this.inferFeishuFileType(fileName),
        file_name: fileName,
        file: fs.readFileSync(resolved),
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
          receive_id: channel,
          msg_type: 'file',
          content: msgContent,
        },
      });
    }
  }

  async downloadFile(fileRef: PlatformFileRef, destDir: string): Promise<DownloadedFile> {
    const resp = await this.client.im.v1.file.get({
      path: { file_key: fileRef.id },
    });

    const ext = path.extname(fileRef.name) || '';
    const localPath = path.join(destDir, `${fileRef.id}${ext}`);
    await (resp as any).writeFile(localPath);

    return { localPath, mimetype: fileRef.mimetype, name: fileRef.name };
  }

  // --- Misc ---

  async getPermalink(_ref: MessageRef): Promise<string | null> {
    // Feishu has no public permalink API.
    return null;
  }

  async postEphemeral(_channel: string, _userId: string, _text: string): Promise<void> {
    // Feishu does not support ephemeral messages — no-op.
  }

  /** Resolve a Destination to a Feishu chat_id. */
  private _resolveChannel(dest: Destination): string {
    return resolveDestinationConduit(dest, this.config.adminChannel);
  }

  getRawClient(): lark.Client {
    return this.client;
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

    // Parse message content (JSON string)
    let text = '';
    try {
      const parsed = JSON.parse(message.content || '{}');
      text = parsed.text || '';
    } catch {
      text = message.content || '';
    }

    const chatId = message.chat_id || '';
    const messageId = message.message_id || '';
    const rootId = message.root_id || undefined;
    const parentId = message.parent_id || undefined;

    const ref: MessageRef = {
      channel: chatId,
      messageId,
      threadId: rootId || parentId || undefined,
    };

    // Extract file references if present
    const files: PlatformFileRef[] | undefined = message.file_key
      ? [{ id: message.file_key, name: message.file_name || '', mimetype: message.file_type || '', url: '', raw: message }]
      : undefined;

    // TODO: Parse Feishu forwarded/merged messages (merge_forward msg type) into
    // IncomingAttachment[]. Feishu's format differs from Slack's msg.attachments.
    const incoming = {
      ref,
      text,
      senderId,
      isBot,
      files,
      subtype: message.message_type,
      raw: data,
    };

    const adapter = this;
    await this.messageHandler({
      message: incoming,
      async reply(content, replyOpts) {
        return adapter.postMessage({ type: 'interactive-reply', conduit: ref.channel, sessionId: '' }, content, {
          threadId: replyOpts?.threadId || ref.threadId,
        });
      },
    });
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
        let ackCalled = false;
        await handler({
          callbackId: formName,
          privateMetadata: JSON.stringify(action.value || {}),
          values: normalizedValues,
          userId,
          async ack(_response) {
            ackCalled = true;
            // Feishu ack is implicit via response — nothing to do
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
        messageRef: messageId ? { channel: chatId, messageId } : undefined,
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

  private async replyInThread(threadMessageId: string, content: MessageContent): Promise<MessageRef> {
    const { msgType, msgContent } = this.buildMessagePayload(content);
    const res = await this.client.im.v1.message.reply({
      path: { message_id: threadMessageId },
      data: {
        msg_type: msgType,
        content: msgContent,
      },
    });

    const messageId = (res as any)?.data?.message_id || '';
    return { channel: '', messageId, threadId: threadMessageId };
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
            name: `${field.blockId}::${field.actionId}`,
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
            name: `${field.blockId}::${field.actionId}`,
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
            name: `${field.blockId}::${field.actionId}`,
            placeholder: field.placeholder
              ? { tag: 'plain_text', content: field.placeholder }
              : undefined,
          });
          break;
      }
    }

    // Add submit button inside form
    formElements.push({
      tag: 'button',
      text: { tag: 'plain_text', content: modal.submitLabel || 'Submit' },
      type: 'primary',
      name: 'submit',
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
   * Feishu form_value is a flat dict { field_name: value }.
   * We reconstruct the two-level { blockId: { actionId: ModalFieldValue } } structure.
   */
  private normalizeFormValues(formValue: Record<string, any>): Record<string, Record<string, ModalFieldValue>> {
    const normalized: Record<string, Record<string, ModalFieldValue>> = {};

    for (const [fieldName, rawValue] of Object.entries(formValue)) {
      // Field names follow our convention: "{blockId}::{actionId}"
      const sepIdx = fieldName.indexOf('::');
      const blockId = sepIdx >= 0 ? fieldName.substring(0, sepIdx) : fieldName;
      const actionId = sepIdx >= 0 ? fieldName.substring(sepIdx + 2) : fieldName;

      if (!normalized[blockId]) normalized[blockId] = {};

      if (Array.isArray(rawValue)) {
        // Multi-select: array of selected values
        normalized[blockId][actionId] = {
          selectedOptions: rawValue.map(v => ({ value: String(v) })),
        };
      } else if (typeof rawValue === 'string') {
        // Could be a text input value or a single select value
        // Heuristic: if it looks like a select option (short, no spaces), treat as selectedOption
        // Otherwise treat as text input
        normalized[blockId][actionId] = { value: rawValue };
      } else if (rawValue && typeof rawValue === 'object') {
        // Selected option object
        normalized[blockId][actionId] = {
          selectedOption: { value: String(rawValue.value || rawValue) },
        };
      } else {
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
