// input:  All components + hooks
// output: Top-level layout + global key handler for M5 Ink client
// pos:    Main App component wiring all pieces together

import React, { useCallback, useRef, useState, useEffect } from 'react';
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
  /**
   * Called when this App component is ready to receive frames for dispatch.
   * The parent (index.tsx) calls this function for each WS frame.
   */
  onSetDispatch?: (dispatch: (frame: TuiFrame) => void) => void;
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
  onSetDispatch,
}: AppProps): React.JSX.Element {
  const transcript = useTranscript();
  const [queuedCount, setQueuedCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inputDisabled, setInputDisabled] = useState(false);
  const [notificationCount] = useState(0);
  const transcriptRef = useRef<{ scrollUp: (page?: boolean) => void; scrollDown: (page?: boolean) => void; scrollToEnd: () => void } | null>(null);

  // Expose transcript dispatch to parent
  useEffect(() => {
    onSetDispatch?.(transcript.dispatch);
  }, [transcript.dispatch, onSetDispatch]);

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
    transcriptRef.current?.scrollUp(page);
  }, []);

  const handleScrollDown = useCallback((page?: boolean) => {
    transcriptRef.current?.scrollDown(page);
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
        ref={transcriptRef}
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
