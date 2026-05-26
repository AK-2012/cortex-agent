// input:  src/platform/tui/protocol.js
// output: Typed WebSocket client wrapping M4 protocol — connect, frame I/O via parseFrame/encodeFrame, reconnect with exponential backoff
// pos:    Foundation for M5 Ink client; zero UI dependency, testable outside React

import WebSocket from 'ws';
import { parseFrame, encodeFrame } from '../platform/tui/protocol.js';
import type { TuiFrame, HandshakeHello, HandshakeAck } from '../platform/tui/protocol.js';

// ── Constants ──

const BACKOFF_MS = [250, 500, 1000, 2000, 4000, 8000]; // then 30_000 cap
const BACKOFF_CAP_MS = 30_000;

// ── Types ──

export type WsState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface WsClientOpts {
  /** Called on successful connection after handshake.ack */
  onConnected?: (ack: HandshakeAck) => void;
  /** Called for every parsed frame received */
  onFrame?: (frame: TuiFrame) => void;
  /** Called when connection closes or fails */
  onClose?: (reason: string) => void;
  /** Called when state changes */
  onStateChange?: (state: WsState) => void;
  /** Called when the exponential backoff cap is exceeded (all attempts exhausted) */
  onCapExceeded?: () => void;
}

// ── Client ──

export class WsClient {
  private _ws: WebSocket | null = null;
  private _address = '';
  private _opts: WsClientOpts = {};
  private _state: WsState = 'disconnected';
  private _lastSessionId: string | null = null;
  private _retryCount = 0;
  private _retryTimer: ReturnType<typeof setTimeout> | null = null;
  private _closed = false; // intentional close — don't reconnect

  /** Latest handshake ack data */
  private _ack: HandshakeAck | null = null;

  get state(): WsState { return this._state; }
  get lastSessionId(): string | null { return this._lastSessionId; }
  get ack(): HandshakeAck | null { return this._ack; }

  // ── Connection ──

  connect(address: string, opts: WsClientOpts = {}): void {
    this._address = address;
    this._opts = opts;
    this._closed = false;
    this._retryCount = 0;
    this._doConnect();
  }

  private _doConnect(): void {
    if (this._closed) return;
    this._setState('connecting');
    this._ws = new WebSocket(this._address);

    this._ws.on('open', () => {
      this._retryCount = 0;
      // Connection is established; handshake.hello will be sent by the consumer
    });

    this._ws.on('message', (data: Buffer) => {
      const raw = data.toString('utf-8');
      const frame = parseFrame(raw);
      if (frame === null) return; // ignore malformed frames
      this._opts.onFrame?.(frame);
    });

    this._ws.on('close', (code: number, reason: Buffer) => {
      this._ws = null;
      const reasonStr = reason.toString('utf-8') || `code=${code}`;

      if (this._state === 'connected') {
        // Unexpected disconnect — reconnect
        this._scheduleReconnect(reasonStr);
      } else if (this._state === 'connecting') {
        // Connection failed — retry
        this._scheduleReconnect(reasonStr);
      }
    });

    this._ws.on('error', () => {
      // Error event is followed by close, so we handle cleanup in on('close')
    });
  }

  // ── Sending ──

  send(frame: TuiFrame): void {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(encodeFrame(frame));
    }
  }

  // ── Handshake helpers ──

  markAck(ack: HandshakeAck): void {
    this._ack = ack;
  }

  markSessionId(id: string): void {
    this._lastSessionId = id;
  }

  markConnected(): void {
    this._setState('connected');
  }

  // ── Reconnect ──

  private _scheduleReconnect(reason: string): void {
    if (this._closed) return;
    this._setState('reconnecting');
    this._opts.onClose?.(reason);

    const delay = this._retryCount < BACKOFF_MS.length
      ? BACKOFF_MS[this._retryCount]
      : BACKOFF_CAP_MS;

    this._retryCount++;

    // Check cap exceeded
    if (this._retryCount > BACKOFF_MS.length + 3) {
      this._opts.onCapExceeded?.();
      return;
    }

    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._doConnect();
    }, delay);
  }

  // ── Close ──

  close(): void {
    this._closed = true;
    if (this._retryTimer !== null) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._setState('disconnected');
  }

  // ── Internal ──

  private _setState(state: WsState): void {
    if (this._state !== state) {
      this._state = state;
      this._opts.onStateChange?.(state);
    }
  }
}

export function createHandshakeHello(clientVersion: string, resume?: string | null, project?: string | null): HandshakeHello {
  const hello: HandshakeHello = {
    type: 'handshake.hello',
    protocolVersion: 1,
    clientName: 'cortex-tui',
    clientVersion,
  };
  if (resume) hello.resume = { sessionId: resume };
  if (project) hello.project = project;
  return hello;
}
