// input:  platform/types.js (type-only)
// output: M4 TUI wire protocol — TuiFrame union + guards + parseFrame/encodeFrame
// pos:    Contract between M1 (TUI gateway adapter) and M5 (Ink client)
// deps:   zero runtime dependencies; only type-level imports from ../types.js
// >>> If I am updated, update the parent folder's CORTEX.md and ensure
//     ALL_FRAME_TYPES + GUARD_BY_TYPE stay in sync with TuiFrame union. <<<

import type {
  MessageContent, RichBlock, ActionElement,
  ModalDefinition, ModalFieldValue,
} from '../types.js';

// ── Protocol Version ──

export const PROTOCOL_VERSION = 1;

// ── Discriminator String Constants ──

// Lifecycle
export const HANDSHAKE_HELLO       = 'handshake.hello';
export const HANDSHAKE_ACK         = 'handshake.ack';
export const SESSION_SWITCH        = 'session.switch';
export const SESSION_SWITCHED      = 'session.switched';
export const PING                  = 'ping';
export const PONG                  = 'pong';
export const CLOSE                 = 'close';
// Chat outbound (M1 → M5)
export const CHAT_POST             = 'chat.post';
export const CHAT_UPDATE           = 'chat.update';
export const CHAT_DELETE           = 'chat.delete';
export const CHAT_MARK_QUEUED      = 'chat.mark_queued';
// Chat inbound (M5 → M1)
export const MSG_USER              = 'msg.user';
export const MSG_EDIT              = 'msg.edit';
// Streaming
export const STREAM_TEXT           = 'stream.text';
export const STREAM_MUTABLE_OPEN   = 'stream.mutable_open';
export const STREAM_MUTABLE_UPDATE = 'stream.mutable_update';
export const STREAM_FLUSH          = 'stream.flush';
// Interactive
export const INTERACTIVE_POST      = 'interactive.post';
export const MODAL_OPEN            = 'modal.open';
export const MODAL_ACK             = 'modal.ack';
export const ACTION_CLICK          = 'action.click';
export const MODAL_SUBMIT          = 'modal.submit';
// Other
export const TRANSCRIPT_REPLAY     = 'transcript.replay';
export const NOTIFICATION          = 'notification';
// UI side-channel
export const UI_QUERY              = 'ui.query';
export const UI_QUERY_RESULT       = 'ui.query_result';
export const UI_MUTATE             = 'ui.mutate';
export const UI_MUTATE_RESULT      = 'ui.mutate_result';
export const UI_SUBSCRIBE          = 'ui.subscribe';
export const UI_EVENT              = 'ui.event';
export const UI_UNSUBSCRIBE        = 'ui.unsubscribe';
// Error
export const ERROR                 = 'error';

// ── TuiFrame Variants ──

// --- Lifecycle ---

export interface HandshakeHello {
  type: typeof HANDSHAKE_HELLO;
  protocolVersion: number;
  clientInfo?: string;
}

export interface HandshakeAck {
  type: typeof HANDSHAKE_ACK;
  protocolVersion: number;
  serverInfo?: string;
}

export interface SessionSwitch {
  type: typeof SESSION_SWITCH;
  sessionId: string;
  projectId?: string;
}

export interface SessionSwitched {
  type: typeof SESSION_SWITCHED;
  sessionId: string;
  ok: boolean;
}

export interface Ping {
  type: typeof PING;
  timestamp?: number;
}

export interface Pong {
  type: typeof PONG;
  timestamp?: number;
}

export interface Close {
  type: typeof CLOSE;
  reason?: string;
}

// --- Chat outbound (M1 → M5) ---

export interface ChatPost {
  type: typeof CHAT_POST;
  conduit: string;
  content: MessageContent;
  messageId?: string;
  threadId?: string;
}

export interface ChatUpdate {
  type: typeof CHAT_UPDATE;
  conduit: string;
  messageId: string;
  content: MessageContent;
}

export interface ChatDelete {
  type: typeof CHAT_DELETE;
  conduit: string;
  messageId: string;
}

export interface ChatMarkQueued {
  type: typeof CHAT_MARK_QUEUED;
  conduit: string;
  messageId: string;
}

// --- Chat inbound (M5 → M1) ---

export interface MsgUser {
  type: typeof MSG_USER;
  conduit: string;
  text: string;
  senderId: string;
  isBot: boolean;
  messageId?: string;
  threadId?: string;
}

export interface MsgEdit {
  type: typeof MSG_EDIT;
  conduit: string;
  messageId: string;
  newText: string;
}

