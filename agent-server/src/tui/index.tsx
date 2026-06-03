#!/usr/bin/env node
// input:  argv → connect → render <App>
// output: M5 Ink TUI client entry point
// pos:    Entry point for cortex-tui

import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { WsClient } from './ws-client.js';
import { isHandshakeAck, isSessionSwitched, isUiQueryResult, isUiEvent, isNotification } from '../platform/tui/protocol.js';
import { CORTEX_VERSION } from '../core/version.js';
import type { TuiFrame } from '../platform/tui/protocol.js';
import type { ResumableSession } from './components/SessionPicker.js';

// ── Argv parsing ──

interface TuiArgs {
  resume: boolean;
  project: string | null;
  port: number;
}

function parseArgs(argv: string[]): TuiArgs {
  const args: TuiArgs = { resume: false, project: null, port: 3003 };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--resume':
        args.resume = true;
        break;
      case '--project':
        args.project = argv[++i] ?? null;
        break;
      case '--port':
        args.port = parseInt(argv[++i] ?? '3003', 10);
        break;
    }
  }

  return args;
}

// ── Main ──

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const client = new WsClient();
  let dispatchFrame: ((frame: TuiFrame) => void) | null = null;
  let ackData: { conduitId: string; serverVersion: string; defaultProjectId: string } | null = null;
  let lastSessionId: string | null = null;
  let currentProjectId: string | null = null;
  let currentSessionName: string | null = null;

  // Resume state: store sessions for interactive picker
  let resumableSessions: ResumableSession[] | null = null;
  let resumePending = false;

  // Connection state
  let connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' = 'disconnected';
  let errorMessage: string | null = null;

  // Track rerender
  let rerender: ((node: React.ReactElement) => void) | null = null;
  let unmount: (() => void) | null = null;

  const doRender = () => {
    const app = React.createElement(App, {
      sendFrame: (frame) => client.send(frame),
      connectionState,
      ack: ackData as any,
      onReconnect: () => {
        errorMessage = null;
        connectionState = 'disconnected';
        client.close();
        doConnect();
      },
      onDisconnect: () => {
        process.exit(0);
      },
      onSendCancel: () => {
        const id = `msg-${Date.now()}`;
        client.send({ type: 'msg.user', id, text: '!cancel' } as any);
      },
      serverVersion: ackData?.serverVersion ?? null,
      projectId: currentProjectId ?? ackData?.defaultProjectId ?? null,
      sessionName: currentSessionName,
      errorMessage,
      onSetDispatch: (dispatch) => { dispatchFrame = dispatch; },
      resumableSessions,
      resumePending,
      onResumeSelect: (sessionId: string, _projectId: string) => {
        resumableSessions = null;
        resumePending = false;
        client.send({
          type: 'session.switch',
          id: 'sess-resume',
          projectId: currentProjectId ?? ackData?.defaultProjectId ?? 'general',
          sessionId,
        } as any);
        doRender();
      },
      onResumeCancel: () => {
        resumableSessions = null;
        resumePending = false;
        client.send({
          type: 'session.switch',
          id: 'sess-fallback',
          projectId: currentProjectId ?? ackData?.defaultProjectId ?? 'general',
          sessionId: null,
        } as any);
        doRender();
      },
    });
    if (rerender) {
      rerender(app);
    } else {
      const instance = render(app, { exitOnCtrlC: false });
      rerender = instance.rerender;
      unmount = instance.unmount;
    }
  };

  const doConnect = () => {
    connectionState = 'connecting';
    doRender();

    // Set resume session before connect so auto-hello includes it
    if (lastSessionId) {
      client.markSessionId(lastSessionId);
    }

    client.connect(`ws://127.0.0.1:${args.port}`, {
      clientVersion: CORTEX_VERSION,
      project: args.project,
      onStateChange: (s) => {
        connectionState = s;
        if (s === 'connected') {
          ackData = client.ack as any;
          errorMessage = null; // clear any prior cap-exceeded error on success
        }
        doRender();
      },
      onFrame: (frame) => {
        if (isHandshakeAck(frame)) {
          ackData = {
            conduitId: frame.conduitId,
            serverVersion: frame.serverVersion,
            defaultProjectId: frame.defaultProjectId,
          };
          client.markAck(frame);
          client.markConnected();

          // Determine initial session
          const project = args.project ?? frame.defaultProjectId;
          currentProjectId = project;

          if (args.resume) {
            resumePending = true;
            client.send({
              type: 'ui.query',
              id: 'sess-list',
              scope: 'sessions.list',
              params: { resumable: true },
            } as any);
          } else {
            // Fresh session
            client.send({
              type: 'session.switch',
              id: 'sess-init',
              projectId: project,
              sessionId: null,
            } as any);
          }

          connectionState = 'connected';
          doRender();
          return;
        }

        if (isSessionSwitched(frame)) {
          lastSessionId = frame.sessionId;
          client.markSessionId(frame.sessionId);
          currentProjectId = frame.projectId;
          currentSessionName = frame.sessionName;
          resumePending = false;
          resumableSessions = null;
          doRender();
          return;
        }

        // Handle resume: ui.queryResult for sessions.list
        if (isUiQueryResult(frame) && frame.id === 'sess-list' && resumePending) {
          if (frame.ok && Array.isArray(frame.data) && frame.data.length > 0) {
            // Store sessions for interactive picker
            resumableSessions = (frame.data as any[]).map((s: any) => ({
              sessionId: s.sessionId ?? s.id,
              name: s.name,
              projectId: s.projectId,
              label: s.label ?? null,
            }));
          }
          // If no sessions, leave resumableSessions as empty array — App renders "no sessions" state
          // Then auto-fallback to fresh session
          if (!frame.ok || !Array.isArray(frame.data) || frame.data.length === 0) {
            resumePending = false;
            client.send({
              type: 'session.switch',
              id: 'sess-fallback',
              projectId: currentProjectId ?? ackData?.defaultProjectId ?? 'general',
              sessionId: null,
            } as any);
          }
          doRender();
          return;
        }

        // Dispatch frame to App for routing (transcript, dashboard, notifications).
        // The App's hooks update React state, which triggers re-render — no extra
        // doRender() here (that caused a full-tree reconcile on every stream token).
        dispatchFrame?.(frame);
      },
      onClose: (reason) => {
        connectionState = 'reconnecting';
        doRender();
      },
      onCapExceeded: () => {
        errorMessage = 'Connection failed — press R to retry, Ctrl+C to exit';
        doRender();
      },
    });
  };

  doConnect();
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
