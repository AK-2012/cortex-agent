// input:  All components + hooks
// output: Top-level layout + global key handler for M5 Ink client
// pos:    Main App component wiring all pieces together

import React, { useCallback, useRef, useState } from 'react';
import { Box } from 'ink';
import { Header } from './components/Header.js';
import { Transcript } from './components/Transcript.js';
import { InputBox } from './components/InputBox.js';
import { StatusLine } from './components/StatusLine.js';
import { useTranscript } from './hooks/useTranscript.js';
import { useKeybindings } from './hooks/useKeybindings.js';
import type { WsState } from './ws-client.js';
import type { TuiFrame, HandshakeAck } from '../platform/tui/protocol.js';
import { isHandshakeAck, isSessionSwitched } from '../platform/tui/protocol.js';

// ── Types ──

export interface AppProps {
  sendFrame: (frame: TuiFrame) => void;
  connectionState: WsState;
  ack: HandshakeAck | null;
  onReconnect: () => void;
  onDisconnect: () => void;
  onSendCancel: () => void;
  serverVersion: string | null;
  projectId: string | null;
  sessionName: string | null;
}

export function App({
  sendFrame,
  connectionState,
  ack,
  onReconnect,
  onDisconnect,
  onSendCancel,
  serverVersion,
  projectId,
  sessionName,
}: AppProps): React.JSX.Element {
  const transcript = useTranscript();
  const [queuedCount, setQueuedCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inputDisabled, setInputDisabled] = useState(false);
  const [notificationCount] = useState(0);
  const scrolledUpRef = useRef(false);

  // Frame dispatch
  const handleFrame = useCallback((frame: TuiFrame) => {
    if (isHandshakeAck(frame)) {
      // Connected
      setInputDisabled(false);
      setErrorMessage(null);
      return;
    }

    if (isSessionSwitched(frame)) {
      // Session ready
      setErrorMessage(null);
      return;
    }

    transcript.dispatch(frame);
  }, [transcript]);

  // Submit message
  const handleSubmit = useCallback((text: string) => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sendFrame({
      type: 'msg.user',
      id,
      text,
    });
    setQueuedCount(prev => prev + 1);
    setInputDisabled(true);
  }, [sendFrame]);

  // Cancel (sends !cancel)
  const handleCancel = useCallback(() => {
    onSendCancel();
  }, [onSendCancel]);

  // Clear view
  const handleClearView = useCallback(() => {
    transcript.clear();
  }, [transcript]);

  // Scroll
  const handleScrollUp = useCallback((page?: boolean) => {
    // Transcript handles scroll internally
    scrolledUpRef.current = true;
  }, []);

  const handleScrollDown = useCallback((page?: boolean) => {
    scrolledUpRef.current = false;
  }, []);

  // Keyboard bindings
  useKeybindings({
    onSubmit: handleSubmit,
    onCancel: handleCancel,
    onScrollUp: handleScrollUp,
    onScrollDown: handleScrollDown,
    onClearView: handleClearView,
    onExit: onDisconnect,
  });

  return (
    <Box flexDirection="column" height="100%">
      <Header
        projectId={projectId}
        sessionName={sessionName}
        queuedCount={queuedCount}
        connected={connectionState === 'connected'}
      />

      <Transcript
        messages={transcript.messages}
        ids={transcript.ids}
      />

      <InputBox
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        disabled={inputDisabled}
      />

      <StatusLine
        connectionState={connectionState}
        queuedCount={queuedCount}
        notificationCount={notificationCount}
        errorMessage={errorMessage}
      />
    </Box>
  );
}