// --- Streaming ---

export interface StreamText {
  type: typeof STREAM_TEXT;
  conduit: string;
  text: string;
  streamId: string;
}

export interface StreamMutableOpen {
  type: typeof STREAM_MUTABLE_OPEN;
  conduit: string;
  text: string;
  streamId: string;
  mutableId: string;
}

export interface StreamMutableUpdate {
  type: typeof STREAM_MUTABLE_UPDATE;
  conduit: string;
  text: string;
  streamId: string;
  mutableId: string;
}

export interface StreamFlush {
  type: typeof STREAM_FLUSH;
  conduit: string;
  streamId: string;
}

// --- Interactive ---

export interface InteractivePost {
  type: typeof INTERACTIVE_POST;
  conduit: string;
  text: string;
  actions?: ActionElement[];
  richBlocks?: RichBlock[];
}

export interface ModalOpen {
  type: typeof MODAL_OPEN;
  triggerId: string;
  modal: ModalDefinition;
}

export interface ModalAck {
  type: typeof MODAL_ACK;
  ok: boolean;
  errors?: Record<string, string>;
}

export interface ActionClick {
  type: typeof ACTION_CLICK;
  actionId: string;
  value: string;
  triggerId: string;
  conduit?: string;
  messageId?: string;
}

export interface ModalSubmit {
  type: typeof MODAL_SUBMIT;
  callbackId: string;
  values: Record<string, Record<string, ModalFieldValue>>;
  privateMetadata: string;
}

// --- Other ---

export interface TranscriptReplay {
  type: typeof TRANSCRIPT_REPLAY;
  conduit: string;
  messages: { role: string; text: string }[];
  streamId: string;
}

export interface Notification {
  type: typeof NOTIFICATION;
  level: 'info' | 'warn' | 'error';
  message: string;
  title?: string;
}

// --- UI side-channel ---

export interface UiQuery {
  type: typeof UI_QUERY;
  queryId: string;
  selector: string;
}

export interface UiQueryResult {
  type: typeof UI_QUERY_RESULT;
  queryId: string;
  data: unknown;
}

export interface UiMutate {
  type: typeof UI_MUTATE;
  mutationId: string;
  action: string;
  payload: unknown;
}

export interface UiMutateResult {
  type: typeof UI_MUTATE_RESULT;
  mutationId: string;
  ok: boolean;
  error?: string;
}

export interface UiSubscribe {
  type: typeof UI_SUBSCRIBE;
  event: string;
  subId: string;
}

export interface UiEvent {
  type: typeof UI_EVENT;
  event: string;
  subId: string;
  data: unknown;
}

export interface UiUnsubscribe {
  type: typeof UI_UNSUBSCRIBE;
  subId: string;
}

// --- Error ---

export interface ErrorFrame {
  type: typeof ERROR;
  code: number;
  message: string;
  originalType?: string;
}

// ── Discriminated Union ──

export type TuiFrame =
  | HandshakeHello
  | HandshakeAck
  | SessionSwitch
  | SessionSwitched
  | Ping
  | Pong
  | Close
  | ChatPost
  | ChatUpdate
  | ChatDelete
  | ChatMarkQueued
  | MsgUser
  | MsgEdit
  | StreamText
  | StreamMutableOpen
  | StreamMutableUpdate
  | StreamFlush
  | InteractivePost
  | ModalOpen
  | ModalAck
  | ActionClick
  | ModalSubmit
  | TranscriptReplay
  | Notification
  | UiQuery
  | UiQueryResult
  | UiMutate
  | UiMutateResult
  | UiSubscribe
  | UiEvent
  | UiUnsubscribe
  | ErrorFrame;

// ── Guards ──

