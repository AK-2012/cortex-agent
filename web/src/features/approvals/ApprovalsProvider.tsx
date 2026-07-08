import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ApprovalCenterModal } from './ApprovalCenterModal';

// Global mount + open/close controller for the approval center overlay (design 7a). A single modal
// instance lives here; the workbench left-rail "N approval pending" banner and the inline chat
// approval card open it via useApprovals().open(). Mirrors the ⌘K palette / exec-log-drawer mounts.

interface ApprovalsContextValue {
  open: () => void;
  close: () => void;
}

const ApprovalsContext = createContext<ApprovalsContextValue | null>(null);

export function ApprovalsProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <ApprovalsContext.Provider value={value}>
      {children}
      <ApprovalCenterModal open={isOpen} onClose={close} />
    </ApprovalsContext.Provider>
  );
}

export function useApprovals(): ApprovalsContextValue {
  const ctx = useContext(ApprovalsContext);
  if (!ctx) {
    throw new Error('useApprovals must be used within an ApprovalsProvider');
  }
  return ctx;
}
