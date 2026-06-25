// input:  Connection state + optional error
// output: Bottom line — hotkey hints always; a connection status only when abnormal
// pos:    Status line for M5 Ink client. The normal "● Connected" text is intentionally
//         hidden — connection only surfaces while connecting/reconnecting/disconnected/error.

import React from 'react';
import { Text } from 'ink';
import type { WsState } from '../ws-client.js';

interface StatusLineProps {
  connectionState: WsState;
  errorMessage?: string | null;
}

const HINTS = 'Ctrl+D Dashboard | Ctrl+N Notifications | Ctrl+P Projects';

export function StatusLine({ connectionState, errorMessage }: StatusLineProps): React.JSX.Element {
  const status = getConnectionStatus(connectionState, errorMessage);
  const color = getStatusColor(connectionState, errorMessage);

  return (
    <Text>
      {status ? <Text color={color}>{status}{' — '}</Text> : null}
      <Text dimColor>{HINTS}</Text>
    </Text>
  );
}

/** Connection status text, or null when connected normally (nothing to show). */
function getConnectionStatus(state: WsState, errorMessage?: string | null): string | null {
  if (errorMessage) return `⚠ ${errorMessage}`;
  if (state === 'reconnecting') return '⟳ Reconnecting...';
  if (state === 'connecting') return '⟳ Connecting...';
  if (state === 'disconnected') return '○ Disconnected — press R to retry, Ctrl+C to exit';
  return null;
}

function getStatusColor(state: WsState, errorMessage?: string | null): string {
  if (errorMessage) return 'red';
  if (state === 'reconnecting' || state === 'connecting') return 'yellow';
  if (state === 'disconnected') return 'red';
  return 'green';
}