export function isHandshakeHello(f: TuiFrame): f is HandshakeHello { return f.type === HANDSHAKE_HELLO; }
export function isHandshakeAck(f: TuiFrame): f is HandshakeAck { return f.type === HANDSHAKE_ACK; }
export function isSessionSwitch(f: TuiFrame): f is SessionSwitch { return f.type === SESSION_SWITCH; }
export function isSessionSwitched(f: TuiFrame): f is SessionSwitched { return f.type === SESSION_SWITCHED; }
export function isPing(f: TuiFrame): f is Ping { return f.type === PING; }
export function isPong(f: TuiFrame): f is Pong { return f.type === PONG; }
export function isClose(f: TuiFrame): f is Close { return f.type === CLOSE; }
export function isChatPost(f: TuiFrame): f is ChatPost { return f.type === CHAT_POST; }
export function isChatUpdate(f: TuiFrame): f is ChatUpdate { return f.type === CHAT_UPDATE; }
export function isChatDelete(f: TuiFrame): f is ChatDelete { return f.type === CHAT_DELETE; }
export function isChatMarkQueued(f: TuiFrame): f is ChatMarkQueued { return f.type === CHAT_MARK_QUEUED; }
export function isMsgUser(f: TuiFrame): f is MsgUser { return f.type === MSG_USER; }
export function isMsgEdit(f: TuiFrame): f is MsgEdit { return f.type === MSG_EDIT; }
export function isStreamText(f: TuiFrame): f is StreamText { return f.type === STREAM_TEXT; }
export function isStreamMutableOpen(f: TuiFrame): f is StreamMutableOpen { return f.type === STREAM_MUTABLE_OPEN; }
export function isStreamMutableUpdate(f: TuiFrame): f is StreamMutableUpdate { return f.type === STREAM_MUTABLE_UPDATE; }
export function isStreamFlush(f: TuiFrame): f is StreamFlush { return f.type === STREAM_FLUSH; }
export function isInteractivePost(f: TuiFrame): f is InteractivePost { return f.type === INTERACTIVE_POST; }
export function isModalOpen(f: TuiFrame): f is ModalOpen { return f.type === MODAL_OPEN; }
export function isModalAck(f: TuiFrame): f is ModalAck { return f.type === MODAL_ACK; }
export function isActionClick(f: TuiFrame): f is ActionClick { return f.type === ACTION_CLICK; }
export function isModalSubmit(f: TuiFrame): f is ModalSubmit { return f.type === MODAL_SUBMIT; }
export function isTranscriptReplay(f: TuiFrame): f is TranscriptReplay { return f.type === TRANSCRIPT_REPLAY; }
export function isNotification(f: TuiFrame): f is Notification { return f.type === NOTIFICATION; }
export function isUiQuery(f: TuiFrame): f is UiQuery { return f.type === UI_QUERY; }
export function isUiQueryResult(f: TuiFrame): f is UiQueryResult { return f.type === UI_QUERY_RESULT; }
export function isUiMutate(f: TuiFrame): f is UiMutate { return f.type === UI_MUTATE; }
export function isUiMutateResult(f: TuiFrame): f is UiMutateResult { return f.type === UI_MUTATE_RESULT; }
export function isUiSubscribe(f: TuiFrame): f is UiSubscribe { return f.type === UI_SUBSCRIBE; }
export function isUiEvent(f: TuiFrame): f is UiEvent { return f.type === UI_EVENT; }
export function isUiUnsubscribe(f: TuiFrame): f is UiUnsubscribe { return f.type === UI_UNSUBSCRIBE; }
export function isErrorFrame(f: TuiFrame): f is ErrorFrame { return f.type === ERROR; }

// ── Frame Type Inventory ──

export const ALL_FRAME_TYPES: readonly string[] = [
  HANDSHAKE_HELLO, HANDSHAKE_ACK, SESSION_SWITCH, SESSION_SWITCHED,
  PING, PONG, CLOSE,
  CHAT_POST, CHAT_UPDATE, CHAT_DELETE, CHAT_MARK_QUEUED,
  MSG_USER, MSG_EDIT,
  STREAM_TEXT, STREAM_MUTABLE_OPEN, STREAM_MUTABLE_UPDATE, STREAM_FLUSH,
  INTERACTIVE_POST, MODAL_OPEN, MODAL_ACK, ACTION_CLICK, MODAL_SUBMIT,
  TRANSCRIPT_REPLAY, NOTIFICATION,
  UI_QUERY, UI_QUERY_RESULT, UI_MUTATE, UI_MUTATE_RESULT,
  UI_SUBSCRIBE, UI_EVENT, UI_UNSUBSCRIBE,
  ERROR,
];

