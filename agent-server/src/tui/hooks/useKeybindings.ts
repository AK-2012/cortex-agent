// input:  ink useInput hook
// output: Global key handlers for M5 Ink client
// pos:    Single source of truth for keyboard shortcuts

import { useInput } from 'ink';
import { useCallback, useRef } from 'react';

export interface KeybindingHandlers {
  onSubmit: (text: string) => void;
  onCancel: () => void;
  onScrollUp: (page?: boolean) => void;
  onScrollDown: (page?: boolean) => void;
  onClearView: () => void;
  onExit: () => void;
  onToggleSidePanel?: () => void; // Ctrl+D
  onToggleNotifications?: () => void; // Ctrl+N
  onToggleProjectSwitcher?: () => void; // Ctrl+P
}

export function useKeybindings(handlers: KeybindingHandlers, isActive = true): void {
  const lastCtrlCTs = useRef(0);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useInput((input, key) => {
    if (!isActive) return;
    const h = handlersRef.current;

    // Ctrl+C: first sends !cancel, second within 1s exits
    if (input === 'c' && key.ctrl) {
      const now = Date.now();
      if (now - lastCtrlCTs.current < 1000) {
        h.onExit();
        return;
      }
      lastCtrlCTs.current = now;
      h.onCancel(); // sends !cancel
      return;
    }

    // Enter: submit
    if (key.return) {
      return;
    }

    // Escape: cancel current input
    if (key.escape) {
      h.onCancel();
      return;
    }

    // Ctrl+L: clear transcript view
    if (input === 'l' && key.ctrl) {
      h.onClearView();
      return;
    }

    // Ctrl+D: toggle side panel
    if (input === 'd' && key.ctrl) {
      h.onToggleSidePanel?.();
      return;
    }

    // Ctrl+N: open notifications
    if (input === 'n' && key.ctrl) {
      h.onToggleNotifications?.();
      return;
    }

    // Ctrl+P: open project switcher
    if (input === 'p' && key.ctrl) {
      h.onToggleProjectSwitcher?.();
      return;
    }

    // ↑/↓: scroll
    if (key.upArrow) {
      h.onScrollUp();
      return;
    }
    if (key.downArrow) {
      h.onScrollDown();
      return;
    }

    // PgUp/PgDn: paginated scroll
    if (key.pageUp) {
      h.onScrollUp(true);
      return;
    }
    if (key.pageDown) {
      h.onScrollDown(true);
      return;
    }
  });
}
