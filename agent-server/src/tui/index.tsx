#!/usr/bin/env node
// input:  argv → connect → render <App>
// output: M5 Ink TUI client entry point
// pos:    Entry point for cortex-tui

import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { WsClient } from './ws-client.js';
import { isHandshakeAck, isSessionSwitched } from '../platform/tui/protocol.js';
import { CORTEX_VERSION } from '../core/version.js';

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
  let ackData: { conduitId: string; serverVersion: string; defaultProjectId: string } | null = null;
  let lastSessionId: string | null = null;
  let currentProjectId: string | null = null;
  let currentSessionName: string | null = null;
  let inputDisabled = false;

  // Connection state
  let connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' = 'disconnected';
  let errorMessage: string | null = null;
  let capExceeded = false;

  // Track rerender
  let rerender: ((node: React.ReactElement) => void) | null = null;
  let unmount: (() => void) | null = null;

  const doRender = () => {
    const app = React.createElement(App, {
      sendFrame: (frame) => client.send(frame),
      connectionState,
      ack: ackData as any,
      onReconnect: () => {
        capExceeded = false;
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
        client.send({ type: 'msg.user', id, text: '!cancel' });
      },
      serverVersion: ackData?.serverVersion ?? null,
      projectId: currentProjectId ?? ackData?.defaultProjectId ?? null,
      sessionName: currentSessionName,
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
            // Send sessions.list query (will be processed when ui.queryResult arrives)
            client.send({
              type: 'ui.query',
              id: 'sess-list',
              scope: 'sessions.list',
              params: { resumable: true },
            });
          } else {
            // Fresh session
            client.send({
              type: 'session.switch',
              id: 'sess-init',
              projectId: project,
              sessionId: null,
            });
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
          inputDisabled = false;
          doRender();
          return;
        }

        // Re-render on relevant frames
        doRender();
      },
      onClose: (reason) => {
        connectionState = 'reconnecting';
        doRender();
      },
      onCapExceeded: () => {
        capExceeded = true;
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