export const GUARD_BY_TYPE: Record<string, (f: TuiFrame) => boolean> = {
  [HANDSHAKE_HELLO]:       isHandshakeHello,
  [HANDSHAKE_ACK]:         isHandshakeAck,
  [SESSION_SWITCH]:        isSessionSwitch,
  [SESSION_SWITCHED]:      isSessionSwitched,
  [PING]:                  isPing,
  [PONG]:                  isPong,
  [CLOSE]:                 isClose,
  [CHAT_POST]:             isChatPost,
  [CHAT_UPDATE]:           isChatUpdate,
  [CHAT_DELETE]:           isChatDelete,
  [CHAT_MARK_QUEUED]:      isChatMarkQueued,
  [MSG_USER]:              isMsgUser,
  [MSG_EDIT]:              isMsgEdit,
  [STREAM_TEXT]:           isStreamText,
  [STREAM_MUTABLE_OPEN]:   isStreamMutableOpen,
  [STREAM_MUTABLE_UPDATE]: isStreamMutableUpdate,
  [STREAM_FLUSH]:          isStreamFlush,
  [INTERACTIVE_POST]:      isInteractivePost,
  [MODAL_OPEN]:            isModalOpen,
  [MODAL_ACK]:             isModalAck,
  [ACTION_CLICK]:          isActionClick,
  [MODAL_SUBMIT]:          isModalSubmit,
  [TRANSCRIPT_REPLAY]:     isTranscriptReplay,
  [NOTIFICATION]:          isNotification,
  [UI_QUERY]:              isUiQuery,
  [UI_QUERY_RESULT]:       isUiQueryResult,
  [UI_MUTATE]:             isUiMutate,
  [UI_MUTATE_RESULT]:      isUiMutateResult,
  [UI_SUBSCRIBE]:          isUiSubscribe,
  [UI_EVENT]:              isUiEvent,
  [UI_UNSUBSCRIBE]:        isUiUnsubscribe,
  [ERROR]:                 isErrorFrame,
};

// ── Required Fields (for parseFrame validation) ──

const REQUIRED_FIELDS: Record<string, readonly string[]> = {
  [HANDSHAKE_HELLO]:       ['protocolVersion'],
  [HANDSHAKE_ACK]:         ['protocolVersion'],
  [SESSION_SWITCH]:        ['sessionId'],
  [SESSION_SWITCHED]:      ['sessionId', 'ok'],
  [PING]:                  [],
  [PONG]:                  [],
  [CLOSE]:                 [],
  [CHAT_POST]:             ['conduit', 'content'],
  [CHAT_UPDATE]:           ['conduit', 'messageId', 'content'],
  [CHAT_DELETE]:           ['conduit', 'messageId'],
  [CHAT_MARK_QUEUED]:      ['conduit', 'messageId'],
  [MSG_USER]:              ['conduit', 'text', 'senderId', 'isBot'],
  [MSG_EDIT]:              ['conduit', 'messageId', 'newText'],
  [STREAM_TEXT]:           ['conduit', 'text', 'streamId'],
  [STREAM_MUTABLE_OPEN]:   ['conduit', 'text', 'streamId', 'mutableId'],
  [STREAM_MUTABLE_UPDATE]: ['conduit', 'text', 'streamId', 'mutableId'],
  [STREAM_FLUSH]:          ['conduit', 'streamId'],
  [INTERACTIVE_POST]:      ['conduit', 'text'],
  [MODAL_OPEN]:            ['triggerId', 'modal'],
  [MODAL_ACK]:             ['ok'],
  [ACTION_CLICK]:          ['actionId', 'value', 'triggerId'],
  [MODAL_SUBMIT]:          ['callbackId', 'values', 'privateMetadata'],
  [TRANSCRIPT_REPLAY]:     ['conduit', 'messages', 'streamId'],
  [NOTIFICATION]:          ['level', 'message'],
  [UI_QUERY]:              ['queryId', 'selector'],
  [UI_QUERY_RESULT]:       ['queryId', 'data'],
  [UI_MUTATE]:             ['mutationId', 'action', 'payload'],
  [UI_MUTATE_RESULT]:      ['mutationId', 'ok'],
  [UI_SUBSCRIBE]:          ['event', 'subId'],
  [UI_EVENT]:              ['event', 'subId', 'data'],
  [UI_UNSUBSCRIBE]:        ['subId'],
  [ERROR]:                 ['code', 'message'],
};

// ── Parse / Encode ──

export function parseFrame(raw: string): TuiFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.type !== 'string') return null;

  const required = REQUIRED_FIELDS[p.type];
  if (!required) return null;

  for (const field of required) {
    if (p[field] === undefined || p[field] === null) return null;
  }

  return parsed as TuiFrame;
}

export function encodeFrame(f: TuiFrame): string {
  return JSON.stringify(f);
}

// ── Re-exports from platform/types (convenience, type-only) ──

export type { MessageContent, RichBlock, ActionElement, ModalDefinition, ModalFieldValue } from '../types.js';
