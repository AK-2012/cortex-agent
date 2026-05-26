// input:  Connection state + message counts
// output: Bottom status bar — busy / queued / error / reconnect / notification count
// pos:    Status line for M5 Ink client

import React from 'react';
import { Text } from 'ink';
import type { WsState } from '../ws-client.js';

interface StatusLineProps {
  connectionState: WsState;
  queuedCount: number;
  notificationCount: number;
  errorMessage?: string | null;
}

export function StatusLine({
  connectionState,
  queuedCount,
  notificationCount,
  errorMessage,
}: StatusLineProps): React.JSX.Element {
  const statusText = getStatusText(connectionState, queuedCount, notificationCount, errorMessage);
  const statusColor = getStatusColor(connectionState, errorMessage);

  return (
    <Text color={statusColor} dimColor={connectionState === 'connected' && !errorMessage}>
      {statusText}
      {notificationCount > 0 ? ` | 🔔 ${notificationCount}` : ''}
      {' — '}
      <Text dimColor>Ctrl+D Phase 2 | Ctrl+N Phase 2 | Ctrl+R Phase 2 | Ctrl+P Phase 2</Text>
    </Text>
  );
}

function getStatusText(
  state: WsState,
  queuedCount: number,
  notificationCount: number,
  errorMessage?: string | null,
): string {
  if (errorMessage) return `⚠ ${errorMessage}`;
  if (state === 'reconnecting') return '⟳ Reconnecting...';
  if (state === 'connecting') return '⟳ Connecting...';
  if (state === 'disconnected') return '○ Disconnected — press R to retry, Ctrl+C to exit';
  if (queuedCount > 0) return `⏳ ${queuedCount} queued`;
  return '● Connected';
}

function getStatusColor(state: WsState, errorMessage?: string | null): string {
  if (errorMessage) return 'red';
  if (state === 'reconnecting' || state === 'connecting') return 'yellow';
  if (state === 'disconnected') return 'red';
  return 'green';
}
