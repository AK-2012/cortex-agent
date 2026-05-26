// input:  TuiConnection, protocol types
// output: sendProjectReport / sendSystemNotice — notification fan-out to TUI connections
// pos:    TUI adapter — routes project-report and system-notice to matching conduits
// >>> If I am updated, update the folder's CORTEX.md <<<

import type { TuiConnection } from './tui-connection.js';
import { createLogger } from '@core/log.js';
import type { MessageRef } from '../../types.js';

const log = createLogger('tui-notif');

/**
 * Send a project-report notification. If the connection's active session matches
 * the source session, send as chat.post; otherwise send as notification frame.
 */
export function sendProjectReport(
  connections: TuiConnection[],
  projectId: string,
  sourceSessionId: string,
  title: string,
  body: string,
  ref?: MessageRef,
): void {
  let sent = 0;
  for (const conn of connections) {
    if (conn.activeProjectId !== projectId) continue;
    if (conn.activeSessionId === sourceSessionId) {
      // Render as chat.post in the active session
      const seq = 0;
      conn.send({
        type: 'chat.post',
        ref: ref ?? { conduit: conn.conduitId, messageId: '', threadId: null },
        content: { text: `${title}\n${body}` },
        seq,
      });
    } else {
      // Render as notification
      const seq = 0;
      conn.send({
        type: 'notification',
        kind: 'project-report',
        projectId,
        sessionId: sourceSessionId,
        title,
        body,
        ref,
        seq,
      });
    }
    sent++;
  }
  if (sent === 0) {
    log.warn(`No TUI connections matched project "${projectId}" for project-report`);
  }
}

/**
 * Send a system-notice to all TUI connections.
 */
export function sendSystemNotice(
  connections: TuiConnection[],
  title: string,
  body: string,
): void {
  for (const conn of connections) {
    const seq = 0;
    conn.send({
      type: 'notification',
      kind: 'system-notice',
      projectId: conn.activeProjectId,
      title,
      body,
      seq,
    });
  }
}
