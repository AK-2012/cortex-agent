// input:  src/tui/components/Notifications.jsx (NotificationsBadge)
// output: Tests — badge shows when unreadCount > 0, hides when 0
// pos:    Verifies corner notification badge

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { NotificationsBadge, NotificationsModal } from '../../src/tui/components/Notifications.js';

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

test('NotificationsBadge shows bell when unreadCount > 0', async (t) => {
  const app = React.createElement(NotificationsBadge, { unreadCount: 3 });
  const instance = render(app);
  await delay(100);

  const output = instance.lastFrame();
  assert.ok(output.includes('3'), 'shows count 3');
  assert.ok(output.includes('🔔'), 'shows bell icon');

  instance.unmount();
  instance.cleanup();
});

test('NotificationsBadge hides when unreadCount is 0', async (t) => {
  const app = React.createElement(NotificationsBadge, { unreadCount: 0 });
  const instance = render(app);
  await delay(100);

  const output = instance.lastFrame();
  // Should be null (component returns null when count is 0)
  // Ink-testing-library renders empty string for null
  assert.equal(output?.trim() ?? '', '', 'badge hidden when count is 0');

  instance.unmount();
  instance.cleanup();
});

test('NotificationsModal shows empty state', async (t) => {
  const app = React.createElement(NotificationsModal, {
    open: true,
    notifications: new Map(),
    ids: [],
    onMarkRead: () => {},
    onClose: () => {},
  });
  const instance = render(app);
  await delay(100);

  const output = instance.lastFrame();
  assert.ok(output.includes('No notifications'), 'shows empty state');

  instance.unmount();
  instance.cleanup();
});
